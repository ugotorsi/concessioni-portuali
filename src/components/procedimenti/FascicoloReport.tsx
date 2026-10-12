import { AlertTriangle, BookOpen, ExternalLink } from "lucide-react";

import { formatDateIT } from "@/lib/utils";
import type {
  StructuredFascicoloReportPayload,
  StructuredReportAuthority,
  StructuredReportQuestion,
} from "@/server/fascicolo-report/structured-report";
import type {
  StructuredReportSnapshotRecord,
  StructuredReportSnapshotStatus,
} from "@/server/fascicolo-report/repository";

export type FascicoloReportSnapshot = Pick<
  StructuredReportSnapshotRecord,
  "id" | "status" | "payload" | "staleReasons" | "generatedAt"
>;

export function fascicoloReportStatusLabel(status: StructuredReportSnapshotStatus): string {
  switch (status) {
    case "CURRENT": return "Corrente";
    case "STALE": return "Da aggiornare";
    case "SUPERSEDED": return "Superato";
  }
}

function professionalNote(value: string): string | null {
  const labels: Readonly<Record<string, string>> = {
    CURRENT_RESEARCH_MISSION_MISSING: "La ricerca non è ancora disponibile per una delle questioni.",
    DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES: "Le scadenze individuate richiedono verifica prima dell’uso operativo.",
    KNOWLEDGE_REVISION_CHANGED: "Il quadro documentale è stato aggiornato dopo la generazione.",
    NO_CURRENT_RESEARCH_QUESTIONS: "Non risultano questioni di ricerca correnti associate al rapporto.",
    NO_USABLE_CONTRARY_AUTHORITY: "Per una o più questioni non risultano fonti contrarie utilizzabili.",
    NO_USABLE_SOURCE: "Non risultano fonti utilizzabili per una delle questioni.",
    QUESTION_NOT_HUMAN_CONFIRMED: "Una o più questioni richiedono conferma professionale.",
    RESEARCH_NOT_COMPLETED: "Una o più ricerche non risultano completate.",
    RESEARCH_STATE_CHANGED: "Lo stato delle ricerche è cambiato dopo la generazione.",
    SOURCE_STATE_CHANGED: "Lo stato di utilizzabilità delle fonti è cambiato dopo la generazione.",
    SUPERSEDED_BY_MATERIAL_CHANGE: "Il rapporto è stato superato dopo modifiche rilevanti al fascicolo.",
    UNCOVERED_ELEMENT: "Un elemento della questione non risulta ancora coperto dalle fonti disponibili.",
  };
  if (labels[value]) return labels[value];
  return /^[A-Z][A-Z0-9_]+$/.test(value) ? null : value;
}

function uniqueNotes(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(professionalNote).filter((value): value is string => value !== null))];
}

function allQuestions(payload: StructuredFascicoloReportPayload): readonly StructuredReportQuestion[] {
  return [...payload.legalIssues.flatMap((issue) => issue.questions), ...payload.unassignedQuestions];
}

interface DirectedAuthority extends StructuredReportAuthority {
  direction: "Favorevole" | "Contraria";
}

function usableAuthorities(payload: StructuredFascicoloReportPayload): readonly DirectedAuthority[] {
  const authorities = allQuestions(payload).flatMap((question) => [
    ...question.favorableAuthorities.map((authority) => ({ ...authority, direction: "Favorevole" as const })),
    ...question.contraryAuthorities.map((authority) => ({ ...authority, direction: "Contraria" as const })),
  ]);
  return [...new Map(authorities.map((authority) => [`${authority.direction}:${authority.resultId}`, authority])).values()];
}

