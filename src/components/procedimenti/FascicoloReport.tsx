import Link from "next/link";
import { AlertTriangle, BookOpen, Download, ExternalLink } from "lucide-react";

import { formatDateIT } from "@/lib/utils";
import { commonLegalContent, legalIssueNarrative, legalRuleKey } from "@/lib/legal-report-presentation";
import { projectProfessionalResearch } from "@/lib/professional-research-sources";
import {
  documentCoverageSummaries,
  documentNamesByReference,
  humanizeProfessionalText,
  isInternalProfessionalDiagnostic,
  professionalGapSummaries,
} from "@/lib/professional-text";
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
  if (isInternalProfessionalDiagnostic(value)) return null;
  const labels: Readonly<Record<string, string>> = {
    CURRENT_RESEARCH_MISSION_MISSING: "La ricerca non è ancora disponibile per una delle questioni.",
    ADDITIONAL_DOCUMENTS_REQUIRED: "Sono necessari ulteriori documenti per completare la valutazione.",
    DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES: "Le scadenze individuate richiedono verifica prima dell’uso operativo.",
    DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_LEGAL_ISSUES: "Il fascicolo contiene segnali documentali che richiedono una valutazione giuridica, ma non risultano ancora questioni giuridiche strutturate.",
    KNOWLEDGE_REVISION_CHANGED: "Il quadro documentale è stato aggiornato dopo la generazione.",
    NO_CURRENT_RESEARCH_QUESTIONS: "Non risultano questioni di ricerca correnti associate al rapporto.",
    NO_USABLE_CONTRARY_AUTHORITY: "Per una o più questioni non risultano fonti contrarie utilizzabili.",
    NO_USABLE_SOURCE: "Non risultano fonti utilizzabili per una delle questioni.",
    QUESTION_NOT_HUMAN_CONFIRMED: "Una o più questioni richiedono conferma professionale.",
    RESEARCH_NOT_COMPLETED: "Una o più ricerche non risultano completate.",
    RESEARCH_STATE_CHANGED: "Lo stato delle ricerche è cambiato dopo la generazione.",
    REPORT_PROJECTION_CHANGED: "I criteri di rappresentazione del rapporto sono cambiati dopo la generazione.",
    SOURCE_STATE_CHANGED: "Lo stato di utilizzabilità delle fonti è cambiato dopo la generazione.",
    SUPERSEDED_BY_MATERIAL_CHANGE: "Il rapporto è stato superato dopo modifiche rilevanti al fascicolo.",
    TECHNICAL_SOURCES_NOT_PROBATIVE_VERIFY_ORIGINAL: "Le acquisizioni tecnico-urbanistiche non sono probatorie e vanno verificate sulle fonti originali.",
    UNCOVERED_ELEMENT: "Un elemento della questione non risulta ancora coperto dalle fonti disponibili.",
  };
  if (labels[value]) return labels[value];
  return /^[A-Z][A-Z0-9_]+$/.test(value) ? null : humanizeProfessionalText(value);
}

