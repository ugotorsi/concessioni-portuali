import { randomUUID } from "node:crypto";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { formatDateIT } from "@/lib/utils";
import { associateLegacyActDraftAction, createActDraftAction } from "@/server/actions/fascicolo-acts";
import { updateOperationalActivityAction } from "@/server/actions/fascicolo-operational-activities";
import { reviewOperationalProposalAction } from "@/server/actions/fascicolo-operational-proposals";
import { requestFascicoloAnalysisRefreshAction } from "@/server/actions/fascicolo-analysis-refresh";
import type { KnowledgeCorpusDrift } from "@/server/queries/knowledge-corpus-drift";
import { archiveStructuredFascicoloReportAction } from "@/server/actions/structured-fascicolo-report";
import { ACT_DRAFT_STATUS_LABELS, actDraftMatchesTemplate, type ActDraft } from "@/server/fascicolo-acts/model";
import { reportPlanTemplateKey } from "@/server/fascicolo-acts/templates";
import { matchProposalActivity } from "@/server/fascicolo-operational-proposals/activity-matching";
import {
  ACTIVITY_STATUS_LABELS,
  activityForKey,
  activityNeedsReview,
  activityProgress,
  openActivityDependencies,
  type ActivityCommand,
  type ActivityRecord,
  type ActivitySpec,
} from "@/server/fascicolo-operational-activities/model";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

import { PreviewValue, type FascicoloProposal } from "./FascicoloProposals";

const fieldClass = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

const errorMessages: Record<string, string> = {
  AUTHORITY_MISMATCH: "Il profilo o l'ente non sono autorizzati a modificare questa attività.",
  IDEMPOTENCY_CONFLICT: "Questa richiesta è già stata usata per un'operazione differente.",
  STALE_VERSION: "L'attività è stata modificata da un altro utente. Ricaricare e verificare la versione corrente.",
  STALE_SPEC: "Il quadro documentale o giuridico non è più attuale. Aggiornare l'analisi e riesaminare l'attività.",
  INVALID_TRANSITION: "Il passaggio richiesto non è consentito nello stato corrente.",
  NOT_JUSTIFIED: "L'iniziativa non è giustificata dagli elementi attualmente disponibili.",
  DEPENDENCY_BLOCKED: "L'attività è bloccata o richiede il completamento verificato delle attività presupposte.",
  INVALID_DEPENDENCY: "La dipendenza o l'attività condivisa non è valida per questo fascicolo.",
  DEPENDENCY_CYCLE: "Le dipendenze selezionate formano un ciclo.",
  SHARING_CONFLICT: "L'attività selezionata ha già una propria cronologia o è condivisa altrove.",
  UNKNOWN_DOCUMENT: "Uno dei documenti selezionati non appartiene al procedimento corrente.",
  EVIDENCE_UNAVAILABLE: "Un documento selezionato non ha un file accessibile e integro. Verificarlo o acquisirlo nuovamente nella sezione Documenti.",
  EVIDENCE_CHANGED: "La versione di un documento è cambiata o non era stata verificata. Aggiornare le registrazioni di esecuzione e riscontro prima della chiusura.",
  INVALID_DRAFT: "La bozza o la sua versione corrente non è valida per il passaggio richiesto.",
  INVALID_DATE: "La data indicata non è coerente con l'esecuzione o con il riscontro.",
  DUE_EVIDENCE_REQUIRED: "Il termine richiede una verifica motivata e almeno un documento di riferimento.",
  INVALID_ALTERNATIVE: "L'alternativa selezionata non appartiene al percorso corrente.",
  APPROVAL_NOT_AVAILABLE: "La proposta approvata non coincide più con il percorso corrente: serve una nuova valutazione.",
  CORRUPT_HISTORY: "La cronologia non è integra e richiede una verifica amministrativa.",
  INVALID_INPUT: "Verificare i campi obbligatori, le date e la motivazione inserita.",
  UNEXPECTED_ERROR: "Non è stato possibile aggiornare l'attività. L'errore è stato registrato.",
};

const eventLabels: Record<ActivityCommand["kind"], string> = {
  APPROVE: "Approvazione dell'iniziativa",
  ADOPT_APPROVAL: "Recepimento della proposta approvata",
  REEVALUATE_PROPOSAL: "Nuova valutazione della proposta",
  TAKE_CHARGE: "Presa in carico",
  CONFIGURE: "Aggiornamento dei collegamenti",
  PREPARE_DRAFT: "Predisposizione della bozza",
  VALIDATE_DRAFT: "Validazione della versione",
  RECORD_EXECUTION: "Registrazione dell'esecuzione",
  RECORD_OUTCOME: "Acquisizione del riscontro",
  VERIFY_COMPLETION: "Completamento verificato",
  BLOCK: "Blocco motivato",
  UNBLOCK: "Rimozione del blocco",
  EXCLUDE: "Iniziativa esclusa",
  RECONFIRM: "Riesame del quadro aggiornato",
  REOPEN: "Riapertura motivata",
};

interface FormContext {
  procedimentoId: string;
  reportFingerprint: string;
  corpusFingerprint: string;
  spec: ActivitySpec;
  record: ActivityRecord | undefined;
}

/** First sentence of a long analysis, so the issue header stays scannable; the full text remains expandable. */
function leadSentence(text: string): string {
  const match = /^[\s\S]{40,}?[.;](?=\s+[A-ZÀ-Ú«])/.exec(text);
  return match ? match[0] : text;
}

function HiddenFields({ context, kind }: { context: FormContext; kind: ActivityCommand["kind"] }) {
  return (
    <>
      <input type="hidden" name="procedimentoId" value={context.procedimentoId} />
      <input type="hidden" name="activityKey" value={context.spec.activityKey} />
      <input type="hidden" name="expectedVersion" value={context.record?.current.version ?? 0} />
      <input type="hidden" name="expectedSpecFingerprint" value={context.spec.fingerprint} />
      <input type="hidden" name="expectedReportFingerprint" value={context.reportFingerprint} />
      <input type="hidden" name="expectedCorpusFingerprint" value={context.corpusFingerprint} />
      <input type="hidden" name="requestId" value={randomUUID()} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
}

function NoteField() {
  return (
    <label className="block text-xs font-medium text-slate-700">
      Motivazione o descrizione
      <textarea name="note" required minLength={3} maxLength={4000} rows={2} className={`${fieldClass} mt-1`} />
    </label>
  );
}

function ConfirmField({ label }: { label: string }) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-700">
      <input type="checkbox" name="confirmed" value="true" required className="mt-0.5" />
      <span>{label}</span>
    </label>
  );
}

