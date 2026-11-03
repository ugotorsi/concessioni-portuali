import { AlertTriangle, BookOpen, Download, ExternalLink } from "lucide-react";

import { formatDateIT } from "@/lib/utils";
import { documentReferenceLabel } from "@/lib/professional-text";
import type {
  PortRegimeCoordination,
  StructuredFascicoloReportPayload,
  StructuredReportAuthority,
  StructuredReportLegalApplication,
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
          <details key={`${authority.direction}-${authority.resultId}`} className="rounded-md border border-slate-200 bg-white">
            <summary className="cursor-pointer p-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{authority.title}</p>
              <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">{authority.direction}</span>
              </div>
            </summary>
            <div className="border-t border-slate-200 p-3">
              <p className="text-xs font-medium text-emerald-800">Fonte verificata e utilizzabile</p>
              {authority.rationale ? <p className="mt-2 text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{authority.rationale}</p> : null}
              {authority.sourceUrl ? (
                <a href={authority.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#075985] underline underline-offset-4">
                  Apri la fonte ufficiale <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export function UnverifiedCandidateSources({ question }: { question: StructuredReportQuestion }) {
  const candidates = question.nonUsableResults.filter((candidate) => !candidate.reasons.includes("CLASSIFICATION_REJECTED"));
  if (candidates.length === 0) return null;
  return (
    <details className="mt-3 rounded-md border border-amber-200 bg-amber-50" aria-label="Fonti candidate da verificare">
      <summary className="cursor-pointer p-3 text-sm font-semibold text-amber-950">Fonti individuate — da verificare ({candidates.length})</summary>
      <div className="border-t border-amber-200 p-3">
      <p className="mt-1 text-xs text-amber-900">
        Risultati preliminari dei connettori: non sono ancora fonti utilizzabili per conclusioni professionali.
        Devono essere controllati identità, testo, citazioni e applicabilità temporale.
      </p>
      <ul className="mt-2 space-y-3">
        {candidates.map((candidate) => (
          <li key={candidate.resultId} className="border-t border-amber-200 pt-2 text-sm text-slate-800">
            <p className="font-medium [overflow-wrap:anywhere]">{candidate.title}</p>
            {candidate.rationale ? (
              <p className="mt-1 leading-6 [overflow-wrap:anywhere]">
                Rilevanza preliminare segnalata, da riscontrare: {candidate.rationale}
              </p>
            ) : null}
            {candidate.sourceUrl ? (
              <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[#075985] underline underline-offset-4">
                Apri il documento <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      </div>
    </details>
  );
}

export function OperationalPlans({ plans }: { plans: NonNullable<StructuredFascicoloReportPayload["operationalPlans"]> }) {
  if (plans.length === 0) return null;
  return (
    <ContentSection title="Percorsi operativi da valutare">
      <p className="mb-4 text-sm leading-6 text-amber-900">
        Ipotesi istruttorie preliminari, non pareri conclusivi né atti autorizzati. Il professionista deve
        verificare titolo, fonti, competenza e termini, quindi scegliere e approvare ogni iniziativa.
      </p>
      <div className="space-y-5">
        {plans.map((plan) => (
          <article key={plan.issueSemanticKey} className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="font-semibold text-slate-950">{plan.issueText}</h4>
            <p className="mt-2 text-sm text-slate-700">{plan.recommendedNextStep}</p>
            <p className="mt-2 text-xs font-medium text-amber-900">
              {plan.legalSourceStatus === "LEGAL_RESEARCH_REQUIRED"
                ? "Normativa e giurisprudenza ancora da verificare"
                : "Fonti collegate: verificare pertinenza e applicabilità prima di procedere"}
            </p>
            {plan.outstandingEvidence.length > 0 ? (
              <div className="mt-3">
                <h5 className="text-sm font-semibold text-slate-900">Documenti e fatti mancanti</h5>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {plan.outstandingEvidence.map((gap) => <li key={gap}>{gap}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="mt-4">
              <h5 className="text-sm font-semibold text-slate-900">Come procedere</h5>
              <ol className="mt-2 space-y-3">
                {plan.steps.map((step) => (
                  <li key={step.title} className="rounded-md bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-950">{step.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{step.action}</p>
                    <p className="mt-2 text-xs text-slate-600">Interlocutore: {step.office}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-700">Documenti necessari</p>
                    <ul className="mt-1 list-disc pl-5 text-xs leading-5 text-slate-700">
                      {step.requiredDocuments.map((document) => <li key={document}>{document}</li>)}
                    </ul>
                    <p className="mt-2 text-xs text-slate-600">Condizione per proseguire: {step.completionGate}</p>
                    {step.draftTemplate ? (
                      <details className="mt-3 rounded-md border border-slate-200 bg-white">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-800">
                          Apri facsimile: {step.draftTitle ?? "atto operativo"}
                        </summary>
                        <pre className="whitespace-pre-wrap border-t border-slate-200 p-3 font-sans text-xs leading-5 text-slate-700">
                          {step.draftTemplate}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-4">
              <h5 className="text-sm font-semibold text-slate-900">Alternative giuridico-operative</h5>
              <div className="mt-2 space-y-3">
                {plan.alternatives.map((alternative) => (
                  <div key={alternative.title} className="border-l-2 border-[#0b7285] pl-3">
                    <p className="text-sm font-semibold text-slate-950">{alternative.title}</p>
                    <p className="mt-1 text-sm text-slate-700">Quando: {alternative.whenApplicable}</p>
                    <p className="mt-1 text-sm text-slate-700">Percorso: {alternative.practicalRoute}</p>
                    <p className="mt-1 text-sm text-amber-900">Rischio: {alternative.riskOrLimit}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-700">{plan.deadlineReview}</p>
            {plan.sourceDocumentRefs.length > 0 ? (
              <p className="mt-2 text-xs text-slate-500">Riferimenti documentali: {plan.sourceDocumentRefs.map(documentReferenceLabel).join("; ")}</p>
            ) : null}
          </article>
        ))}
      </div>
    </ContentSection>
  );
}

const TEMPORAL_STATUS_LABELS: Readonly<Record<StructuredReportLegalApplication["rules"][number]["temporalStatus"], string>> = {
  APPLICABLE: "Applicabile",
  APPLICABLE_PREVIOUS_VERSION: "Applicabile nel testo previgente",
  NOT_APPLICABLE_RATIONE_TEMPORIS: "Non applicabile ratione temporis",
  PROSPECTIVE_ONLY: "Solo per adempimenti successivi",
  DATE_TO_VERIFY: "Data da accertare",
};

const ELEMENT_STATUS_LABELS: Readonly<Record<NonNullable<StructuredReportLegalApplication["elementAnalysis"]>["elements"][number]["status"], string>> = {
  PROVEN: "Provato",
  INDICATED: "Dai documenti, da confermare",
  NOT_PROVEN: "Non provato",
  CONTRARY_EVIDENCE: "Elementi contrari",
};

const PORT_REGIME_STATUS_LABELS: Readonly<Record<PortRegimeCoordination["sources"][number]["status"], string>> = {
  FULLY_APPLICABLE: "Applicabile integralmente",
  PARTIALLY_APPLICABLE: "Applicabile in parte",
  PREVIOUS_TEXT_APPLICABLE: "Testo previgente",
  NOT_APPLICABLE_RATIONE_TEMPORIS: "Non applicabile ratione temporis",
  SUPERSEDED: "Sostituita",
  DATE_TO_VERIFY: "Data da accertare",
};

export function PortRegimeSection({ regime }: { regime: PortRegimeCoordination }) {
  const dateLine = (entry: PortRegimeCoordination["grantDate"]) =>
    `${entry.label}: ${entry.date ? formatDateIT(new Date(`${entry.date}T00:00:00Z`)) : "da accertare"} — ${entry.basis}${entry.pages.length ? ` (pag. ${entry.pages.join(", ")})` : ""}`;
  return (
    <ContentSection title="Coordinamento del regime concessorio portuale nel tempo">
      <div className="space-y-3 text-sm leading-6 text-slate-700">
        <ul className="space-y-1">
          <li>{dateLine(regime.procedureStartDate)}</li>
          <li>{dateLine(regime.grantDate)}</li>
        </ul>
        <div className="space-y-2">
          {regime.sources.map((source) => (
            <details key={source.sourceId} className="rounded-md border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-3 py-2">
                <span className="font-medium text-slate-950">{source.citation}</span>
                <span className="ml-2 text-xs font-semibold text-slate-600">{PORT_REGIME_STATUS_LABELS[source.status]}</span>
              </summary>
              <div className="space-y-1 border-t border-slate-200 px-3 py-2">
                <p>{source.reasoning}</p>
                {source.operativeConsequences.length ? (
                  <ul className="list-disc space-y-1 pl-5">{source.operativeConsequences.map((consequence) => <li key={consequence}>{consequence}</li>)}</ul>
                ) : null}
                <a href={source.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-[#075985] underline underline-offset-4">
                  Testo ufficiale <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </details>
          ))}
        </div>
        <p><strong>Conclusione:</strong> {regime.conclusion}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">{regime.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
      </div>
    </ContentSection>
  );
}

export function LegalApplicationSection({ items }: { items: readonly StructuredReportLegalApplication[] }) {
  if (items.length === 0) return null;
  return (
    <ContentSection title="Analisi giuridica: applicazione delle norme ai fatti">
      <div className="space-y-3">
        {items.map((item) => (
          <details key={item.issueSemanticKey} className="rounded-md border border-slate-200 bg-white" aria-label={`Analisi: ${item.issueText}`}>
            <summary className="cursor-pointer p-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{item.issueText}</p>
                <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                  {item.conclusionStatus === "GROUNDED_ON_VERIFIED_AUTHORITIES" ? "Con giurisprudenza verificata" : "Preliminare: solo dato normativo"}
                </span>
              </div>
            </summary>
            <div className="space-y-4 border-t border-slate-200 p-4 text-sm leading-6 text-slate-700">
              <section>
                <h5 className="font-semibold text-slate-950">Date rilevanti</h5>
                <ul className="mt-1 space-y-1">
                  {item.relevantDates.map((date) => (
                    <li key={`${date.label}-${date.date}`}><strong>{date.label}:</strong> {formatDateIT(new Date(`${date.date}T00:00:00Z`))} — {date.basis}</li>
                  ))}
                </ul>
              </section>
              {item.facts.length > 0 ? (
                <section>
                  <h5 className="font-semibold text-slate-950">Fatti e prova documentale</h5>
                  <ul className="mt-1 space-y-1">
                    {item.facts.map((fact) => (
                      <li key={fact.text} className="[overflow-wrap:anywhere]">
                        {fact.text}
                        <span className="text-xs text-slate-500"> ({fact.humanConfirmed ? "confermato" : "da confermare"}{fact.pages.length ? `; pag. ${fact.pages.join(", ")}` : ""})</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {item.rules.length > 0 ? (
                <section>
                  <h5 className="font-semibold text-slate-950">Normativa applicabile nel tempo</h5>
                  <div className="mt-2 space-y-2">
                    {item.rules.map((rule) => (
                      <details key={rule.ruleId} className="rounded-md border border-slate-200 bg-slate-50">
                        <summary className="cursor-pointer px-3 py-2">
                          <span className="font-medium text-slate-950">{rule.citation}</span>
                          <span className="ml-2 text-xs font-semibold text-slate-600">{TEMPORAL_STATUS_LABELS[rule.temporalStatus]}</span>
                        </summary>
                        <div className="space-y-1 border-t border-slate-200 px-3 py-2">
                          <p><strong>Oggetto:</strong> {rule.subject}</p>
                          <p><strong>Vigenza:</strong> {rule.temporalReasoning}</p>
                          <p><strong>Applicazione ai fatti:</strong> {rule.applicationToFacts}</p>
                          <a href={rule.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-[#075985] underline underline-offset-4">
                            Testo ufficiale{rule.referenceDate ? " nella versione alla data rilevante" : ""} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <section>
                  <h5 className="font-semibold text-slate-950">Argomenti a sostegno</h5>
                  <ul className="mt-1 list-disc space-y-1 pl-5">{item.favorableArguments.map((argument) => <li key={argument}>{argument}</li>)}</ul>
                </section>
                <section>
                  <h5 className="font-semibold text-slate-950">Argomenti contrari e rischi</h5>
                  <ul className="mt-1 list-disc space-y-1 pl-5">{item.contraryArguments.map((argument) => <li key={argument}>{argument}</li>)}</ul>
                </section>
              </div>
              {item.elementAnalysis ? (
                <section aria-label="Analisi degli elementi della fattispecie">
                  <h5 className="font-semibold text-slate-950">Elementi della fattispecie: {item.elementAnalysis.label}</h5>
                  <ul className="mt-2 space-y-2">
                    {item.elementAnalysis.elements.map((element) => (
                      <li key={element.elementId} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                          <span className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{element.requirement}</span>
                          <span className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{ELEMENT_STATUS_LABELS[element.status]}</span>
                        </div>
                        <p className="text-xs text-slate-500">{element.legalBasis}</p>
                        <p className="mt-1">{element.reasoning}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section>
                <h5 className="font-semibold text-slate-950">Conclusione motivata</h5>
                <p className="mt-1">{item.conclusion}</p>
              </section>
              <section>
                <h5 className="font-semibold text-slate-950">Conseguenze operative e processuali</h5>
                <ul className="mt-1 list-disc space-y-1 pl-5">{item.consequences.map((consequence) => <li key={consequence}>{consequence}</li>)}</ul>
              </section>
            </div>
          </details>
        ))}
      </div>
    </ContentSection>
  );
}

function RegulatoryApplicability({
  rows,
}: {
  rows: NonNullable<StructuredFascicoloReportPayload["regulatoryApplicability"]>;
}) {
  if (rows.length === 0) return null;
  return (
    <ContentSection title="Applicabilità della delibera ART n. 242/2025">
      <details className="rounded-md border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-950">
          Matrice temporale e adempimenti ({rows.length} misure)
        </summary>
        <div className="space-y-3 border-t border-slate-200 p-4">
          {rows.map((row) => (
            <article key={row.measure} className="rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
              <h4 className="font-semibold text-slate-950">Misura {row.measure}</h4>
              <p><strong>Efficacia:</strong> {row.effectiveFrom}</p>
              <p><strong>Fattispecie:</strong> {row.trigger}</p>
              <p><strong>Applicabilità:</strong> {row.applicability}</p>
              <p><strong>Adempimento AdSP:</strong> {row.authorityAction}</p>
              <p><strong>Scadenza:</strong> {row.deadline}</p>
              <a href={row.officialSourceUrl} target="_blank" rel="noreferrer" className="font-medium text-[#075985] underline underline-offset-4">
                Allegato A ufficiale ART
              </a>
            </article>
          ))}
        </div>
      </details>
    </ContentSection>
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
                    {issue.questions.map((question) => (
                      <li key={question.knowledgeItemId}>
                        <p>{question.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {payload.unassignedQuestions.map((question) => (
              <article key={question.knowledgeItemId} className="border-l-2 border-slate-300 pl-4 text-sm leading-6 text-slate-700">
                <p>{question.text}</p>
              </article>
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

      {payload.portRegime ? <PortRegimeSection regime={payload.portRegime} /> : null}
      {payload.legalApplication?.length ? <LegalApplicationSection items={payload.legalApplication} /> : null}

      {payload.regulatoryApplicability?.length ? <RegulatoryApplicability rows={payload.regulatoryApplicability} /> : null}

      {payload.operationalPlans?.length ? <OperationalPlans plans={payload.operationalPlans} /> : null}

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

function ReportDiagnostics({ payload }: { payload: StructuredFascicoloReportPayload }) {
  const questions = allQuestions(payload).filter((question) => question.nonUsableResults.length > 0);
  if (questions.length === 0) return null;
  return (
    <details className="rounded-md border border-slate-300 bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Diagnostica amministratore — fonti escluse dal rapporto professionale
      </summary>
      <div className="mt-3 space-y-4 border-t border-slate-200 pt-3">
        {questions.map((question) => (
          <article key={question.semanticKey}>
            <p className="text-sm font-medium text-slate-900">{question.text}</p>
            <UnverifiedCandidateSources question={question} />
          </article>
        ))}
      </div>
    </details>
  );
}

export function FascicoloReport({
  procedimentoId,
  showDiagnostics = false,
  snapshots,
}: {
  procedimentoId: string;
  showDiagnostics?: boolean;
  snapshots: readonly FascicoloReportSnapshot[];
}) {
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
        <p className="mt-1 text-sm text-slate-600">Bozza istruttoria automatica: richiede verifica e validazione professionale.</p>
      </header>

      {report ? (
        <>
          <section aria-label="Rapporto disponibile" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <dl className="flex flex-wrap gap-x-7 gap-y-3 text-sm">
                <div><dt className="text-xs font-medium text-slate-500">Stato</dt><dd className="mt-1 font-semibold text-slate-950">{fascicoloReportStatusLabel(report.status)}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Generato il</dt><dd className="mt-1 font-semibold text-slate-950">{formatDateIT(report.generatedAt)}</dd></div>
              </dl>
              {report.status === "CURRENT" ? (
                <div className="flex flex-wrap gap-2">
                  {(["pdf", "rtf"] as const).map((format) => (
                    <a
                      key={format}
                      href={`/procedimenti/${procedimentoId}/report/export?format=${format}`}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Scarica {format.toUpperCase()}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            {report.status === "STALE" ? (
              <div className="mt-4 flex items-start gap-2 border-t border-amber-200 pt-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>Il fascicolo contiene modifiche successive alla generazione di questo rapporto.</p>
              </div>
            ) : null}
          </section>
          <ReportContent payload={report.payload} />
          {showDiagnostics ? <ReportDiagnostics payload={report.payload} /> : null}
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
