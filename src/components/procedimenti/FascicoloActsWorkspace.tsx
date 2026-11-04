import Link from "next/link";
import { FilePenLine, FileText, History, Link2, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { formatDateIT } from "@/lib/utils";
import {
  restoreActDraftVersionAction,
  saveActDraftVersionAction,
} from "@/server/actions/fascicolo-acts";
import {
  actDraftMatchesTemplate,
  ACT_DRAFT_STATUSES,
  ACT_DRAFT_STATUS_LABELS,
  changedActDraftFields,
  type ActDraft,
} from "@/server/fascicolo-acts/model";
import { ACT_PHASE_LABELS, type ActTemplateCatalog } from "@/server/fascicolo-acts/templates";
import { groupActDraftsForReview, type ActDraftGroupMember } from "@/server/fascicolo-acts/reconciliation";
import type { ActivityRecord, ActivitySpec } from "@/server/fascicolo-operational-activities/model";

const RECONCILIATION_LABELS: Record<ActDraftGroupMember["reconciliation"], string> = {
  KEEP_AS_REFERENCE: "Bozza di riferimento",
  IDENTICAL_DUPLICATE: "Copia identica: archiviabile previa autorizzazione",
  DIVERGENT_CONTENT: "Contenuto diverso: confrontare",
};

const inputClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-600 focus:outline-none";

function DraftEditor({
  draft, drafts, procedimentoId, attachmentOptions,
}: {
  draft: ActDraft;
  drafts: readonly ActDraft[];
  procedimentoId: string;
  attachmentOptions: ReadonlyArray<{ id: string; nome: string }>;
}) {
  const current = draft.current;
  const others = drafts.filter((candidate) => candidate.draftKey !== draft.draftKey);
  return (
    <form action={saveActDraftVersionAction} className="mt-4 space-y-3 border-t border-slate-200 pt-4">
      <input type="hidden" name="procedimentoId" value={procedimentoId} />
      <input type="hidden" name="draftKey" value={draft.draftKey} />
      <input type="hidden" name="expectedVersion" value={current.version} />
      <label className="block text-sm font-medium text-slate-700">Titolo
        <input name="title" defaultValue={current.title} required minLength={3} maxLength={300} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-slate-700">Testo dell&apos;atto
        <textarea name="body" defaultValue={current.body} required rows={14} className={`${inputClass} font-mono`} />
      </label>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block text-sm font-medium text-slate-700">Stato
          <select name="status" defaultValue={current.status} className={inputClass}>
            {ACT_DRAFT_STATUSES.map((status) => <option key={status} value={status}>{ACT_DRAFT_STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Assegnatario
          <input name="assignee" defaultValue={current.assignee ?? ""} maxLength={200} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Scadenza interna
          <input type="date" name="dueDate" defaultValue={current.dueDate ?? ""} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Avanzamento della bozza (%)
          <input type="number" name="progress" min={0} max={100} step={5} defaultValue={current.progress} className={inputClass} />
        </label>
      </div>
      {others.length ? (
        <fieldset className="text-sm text-slate-700">
          <legend className="font-medium">Atti presupposti (dipendenze)</legend>
          {others.map((candidate) => (
            <label key={candidate.draftKey} className="mr-4 inline-flex items-center gap-1">
              <input type="checkbox" name="dependencies" value={candidate.draftKey} defaultChecked={current.dependencies.includes(candidate.draftKey)} />
              {candidate.current.title}
            </label>
          ))}
        </fieldset>
      ) : null}
      {attachmentOptions.length ? (
        <fieldset className="text-sm text-slate-700">
          <legend className="font-medium">Allegati dal fascicolo</legend>
          <div className="max-h-40 overflow-y-auto">
            {attachmentOptions.map((option) => (
              <label key={option.id} className="block">
                <input type="checkbox" name="attachments" value={option.id} defaultChecked={current.attachments.includes(option.id)} className="mr-1" />
                {option.nome}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="block text-sm font-medium text-slate-700">Nota di modifica
        <input name="changeNote" maxLength={2000} placeholder="Motivo della nuova versione" className={inputClass} />
      </label>
      <Button type="submit" size="sm">Salva nuova versione</Button>
    </form>
  );
}

function DraftCard({
  draft, drafts, procedimentoId, canManage, attachmentOptions, issueLabel, activityLabel, activityKey,
}: {
  draft: ActDraft;
  drafts: readonly ActDraft[];
  procedimentoId: string;
  canManage: boolean;
  attachmentOptions: ReadonlyArray<{ id: string; nome: string }>;
  issueLabel: string | null;
  activityLabel: string | null;
  activityKey: string | null;
}) {
  const current = draft.current;
  const titleByKey = new Map(drafts.map((candidate) => [candidate.draftKey, candidate.current.title]));
  const nameById = new Map(attachmentOptions.map((option) => [option.id, option.nome]));
  const exportBase = `/procedimenti/${procedimentoId}/atti/${draft.draftKey}/export`;
  return (
    <article id={`draft-${draft.draftKey}`} className="rounded-lg border border-slate-200 bg-white p-4" aria-label={current.title}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{current.title}</h3>
          <p className="text-xs text-slate-500">
            {ACT_DRAFT_STATUS_LABELS[current.status]} · versione {current.version} · {current.progress}% ·{" "}
            {current.assignee ? `assegnata a ${current.assignee}` : "assegnatario da individuare"}
            {current.dueDate ? ` · scadenza ${formatDateIT(new Date(`${current.dueDate}T00:00:00.000Z`))}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Problematica: {issueLabel ?? "collegamento da verificare"}
            {activityLabel ? ` · Attività: ${activityLabel}` : ""}
          </p>
          {activityKey ? (
            <Link className="mt-1 inline-block text-xs text-sky-700 underline"
              href={`/procedimenti/${procedimentoId}?section=proposals&activity=${activityKey}#activity-${activityKey}`}>
              Torna all&apos;attività
            </Link>
          ) : null}
        </div>
        <div className="flex gap-2 text-sm">
          <a className="text-sky-700 underline" href={`${exportBase}?format=pdf`}>PDF</a>
          <a className="text-sky-700 underline" href={`${exportBase}?format=rtf`}>RTF</a>
        </div>
      </header>
      <div className="mt-2 h-1.5 w-full rounded bg-slate-100" aria-hidden="true">
        <div className="h-1.5 rounded bg-sky-600" style={{ width: `${current.progress}%` }} />
      </div>
      {draft.openDependencies.length ? (
        <p className="mt-2 flex items-center gap-1 text-sm text-amber-800">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          In attesa di: {draft.openDependencies.map((key) => titleByKey.get(key) ?? "atto non disponibile").join("; ")}
        </p>
      ) : null}
      {current.attachments.length ? (
        <p className="mt-2 flex items-center gap-1 text-sm text-slate-600">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          {current.attachments.map((id) => nameById.get(id) ?? "documento non più disponibile").join("; ")}
        </p>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Testo corrente</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">{current.body}</pre>
      </details>
      <details className="mt-3">
        <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium text-slate-800">
          <History className="h-4 w-4" aria-hidden="true" /> Cronologia delle versioni ({draft.history.length})
        </summary>
        <ol className="mt-2 space-y-2">
          {draft.history.map((version, index) => {
            const previous = draft.history[index + 1] ?? null;
            return (
              <li key={version.version} className="rounded border border-slate-100 px-3 py-2 text-sm">
                <p className="font-medium text-slate-800">
                  Versione {version.version} – {formatDateIT(version.savedAt)} {version.savedBy ? `– ${version.savedBy}` : ""}
                </p>
                <p className="text-slate-600">Modifiche: {changedActDraftFields(previous, version).join(", ") || "nessuna variazione di contenuto"}</p>
                {version.changeNote ? <p className="text-slate-600">Nota: {version.changeNote}</p> : null}
                <div className="mt-1 flex flex-wrap gap-3">
                  <a className="text-sky-700 underline" href={`${exportBase}?format=pdf&version=${version.version}`}>PDF v{version.version}</a>
                  <a className="text-sky-700 underline" href={`${exportBase}?format=rtf&version=${version.version}`}>RTF v{version.version}</a>
                  {canManage && version.version !== current.version ? (
                    <form action={restoreActDraftVersionAction}>
                      <input type="hidden" name="procedimentoId" value={procedimentoId} />
                      <input type="hidden" name="draftKey" value={draft.draftKey} />
                      <input type="hidden" name="expectedVersion" value={current.version} />
                      <input type="hidden" name="restoreVersion" value={version.version} />
                      <button type="submit" className="text-sky-700 underline">Ripristina come nuova versione</button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </details>
      {canManage ? (
        <details className="mt-3">
          <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium text-slate-800">
            <FilePenLine className="h-4 w-4" aria-hidden="true" /> Modifica e versiona
          </summary>
          <DraftEditor draft={draft} drafts={drafts} procedimentoId={procedimentoId} attachmentOptions={attachmentOptions} />
        </details>
      ) : null}
    </article>
  );
}

export function FascicoloActsWorkspace({
  procedimentoId, catalog, drafts, canManage, attachmentOptions, activitySpecs, activities,
}: {
  procedimentoId: string;
  catalog: ActTemplateCatalog;
  drafts: readonly ActDraft[];
  canManage: boolean;
  attachmentOptions: ReadonlyArray<{ id: string; nome: string }>;
  activitySpecs: readonly ActivitySpec[];
  activities: readonly ActivityRecord[];
}) {
  const templates = [...catalog.recommended, ...catalog.others];
  const templateFor = (draft: ActDraft) => {
    const matches = templates.filter((candidate) => actDraftMatchesTemplate(draft, {
      templateKey: candidate.templateKey,
      issueSemanticKey: candidate.issueSemanticKey,
      legacyTemplateKeys: candidate.legacyTemplateKeys,
    }));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const issueTextFor = (draft: ActDraft) => (templateFor(draft) ?? templates.find((candidate) =>
    candidate.issueSemanticKey !== null && candidate.issueSemanticKey === draft.current.issueSemanticKey))?.issueText ?? null;
  const draftByKey = new Map(drafts.map((draft) => [draft.draftKey, draft]));
  const linkedDraftKeys = new Set(activities.flatMap((activity) => activity.current.drafts.map((link) => link.draftKey)));
  const groups = groupActDraftsForReview(drafts, linkedDraftKeys);
  return (
    <section className="space-y-6" aria-label="Atti del procedimento">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <FileText className="h-5 w-5" aria-hidden="true" /> Atti e facsimili
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Fase rilevata: <strong>{ACT_PHASE_LABELS[catalog.phase]}</strong>
          {catalog.reviewPending ? " – risulta un'istanza di riesame o autotutela da istruire separatamente" : ""}.
          Ogni salvataggio crea una nuova versione immutabile registrata nel registro di audit. Le bozze non vengono firmate, protocollate né inviate automaticamente.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          L&apos;avanzamento della bozza non coincide con il completamento dell&apos;attività. Per predisporre un atto,
          {" "}<Link className="text-sky-700 underline" href={`/procedimenti/${procedimentoId}?section=proposals`}>aprire la relativa attività nelle Proposte</Link>.
        </p>
        {catalog.documentaryAhead ? (
          <div role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p>
              Fase desunta dai documenti del fascicolo: i dati anagrafici del procedimento indicano ancora
              {" "}<strong>{ACT_PHASE_LABELS[catalog.authoritativePhase]}</strong>. Verificare e, se confermato,
              approvare la correzione nella sezione Proposte prima di adottare atti.
            </p>
            {catalog.documentarySignals.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {catalog.documentarySignals.map((signal) => <li key={signal}>{signal}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-slate-900">Bozze in lavorazione ({drafts.length})</h3>
        <p className="text-sm text-slate-600">Le bozze sono raggruppate per problematica e tipo di documento. Per ciascun gruppo è indicata l&apos;attività di riferimento.</p>
        {drafts.length === 0 ? (
          <p className="text-sm text-slate-600">Nessuna bozza ancora creata.</p>
        ) : groups.map((group) => {
          const groupDrafts = group.members.map((member) => draftByKey.get(member.draftKey)!);
          const first = groupDrafts[0]!;
          const template = templateFor(first);
          return (
            <section key={`${group.issueSemanticKey ?? ""}:${group.templateKey}`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
              aria-label={`Gruppo ${first.current.title}`}>
              <h4 className="text-sm font-semibold text-slate-900">
                {template?.activityTitle ?? first.current.title}
                <span className="font-normal text-slate-600"> · {issueTextFor(first) ?? "problematica da verificare"} · {group.members.length} {group.members.length === 1 ? "bozza" : "bozze"}</span>
              </h4>
              {group.duplicated ? (
                <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">Possibili duplicati storici</p>
                  <p className="mt-1">{group.reconciliationNote}</p>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-amber-950">
                        <th className="py-1 pr-2 font-medium">Bozza</th>
                        <th className="py-1 pr-2 font-medium">Destinatario</th>
                        <th className="py-1 pr-2 font-medium">Contenuto</th>
                        <th className="py-1 pr-2 font-medium">Stato</th>
                        <th className="py-1 font-medium">Proposta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.members.map((member, index) => (
                        <tr key={member.draftKey} className="border-t border-amber-200 align-top">
                          <td className="py-1 pr-2"><a className="underline" href={`#draft-${member.draftKey}`}>n. {index + 1}</a> · {formatDateIT(member.lastSavedAt)}</td>
                          <td className="py-1 pr-2">{member.recipient ?? "non indicato nel testo"}</td>
                          <td className="py-1 pr-2 font-mono">{member.bodySha256.slice(0, 8)}</td>
                          <td className="py-1 pr-2">{ACT_DRAFT_STATUS_LABELS[member.status]} · v{member.version}{member.linkedToActivity ? " · collegata all'attività" : ""}</td>
                          <td className="py-1">{RECONCILIATION_LABELS[member.reconciliation]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {groupDrafts.map((draft) => {
                const linkedActivities = activities.filter((activity) =>
                  activity.current.drafts.some((link) => link.draftKey === draft.draftKey));
                const exactSpecs = activitySpecs.filter((spec) => spec.issueSemanticKey === draft.current.issueSemanticKey
                  && spec.documents.some((document) => document.templateKey === draft.current.templateKey));
                const linkedKey = linkedActivities.length === 1 ? linkedActivities[0].activityKey
                  : linkedActivities.length === 0 && exactSpecs.length === 1 ? exactSpecs[0].activityKey : null;
                const activityKey = activitySpecs.some((spec) => spec.activityKey === linkedKey) ? linkedKey : null;
                return (
                  <DraftCard
                    key={draft.draftKey}
                    draft={draft}
                    drafts={drafts}
                    procedimentoId={procedimentoId}
                    canManage={canManage}
                    attachmentOptions={attachmentOptions}
                    issueLabel={issueTextFor(draft)}
                    activityLabel={templateFor(draft)?.activityTitle ?? null}
                    activityKey={activityKey}
                  />
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}