function SimpleCommand({
  context, kind, label, confirmation, proposalId, expectedReviewVersion, expectedProposalStatus, manualReview,
}: {
  context: FormContext;
  kind: "APPROVE" | "ADOPT_APPROVAL" | "REEVALUATE_PROPOSAL" | "TAKE_CHARGE" | "VERIFY_COMPLETION" | "BLOCK" | "UNBLOCK" | "EXCLUDE" | "RECONFIRM" | "REOPEN";
  label: string;
  confirmation?: string;
  proposalId?: string;
  expectedReviewVersion?: number;
  expectedProposalStatus?: "REJECTED" | "APPROVED" | "AMENDED_AND_APPROVED";
  manualReview?: boolean;
}) {
  return (
    <form action={updateOperationalActivityAction} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <HiddenFields context={context} kind={kind} />
      {proposalId ? <input type="hidden" name="proposalId" value={proposalId} /> : null}
      {expectedReviewVersion !== undefined ? <input type="hidden" name="expectedReviewVersion" value={expectedReviewVersion} /> : null}
      {expectedProposalStatus ? <input type="hidden" name="expectedProposalStatus" value={expectedProposalStatus} /> : null}
      {manualReview ? <input type="hidden" name="manualReview" value="true" /> : null}
      <NoteField />
      {confirmation ? <ConfirmField label={confirmation} /> : null}
      <Button type="submit" size="sm" variant="outline">{label}</Button>
    </form>
  );
}