function TextList({ items }: { items: readonly { normalizedText: string }[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-slate-700">
      {items.map((item, index) => <li key={`${item.normalizedText}-${index}`} className="[overflow-wrap:anywhere]">{item.normalizedText}</li>)}
    </ul>
  );
}

function ContentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-5">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AuthorityGroup({ title, authorities }: { title: string; authorities: readonly DirectedAuthority[] }) {
  if (authorities.length === 0) return null;
  return (
    <section aria-label={title}>
      <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
      <div className="mt-2 space-y-2">
        {authorities.map((authority) => (
          <article key={`${authority.direction}-${authority.resultId}`} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{authority.title}</p>
              <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">{authority.direction}</span>
            </div>
            {authority.rationale ? <p className="mt-2 text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{authority.rationale}</p> : null}
            {authority.sourceUrl ? (
              <a href={authority.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#075985] underline underline-offset-4">
                Apri la fonte <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ReportContent({ payload }: { payload: StructuredFascicoloReportPayload }) {
  const framework = payload.documentedFramework;
  const frameworkGroups = [
    { title: "Ruoli e soggetti", items: framework.partyRoles },
    { title: "Atti rilevanti", items: framework.legalActs },
    { title: "Misure", items: framework.measures },
  ].filter((group) => group.items.length > 0);
  const questions = allQuestions(payload);
  const authorities = usableAuthorities(payload);
  const favorable = authorities.filter((authority) => authority.direction === "Favorevole");
  const contrary = authorities.filter((authority) => authority.direction === "Contraria");
  const limitations = uniqueNotes([
    ...payload.limitations,
    ...questions.flatMap((question) => [...question.gaps, ...question.limitations]),
  ]);

  return (
    <div className="space-y-5">
      {frameworkGroups.length > 0 ? (
        <ContentSection title="Quadro del fascicolo">
          <div className="grid gap-4 md:grid-cols-2">
            {frameworkGroups.map((group) => (
              <div key={group.title}>
                <h4 className="mb-2 text-sm font-medium text-slate-900">{group.title}</h4>
                <TextList items={group.items} />
              </div>
            ))}
          </div>
        </ContentSection>
      ) : null}

      {framework.facts.length > 0 ? <ContentSection title="Fatti rilevanti"><TextList items={framework.facts} /></ContentSection> : null}

      {payload.legalIssues.length > 0 || payload.unassignedQuestions.length > 0 ? (
        <ContentSection title="Questioni giuridiche">
          <div className="space-y-4">
            {payload.legalIssues.map((issue) => (
              <article key={issue.knowledgeItemId} className="border-l-2 border-[#0b7285] pl-4">
                <h4 className="font-medium text-slate-950 [overflow-wrap:anywhere]">{issue.text}</h4>
                {issue.questions.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
                    {issue.questions.map((question) => <li key={question.knowledgeItemId}>{question.text}</li>)}
                  </ul>
                ) : null}
              </article>
            ))}
            {payload.unassignedQuestions.map((question) => (
              <article key={question.knowledgeItemId} className="border-l-2 border-slate-300 pl-4 text-sm leading-6 text-slate-700">{question.text}</article>
            ))}
          </div>
        </ContentSection>
      ) : null}

      {authorities.length > 0 ? (
        <ContentSection title="Fonti utilizzabili">
          <div className="grid gap-4 lg:grid-cols-2">
            <AuthorityGroup title="Elementi favorevoli" authorities={favorable} />
            <AuthorityGroup title="Elementi contrari" authorities={contrary} />
          </div>
        </ContentSection>
      ) : null}

      {framework.contradictions.length > 0 ? <ContentSection title="Criticità"><TextList items={framework.contradictions} /></ContentSection> : null}

      {payload.gaps.length > 0 || limitations.length > 0 ? (
        <ContentSection title="Limiti e punti da approfondire">
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {payload.gaps.map((gap) => <li key={gap.id}>{gap.normalizedText}</li>)}
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </ContentSection>
      ) : null}
    </div>
  );
}

function PreviousVersions({ snapshots }: { snapshots: readonly FascicoloReportSnapshot[] }) {
  if (snapshots.length === 0) return null;
  return (
    <details className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Versioni precedenti</summary>
      <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
        {snapshots.map((snapshot) => {
          const reasons = uniqueNotes(snapshot.staleReasons);
          return (
            <li key={snapshot.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-slate-950">{formatDateIT(snapshot.generatedAt)}</span>
                <span className="text-slate-600">{fascicoloReportStatusLabel(snapshot.status)}</span>
              </div>
              {reasons.length > 0 ? <p className="mt-1 text-slate-600">{reasons.join(" ")}</p> : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function FascicoloReport({ snapshots }: { snapshots: readonly FascicoloReportSnapshot[] }) {
  const report = snapshots.find((snapshot) => snapshot.status === "CURRENT")
    ?? snapshots.find((snapshot) => snapshot.status === "STALE")
    ?? null;
  const previous = snapshots.filter((snapshot) => snapshot.id !== report?.id);

  return (
    <section aria-labelledby="report-title" className="min-w-0 space-y-6" data-testid="fascicolo-report">
      <header className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-[#173d4f]" aria-hidden="true" />
          <h2 id="report-title" className="text-xl font-semibold text-slate-950">Rapporto</h2>
        </div>
        <p className="mt-1 text-sm text-slate-600">Sintesi professionale strutturata del fascicolo.</p>
      </header>

      {report ? (
        <>
          <section aria-label="Rapporto disponibile" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
            <dl className="flex flex-wrap gap-x-7 gap-y-3 text-sm">
              <div><dt className="text-xs font-medium text-slate-500">Stato</dt><dd className="mt-1 font-semibold text-slate-950">{fascicoloReportStatusLabel(report.status)}</dd></div>
              <div><dt className="text-xs font-medium text-slate-500">Generato il</dt><dd className="mt-1 font-semibold text-slate-950">{formatDateIT(report.generatedAt)}</dd></div>
            </dl>
            {report.status === "STALE" ? (
              <div className="mt-4 flex items-start gap-2 border-t border-amber-200 pt-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>Il fascicolo contiene modifiche successive alla generazione di questo rapporto.</p>
              </div>
            ) : null}
          </section>
          <ReportContent payload={report.payload} />
        </>
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">Non è ancora disponibile un rapporto strutturato per questo fascicolo.</p>
          <p className="mt-1 text-sm text-slate-600">I dati del fascicolo restano consultabili nelle sezioni Analisi, Ricerca, Scadenze e Criticità.</p>
        </div>
      )}

      <PreviousVersions snapshots={previous} />
    </section>
  );
}