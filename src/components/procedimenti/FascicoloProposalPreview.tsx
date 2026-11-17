import Link from "next/link";

import { fascicoloProposalStatusLabel, fascicoloProposalTypeLabel } from "@/components/procedimenti/FascicoloProposals";
import { Button } from "@/components/ui/Button";
import { humanizeProfessionalText } from "@/lib/professional-text";
import { formatDateIT } from "@/lib/utils";
import {
  generateOperationalProposalsAction,
  reverseOperationalProposalReconciliationAction,
} from "@/server/actions/fascicolo-operational-proposals";
import { ACT_DRAFT_STATUS_LABELS } from "@/server/fascicolo-acts/model";
import { ACTIVITY_STATUS_LABELS } from "@/server/fascicolo-operational-activities/model";
import type { OperationalProposalPreview } from "@/server/fascicolo-operational-proposals/preview";
import type { OperationalProposalRecord, ProposalReconciliationSummary } from "@/server/fascicolo-operational-proposals/repository";

const reconciliationErrors: Record<string, string> = {
  STALE_PREVIEW: "La coda è cambiata dopo l'anteprima. Riesaminare la nuova simulazione prima di procedere.",
  CURRENT_INPUT_REQUIRED: "Il fascicolo o il rapporto non sono più attuali. Aggiornare l'analisi e archiviare il quadro prima di procedere.",
  RECONCILIATION_NOT_FOUND: "La riconciliazione non è disponibile per questo procedimento.",
  RECONCILIATION_ALREADY_REVERSED: "Questa riconciliazione è già stata ripristinata.",
  RECONCILIATION_CHANGED: "La coda è cambiata dopo la riconciliazione: il ripristino automatico è bloccato per non sovrascrivere il lavoro successivo.",
  RECONCILIATION_INVALID: "La registrazione di riconciliazione non ha superato i controlli di integrità.",
  UNEXPECTED_ERROR: "Operazione non completata. Consultare il registro degli errori prima di riprovare.",
};

function issueLabels(keys: readonly string[], issues: ReadonlyMap<string, string>): string {
  if (!keys.length) return "Non collegata a una problematica specifica";
  return keys.map((key) => issues.get(key) ?? "Problematica non più presente nel quadro corrente").join("; ");
}