function ActivityHistory({
  record, specs, drafts, documents, procedimentoId,
}: {
  record: ActivityRecord;
  specs: readonly ActivitySpec[];
  drafts: readonly ActDraft[];
  documents: ReadonlyArray<{ id: string; nome: string }>;
  procedimentoId: string;
}) {
  const documentNames = new Map(documents.map((document) => [document.id, document.nome]));
  const documentList = (ids: readonly string[]) => ids.map((id) =>
    documentNames.get(id) ?? "Documento non più disponibile").join("; ");
  const activityList = (keys: readonly string[]) => keys.map((key) =>
    specs.find((spec) => spec.activityKey === key)?.title ?? "Attività non presente nel percorso corrente").join("; ");
  const savedAt = new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome",
  });
  return (
    <details className="text-xs text-slate-700">
      <summary className="cursor-pointer font-medium">Cronologia completa ({record.history.length})</summary>
      <ol className="mt-2 space-y-3 border-l border-slate-300 pl-3">
        {record.history.map((version) => (
          <li key={version.version} className="space-y-1">
            <p className="font-medium">
              Versione {version.version} · {eventLabels[version.event]} · {savedAt.format(version.savedAt)}
              {version.savedBy ? ` · ${version.savedBy}` : ""}
            </p>
            <p>{version.eventNote}</p>
            <p>Stato: {ACTIVITY_STATUS_LABELS[version.status]}{version.blockedReason ? `; blocco: ${version.blockedReason}` : ""}.</p>
            {version.issueText ? <p>Problematica: {version.issueText}</p> : null}
            {version.assignee ? <p>Responsabile: {version.assignee}.</p> : null}
            {version.dueDate ? <p>Termine verificato: {version.dueDate} — {version.dueDateReason}; documenti: {documentList(version.dueDateDocumentIds)}.</p> : null}
            {version.dependencyKeys.length ? <p>Presupposti: {activityList(version.dependencyKeys)}.</p> : null}
            {version.sharedActivities.length ? <p>Condivisioni: {activityList(version.sharedActivities.map((item) => item.activityKey))}.</p> : null}
            {version.attachedDocumentIds.length ? <p>Documenti collegati: {documentList(version.attachedDocumentIds)}.</p> : null}
            {version.drafts.length ? (
              <p>Bozze: {version.drafts.map((link, index) => {
                const draft = drafts.find((item) => item.draftKey === link.draftKey);
                return (
                  <span key={link.templateKey}>
                    {index ? "; " : ""}
                    <Link className="text-sky-700 underline" href={`/procedimenti/${procedimentoId}?section=acts#draft-${link.draftKey}`}>
                      {draft?.current.title ?? "Bozza non più disponibile"}
                    </Link>
                    {` · versione predisposta ${link.preparedVersion}${link.validatedVersion ? `, validata ${link.validatedVersion}` : ", non validata"}`}
                  </span>
                );
              })}.</p>
            ) : null}
            {version.execution ? <p>Esecuzione {version.execution.date}: {version.execution.description} — {documentList(version.execution.documentIds)}.</p> : null}
            {version.outcome ? <p>Riscontro {version.outcome.date}: {version.outcome.description} — {documentList(version.outcome.documentIds)}{version.outcome.alternativeTitle ? `; alternativa: ${version.outcome.alternativeTitle}` : ""}.</p> : null}
            {version.completionNote ? <p>Completamento: {version.completionNote}.</p> : null}
            {version.completionReviewMode === "MANUAL_CORPUS" ? <p>Chiusura fondata sulla verifica manuale del fascicolo; il rapporto non è stato aggiornato automaticamente.</p> : null}
            {version.exclusionNote ? <p>Esclusione: {version.exclusionNote}.</p> : null}
            {version.approvalReviewStatus ? <p>Nuova valutazione della revisione {version.approvalReviewVersion}; la decisione precedente resta nello storico delle proposte.</p> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function ConfigurationForm({
  context, specs, records, documents,
}: {
  context: FormContext;
  specs: readonly ActivitySpec[];
  records: readonly ActivityRecord[];
  documents: ReadonlyArray<{ id: string; nome: string }>;
}) {
  const current = context.record?.current;
  if (!current) return null;
  const dependencies = specs.filter((item) => item.activityKey !== context.spec.activityKey);
  const sharing = specs.filter((item) => item.issueSemanticKey !== context.spec.issueSemanticKey
    && (!activityForKey(records, item.activityKey)
      || activityForKey(records, item.activityKey)?.activityKey === context.spec.activityKey));
  return (
    <details className="rounded-md border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium">Responsabile, termini, documenti e collegamenti</summary>
      <form action={updateOperationalActivityAction} className="mt-3 space-y-3">
        <HiddenFields context={context} kind="CONFIGURE" />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">Responsabile o ufficio
            <input name="assignee" defaultValue={current.assignee ?? ""} maxLength={200} className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-700">Termine verificato, se esistente
            <input type="date" name="dueDate" defaultValue={current.dueDate ?? ""} className={`${fieldClass} mt-1`} />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-700">Motivo e fondamento del termine
          <textarea name="dueDateReason" defaultValue={current.dueDateReason ?? ""} maxLength={2000} rows={2} className={`${fieldClass} mt-1`} />
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" name="dueDateVerified" value="true" defaultChecked={Boolean(current.dueDate)} className="mt-0.5" />
          <span>Ho verificato il termine e la sua applicabilità; se non esiste, lasciare vuota la data.</span>
        </label>
        {documents.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">Documenti che fondano il termine
              <select name="dueDateDocumentIds" multiple defaultValue={current.dueDateDocumentIds} className={`${fieldClass} mt-1`} size={Math.min(5, documents.length)}>
                {documents.map((document) => <option key={document.id} value={document.id}>{document.nome}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">Altri documenti collegati all&apos;attività
              <select name="attachedDocumentIds" multiple defaultValue={current.attachedDocumentIds} className={`${fieldClass} mt-1`} size={Math.min(5, documents.length)}>
                {documents.map((document) => <option key={document.id} value={document.id}>{document.nome}</option>)}
              </select>
            </label>
          </div>
        ) : <p className="text-xs text-slate-600">Per collegare evidenze, acquisire prima i documenti nella sezione Documenti.</p>}
        {dependencies.length ? (
          <label className="block text-xs font-medium text-slate-700">Attività presupposte
            <select name="dependencyKeys" multiple defaultValue={current.dependencyKeys} className={`${fieldClass} mt-1`} size={Math.min(5, dependencies.length)}>
              {dependencies.map((item) => <option key={item.activityKey} value={item.activityKey}>{item.issueText} — {item.title}</option>)}
            </select>
          </label>
        ) : null}
        {sharing.length ? (
          <label className="block text-xs font-medium text-slate-700">Stesso lavoro condiviso con altre problematiche
            <select name="sharedActivityKeys" multiple defaultValue={current.sharedActivities.map((item) => item.activityKey)} className={`${fieldClass} mt-1`} size={Math.min(5, sharing.length)}>
              {sharing.map((item) => <option key={item.activityKey} value={item.activityKey}>{item.issueText} — {item.title}</option>)}
            </select>
            <span className="mt-1 block font-normal">Selezionare solo attività effettivamente coincidenti, dopo verifica professionale.</span>
          </label>
        ) : null}
        <NoteField />
        <Button type="submit" size="sm">Salva collegamenti</Button>
      </form>
    </details>
  );
}

function EvidenceForm({
  context, kind, documents, alternatives,
}: {
  context: FormContext;
  kind: "RECORD_EXECUTION" | "RECORD_OUTCOME";
  documents: ReadonlyArray<{ id: string; nome: string }>;
  alternatives: ActivitySpec["alternatives"];
}) {
  const correcting = kind === "RECORD_EXECUTION"
    ? ["EXECUTED", "OUTCOME_RECORDED"].includes(context.record?.current.status ?? "")
    : context.record?.current.status === "OUTCOME_RECORDED";
  const label = kind === "RECORD_EXECUTION"
    ? correcting ? "Aggiorna esecuzione o comunicazione" : "Registra esecuzione o comunicazione"
    : correcting ? "Aggiorna riscontro ed esito" : "Registra riscontro ed esito";
  return (
    <details className="rounded-md border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <form action={updateOperationalActivityAction} className="mt-3 space-y-3">
        <HiddenFields context={context} kind={kind} />
        {correcting && kind === "RECORD_EXECUTION" ? (
          <p className="text-xs text-amber-900">L&apos;aggiornamento conserva lo storico, ma richiede di registrare nuovamente il riscontro.</p>
        ) : null}
        <label className="block text-xs font-medium text-slate-700">Data effettiva
          <input type="date" name="date" required className={`${fieldClass} mt-1`} />
        </label>
        {documents.length ? (
          <label className="block text-xs font-medium text-slate-700">Documenti che comprovano il passaggio
            <select name="documentIds" multiple required className={`${fieldClass} mt-1`} size={Math.min(5, documents.length)}>
              {documents.map((document) => <option key={document.id} value={document.id}>{document.nome}</option>)}
            </select>
          </label>
        ) : (
          <p className="text-xs text-amber-900">
            Acquisire prima almeno un documento nella <Link className="underline" href={`/procedimenti/${context.procedimentoId}?section=documents`}>sezione Documenti</Link>.
          </p>
        )}
        <p className="text-xs text-slate-600">Sono accettati soltanto file disponibili con integrità verificata; la versione viene conservata nello storico.</p>
        {kind === "RECORD_OUTCOME" && alternatives.length ? (
          <label className="block text-xs font-medium text-slate-700">Alternativa valutata, se pertinente
            <select name="alternativeTitle" defaultValue="" className={`${fieldClass} mt-1`}>
              <option value="">Nessuna alternativa selezionata</option>
              {alternatives.map((alternative) => <option key={alternative.title} value={alternative.title}>{alternative.title}</option>)}
            </select>
          </label>
        ) : null}
        <NoteField />
        <Button type="submit" size="sm" disabled={documents.length === 0}>{label}</Button>
      </form>
    </details>
  );
}

function DraftsForActivity({
  context, drafts, canManage,
}: {
  context: FormContext;
  drafts: readonly ActDraft[];
  canManage: boolean;
}) {
  const { spec, record, procedimentoId } = context;
  if (!spec.documents.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-800">Atti pertinenti</p>
      {spec.documents.map((document) => {
        const linked = drafts.filter((draft) => actDraftMatchesTemplate(draft, {
          templateKey: document.templateKey, issueSemanticKey: spec.issueSemanticKey,
          legacyTemplateKeys: document.legacyTemplateKeys,
        }));
        const possibleLegacy = [
          `PLAN:${document.title}`,
          reportPlanTemplateKey(spec.issueSemanticKey, spec.title, document.title),
        ].filter((key) => key !== document.templateKey && !document.legacyTemplateKeys.includes(key));
        const ambiguousDrafts = drafts.filter((draft) => possibleLegacy.some((key) =>
            actDraftMatchesTemplate(draft, { templateKey: key, issueSemanticKey: spec.issueSemanticKey })));
        const ambiguous = ambiguousDrafts.length > 0;
        const canLink = canManage && record && ["IN_PROGRESS", "DRAFT_PREPARATION", "DRAFT_VALIDATED"].includes(record.current.status)
          && !record.current.blockedReason;
        return (
          <div key={document.templateKey} className="rounded-md border border-slate-200 bg-white p-3 text-xs">
            <p className="font-semibold text-slate-900">{document.title}</p>
            {linked.map((draft) => {
              const link = record?.current.drafts.find((item) =>
                item.templateKey === document.templateKey && item.draftKey === draft.draftKey);
              return (
                <div key={draft.draftKey} className="mt-2 space-y-2">
                  <Link className="text-sky-700 underline" href={`/procedimenti/${procedimentoId}?section=acts#draft-${draft.draftKey}`}>
                    {draft.current.title} · v{draft.current.version} · {ACT_DRAFT_STATUS_LABELS[draft.current.status]}
                  </Link>
                  {link ? <p>Collegata alla versione {link.preparedVersion}{link.validatedVersion ? `; validata v${link.validatedVersion}` : "; non ancora validata"}.</p> : null}
                  {draft.current.status === "ARCHIVIATA" ? (
                    <p>La bozza è archiviata: verificare se ripristinarla prima di associarla.</p>
                  ) : canLink ? (
                    <div className="flex flex-wrap gap-2">
                      {(!link || link.preparedVersion !== draft.current.version) ? (
                        <form action={updateOperationalActivityAction} className="space-y-1">
                          <HiddenFields context={context} kind="PREPARE_DRAFT" />
                          <input type="hidden" name="templateKey" value={document.templateKey} />
                          <input type="hidden" name="draftKey" value={draft.draftKey} />
                          <input type="hidden" name="draftVersion" value={draft.current.version} />
                          <input name="note" required minLength={3} maxLength={4000} placeholder="Nota sul collegamento" className={fieldClass} />
                          <Button type="submit" size="sm" variant="outline">Collega versione</Button>
                        </form>
                      ) : null}
                      {link && draft.current.status === "APPROVATA_INTERNAMENTE"
                        && link.validatedVersion !== draft.current.version ? (
                          <form action={updateOperationalActivityAction} className="space-y-1">
                            <HiddenFields context={context} kind="VALIDATE_DRAFT" />
                            <input type="hidden" name="templateKey" value={document.templateKey} />
                            <input type="hidden" name="draftKey" value={draft.draftKey} />
                            <input type="hidden" name="draftVersion" value={draft.current.version} />
                            <input name="note" required minLength={3} maxLength={4000} placeholder="Motivo della validazione" className={fieldClass} />
                            <Button type="submit" size="sm" variant="outline">Valida versione corrente</Button>
                          </form>
                        ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!linked.length && ambiguous ? (
              <div className="mt-2 space-y-3 text-amber-900">
                <p>Esistono bozze precedenti con attribuzione ambigua. Esaminare il contenuto e associare solo quella pertinente; le altre non vengono modificate o eliminate.</p>
                {ambiguousDrafts.map((draft) => (
                  <div key={draft.draftKey} className="space-y-2 border-t border-amber-200 pt-2">
                    <Link className="text-sky-700 underline" href={`/procedimenti/${procedimentoId}?section=acts#draft-${draft.draftKey}`}>
                      {draft.current.title} · v{draft.current.version} · {formatDateIT(draft.current.savedAt)}
                      {draft.current.savedBy ? ` · ${draft.current.savedBy}` : ""}
                    </Link>
                    {canLink ? (
                      <form action={associateLegacyActDraftAction} className="space-y-2">
                        <input type="hidden" name="procedimentoId" value={procedimentoId} />
                        <input type="hidden" name="activityKey" value={spec.activityKey} />
                        <input type="hidden" name="expectedActivityVersion" value={record.current.version} />
                        <input type="hidden" name="expectedSpecFingerprint" value={spec.fingerprint} />
                        <input type="hidden" name="expectedReportFingerprint" value={context.reportFingerprint} />
                        <input type="hidden" name="expectedCorpusFingerprint" value={context.corpusFingerprint} />
                        <input type="hidden" name="templateKey" value={document.templateKey} />
                        <input type="hidden" name="draftKey" value={draft.draftKey} />
                        <input type="hidden" name="expectedDraftVersion" value={draft.current.version} />
                        <label className="block font-medium">Motivo dell&apos;associazione
                          <textarea name="note" required minLength={3} maxLength={1900} rows={2} className={`${fieldClass} mt-1`} />
                        </label>
                        <ConfirmField label="Ho confrontato la bozza con questa attività e questo documento. L'associazione crea una nuova versione; una precedente approvazione interna richiederà nuova verifica." />
                        <Button type="submit" size="sm" variant="outline">Associa questa bozza</Button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {!linked.length && !ambiguous && canLink ? (
              <form action={createActDraftAction} className="mt-2">
                <input type="hidden" name="procedimentoId" value={procedimentoId} />
                <input type="hidden" name="activityKey" value={spec.activityKey} />
                <input type="hidden" name="expectedActivityVersion" value={record.current.version} />
                <input type="hidden" name="expectedSpecFingerprint" value={spec.fingerprint} />
                <input type="hidden" name="expectedReportFingerprint" value={context.reportFingerprint} />
                <input type="hidden" name="expectedCorpusFingerprint" value={context.corpusFingerprint} />
                <input type="hidden" name="templateKey" value={document.templateKey} />
                <Button type="submit" size="sm" variant="outline">Apri o crea bozza</Button>
              </form>
            ) : null}
            {!linked.length && !ambiguous && canManage && !canLink ? (
              <p className="mt-2 text-slate-600">La predisposizione è disponibile dopo la presa in carico.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function matchingProposal(
  spec: ActivitySpec,
  specs: readonly ActivitySpec[],
  proposals: readonly FascicoloProposal[],
  reportFingerprint: string,
): FascicoloProposal | undefined {
  const candidates = proposals.filter((proposal) => matchProposalActivity(proposal, spec, specs) !== null);
  return candidates.find((proposal) => proposal.structuredReportFingerprint === reportFingerprint
    && !proposal.supersededAt && ["PROPOSED", "APPROVED", "AMENDED_AND_APPROVED", "REJECTED"].includes(proposal.status))
    ?? candidates.find((proposal) => ["APPROVED", "AMENDED_AND_APPROVED", "REJECTED"].includes(proposal.status));
}

function ActivityCard({
  spec, specs, records, drafts, documents, proposals, reportFingerprint, corpusFingerprint, procedimentoId, canManage, analysisCurrent,
}: {
  spec: ActivitySpec;
  specs: readonly ActivitySpec[];
  records: readonly ActivityRecord[];
  drafts: readonly ActDraft[];
  documents: ReadonlyArray<{ id: string; nome: string }>;
  proposals: readonly FascicoloProposal[];
  reportFingerprint: string;
  corpusFingerprint: string;
  procedimentoId: string;
  canManage: boolean;
  analysisCurrent: boolean;
}) {
  const record = activityForKey(records, spec.activityKey);
  const shared = record && record.activityKey !== spec.activityKey;
  const context = { procedimentoId, reportFingerprint, corpusFingerprint, spec, record };
  const corpus = { fingerprint: corpusFingerprint, analysisCurrent };
  const needsReview = record ? activityNeedsReview(record, specs, corpus) : false;
  const openDependencies = record ? openActivityDependencies(record, records, specs, corpus) : [];
  const proposal = matchingProposal(spec, specs, proposals, reportFingerprint);
  const proposalCurrent = proposal?.structuredReportFingerprint === reportFingerprint && !proposal.supersededAt;
  const status = record?.current.status;
  const blocked = Boolean(record?.current.blockedReason || openDependencies.length);
  const validDrafts = record && spec.documents.every((document) => {
    const link = record.current.drafts.find((item) => item.templateKey === document.templateKey);
    const draft = link && drafts.find((item) => item.draftKey === link.draftKey);
    return link?.validatedVersion !== null && link?.validatedVersion === draft?.current.version
      && draft?.current.status === "APPROVATA_INTERNAMENTE";
  });
  const documentNames = new Map(documents.map((item) => [item.id, item.nome]));
  const evidenceNames = (ids: readonly string[]) => ids.map((id) => documentNames.get(id) ?? "Documento non più disponibile").join("; ");
  return (
    <article id={`activity-${spec.activityKey}`} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-semibold text-slate-950">{spec.title}</h4>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-700">
          {status ? ACTIVITY_STATUS_LABELS[status] : "Da valutare"}
        </span>
      </div>
      <p className="text-sm text-slate-700">{spec.action}</p>
      <p className="text-xs text-slate-600">
        {spec.necessity === "REQUIRED" ? "Attività necessaria" : spec.necessity === "NOT_JUSTIFIED" ? "Iniziativa non giustificata allo stato" : "Attività eventuale: verificare i presupposti"}
        {" · "}Interlocutore: {spec.office}
      </p>
      {shared && record ? (
        <p className="text-xs text-sky-800">
          Attività condivisa: <Link className="underline" href={`/procedimenti/${procedimentoId}?section=proposals&activity=${record.activityKey}#activity-${record.activityKey}`}>aprire la cronologia principale</Link>. Il lavoro non viene duplicato.
        </p>
      ) : null}
      {needsReview || (record && !analysisCurrent && !(status === "COMPLETED"
        && record.current.completionReviewMode === "MANUAL_CORPUS"
        && record.current.completionCorpusFingerprint === corpusFingerprint)) ? (
          <p className="text-xs font-semibold text-amber-900">Il quadro è cambiato: il professionista deve riesaminare questa attività.</p>
        ) : null}
      {!record && proposal?.status === "PROPOSED" && (!proposalCurrent || !analysisCurrent) ? (
        <p className="text-xs font-semibold text-amber-900">
          Valutazione superata: formulata su {proposalCurrent ? "un'analisi non più allineata ai documenti" : "un rapporto precedente"}. Va riconsiderata sull&apos;analisi aggiornata prima di poter essere approvata.
        </p>
      ) : null}
      {record?.current.blockedReason ? <p className="text-xs text-amber-900">Blocco: {record.current.blockedReason}</p> : null}
      {openDependencies.length ? (
        <p className="text-xs text-amber-900">
          Presupposti non completati: {openDependencies.map((key) => specs.find((item) => item.activityKey === key)?.title ?? "attività da riesaminare").join("; ")}.
        </p>
      ) : null}
      {record?.current.assignee ? <p className="text-xs text-slate-700">Responsabile: {record.current.assignee}</p> : null}
      {record?.current.dueDate ? <p className="text-xs text-slate-700">Termine verificato: {record.current.dueDate} — {record.current.dueDateReason}</p> : null}
      <p className="text-xs text-slate-700">Documenti richiesti: {spec.requiredDocuments.join("; ") || "da verificare"}.</p>
      {record?.current.attachedDocumentIds.length ? <p className="text-xs text-slate-700">Documenti collegati: {evidenceNames(record.current.attachedDocumentIds)}.</p> : null}
      {record?.current.execution ? <p className="text-xs text-slate-700">Esecuzione {record.current.execution.date}: {record.current.execution.description} — {evidenceNames(record.current.execution.documentIds)}.</p> : null}
      {record?.current.outcome ? <p className="text-xs text-slate-700">Riscontro {record.current.outcome.date}: {record.current.outcome.description} — {evidenceNames(record.current.outcome.documentIds)}{record.current.outcome.alternativeTitle ? `; alternativa: ${record.current.outcome.alternativeTitle}` : ""}.</p> : null}
      <p className="text-xs text-slate-600">Condizione di completamento: {spec.completionGate}.</p>
      {!shared ? <DraftsForActivity context={context} drafts={drafts} canManage={canManage && analysisCurrent && !needsReview && spec.necessity !== "NOT_JUSTIFIED"} /> : null}
      {canManage && !shared ? (
        <div className="space-y-2">
          {!record && proposal?.status === "PROPOSED" && proposalCurrent && analysisCurrent && spec.necessity !== "NOT_JUSTIFIED" ? (
            <form action={reviewOperationalProposalAction} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
              <input type="hidden" name="procedimentoId" value={procedimentoId} />
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="reviewVersion" value={proposal.reviewVersion} />
              <input type="hidden" name="action" value="APPROVE" />
              <label className="block text-xs font-medium">Motivo dell&apos;approvazione
                <textarea name="reviewNote" required minLength={3} maxLength={4000} rows={2} className={`${fieldClass} mt-1`} />
              </label>
              <Button type="submit" size="sm">Approva proposta</Button>
            </form>
          ) : null}
          {!record && proposal?.status === "APPROVED" && proposalCurrent && analysisCurrent && spec.necessity !== "NOT_JUSTIFIED" ? (
            <SimpleCommand context={context} kind="ADOPT_APPROVAL" proposalId={proposal.id} label="Collega approvazione all'attività"
              confirmation="Confermo che l'approvazione riguarda questa attività nel quadro attuale." />
          ) : null}
          {!record && proposal && (proposal.status === "REJECTED" || proposal.status === "AMENDED_AND_APPROVED"
            || (proposal.status === "APPROVED" && !proposalCurrent))
            && analysisCurrent && spec.necessity !== "NOT_JUSTIFIED" ? (
              <details className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {proposal.status === "REJECTED" ? "Rivaluta la proposta rifiutata"
                    : proposal.status === "AMENDED_AND_APPROVED" ? "Rivaluta la proposta approvata con modifiche"
                      : "Rivaluta l'approvazione relativa a un quadro precedente"}
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-amber-950">
                    La decisione precedente e il suo contenuto restano invariati. Questa nuova valutazione riguarda il percorso corrente mostrato sopra:
                    eventuali modifiche non vengono trasferite automaticamente e devono essere considerate e motivate dal professionista.
                  </p>
                  {proposal.reviewNote ? <p className="text-xs">Motivo della decisione precedente: {proposal.reviewNote}</p> : null}
                  {proposal.status !== "REJECTED" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div><p className="text-xs font-medium">Proposta originaria</p><PreviewValue value={proposal.proposedPayload} /></div>
                      <div><p className="text-xs font-medium">Contenuto approvato con modifiche</p><PreviewValue value={proposal.approvedPayload} /></div>
                    </div>
                  ) : null}
                  <SimpleCommand context={context} kind="REEVALUATE_PROPOSAL" proposalId={proposal.id}
                    expectedReviewVersion={proposal.reviewVersion} expectedProposalStatus={proposal.status}
                    label="Approva il percorso corrente dopo riesame"
                    confirmation="Ho valutato la decisione precedente e le eventuali modifiche; approvo motivatamente il percorso corrente senza alterare la proposta originaria." />
                </div>
              </details>
            ) : null}
          {!record && !proposal && analysisCurrent && spec.necessity !== "NOT_JUSTIFIED" ? (
            <SimpleCommand context={context} kind="APPROVE" label="Approva questa iniziativa"
              confirmation="Ho valutato presupposti, fonti e alternative; approvo l'attività proposta." />
          ) : null}
          {!record && spec.necessity === "NOT_JUSTIFIED" ? (
            <SimpleCommand context={context} kind="EXCLUDE" label="Escludi iniziativa"
              confirmation="Confermo l'esclusione motivata senza eseguire l'iniziativa." />
          ) : null}
          {!record && spec.necessity !== "NOT_JUSTIFIED" ? (
            <details className="rounded-md border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium">Escludi l&apos;iniziativa se non pertinente</summary>
              <div className="mt-2"><SimpleCommand context={context} kind="EXCLUDE" label="Escludi iniziativa"
                confirmation="Confermo l'esclusione motivata senza eseguire l'iniziativa." /></div>
            </details>
          ) : null}
          {record && needsReview && analysisCurrent && status !== "COMPLETED"
            && (spec.necessity !== "NOT_JUSTIFIED" || status === "EXCLUDED") ? (
            <SimpleCommand context={context} kind="RECONFIRM" label="Riesamina e conferma"
              confirmation="Ho riesaminato il quadro aggiornato e i collegamenti condivisi." />
          ) : null}
          {record && needsReview && status === "COMPLETED" ? (
            <p className="text-xs text-amber-900">Per confermare il completamento nel quadro aggiornato, riaprire l&apos;attività e verificare nuovamente esecuzione e riscontro.</p>
          ) : null}
          {record && !needsReview && !record.current.blockedReason && status === "APPROVED" ? (
            <SimpleCommand context={context} kind="TAKE_CHARGE" label="Prendi in carico" />
          ) : null}
          {record && !needsReview && !blocked && ((status === "IN_PROGRESS" && spec.documents.length === 0)
            || (status === "DRAFT_VALIDATED" && validDrafts)) ? (
              <EvidenceForm context={context} kind="RECORD_EXECUTION" documents={documents} alternatives={spec.alternatives} />
            ) : null}
          {record && !needsReview && !record.current.blockedReason && status === "EXECUTED" ? (
            <EvidenceForm context={context} kind="RECORD_OUTCOME" documents={documents} alternatives={spec.alternatives} />
          ) : null}
          {record && !needsReview && !blocked && ["EXECUTED", "OUTCOME_RECORDED"].includes(status ?? "") ? (
            <EvidenceForm context={context} kind="RECORD_EXECUTION" documents={documents} alternatives={spec.alternatives} />
          ) : null}
          {record && !needsReview && !record.current.blockedReason && status === "OUTCOME_RECORDED" ? (
            <EvidenceForm context={context} kind="RECORD_OUTCOME" documents={documents} alternatives={spec.alternatives} />
          ) : null}
          {record && !needsReview && !blocked && status === "OUTCOME_RECORDED" ? (
            <SimpleCommand context={context} kind="VERIFY_COMPLETION" label="Verifica e completa"
              manualReview={!analysisCurrent}
              confirmation={analysisCurrent
                ? "Ho verificato esecuzione, riscontro e condizioni di completamento."
                : "Il rapporto non è aggiornato. Ho esaminato personalmente il fascicolo documentale corrente, gli effetti delle nuove evidenze e le condizioni di completamento; questa verifica non aggiorna automaticamente il rapporto."} />
          ) : null}
          {record && !needsReview && !["EXCLUDED"].includes(record.current.status) ? (
            <ConfigurationForm context={context} specs={specs} records={records} documents={documents} />
          ) : null}
          {record && !["COMPLETED", "EXCLUDED"].includes(record.current.status) ? (
            <details className="rounded-md border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium">Blocco o esclusione motivata</summary>
              <div className="mt-3 space-y-2">
                {record.current.blockedReason ? (
                  <SimpleCommand context={context} kind="UNBLOCK" label="Rimuovi blocco" />
                ) : <SimpleCommand context={context} kind="BLOCK" label="Blocca attività" />}
                {!["EXECUTED", "OUTCOME_RECORDED"].includes(record.current.status) ? (
                  <SimpleCommand context={context} kind="EXCLUDE" label="Escludi iniziativa"
                    confirmation="Confermo che l'iniziativa non deve essere eseguita." />
                ) : null}
              </div>
            </details>
          ) : null}
          {record && (record.current.status === "COMPLETED"
            || (record.current.status === "EXCLUDED" && spec.necessity !== "NOT_JUSTIFIED")) ? (
            <details className="rounded-md border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium">Riapri attività</summary>
              <div className="mt-2"><SimpleCommand context={context} kind="REOPEN" label="Riapri motivatamente"
                confirmation="Confermo la riapertura; la cronologia precedente resta conservata." /></div>
            </details>
          ) : null}
        </div>
      ) : null}
      {record && !shared ? (
        <ActivityHistory record={record} specs={specs} drafts={drafts} documents={documents} procedimentoId={procedimentoId} />
      ) : null}
    </article>
  );
}

export function FascicoloGuidedActivities({
  procedimentoId, payload, reportFingerprint, corpusFingerprint, specs, records, drafts, documents, proposals, canManage, canReviewLegalSources = false,   reportArchived, analysisCurrent, analysisStatus, analysisDrift, analysisRefreshNotice, errorCode, focusActivityKey,
}: {
  procedimentoId: string;
  payload: StructuredFascicoloReportPayload | null;
  reportFingerprint: string | null;
  corpusFingerprint: string | null;
  specs: readonly ActivitySpec[];
  records: readonly ActivityRecord[];
  drafts: readonly ActDraft[];
  documents: ReadonlyArray<{ id: string; nome: string }>;
  proposals: readonly FascicoloProposal[];
  canManage: boolean;
  canReviewLegalSources?: boolean;
  reportArchived: boolean;
  analysisCurrent: boolean;
  analysisStatus?: "CURRENT" | "UPDATING" | "STALE" | "WAITING_AUTHORIZATION" | "ERROR";
  analysisDrift?: KnowledgeCorpusDrift | null;
  analysisRefreshNotice?: string;
  errorCode?: string;
  focusActivityKey?: string;
}) {
  const plans = payload?.operationalPlans ?? [];
  const orphaned = records.filter((record) => !specs.some((spec) => spec.activityKey === record.activityKey));
  if (!plans.length && !orphaned.length) return null;
  return (
    <section aria-label="Procedimento guidato" className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Problematiche e attività</h2>
        <p className="mt-1 text-sm text-slate-600">
          Analisi, iniziative e riscontri sono preliminari fino alla verifica del professionista. Una bozza o un&apos;esportazione non completano l&apos;attività.
        </p>
      </div>
      {errorCode ? <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{errorMessages[errorCode] ?? errorMessages.UNEXPECTED_ERROR}</p> : null}
      {reportFingerprint && !reportArchived ? (
        <div role="note" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Il rapporto costruito sulla Knowledge disponibile non è ancora archiviato. Archiviarlo prima di registrare decisioni o attività, senza modificare le proposte esistenti.
            {!analysisCurrent ? " L'archiviazione non esamina i nuovi documenti e non aggiorna l'analisi." : ""}
          </p>
          {canManage ? (
            <form action={archiveStructuredFascicoloReportAction}>
              <input type="hidden" name="procedimentoId" value={procedimentoId} />
              <Button type="submit" size="sm" variant="outline">Archivia il quadro corrente</Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!analysisCurrent ? (
        <div id="analysis-update" role="note" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            L&apos;analisi non è aggiornata rispetto ai documenti. Le valutazioni esistenti restano consultabili ma sono superate: non possono essere approvate finché non siano riconsiderate su un&apos;analisi aggiornata. Il completamento di un&apos;attività richiede nel frattempo una verifica manuale esplicita dell&apos;intero fascicolo. Decisioni, attività e bozze già registrate sono conservate.
          </p>
          {analysisDrift && analysisDrift.entries.length > 0 ? (
            <details>
              <summary className="cursor-pointer font-medium">Che cosa è cambiato ({analysisDrift.entries.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {analysisDrift.entries.map((entry, index) => <li key={`${entry.kind}-${entry.documentoId}-${index}`}>{entry.explanation}</li>)}
              </ul>
              {analysisDrift.affectedKnowledgeItemCount > 0 ? (
                <p className="mt-1">Elementi dell&apos;analisi fondati su pagine cambiate: {analysisDrift.affectedKnowledgeItemCount}.</p>
              ) : null}
            </details>
          ) : null}
          {analysisRefreshNotice ? <p className="font-medium">{analysisRefreshNotice}</p> : null}
          {canReviewLegalSources && corpusFingerprint && analysisStatus !== "UPDATING" && analysisStatus !== "WAITING_AUTHORIZATION" ? (
            <form action={requestFascicoloAnalysisRefreshAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="procedimentoId" value={procedimentoId} />
              <input type="hidden" name="expectedCorpusFingerprint" value={corpusFingerprint} />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" name="confirmed" value="true" required /> Confermo l&apos;aggiornamento controllato dell&apos;analisi
              </label>
              <Button type="submit" size="sm" variant="outline">Richiedi aggiornamento dell&apos;analisi</Button>
            </form>
          ) : analysisStatus === "UPDATING" ? (
            <p>Aggiornamento dell&apos;analisi in corso.</p>
          ) : analysisStatus === "WAITING_AUTHORIZATION" ? (
            <p>Aggiornamento richiesto: in attesa dell&apos;abilitazione dell&apos;esecuzione delle analisi.</p>
          ) : null}
        </div>
      ) : null}
      {plans.map((plan) => {
        const issueSpecs = specs.filter((spec) => spec.issueSemanticKey === plan.issueSemanticKey);
        const questions = payload?.legalIssues.find((issue) => issue.semanticKey === plan.issueSemanticKey)?.questions ?? [];
        const unreviewedSources = questions.flatMap((question) => question.nonUsableResults
          .filter((result) => result.reasons.includes("CLASSIFICATION_NOT_HUMAN_CONFIRMED")
            || result.reasons.includes("CLASSIFICATION_ATTESTATION_REQUIRED"))
          .map((result) => ({ question: question.text, missionId: result.missionId })));
        const reviewMissions = [...new Map(unreviewedSources
          .filter((source): source is { question: string; missionId: string } => Boolean(source.missionId))
          .map((source) => [`${source.missionId}:${source.question}`, source])).values()];
        const corpus = corpusFingerprint ? { fingerprint: corpusFingerprint, analysisCurrent } : undefined;
        const progress = activityProgress(issueSpecs, records, specs, corpus);
        const hasManualCompletion = issueSpecs.some((spec) => {
          const current = activityForKey(records, spec.activityKey)?.current;
          return current?.status === "COMPLETED" && current.completionReviewMode === "MANUAL_CORPUS"
            && current.completionCorpusFingerprint === corpusFingerprint;
        });
        const next = issueSpecs.find((spec) => {
          const record = activityForKey(records, spec.activityKey);
          return spec.necessity === "REQUIRED" && (!record || (!["COMPLETED", "EXCLUDED"].includes(record.current.status)
            && !record.current.blockedReason && openActivityDependencies(record, records, specs, corpus).length === 0));
        }) ?? issueSpecs.find((spec) => {
          const record = activityForKey(records, spec.activityKey);
          return spec.necessity !== "NOT_JUSTIFIED" && (!record || (!["COMPLETED", "EXCLUDED"].includes(record.current.status)
            && !record.current.blockedReason && openActivityDependencies(record, records, specs, corpus).length === 0));
        });
        const nextDocument = next?.documents[0] ?? null;
        const doneSpecs = issueSpecs.filter((spec) => activityForKey(records, spec.activityKey)?.current.status === "COMPLETED");
        const sharedRefs = plan.sharedActivityRefs ?? [];
        return (
          <details key={plan.issueSemanticKey} open={issueSpecs.some((spec) => spec.activityKey === focusActivityKey) || undefined} className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer p-4">
              <span className="block font-semibold text-slate-950">{plan.issueText}</span>
              <span className="mt-1 block text-sm font-medium text-slate-900">
                Prossimo passo: {next?.title ?? (progress.pending ? "riesaminare le attività bloccate o superate" : "nessuna attività necessaria pendente")}
                {nextDocument ? <>{" · "}Atto: {nextDocument.title}</> : null}
              </span>
              <span className="mt-1 block text-xs text-slate-600">
                {(analysisCurrent || hasManualCompletion) && progress.percentage !== null
                  ? `${progress.percentage}% verificato${!analysisCurrent ? " con valutazione manuale" : ""}`
                  : "avanzamento da verificare"}
                {" · "}{progress.completed} completate, {progress.pending} pendenti{progress.optional ? `, ${progress.optional} eventuali` : ""}, {progress.excluded} escluse
              </span>
              <span className="mt-1 block text-sm text-slate-700">{leadSentence(issueSpecs[0]?.legalSummary ?? "Analisi da verificare.")}</span>
            </summary>
            <div className="space-y-3 border-t border-slate-200 p-4">
              {issueSpecs[0]?.legalSummary && leadSentence(issueSpecs[0].legalSummary) !== issueSpecs[0].legalSummary ? (
                <details className="text-sm text-slate-700">
                  <summary className="cursor-pointer font-medium text-slate-900">Sintesi completa dell&apos;analisi</summary>
                  <p className="mt-1">{issueSpecs[0].legalSummary}</p>
                </details>
              ) : null}
              {doneSpecs.length ? (
                <p className="text-xs text-emerald-900">Attività completate: {doneSpecs.map((spec) => spec.title).join("; ")}</p>
              ) : null}
              {sharedRefs.length ? (
                <ul className="space-y-1 text-xs text-slate-700">
                  {sharedRefs.map((ref) => (
                    <li key={ref.activityCode}>Attività comune gestita nella problematica «{ref.hostIssueText}»: {ref.title.replace(/^\d+\.\s*/, "")}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-amber-900">
                {plan.legalSourceStatus === "LEGAL_RESEARCH_REQUIRED"
                  ? "Le fonti e la giurisprudenza richiedono ulteriori verifiche."
                  : "Fonti collegate: verificare pertinenza e applicabilità prima di procedere."}
                {" "}<Link className="underline" href={`/procedimenti/${procedimentoId}?section=reports`}>Apri l&apos;analisi giuridica</Link>
              </p>
              {unreviewedSources.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                  <p>Alcune fonti richiedono una valutazione motivata della pertinenza e dell&apos;orientamento.</p>
                  {canReviewLegalSources && reviewMissions.length ? (
                    <ul className="mt-1 space-y-1">
                      {reviewMissions.map((source) => (
                        <li key={`${source.missionId}:${source.question}`}>
                          <Link className="underline" href={`/legal-research/assisted-verification/${encodeURIComponent(source.missionId)}`}>
                            Verifica le fonti: {source.question}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-1">La classificazione spetta a un professionista autorizzato.</p>}
                </div>
              ) : null}
              {plan.outstandingEvidence.length ? <p className="text-xs text-slate-700">Lacune: {plan.outstandingEvidence.join("; ")}</p> : null}
              {issueSpecs.map((spec) => (
                <ActivityCard key={spec.activityKey} spec={spec} specs={specs} records={records} drafts={drafts} documents={documents}
                  proposals={proposals} reportFingerprint={reportFingerprint ?? ""} corpusFingerprint={corpusFingerprint ?? ""}
                  procedimentoId={procedimentoId} canManage={canManage && reportArchived && reportFingerprint !== null && corpusFingerprint !== null}
                  analysisCurrent={analysisCurrent && reportFingerprint !== null && corpusFingerprint !== null} />
              ))}
              {plan.alternatives.length ? (
                <details className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Alternative da valutare, non cumulative</summary>
                  <ul className="mt-2 space-y-2">
                    {plan.alternatives.map((alternative) => (
                      <li key={alternative.title}>
                        <strong>{alternative.title}</strong> — {alternative.whenApplicable} {alternative.practicalRoute} {alternative.riskOrLimit}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="text-xs text-slate-600">{plan.deadlineReview}</p>
            </div>
          </details>
        );
      })}
      {orphaned.length ? (
        <details className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Cronologie non presenti nel percorso corrente ({orphaned.length})</summary>
          <ul className="mt-2 space-y-3">
            {orphaned.map((record) => (
              <li key={record.activityKey} className="rounded-md bg-white p-3">
                <p className="font-medium">{record.current.title} — {ACTIVITY_STATUS_LABELS[record.current.status]}</p>
                <p className="text-xs">Il collegamento al percorso corrente richiede una nuova verifica.</p>
                <ActivityHistory record={record} specs={specs} drafts={drafts} documents={documents} procedimentoId={procedimentoId} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