function professionalContent(value: string): string {
  return isInternalProfessionalDiagnostic(value) ? "" : humanizeProfessionalText(value);
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
      {items.filter((item) => !isInternalProfessionalDiagnostic(item.normalizedText))
        .map((item, index) => <li key={`${item.normalizedText}-${index}`} className="[overflow-wrap:anywhere]">{humanizeProfessionalText(item.normalizedText)}</li>)}
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

const LEGAL_COMPLETENESS_LABELS: Readonly<Record<string, string>> = {
  DOCUMENTED_ISSUES_STRUCTURED: "Le questioni giuridiche documentate risultano strutturate.",
  NO_ISSUES_EMERGE_FROM_DOCUMENTS: "Dai documenti disponibili non emergono questioni giuridiche da strutturare.",
  DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_ISSUES: "Sono presenti segnali documentali senza corrispondenti questioni giuridiche strutturate.",
  NO_ADDITIONAL_DOCUMENT_NEED_IDENTIFIED: "Non sono state individuate ulteriori esigenze documentali.",
  ADDITIONAL_DOCUMENTS_REQUIRED: "Sono necessari ulteriori documenti.",
  RESEARCH_QUESTIONS_STRUCTURED: "I quesiti di ricerca risultano strutturati.",
  RESEARCH_QUESTIONS_NOT_STRUCTURED: "Le questioni esistono, ma i quesiti di ricerca non risultano strutturati.",
  ASSESSMENT_REQUIRED_BEFORE_RESEARCH: "È necessaria una valutazione professionale prima di formulare quesiti di ricerca.",
  NO_RESEARCH_NEED_IDENTIFIED: "Dai documenti disponibili non emerge una necessità di ricerca.",
};

function LegalCompletenessSection({
  assessment,
}: {
  assessment: NonNullable<StructuredFascicoloReportPayload["legalCompleteness"]>;
}) {
  return (
    <ContentSection title="Controllo di completezza giuridica">
      <ul className="space-y-2 text-sm leading-6 text-slate-700">
        <li>{LEGAL_COMPLETENESS_LABELS[assessment.issueCoverage]}</li>
        <li>{LEGAL_COMPLETENESS_LABELS[assessment.documentNeed]}</li>
        <li>{LEGAL_COMPLETENESS_LABELS[assessment.researchNeed]}</li>
      </ul>
    </ContentSection>
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
              <p className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{professionalContent(authority.title) || "Fonte da verificare"}</p>
              <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">{authority.direction}</span>
              </div>
            </summary>
            <div className="border-t border-slate-200 p-3">
              <p className="text-xs font-medium text-emerald-800">Fonte verificata e classificata dal professionista</p>
              {authority.rationale && professionalContent(authority.rationale) ? <p className="mt-2 text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{professionalContent(authority.rationale)}</p> : null}
              {authority.sourceUrl ? (
                <a href={authority.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#075985] underline underline-offset-4">
                  Apri la fonte <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
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
  const visible = question.nonUsableResults.filter((candidate) => !candidate.reasons.includes("CLASSIFICATION_REJECTED"));
  const pertinent = visible.filter((candidate) => candidate.relevance === "PERTINENTE_VERIFICATA_DA_CLASSIFICARE");
  const notPertinent = visible.filter((candidate) => candidate.relevance === "NON_PERTINENTE");
  const candidates = visible.filter((candidate) => (
    candidate.relevance !== "PERTINENTE_VERIFICATA_DA_CLASSIFICARE" && candidate.relevance !== "NON_PERTINENTE"
  ));
  if (visible.length === 0) return null;
  return (
    <>
      {pertinent.length > 0 ? (
        <section className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3" aria-label="Fonti ufficiali acquisite con corrispondenza testuale" data-testid="report-pertinent-verified-sources">
          <h5 className="text-sm font-semibold text-emerald-950">Fonti ufficiali acquisite con corrispondenza testuale — pertinenza da confermare</h5>
          <p className="mt-1 text-xs text-emerald-900">
            Testo ufficiale acquisito e articolo con corrispondenza testuale al quesito. L&apos;acquisizione dal sito
            ufficiale non equivale a una verifica giuridica: il professionista deve confermarne pertinenza e
            orientamento (a favore o contrario) nella verifica assistita prima di fondare conclusioni.
          </p>
          <ul className="mt-2 space-y-3">
            {pertinent.map((candidate) => (
              <li key={candidate.resultId} className="border-t border-emerald-200 pt-2 text-sm text-slate-800">
                <p className="font-medium [overflow-wrap:anywhere]">{professionalContent(candidate.title) || "Fonte da verificare"}</p>
                {candidate.relevanceNote ? <p className="mt-1 text-xs text-emerald-900">{candidate.relevanceNote}</p> : null}
                {candidate.rationale && professionalContent(candidate.rationale) ? <p className="mt-1 leading-6 [overflow-wrap:anywhere]">{professionalContent(candidate.rationale)}</p> : null}
                {candidate.sourceUrl ? (
                  <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[#075985] underline underline-offset-4">
                    Apri la fonte <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {candidates.length > 0 ? (
        <section className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3" aria-label="Fonti candidate da verificare">
          <h5 className="text-sm font-semibold text-amber-950">Fonti individuate — non verificabili o da verificare</h5>
          <p className="mt-1 text-xs text-amber-900">
            Risultati preliminari dei connettori: non sono ancora fonti utilizzabili per conclusioni professionali.
            Devono essere controllati identità, testo, citazioni e applicabilità temporale.
          </p>
          <ul className="mt-2 space-y-3">
            {candidates.map((candidate) => (
              <li key={candidate.resultId} className="border-t border-amber-200 pt-2 text-sm text-slate-800">
                <p className="font-medium [overflow-wrap:anywhere]">{professionalContent(candidate.title) || "Fonte da verificare"}</p>
                {candidate.relevanceNote ? <p className="mt-1 text-xs text-amber-900">{candidate.relevanceNote}</p> : null}
                {candidate.rationale && professionalContent(candidate.rationale) ? (
                  <p className="mt-1 leading-6 [overflow-wrap:anywhere]">
                    Rilevanza preliminare segnalata, da riscontrare: {professionalContent(candidate.rationale)}
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
        </section>
      ) : null}
      {notPertinent.length > 0 ? (
        <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="report-not-pertinent-sources">
          <summary className="cursor-pointer font-semibold text-slate-700">
            Fonti escluse perché non pertinenti al quesito ({notPertinent.length})
          </summary>
          <ul className="mt-2 space-y-2 text-slate-700">
            {notPertinent.map((candidate) => (
              <li key={candidate.resultId} className="[overflow-wrap:anywhere]">
                {professionalContent(candidate.title) || "Fonte da verificare"}
                {candidate.relevanceNote ? <span className="block text-xs text-slate-500">{candidate.relevanceNote}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

const TECHNICAL_STATUS_LABELS: Readonly<Record<string, string>> = {
  DA_VERIFICARE_SU_FONTE_ORIGINALE: "Da verificare su fonte originale",
  INDICATIVO_DA_VERIFICARE: "Indicativo, da verificare",
  RISPOSTA_VUOTA_NON_PROBATORIA: "Risposta vuota, non probatoria",
};

export function TechnicalSourcesSection({ sources }: { sources: NonNullable<StructuredFascicoloReportPayload["technicalSources"]> }) {
  if (sources.length === 0) return null;
  return (
    <section className="border-t border-slate-200 pt-5" aria-label="Fonti tecniche e urbanistiche da verificare" data-testid="report-technical-sources">
      <h3 className="text-base font-semibold text-slate-950">Fonti tecniche e urbanistiche — da verificare</h3>
      <p className="mt-1 text-xs text-amber-900">
        Acquisizioni tramite connettore tecnico (MCP): non sono fonti utilizzabili e non attestano vincoli, conformità o assenza di vincoli.
      </p>
      <ul className="mt-3 space-y-3">
        {sources.map((source) => (
          <li key={source.recordId} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{source.question}</p>
              <span className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-950">
                {TECHNICAL_STATUS_LABELS[source.verificationStatus] ?? "Da verificare"}
              </span>
            </div>
            <p className="mt-1 leading-6">{source.requiredVerification}</p>
            <p className="mt-1 text-xs text-slate-600">
              Strumento {source.toolName} · servizio {source.serviceVersion} · acquisito il {new Date(source.retrievedAt).toLocaleString("it-IT")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TEMPORAL_STATUS_LABELS: Readonly<Record<StructuredReportLegalApplication["rules"][number]["temporalStatus"], string>> = {
  APPLICABLE: "Applicabile",
  APPLICABLE_PREVIOUS_VERSION: "Applicabile nel testo previgente",
  NOT_APPLICABLE_RATIONE_TEMPORIS: "Non applicabile ratione temporis",
  PROSPECTIVE_ONLY: "Solo per adempimenti successivi",
  SUPERSEDED: "Sostituita per nuove procedure",
  APPLICABILITY_TO_VERIFY: "Presupposti da verificare",
  DATE_TO_VERIFY: "Data da accertare",
};

const ELEMENT_STATUS_LABELS: Readonly<Record<NonNullable<StructuredReportLegalApplication["elementAnalysis"]>["elements"][number]["status"], string>> = {
  PROVEN: "Provato",
  INDICATED: "Dai documenti, da confermare",
  NOT_PROVEN: "Non provato",
  CONTRARY_EVIDENCE: "Elementi contrari",
};

const PORT_REGIME_STATUS_LABELS: Readonly<Record<PortRegimeCoordination["sources"][number]["status"], string>> = {
  FULLY_APPLICABLE: "Applicabile al titolo, per singolo istituto e data",
  PARTIALLY_APPLICABLE: "Applicabile in parte",
  PREVIOUS_TEXT_APPLICABLE: "Testo previgente",
  NOT_APPLICABLE_RATIONE_TEMPORIS: "Non applicabile ratione temporis",
  SUPERSEDED: "Sostituita",
  APPLICABILITY_TO_VERIFY: "Presupposti da verificare",
  DATE_TO_VERIFY: "Data da accertare",
};

export function PortRegimeSection({ regime }: { regime: PortRegimeCoordination }) {
  const dateLine = (entry: PortRegimeCoordination["grantDate"]) =>
    `${entry.label}: ${entry.date ? formatDateIT(new Date(`${entry.date}T00:00:00Z`)) : "da accertare"} — ${entry.basis}${entry.pages.length ? ` (pag. ${entry.pages.join(", ")})` : ""}`;
  return (
    <ContentSection title="Coordinamento del regime concessorio portuale nel tempo">
      <div className="space-y-3 text-sm leading-6 text-slate-700">
        <ul className="space-y-1">
          <li>{professionalContent(dateLine(regime.procedureStartDate))}</li>
          <li>{professionalContent(dateLine(regime.grantDate))}</li>
        </ul>
        <div className="space-y-2">
          {regime.sources.map((source) => (
            <details key={source.sourceId} className="rounded-md border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-3 py-2">
                <span className="font-medium text-slate-950">{professionalContent(source.citation)}</span>
                <span className="ml-2 text-xs font-semibold text-slate-600">{PORT_REGIME_STATUS_LABELS[source.status]}</span>
              </summary>
              <div className="space-y-1 border-t border-slate-200 px-3 py-2">
                <p>{professionalContent(source.reasoning)}</p>
                {source.operativeConsequences.length ? (
                  <ul className="list-disc space-y-1 pl-5">{source.operativeConsequences.filter(professionalContent).map((consequence) => <li key={consequence}>{professionalContent(consequence)}</li>)}</ul>
                ) : null}
                <a href={source.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-[#075985] underline underline-offset-4">
                  Testo ufficiale <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </details>
          ))}
        </div>
        <p><strong>Conclusione:</strong> {professionalContent(regime.conclusion)}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">{regime.limits.filter(professionalContent).map((limit) => <li key={limit}>{professionalContent(limit)}</li>)}</ul>
      </div>
    </ContentSection>
  );
}

function RuleDetails({ rule }: { rule: StructuredReportLegalApplication["rules"][number] }) {
  return (
    <details className="rounded-md border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer px-3 py-2">
        <span className="font-medium text-slate-950">{professionalContent(rule.citation)}</span>
        <span className="ml-2 text-xs font-semibold text-slate-600">{TEMPORAL_STATUS_LABELS[rule.temporalStatus]}</span>
      </summary>
      <div className="space-y-1 border-t border-slate-200 px-3 py-2">
        <p><strong>Oggetto:</strong> {professionalContent(rule.subject)}</p>
        <p><strong>Vigenza:</strong> {professionalContent(rule.temporalReasoning)}</p>
        <p><strong>Applicazione ai fatti:</strong> {professionalContent(rule.applicationToFacts)}</p>
        <a href={rule.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-[#075985] underline underline-offset-4">
          Testo ufficiale{rule.referenceDate ? " nella versione alla data rilevante" : ""} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}

export function LegalApplicationSection({ items }: { items: readonly StructuredReportLegalApplication[] }) {
  if (items.length === 0) return null;
  const common = commonLegalContent(items);
  const commonRules = items[0]!.rules.filter((rule) => common.ruleKeys.has(legalRuleKey(rule)));
  const hasCommon = commonRules.length > 0 || common.arguments.size > 0 || common.consequences.size > 0;
  return (
    <ContentSection title="Analisi giuridica: applicazione delle norme ai fatti">
      <div className="space-y-3">
        {hasCommon ? (
          <details className="rounded-md border border-slate-200 bg-white" aria-label="Profili comuni a tutte le questioni">
            <summary className="cursor-pointer p-3 font-medium text-slate-950">Norme e avvertenze comuni a tutte le questioni</summary>
            <div className="space-y-3 border-t border-slate-200 p-4 text-sm leading-6 text-slate-700">
              {commonRules.length ? <div className="space-y-2">{commonRules.map((rule) => <RuleDetails key={rule.ruleId} rule={rule} />)}</div> : null}
              {common.arguments.size ? (
                <ul className="list-disc space-y-1 pl-5">{[...common.arguments].filter(professionalContent).map((argument) => <li key={argument}>{professionalContent(argument)}</li>)}</ul>
              ) : null}
              {common.consequences.size ? (
                <ul className="list-disc space-y-1 pl-5">{[...common.consequences].filter(professionalContent).map((consequence) => <li key={consequence}>{professionalContent(consequence)}</li>)}</ul>
              ) : null}
            </div>
          </details>
        ) : null}
        {items.map((item) => {
          const rules = item.rules.filter((rule) => !common.ruleKeys.has(legalRuleKey(rule)));
          const contraryArguments = item.contraryArguments.filter((argument) => !common.arguments.has(argument));
          const consequences = item.consequences.filter((consequence) => !common.consequences.has(consequence));
          return (
          <article key={item.issueSemanticKey} className="rounded-md border border-slate-200 bg-white" aria-label={`Analisi: ${professionalContent(item.issueText) || "questione da verificare"}`}>
            <div className="space-y-2 p-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <h4 className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{professionalContent(item.issueText) || "Questione da verificare"}</h4>
                <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                  {item.conclusionStatus === "GROUNDED_ON_VERIFIED_AUTHORITIES" ? "Con fonti verificate e classificate"
                    : item.rules.some((rule) => ["APPLICABLE", "APPLICABLE_PREVIOUS_VERSION"].includes(rule.temporalStatus))
                      ? "Preliminare: solo dato normativo" : "Fonti da verificare"}
                </span>
              </div>
              <div className="space-y-2 text-sm leading-6 text-slate-800" aria-label="Esposizione giuridica">
                {legalIssueNarrative(item).map((paragraph) => <p key={paragraph}>{professionalContent(paragraph)}</p>)}
              </div>
            </div>
            <details>
              <summary className="cursor-pointer border-t border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">Dettaglio: date, fatti, norme, presupposti e argomenti</summary>
            <div className="space-y-4 border-t border-slate-200 p-4 text-sm leading-6 text-slate-700">
              <section>
                <h5 className="font-semibold text-slate-950">Date rilevanti</h5>
                <ul className="mt-1 space-y-1">
                  {item.relevantDates.map((date) => (
                    <li key={`${date.label}-${date.date}`}><strong>{professionalContent(date.label)}:</strong> {formatDateIT(new Date(`${date.date}T00:00:00Z`))} — {professionalContent(date.basis)}</li>
                  ))}
                </ul>
              </section>
              {item.facts.length > 0 ? (
                <section>
                  <h5 className="font-semibold text-slate-950">Fatti e prova documentale</h5>
                  <ul className="mt-1 space-y-1">
                    {item.facts.filter((fact) => professionalContent(fact.text)).map((fact) => (
                      <li key={fact.text} className="[overflow-wrap:anywhere]">
                        {professionalContent(fact.text)}
                        <span className="text-xs text-slate-500"> ({fact.humanConfirmed ? "confermato" : "da confermare"}{fact.pages.length ? `; pag. ${fact.pages.join(", ")}` : ""})</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {rules.length > 0 ? (
                <section>
                  <h5 className="font-semibold text-slate-950">Normativa applicabile nel tempo</h5>
                  <div className="mt-2 space-y-2">
                    {rules.map((rule) => <RuleDetails key={rule.ruleId} rule={rule} />)}
                  </div>
                </section>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <section>
                  <h5 className="font-semibold text-slate-950">Argomenti a sostegno</h5>
                  <ul className="mt-1 list-disc space-y-1 pl-5">{item.favorableArguments.filter(professionalContent).map((argument) => <li key={argument}>{professionalContent(argument)}</li>)}</ul>
                </section>
                <section>
                  <h5 className="font-semibold text-slate-950">Argomenti contrari e rischi</h5>
                  <ul className="mt-1 list-disc space-y-1 pl-5">{contraryArguments.filter(professionalContent).map((argument) => <li key={argument}>{professionalContent(argument)}</li>)}</ul>
                </section>
              </div>
              {item.elementAnalysis ? (
                <section aria-label="Analisi degli elementi della fattispecie">
                  <h5 className="font-semibold text-slate-950">Elementi della fattispecie: {professionalContent(item.elementAnalysis.label)}</h5>
                  <ul className="mt-2 space-y-2">
                    {item.elementAnalysis.elements.map((element) => (
                      <li key={element.elementId} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                          <span className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere]">{professionalContent(element.requirement)}</span>
                          <span className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{ELEMENT_STATUS_LABELS[element.status]}</span>
                        </div>
                        <p className="text-xs text-slate-500">{professionalContent(element.legalBasis)}</p>
                        <p className="mt-1">{professionalContent(element.reasoning)}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section>
                <h5 className="font-semibold text-slate-950">Conseguenze operative e processuali</h5>
                <ul className="mt-1 list-disc space-y-1 pl-5">{consequences.filter(professionalContent).map((consequence) => <li key={consequence}>{professionalContent(consequence)}</li>)}</ul>
              </section>
            </div>
            </details>
          </article>
          );
        })}
      </div>
    </ContentSection>
  );
}

const LEGAL_ANALYSIS_STATUS_LABELS = {
  RESEARCH_REQUIRED: "Ricerca giuridica necessaria",
  MOTIVATION_REQUIRED: "Motivazione argomentata da acquisire",
  ARGUED: "Motivazione argomentata disponibile",
  CONTESTED: "Tesi controverse",
} as const;

function LegalAnalyses({
  analyses,
}: {
  analyses: NonNullable<StructuredFascicoloReportPayload["legalAnalyses"]>;
}) {
  if (analyses.length === 0) return null;
  return (
    <ContentSection title="Analisi giuridica">
      <div className="space-y-6">
        {analyses.map((analysis) => (
          <article key={analysis.issueSemanticKey} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h4 className="font-semibold text-slate-950">{analysis.issueText}</h4>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                {LEGAL_ANALYSIS_STATUS_LABELS[analysis.status]}
              </span>
            </div>

            {analysis.documentedFacts.length > 0 ? (
              <section className="mt-4" aria-label="Fatti documentati rilevanti">
                <h5 className="text-sm font-semibold text-slate-900">Fatti documentati rilevanti</h5>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                  {analysis.documentedFacts.map((fact, index) => (
                    <li key={`${fact.statement}-${index}`}>
                      <p>{fact.statement}</p>
                      {fact.documentReferences.length > 0 ? (
                        <p className="text-xs text-slate-500">
                          Riscontro: {fact.documentReferences.map(humanizeProfessionalText).join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {analysis.verifiedSources.length > 0 ? (
              <section className="mt-4" aria-label="Fonti verificate applicate alla questione">
                <h5 className="text-sm font-semibold text-slate-900">Fonti verificate</h5>
                <div className="mt-2 space-y-3">
                  {analysis.verifiedSources.map((source) => (
                    <div key={source.resultId} className="border-l-2 border-[#0b7285] pl-3">
                      <p className="text-sm font-semibold text-slate-950">{source.title}</p>
                      <p className="mt-1 text-xs font-medium text-slate-600">
                        {source.direction === "SUPPORTS" ? "Tesi favorevole" : "Tesi contraria"}
                        {source.provider ? ` · reperita tramite ${source.provider}` : ""}
                      </p>
                      {source.relevantPassage ? (
                        <blockquote className="mt-2 text-sm leading-6 text-slate-700">
                          {source.relevantPassage}
                        </blockquote>
                      ) : null}
                      {source.rationale ? <p className="mt-1 text-sm text-slate-600">{source.rationale}</p> : null}
                      {source.sourceUrl ? (
                        <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#075985] underline underline-offset-4">
                          Apri la fonte <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {analysis.applications.length > 0 ? (
              <section className="mt-4" aria-label="Applicazione delle fonti ai fatti">
                <h5 className="text-sm font-semibold text-slate-900">Applicazione ai fatti</h5>
                <div className="mt-2 space-y-4">
                  {analysis.applications.map((application) => (
                    <div key={application.applicationId} className="rounded-md bg-slate-50 p-3">
                      <ul className="space-y-2 text-sm leading-6 text-slate-700">
                        {application.checks.map((check) => (
                          <li key={check.criterion}>
                            <span className="font-semibold text-slate-900">{check.criterion}:</span>{" "}
                            {check.rationale}
                            {check.decisiveFacts.length > 0 ? (
                              <span className="block text-xs text-slate-500">
                                Fatti decisivi: {check.decisiveFacts.join("; ")}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-sm font-medium leading-6 text-slate-900">{application.conclusion}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {analysis.professionalReasoning ? (
              <section className="mt-4" aria-label="Motivazione giuridica specifica">
                <h5 className="text-sm font-semibold text-slate-900">Motivazione giuridica specifica</h5>
                <div className="mt-2 space-y-4">
                  {analysis.professionalReasoning.ruleApplications.map((application) => (
                    <article key={application.title} className="rounded-md border border-slate-200 p-3">
                      <h6 className="text-sm font-semibold text-slate-950">{application.title}</h6>
                      <p className="mt-2 text-sm leading-6 text-slate-700"><strong>Regola:</strong> {application.rule}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700"><strong>Fatti rilevanti:</strong> {application.relevantFacts}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700"><strong>Applicazione:</strong> {application.application}</p>
                      <p className="mt-2 text-sm font-medium leading-6 text-slate-900"><strong>Esito:</strong> {application.outcome}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Fonti: {application.sourceCandidateIds.join(", ")} · Documenti: {application.factBasisRefs.join(", ")}
                      </p>
                    </article>
                  ))}
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h6 className="text-sm font-semibold text-slate-900">Argomenti favorevoli</h6>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                      {analysis.professionalReasoning.supportingArguments.map((argument) => (
                        <li key={argument.text}>{argument.text}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h6 className="text-sm font-semibold text-slate-900">Argomenti contrari</h6>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                      {analysis.professionalReasoning.contraryArguments.map((argument) => (
                        <li key={argument.text}>{argument.text}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-4">
                  <h6 className="text-sm font-semibold text-slate-900">Valutazione delle prove</h6>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                    {analysis.professionalReasoning.evidenceAssessment.strengths.map((item) => (
                      <li key={`strength-${item.text}`}><strong>Punto di forza:</strong> {item.text}</li>
                    ))}
                    {analysis.professionalReasoning.evidenceAssessment.weaknesses.map((item) => (
                      <li key={`weakness-${item.text}`}><strong>Punto di debolezza:</strong> {item.text}</li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}

            <section className="mt-4" aria-label="Valutazione conclusiva">
              <h5 className="text-sm font-semibold text-slate-900">Valutazione conclusiva</h5>
              <p className="mt-1 text-sm leading-6 text-slate-700">{analysis.assessment}</p>
              {analysis.professionalReasoning ? (
                <p className="mt-2 text-xs font-medium text-slate-600">
                  Confidenza dichiarata: {analysis.professionalReasoning.reasonedConclusion.confidence}
                </p>
              ) : null}
            </section>

            {analysis.recommendedActions.length > 0 ? (
              <section className="mt-4" aria-label="Iniziative mirate">
                <h5 className="text-sm font-semibold text-slate-900">Iniziative mirate</h5>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                  {analysis.recommendedActions.map((action) => <li key={action}>{action}</li>)}
                </ul>
              </section>
            ) : null}
          </article>
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
              <h4 className="font-semibold text-slate-950">Misura {professionalContent(row.measure)}</h4>
              <p><strong>Efficacia:</strong> {professionalContent(row.effectiveFrom)}</p>
              <p><strong>Fattispecie:</strong> {professionalContent(row.trigger)}</p>
              <p><strong>Applicabilità:</strong> {professionalContent(row.applicability)}</p>
              <p><strong>Adempimento AdSP:</strong> {professionalContent(row.authorityAction)}</p>
              <p><strong>Scadenza:</strong> {professionalContent(row.deadline)}</p>
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

function ReportContent({
  payload, procedimentoId, documents,
}: {
  payload: StructuredFascicoloReportPayload;
  procedimentoId: string;
  documents: ReadonlyArray<{ id: string; nome: string }>;
}) {
  const framework = payload.documentedFramework;
  const frameworkGroups = [
    { title: "Ruoli e soggetti", items: framework.partyRoles },
    { title: "Posizioni e difese delle parti", items: framework.partyPositions ?? [] },
    { title: "Atti rilevanti", items: framework.legalActs },
    { title: "Misure", items: framework.measures },
  ].filter((group) => group.items.length > 0);
  const questions = allQuestions(payload);
  const research = projectProfessionalResearch(payload);
  const authorities = research.authoritiesAttested ? usableAuthorities(payload) : [];
  const favorable = authorities.filter((authority) => authority.direction === "Favorevole");
  const contrary = authorities.filter((authority) => authority.direction === "Contraria");
  const limitations = uniqueNotes([
    ...(research.legacyWarning ? [research.legacyWarning] : []),
    ...payload.limitations,
    ...questions.flatMap((question) => [...question.gaps, ...question.limitations]),
  ]);
  const documentNames = documentNamesByReference([
    ...payload.gaps,
    ...payload.deadlineCandidates,
    ...Object.values(framework).flat(),
  ], documents);
  const professionalGaps = professionalGapSummaries(payload.gaps, documentNames, payload.documentCoverage ?? []);
  const coverageSummaries = documentCoverageSummaries(payload.documentCoverage ?? []);

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
                <h4 className="font-medium text-slate-950 [overflow-wrap:anywhere]">{professionalContent(issue.text) || "Questione da verificare"}</h4>
                {issue.questions.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
                    {issue.questions.map((question) => (
                      <li key={question.knowledgeItemId}>
                        <p>{professionalContent(question.text)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {payload.unassignedQuestions.map((question) => (
              <article key={question.knowledgeItemId} className="border-l-2 border-slate-300 pl-4 text-sm leading-6 text-slate-700">
                <p>{professionalContent(question.text)}</p>
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
      {research.applications.length ? <LegalApplicationSection items={research.applications} /> : null}

      {payload.regulatoryApplicability?.length ? <RegulatoryApplicability rows={payload.regulatoryApplicability} /> : null}

      {payload.technicalSources?.length ? <TechnicalSourcesSection sources={payload.technicalSources} /> : null}

      {payload.legalAnalyses?.length ? <LegalAnalyses analyses={payload.legalAnalyses} /> : null}

      {payload.operationalPlans?.length ? (
        <ContentSection title="Seguito operativo">
          <p className="text-sm text-slate-700">
            Le attività, i relativi atti e gli esiti sono consultabili nella{" "}
            <Link href={`/procedimenti/${procedimentoId}?section=proposals`} className="font-medium text-sky-700 underline">sezione Proposte</Link>.
          </p>
        </ContentSection>
      ) : null}

      {framework.contradictions.length > 0 ? <ContentSection title="Criticità"><TextList items={framework.contradictions} /></ContentSection> : null}

      {payload.legalCompleteness ? <LegalCompletenessSection assessment={payload.legalCompleteness} /> : null}

      {professionalGaps.length > 0 || limitations.length > 0 ? (
        <ContentSection title="Limiti e punti da approfondire">
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {professionalGaps.map((gap) => <li key={gap}>{gap}</li>)}
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </ContentSection>
      ) : null}

      {coverageSummaries.length > 0 ? (
        <details className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Copertura documentale</summary>
          <p className="mt-2 text-xs text-slate-600">Pagine effettivamente lette per ciascun documento. Le pagine prive di testo e quelle assenti dal file originale sono indicate separatamente.</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700">
            {coverageSummaries.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PreviousVersions({ snapshots, documents }: { snapshots: readonly FascicoloReportSnapshot[]; documents: ReadonlyArray<{ id: string; nome: string }> }) {
  if (snapshots.length === 0) return null;
  return (
    <details className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Versioni precedenti</summary>
      <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
        {snapshots.map((snapshot) => {
          const reasons = uniqueNotes(snapshot.staleReasons);
          return (
            <details key={snapshot.id} className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-medium text-slate-950">{formatDateIT(snapshot.generatedAt)}</span>
                <span className="ml-3 text-slate-600">{fascicoloReportStatusLabel(snapshot.status)}</span>
              </summary>
              {reasons.length > 0 ? <p className="mt-2 text-sm text-slate-600">{reasons.join(" ")}</p> : null}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <a href={`/api/procedimenti/${snapshot.payload.procedimentoId}/reports/${snapshot.id}/export?format=pdf`} className="font-semibold text-[#075985] underline underline-offset-4">Esporta PDF</a>
                <a href={`/api/procedimenti/${snapshot.payload.procedimentoId}/reports/${snapshot.id}/export?format=rtf`} className="font-semibold text-[#075985] underline underline-offset-4">Esporta RTF modificabile</a>
              </div>
              <div className="mt-4 border-t border-slate-200 pt-4" aria-label={`Rapporto storico del ${formatDateIT(snapshot.generatedAt)}`}>
                <ReportContent payload={snapshot.payload} procedimentoId={snapshot.payload.procedimentoId} documents={documents} />
              </div>
            </details>
          );
        })}
      </div>
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
            <p className="text-sm font-medium text-slate-900">{professionalContent(question.text)}</p>
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
  documents = [],
}: {
  procedimentoId: string;
  showDiagnostics?: boolean;
  snapshots: readonly FascicoloReportSnapshot[];
  documents?: ReadonlyArray<{ id: string; nome: string }>;
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
            <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200 pt-3 text-sm">
              <a href={`/api/procedimenti/${report.payload.procedimentoId}/reports/${report.id}/export?format=pdf`} className="font-semibold text-[#075985] underline underline-offset-4">Esporta PDF strutturato</a>
              <a href={`/api/procedimenti/${report.payload.procedimentoId}/reports/${report.id}/export?format=rtf`} className="font-semibold text-[#075985] underline underline-offset-4">Esporta RTF modificabile</a>
            </div>
          </section>
          <ReportContent payload={report.payload} procedimentoId={procedimentoId} documents={documents} />
          {showDiagnostics ? <ReportDiagnostics payload={report.payload} /> : null}
        </>
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">Non è ancora disponibile un rapporto strutturato per questo fascicolo.</p>
          <p className="mt-1 text-sm text-slate-600">I dati del fascicolo restano consultabili nelle sezioni Analisi, Ricerca, Scadenze e Criticità.</p>
        </div>
      )}

      <PreviousVersions snapshots={previous} documents={documents} />
    </section>
  );
}