function ExistingGroup({ title, explanation, items, issues }: {
  title: string;
  explanation: string;
  items: readonly OperationalProposalRecord[];
  issues: ReadonlyMap<string, string>;
}) {
  return (
    <details className="rounded-md border border-slate-200 p-3">
      <summary className="cursor-pointer font-medium">{title} ({items.length})</summary>
      <p className="mt-2 text-slate-600">{explanation}</p>
      <ul className="mt-2 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <p className="font-medium">{humanizeProfessionalText(item.title)}</p>
            <p>{fascicoloProposalTypeLabel(item.proposalType)} · {fascicoloProposalStatusLabel(item.status)} · revisione {item.reviewVersion}</p>
            <p>Problematica: {issueLabels(item.originatingIssueSemanticKeys, issues)}</p>
            <p>Motivazione originaria: {humanizeProfessionalText(item.rationale)}</p>
            <p className="break-all text-xs text-slate-500">Identificativo: {item.id}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function FascicoloProposalPreview({
  preview, procedimentoId, issueNames, analysisCurrent, reportArchived, reportFingerprint, corpusFingerprint,
  canManage, reconciliations, errorCode, done,
}: {
  preview: OperationalProposalPreview;
  procedimentoId: string;
  issueNames: readonly { semanticKey: string; text: string }[];
  analysisCurrent: boolean;
  reportArchived: boolean;
  reportFingerprint: string;
  corpusFingerprint: string;
  canManage: boolean;
  reconciliations: readonly ProposalReconciliationSummary[];
  errorCode?: string;
  done?: string;
}) {
  const issues = new Map(issueNames.map((issue) => [issue.semanticKey, issue.text]));
  const classifications = {
    NEW: "Nuova attività, senza precedenti strutturati individuati",
    EXISTING: "Nuova proposta per un'attività già individuata",
    UNDETERMINED: "Novità dell'attività da verificare: identità precedente non determinabile",
    NOT_ACTIVITY: "Altra nuova proposta",
  } as const;
  return (
    <details id="proposal-reconciliation" open={errorCode || done ? true : undefined} className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-slate-900">Simulazione della riconciliazione delle proposte</summary>
      <div className="mt-3 space-y-3 text-sm text-slate-700">
        <p>
          Anteprima in sola lettura: non modifica proposte, approvazioni, attività o bozze.
          Il confronto usa le impronte del rapporto e le identità strutturate; non accorpa né cancella automaticamente.
          Ricalcolare l&apos;anteprima prima di ogni eventuale intervento.
        </p>
        {!analysisCurrent ? (
          <p role="note" className="rounded-md bg-amber-50 p-3 font-medium text-amber-900">
            L&apos;analisi non è aggiornata rispetto ai documenti: questa simulazione è provvisoria e non è una base affidabile per modificare la coda.
          </p>
        ) : null}
        {errorCode ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 font-medium text-red-900">{reconciliationErrors[errorCode] ?? reconciliationErrors.UNEXPECTED_ERROR}</p>
        ) : null}
        {done === "generated" || done === "reversed" ? (
          <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-900">
            {done === "generated" ? "Riconciliazione registrata con le immagini prima e dopo." : "Ripristino registrato; le nuove proposte restano nello storico."}
          </p>
        ) : null}
        <p className="break-all text-xs text-slate-500">Impronta del rapporto, dei candidati e della coda confrontata: {preview.baselineFingerprint}</p>
        <ExistingGroup title="Proposte conservate" items={preview.retained} issues={issues}
          explanation="La stessa impronta è ancora presente: identificativo, stato e cronologia restano invariati." />
        <ExistingGroup title="Proposte da riattivare" items={preview.reactivated} issues={issues}
          explanation="La stessa proposta non revisionata ricompare; sarebbe riattivata con lo stesso identificativo." />
        <ExistingGroup title="Proposte superate" items={preview.superseded} issues={issues}
          explanation="L'impronta non è più tra i candidati: la proposta uscirebbe dalla coda attiva, ma resterebbe nello storico." />
        <ExistingGroup title="Approvazioni da riesaminare" items={preview.approvalsNeedingReview} issues={issues}
          explanation="Il candidato non coincide più con il quadro: approvazione e identificativo restano conservati, ma occorre una nuova valutazione." />
        <ExistingGroup title="Approvazioni nuovamente corrispondenti" items={preview.restoredApprovals} issues={issues}
          explanation="Ricompare la stessa impronta; l'approvazione conserva la propria storia e il contrassegno di superamento sarebbe rimosso." />
        <ExistingGroup title="Altre proposte storiche conservate" items={preview.historical} issues={issues}
          explanation="Rifiuti, materializzazioni e altre revisioni storiche non vengono cancellati né riapprovati." />
        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">Nuove proposte generate ({preview.newProposals.length})</summary>
          <ul className="mt-2 space-y-3">
            {preview.newProposals.map(({ candidate, activityKey, activityClassification, relatedProposalIds }) => (
              <li key={candidate.proposalFingerprint}>
                <p className="font-medium">{humanizeProfessionalText(candidate.title)}</p>
                <p>{fascicoloProposalTypeLabel(candidate.proposalType)} · {classifications[activityClassification]}</p>
                <p>Problematica: {issueLabels(candidate.originatingIssueSemanticKeys, issues)}</p>
                <p>Motivazione: {humanizeProfessionalText(candidate.rationale)}</p>
                {activityKey ? (
                  <Link className="text-sky-700 underline" href={`/procedimenti/${procedimentoId}?section=proposals&activity=${activityKey}#activity-${activityKey}`}>
                    Vai all&apos;attività
                  </Link>
                ) : null}
                {relatedProposalIds.length ? <p className="break-all text-xs">Proposte precedenti: {relatedProposalIds.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        </details>
        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">Possibili accorpamenti da verificare ({preview.possibleConsolidations.length})</summary>
          <p className="mt-2 text-slate-600">Sono segnalate soltanto proposte con lo stesso codice attività e la stessa problematica. Nessun accorpamento è eseguito o presunto.</p>
          <ul className="mt-2 space-y-2">
            {preview.possibleConsolidations.map(({ activity, proposalIds }) => (
              <li key={activity.activityKey}>
                <p>{activity.issueText} — {activity.title}</p>
                <p className="break-all text-xs">Identificativi da confrontare: {proposalIds.join(", ")}</p>
              </li>
            ))}
          </ul>
        </details>
        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">Attività precedenti non identificabili con certezza ({preview.unmappedActivities.length})</summary>
          <p className="mt-2 text-slate-600">Una somiglianza nel titolo non dimostra l&apos;identità dell&apos;attività: confrontare documenti, presupposti e cronologia.</p>
          <ul className="mt-2 space-y-2">
            {preview.unmappedActivities.map((proposal) => (
              <li key={proposal.id}>
                {humanizeProfessionalText(proposal.title)} — {issueLabels(proposal.originatingIssueSemanticKeys, issues)}
                <p className="break-all text-xs">Identificativo: {proposal.id}</p>
              </li>
            ))}
          </ul>
        </details>
        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">Attività già condivise ({preview.sharedActivities.length})</summary>
          <ul className="mt-2 space-y-2">
            {preview.sharedActivities.map(({ primary, target, targetKey }) => (
              <li key={`${primary.activityKey}:${targetKey}`}>
                {primary.current.issueText ?? "Problematica principale"} — {primary.current.title}
                {" → "}{target ? `${target.issueText} — ${target.title}` : "Attività non più presente nel quadro: riesame necessario"}
                {" · "}{ACTIVITY_STATUS_LABELS[primary.current.status]}
              </li>
            ))}
          </ul>
        </details>
        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">Bozze collegate o da confrontare ({preview.draftMatches.length})</summary>
          <ul className="mt-2 space-y-2">
            {preview.draftMatches.map(({ activity, documentTitle, draft, match, ambiguous }) => (
              <li key={`${activity.activityKey}:${documentTitle}:${draft.draftKey}`}>
                <p>{activity.issueText} — {activity.title} — {documentTitle}</p>
                <Link className="text-sky-700 underline" href={`/procedimenti/${procedimentoId}?section=acts#draft-${draft.draftKey}`}>
                  {draft.current.title} · v{draft.current.version} · {ACT_DRAFT_STATUS_LABELS[draft.current.status]}
                </Link>
                {" · "}{match === "LINKED" ? "collegamento registrato"
                  : match === "STABLE_IDENTITY" ? "identità compatibile, collegamento da verificare"
                    : ambiguous ? "bozza precedente ambigua: scelta professionale necessaria" : "bozza precedente da verificare"}
              </li>
            ))}
          </ul>
        </details>
        {canManage && analysisCurrent && reportArchived ? (
          <form action={generateOperationalProposalsAction} className="space-y-2 rounded-md border border-slate-300 p-3">
            <input type="hidden" name="procedimentoId" value={procedimentoId} />
            <input type="hidden" name="expectedReportFingerprint" value={reportFingerprint} />
            <input type="hidden" name="expectedCorpusFingerprint" value={corpusFingerprint} />
            <input type="hidden" name="expectedPreviewFingerprint" value={preview.baselineFingerprint} />
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirmed" value="true" required />
              <span>Ho esaminato la simulazione e autorizzo la riconciliazione della coda, senza eliminare lo storico.</span>
            </label>
            <Button type="submit" size="sm">Genera proposte operative</Button>
          </form>
        ) : canManage ? (
          <p className="rounded-md bg-amber-50 p-3 text-amber-900">
            Per modificare la coda occorrono un&apos;analisi aggiornata e il rapporto corrispondente archiviato. La sola anteprima non effettua scritture.
          </p>
        ) : null}
        {canManage ? (
          <details className="rounded-md border border-slate-200 p-3">
            <summary className="cursor-pointer font-medium">Ultime riconciliazioni verificabili ({reconciliations.length})</summary>
            <p className="mt-2 text-slate-600">
              Il ripristino riporta gli stati precedenti e conserva le nuove proposte nello storico.
              È bloccato se la coda è cambiata; non annulla il rapporto archiviato o altri lavori successivi.
            </p>
            <ul className="mt-2 space-y-3">
              {reconciliations.map((item) => (
                <li key={item.reconciliationId} className="border-t border-slate-200 pt-2">
                  <p>{formatDateIT(item.createdAt)} · {item.state === "AVAILABLE" ? "Ripristino verificabile"
                    : item.state === "CHANGED" ? "Coda cambiata: ripristino bloccato" : "Già ripristinata"}</p>
                  <p className="break-all text-xs text-slate-500">{item.reconciliationId}</p>
                  {item.state === "AVAILABLE" ? (
                    <form action={reverseOperationalProposalReconciliationAction} className="mt-2 space-y-2">
                      <input type="hidden" name="procedimentoId" value={procedimentoId} />
                      <input type="hidden" name="reconciliationId" value={item.reconciliationId} />
                      <input type="hidden" name="expectedAfterFingerprint" value={item.afterFingerprint} />
                      <label className="block text-xs font-medium">Motivo del ripristino
                        <textarea name="note" required minLength={3} maxLength={4000} rows={2}
                          className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm" />
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" name="confirmed" value="true" required />
                        <span>Confermo il ripristino della coda e la conservazione dello storico.</span>
                      </label>
                      <Button type="submit" size="sm" variant="outline">Ripristina la coda precedente</Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </details>
  );
}
