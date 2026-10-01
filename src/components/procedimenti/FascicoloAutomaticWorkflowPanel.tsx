import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  generateOperationalProposalsAction,
  materializeOperationalProposalAction,
  reviewOperationalProposalAction,
} from "@/server/actions/fascicolo-operational-proposals";
import { archiveStructuredFascicoloReportAction } from "@/server/actions/structured-fascicolo-report";
import type { FascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

function failureLabel(code: string | null): string {
  switch (code) {
    case "AI_CONFIGURATION_ERROR": return "Servizio di analisi non configurato";
    case "AUTOMATIC_REPORT_REPOSITORY_NOT_CONFIGURED": return "Archivio del rapporto non configurato";
    case "DOCUMENT_UNREADABLE": return "Documento privo di testo leggibile";
    case "DOCUMENT_GROUNDING_INVALID": return "Analisi non collegata alle pagine del documento";
    case "INVALID_PROVIDER_OUTPUT": return "Risposta di analisi incompleta o incerta";
    case "AI_PROVIDER_UNAVAILABLE": return "Servizio di analisi temporaneamente non disponibile";
    case "FASCICOLO_ANALYSIS_AUTHORITY_MISMATCH": return "Accesso o versione del fascicolo non validi";
    default: return code ?? "Elaborazione non completata";
  }
}

function jobLabel(status: FascicoloAutomaticWorkflowReadModel["jobs"][number]["status"]): string {
  switch (status) {
    case "QUEUED": return "Analisi in coda";
    case "RUNNING": return "Analisi documenti in corso";
    case "SUCCEEDED": return "Questioni individuate";
    case "RETRY_WAIT": return "Nuovo tentativo programmato";
    case "TERMINAL_FAILED": return "Analisi non completata";
    case "CANCELLATION_REQUESTED": return "Annullamento richiesto";
    case "CANCELLED": return "Analisi annullata";
  }
}

function researchRequirementLabel(code: string): string {
  if (code === "AUTOMATIC_RESEARCH_POLICY_DISABLED") return "Abilitare la policy di ricerca automatica";
  if (code === "AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED") return "Autorizzare questo ente nella policy di ricerca automatica";
  if (code === "AUTOMATIC_RESEARCH_CAPABILITY_NOT_ALLOWED") return "Autorizzare le capacità richieste dalla missione";
  if (code === "AUTOMATIC_RESEARCH_BUDGET_NOT_ALLOWED") return "Aumentare il budget massimo autorizzato dalla policy";
  if (code === "AUTOMATIC_RESEARCH_POLICY_INVALID") return "Completare la configurazione della policy di ricerca automatica";
  if (code.startsWith("AUTOMATIC_RESEARCH_PROVIDER_CAPABILITY_UNAVAILABLE")) {
    return "Configurare credenziali e capacità del provider di ricerca richiesto";
  }
  if (code.includes("OUTCOME_UNCERTAIN")) return "Riconciliare manualmente l’esito incerto prima di riprendere la ricerca";
  return code;
}

function knowledgeStatus(status: "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED") {
  if (status === "HUMAN_CONFIRMED") return <Badge variant="success">Confermata</Badge>;
  if (status === "REJECTED") return <Badge variant="danger">Respinta</Badge>;
  return <Badge variant="warning">Proposta AI · Da verificare</Badge>;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function payloadText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function directionBadge(direction: FascicoloAutomaticWorkflowReadModel["missions"][number]["results"][number]["supportDirection"]) {
  if (direction === "SUPPORTS") return <Badge variant="success">Favorevole</Badge>;
  if (direction === "OPPOSES") return <Badge variant="danger">Contrario</Badge>;
  if (direction === "NEUTRAL") return <Badge variant="default">Neutro</Badge>;
  if (direction === "INCONCLUSIVE") return <Badge variant="warning">Inconcludente</Badge>;
  return <Badge variant="warning">Non valutato</Badge>;
}

function sourceStateLabel(state: FascicoloAutomaticWorkflowReadModel["missions"][number]["results"][number]["sourceVerificationState"]): string {
  if (state === "ACQUIRED") return "Testo acquisito";
  if (state === "IDENTITY_VERIFIED") return "Identità verificata";
  if (state === "CONTENT_VERIFIED") return "Contenuto verificato";
  if (state === "TEMPORAL_ASSESSED") return "Valutazione temporale disponibile";
  if (state === "USABLE") return "Utilizzabilità già verificata";
  return "Fonte solo individuata";
}

function pipelineStateLabel(result: FascicoloAutomaticWorkflowReadModel["missions"][number]["results"][number]): string {
  if (result.usable) return "Fonte utilizzabile";
  if (result.manualReviewRequired) return "Review richiesta";
  if (result.retrievalState === "BLOCKED" || result.identityVerification === "MISMATCH" || result.contentVerification === "MISMATCH") return "Fonte bloccata";
  if (result.temporalStatus === "APPLICABLE") return "Temporalmente applicabile";
  if (result.contentVerification === "VERIFIED") return "Contenuto verificato";
  if (result.identityVerification === "VERIFIED") return "Identità verificata";
  if (result.acquisitionState === "FULL_TEXT") return "Testo acquisito";
  return sourceStateLabel(result.sourceVerificationState);
}

function proposalStatusBadge(status: FascicoloAutomaticWorkflowReadModel["operationalProposals"][number]["status"]) {
  if (status === "MATERIALIZED") return <Badge variant="success">Materializzata</Badge>;
  if (status === "APPROVED" || status === "AMENDED_AND_APPROVED") return <Badge variant="success">Approvata</Badge>;
  if (status === "REJECTED") return <Badge variant="danger">Rifiutata</Badge>;
  if (status === "STALE" || status === "SUPERSEDED") return <Badge variant="warning">Superata</Badge>;
  return <Badge variant="warning">Da revisionare</Badge>;
}

function WorkflowSummary({
  model,
  currentJob,
}: {
  model: FascicoloAutomaticWorkflowReadModel;
  currentJob: FascicoloAutomaticWorkflowReadModel["jobs"][number] | null;
}) {
  const legalIssueCount = model.knowledge?.legalIssues.length ?? 0;
  const usableSourceCount = model.missions.reduce(
    (total, mission) => total + mission.results.filter((result) => result.usable).length,
    0,
  );
  const reviewCount = model.missions.reduce(
    (total, mission) => total + mission.results.filter((result) => result.manualReviewRequired).length,
    0,
  );

  return (
    <div className="grid overflow-hidden rounded-md border border-slate-200 bg-slate-50 sm:grid-cols-2 xl:grid-cols-4">
      <div className="border-b border-slate-200 px-3 py-2.5 sm:border-r xl:border-b-0">
        <p className="text-xs font-medium text-slate-500">Stato analisi</p>
        <p className="mt-1 text-sm font-semibold text-slate-900">{currentJob ? jobLabel(currentJob.status) : "Non avviata"}</p>
      </div>
      <div className="border-b border-slate-200 px-3 py-2.5 xl:border-b-0 xl:border-r">
        <p className="text-xs font-medium text-slate-500">Questioni giuridiche</p>
        <p className="mt-1 text-lg font-semibold text-slate-950">{legalIssueCount}</p>
      </div>
      <div className="border-b border-slate-200 px-3 py-2.5 sm:border-b-0 sm:border-r">
        <p className="text-xs font-medium text-slate-500">Fonti utilizzabili</p>
        <p className="mt-1 text-lg font-semibold text-slate-950">{usableSourceCount}</p>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-medium text-slate-500">Verifiche professionali</p>
        <p className="mt-1 text-lg font-semibold text-slate-950">{reviewCount}</p>
      </div>
    </div>
  );
}

export function FascicoloAutomaticWorkflowPanel({
  model,
}: { model: FascicoloAutomaticWorkflowReadModel | null }) {
  if (!model || (!model.knowledge && model.reports.length === 0 && model.jobs.length === 0 && model.missions.length === 0 && model.operationalProposals.length === 0)) return null;
  const currentJob = model.jobs.find((job) => !job.superseded) ?? null;
  const currentReport = model.reports.find((report) => report.status !== "SUPERSEDED") ?? null;
  const structuredReport = model.structuredReport;
  const currentStructuredSnapshot = model.structuredReportSnapshots.find((snapshot) => snapshot.effectiveStatus !== "SUPERSEDED") ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analisi automatica e ricerca</CardTitle>
        <CardDescription>
          Questioni ricavate dai documenti, ricerca delle fonti e punti che richiedono verifica professionale.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <WorkflowSummary model={model} currentJob={currentJob} />
        {!model.automaticResearch.authorized && model.automaticResearch.requirementCode ? (
          <div className="border-l-2 border-amber-500 pl-3 text-sm text-amber-900">
            Ricerca automatica non avviata: {researchRequirementLabel(model.automaticResearch.requirementCode)}.
          </div>
        ) : null}
        {currentJob ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge code={currentJob.status} label={jobLabel(currentJob.status)} />
            <span className="text-xs text-slate-500">Avviata il {formatDateIT(currentJob.createdAt)}</span>
            {currentJob.failureCode ? (
              <div className="w-full text-sm text-red-700">
                <p>{failureLabel(currentJob.failureCode)}</p>
                <details className="mt-1 text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium">Dettaglio tecnico</summary>
                  <code className="mt-1 block">{currentJob.failureCode}</code>
                </details>
              </div>
            ) : null}
          </div>
        ) : null}

        {model.knowledge ? (
          <section className="space-y-4 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Conoscenza strutturata del fascicolo</h3>
              <span className="text-xs text-slate-500">Revisione corrente</span>
            </div>
            {model.knowledge.legalIssues.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Questioni giuridiche individuate</h4>
                <div className="mt-2 space-y-4">
                  {model.knowledge.legalIssues.map((issue) => {
                    const issuePayload = payloadRecord(issue.payload);
                    const originItems = [
                      ...model.knowledge!.facts,
                      ...model.knowledge!.events,
                      ...model.knowledge!.legalActs,
                      ...model.knowledge!.measures,
                      ...model.knowledge!.contradictions,
                      ...model.knowledge!.gaps,
                    ].filter((item) => issue.originatingItemIds.includes(item.id));
                    const questions = model.knowledge!.researchQuestions.filter((question) => question.legalIssueId === issue.id);
                    return (
                      <section key={issue.id} className="border-l-2 border-slate-300 pl-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{payloadText(issuePayload.title) ?? issue.normalizedText}</p>
                          <Badge variant="default">{payloadText(issuePayload.priority) ?? "MEDIUM"}</Badge>
                          {knowledgeStatus(issue.status)}
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{payloadText(issuePayload.rationale) ?? issue.normalizedText}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Fondamento: {originItems.map((item) => item.normalizedText).join("; ") || "Da verificare"}
                        </p>
                        {questions.map((question) => {
                          const questionPayload = payloadRecord(question.payload);
                          const basis = payloadRecord(questionPayload.referenceDateBasis);
                          const mission = model.missions.find((candidate) => candidate.researchQuestionSemanticKey === question.semanticKey);
                          return (
                            <div key={question.id} className="mt-3 border-t border-slate-200 pt-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm text-slate-800">{question.normalizedText}</p>
                                {knowledgeStatus(question.status)}
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                Data di riferimento: {payloadText(questionPayload.referenceDate) ?? "Da verificare"}.
                                Motivo: {payloadText(basis.rationale) ?? "Basis non determinata"}.
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Ricerca: {mission ? jobLabel(mission.status === "PENDING" ? "QUEUED" : mission.status === "COMPLETED" ? "SUCCEEDED" : mission.status === "REJECTED" ? "TERMINAL_FAILED" : "RUNNING") : "Non avviata"}
                              </p>
                              {mission?.missionFingerprint ? (
                                <details className="mt-1 text-xs text-slate-500">
                                  <summary className="cursor-pointer font-medium">Identificativi tecnici</summary>
                                  <code className="mt-1 block break-all">{mission.missionFingerprint}</code>
                                </details>
                              ) : null}
                              {mission ? (
                                <div className="mt-2 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                    <span>Stato ricerca: {mission.researchState}</span>
                                    <span>Copertura: {mission.coverageStatus}</span>
                                    <span>Discovery: {mission.discoveryCoverageStatus}</span>
                                    <span>Fonti utilizzabili: {mission.usableCoverageStatus}</span>
                                    {mission.conflicting ? <Badge variant="danger">Orientamenti in conflitto</Badge> : null}
                                    {mission.conflictingUsableAuthorities ? <Badge variant="danger">Autorità utilizzabili in conflitto</Badge> : null}
                                    {mission.historicalResultCount > 0 ? <span>Risultati storici: {mission.historicalResultCount}</span> : null}
                                  </div>
                                  {mission.adverseMission ? (
                                    <p className="text-xs text-slate-600">Ricerca contraria: {mission.adverseMission.status}</p>
                                  ) : null}
                                  {mission.results.length > 0 ? (
                                    <ul className="space-y-2">
                                      {mission.results.map((result) => (
                                        <li key={result.resultId} className="border-l-2 border-slate-200 pl-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm text-slate-800">{result.title}</span>
                                            {directionBadge(result.supportDirection)}
                                            <Badge variant={result.usable ? "success" : result.manualReviewRequired ? "warning" : "default"}>{pipelineStateLabel(result)}</Badge>
                                            <Badge variant="default">{result.officiality}</Badge>
                                          </div>
                                          {result.classificationRationale ? <p className="mt-1 text-xs text-slate-600">{result.classificationRationale}</p> : null}
                                          {result.blockingReasons.length > 0 ? (
                                            <p className="mt-1 text-xs text-amber-800">Motivi di blocco: {result.blockingReasons.join(", ")}</p>
                                          ) : null}
                                          {result.citationAnchors.length > 0 ? (
                                            <p className="mt-1 text-xs text-slate-500">Riferimenti puntuali disponibili: {result.citationAnchors.length}</p>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <p className="text-xs text-slate-500">Nessun risultato collegato.</p>}
                                  {mission.coverageGaps.length > 0 ? (
                                    <p className="text-xs text-amber-800">Aspetti scoperti: {mission.coverageGaps.map((gap) => gap.key).join(", ")}</p>
                                  ) : null}
                                  {mission.sourceGaps.length > 0 ? (
                                    <p className="text-xs text-amber-800">Gap fonti: {mission.sourceGaps.join(", ")}</p>
                                  ) : null}
                                  <p className="text-xs text-slate-500">La direzione del risultato non certifica la fonte e non costituisce una conclusione giuridica.</p>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {model.knowledge.subjects.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Soggetti</h4>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {model.knowledge.subjects.map((subject) => (
                    <li key={subject.id}>{subject.canonicalName} <span className="text-xs text-slate-500">{subject.subjectType}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {model.knowledge.timeline.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Cronologia derivata</h4>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {model.knowledge.timeline.map((event) => (
                    <li key={event.id}>{event.normalizedText} <span className="ml-2">{knowledgeStatus(event.status)}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {model.knowledge.facts.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Fatti principali</h4>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {model.knowledge.facts.map((fact) => (
                    <li key={fact.id}>{fact.normalizedText} <span className="ml-2">{knowledgeStatus(fact.status)}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Contraddizioni aperte</h4>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {model.knowledge.contradictions.map((item) => <li key={item.id}>{item.normalizedText} ({item.contradictedItemIds.length} elementi)</li>)}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Lacune</h4>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {model.knowledge.gaps.map((item) => <li key={item.id}>{item.normalizedText}</li>)}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Scadenze candidate</h4>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {model.knowledge.deadlineCandidates.map((item) => <li key={item.id}>{item.normalizedText} {knowledgeStatus(item.status)}</li>)}
                </ul>
              </div>
            </div>
            {model.knowledge.revision.warnings.length > 0 ? (
              <p className="text-xs text-amber-800">Alcuni elementi sono stati esclusi perché privi di provenienza verificabile.</p>
            ) : null}
          </section>
        ) : null}

        {structuredReport ? (
          <section className="space-y-4 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Rapporto strutturato del fascicolo</h3>
                <p className="mt-1 text-xs text-slate-500">Sintesi aggiornata delle informazioni e delle fonti utilizzabili.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={currentStructuredSnapshot?.effectiveStatus === "STALE" ? "warning" : "success"}>
                  {currentStructuredSnapshot?.effectiveStatus === "STALE" ? "Da aggiornare" : "Aggiornato"}
                </Badge>
                <form action={generateOperationalProposalsAction}>
                  <input type="hidden" name="procedimentoId" value={structuredReport.payload.procedimentoId} />
                  <Button type="submit" size="sm">Genera proposte operative</Button>
                </form>
                <details>
                  <summary className="cursor-pointer rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Altro</summary>
                  <form action={archiveStructuredFascicoloReportAction} className="mt-2">
                    <input type="hidden" name="procedimentoId" value={structuredReport.payload.procedimentoId} />
                    <Button type="submit" size="sm" variant="outline">Archivia rapporto</Button>
                  </form>
                </details>
              </div>
            </div>
            {currentStructuredSnapshot?.staleReasons.length ? (
              <p className="text-sm text-amber-800">Motivi di obsolescenza: {currentStructuredSnapshot.staleReasons.join(", ")}.</p>
            ) : null}
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-600">Quadro documentato corrente</h4>
              {structuredReport.payload.documentedFramework.facts.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {structuredReport.payload.documentedFramework.facts.map((fact) => (
                    <li key={fact.id}>{fact.normalizedText} <span className="text-xs text-slate-500">({fact.evidence.map((evidence) => evidence.basisRef).filter(Boolean).join(", ")})</span></li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-slate-600">Nessun fatto corrente non respinto.</p>}
            </div>
            {structuredReport.payload.legalIssues.map((issue) => (
              <section key={issue.knowledgeItemId} className="space-y-3 border-l-2 border-slate-300 pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">{issue.text}</h4>
                  {knowledgeStatus(issue.reviewStatus)}
                </div>
                {issue.questions.map((question) => (
                  <div key={question.knowledgeItemId} className="space-y-3 border-t border-slate-200 pt-3">
                    <p className="text-sm font-medium text-slate-800">{question.text}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <h5 className="text-xs font-semibold uppercase text-emerald-700">Autorità favorevoli utilizzabili</h5>
                        {question.favorableAuthorities.length ? (
                          <ul className="mt-2 space-y-2 text-sm text-slate-700">
                            {question.favorableAuthorities.map((authority) => (
                              <li key={authority.resultId}>
                                {authority.sourceUrl ? <a className="underline" href={authority.sourceUrl}>{authority.title}</a> : authority.title}
                                <span className="block text-xs text-slate-500">Citazioni: {authority.citationAnchors.map((anchor) => JSON.stringify(anchor)).join("; ")}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-1 text-sm text-slate-600">Nessuna.</p>}
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold uppercase text-red-700">Autorità contrarie utilizzabili</h5>
                        {question.contraryAuthorities.length ? (
                          <ul className="mt-2 space-y-2 text-sm text-slate-700">
                            {question.contraryAuthorities.map((authority) => (
                              <li key={authority.resultId}>
                                {authority.sourceUrl ? <a className="underline" href={authority.sourceUrl}>{authority.title}</a> : authority.title}
                                <span className="block text-xs text-slate-500">Citazioni: {authority.citationAnchors.map((anchor) => JSON.stringify(anchor)).join("; ")}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-1 text-sm text-slate-600">Nessuna.</p>}
                      </div>
                    </div>
                    {question.nonUsableResults.length > 0 ? (
                      <div>
                        <h5 className="text-xs font-semibold uppercase text-slate-600">Risultati non utilizzabili</h5>
                        <ul className="mt-1 space-y-1 text-sm text-slate-700">
                          {question.nonUsableResults.map((result) => <li key={result.resultId}>{result.title}: {result.reasons.join(", ")}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {question.gaps.length > 0 ? <p className="text-sm text-amber-800">Gap: {question.gaps.join(", ")}.</p> : null}
                    {question.limitations.length > 0 ? <p className="text-sm text-amber-800">Limiti: {question.limitations.join(", ")}.</p> : null}
                  </div>
                ))}
              </section>
            ))}
            {structuredReport.payload.limitations.length > 0 ? (
              <p className="text-sm text-amber-800">Limiti generali: {structuredReport.payload.limitations.join(", ")}.</p>
            ) : null}
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">Dettagli tecnici del rapporto</summary>
              <div className="mt-1 space-y-1 break-all font-mono">
                <p>Revisione Knowledge: {structuredReport.payload.knowledgeRevisionId}</p>
                <p>Rapporto: {structuredReport.reportFingerprint}</p>
                <p>Ricerca: {structuredReport.payload.researchStateFingerprint}</p>
                <p>Fonti: {structuredReport.payload.sourceStateFingerprint}</p>
              </div>
            </details>
          </section>
        ) : null}

        {model.operationalProposals.length > 0 ? (
          <section className="space-y-4 border-t border-slate-200 pt-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Proposte operative</h3>
              <p className="mt-1 text-sm text-amber-800">Le proposte richiedono approvazione prima di produrre effetti.</p>
            </div>
            <div className="space-y-4">
              {model.operationalProposals.map((proposal) => {
                const canReview = proposal.status === "PROPOSED";
                const canMaterialize = (proposal.status === "APPROVED" || proposal.status === "AMENDED_AND_APPROVED")
                  && !proposal.warningCodes.includes("MANUAL_ACTION_REQUIRED");
                return (
                  <article key={proposal.id} className="border-l-2 border-slate-300 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">{proposal.title}</h4>
                      <Badge variant="default">{formatEnumLabel(proposal.proposalType)}</Badge>
                      {proposalStatusBadge(proposal.status)}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{proposal.description}</p>
                    <p className="mt-1 text-xs text-slate-500">Razionale: {proposal.rationale}</p>
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="cursor-pointer font-medium">Dettagli tecnici</summary>
                      <div className="mt-1 space-y-1">
                        <p>Origini: {proposal.originatingKnowledgeItemIds.length} elementi, {proposal.originatingIssueSemanticKeys.length} questioni, {proposal.originatingQuestionSemanticKeys.length} quesiti, {proposal.relevantResultIds.length} risultati.</p>
                        {proposal.warningCodes.length > 0 ? <p>Codici: {proposal.warningCodes.join(", ")}.</p> : null}
                      </div>
                    </details>
                    {canReview ? (
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        <form action={reviewOperationalProposalAction}>
                          <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
                          <input type="hidden" name="proposalId" value={proposal.id} />
                          <input type="hidden" name="reviewVersion" value={proposal.reviewVersion} />
                          <input type="hidden" name="action" value="APPROVE" />
                          <Button type="submit" size="sm">Approva</Button>
                        </form>
                        <form action={reviewOperationalProposalAction}>
                          <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
                          <input type="hidden" name="proposalId" value={proposal.id} />
                          <input type="hidden" name="reviewVersion" value={proposal.reviewVersion} />
                          <input type="hidden" name="action" value="REJECT" />
                          <Button type="submit" size="sm" variant="outline">Rifiuta</Button>
                        </form>
                        <details className="w-full max-w-3xl">
                          <summary className="cursor-pointer text-sm font-medium text-slate-700">Modifica e approva</summary>
                          <form action={reviewOperationalProposalAction} className="mt-2 space-y-2">
                            <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
                            <input type="hidden" name="proposalId" value={proposal.id} />
                            <input type="hidden" name="reviewVersion" value={proposal.reviewVersion} />
                            <input type="hidden" name="action" value="AMEND_AND_APPROVE" />
                            <textarea className="min-h-40 w-full border border-slate-300 p-2 font-mono text-xs" name="approvedPayload" defaultValue={JSON.stringify(proposal.proposedPayload, null, 2)} required />
                            <input className="w-full border border-slate-300 px-2 py-1 text-sm" name="reviewNote" placeholder="Nota di revisione" />
                            <Button type="submit" size="sm">Salva modifica e approva</Button>
                          </form>
                        </details>
                      </div>
                    ) : null}
                    {canMaterialize ? (
                      <form action={materializeOperationalProposalAction} className="mt-3">
                        <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
                        <input type="hidden" name="proposalId" value={proposal.id} />
                        <Button type="submit" size="sm" variant="outline">Materializza</Button>
                      </form>
                    ) : null}
                    {(proposal.status === "APPROVED" || proposal.status === "AMENDED_AND_APPROVED") && proposal.warningCodes.includes("MANUAL_ACTION_REQUIRED") ? (
                      <p className="mt-2 text-sm text-amber-800">Approvata; materializzazione automatica non disponibile. Azione manuale richiesta.</p>
                    ) : null}
                    {proposal.materializedEntityType && proposal.materializedEntityId ? (
                      <p className="mt-2 text-sm text-emerald-800">Entità creata: {formatEnumLabel(proposal.materializedEntityType)}.</p>
                    ) : null}
                    {proposal.reviewEvents.length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Storico review ({proposal.reviewEvents.length})</summary>
                        <ul className="mt-1 space-y-1 text-xs text-slate-600">
                          {proposal.reviewEvents.map((event, index) => (
                            <li key={`${proposal.id}-review-${index}`}>{String(event.action)} · versione {String(event.reviewVersion)} · {String(event.actorRole)}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {currentReport ? (
          <details className="border-t border-slate-200 pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Analisi documentale precedente</summary>
          <section className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Rapporto documentale automatico legacy</h3>
                <p className="mt-1 text-xs text-slate-500">Vista storica derivata dall’analisi provider; non alimenta il rapporto strutturato.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={currentReport.preliminaryDiscoveryStatus === "COMPLETED" ? "success" : "default"}>
                  Discovery preliminare: {currentReport.preliminaryDiscoveryStatus}
                </Badge>
                <Badge variant="warning">Verifica professionale pendente</Badge>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-600">Sintesi documentata</h4>
              <p className="mt-1 text-sm text-slate-800">{currentReport.summary.text}</p>
              <p className="mt-1 text-xs text-slate-500">Provenienza: {currentReport.summary.basisRefs.join(", ")}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-600">Fatti e date documentati</h4>
              {currentReport.documentedFacts.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {currentReport.documentedFacts.map((fact, index) => (
                    <li key={`${currentReport.reportId}-fact-${index}`}>
                      {fact.recordedAt ? `${fact.recordedAt} · ` : ""}{fact.text}
                      <span className="block text-xs text-slate-500">Provenienza: {fact.basisRefs.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-slate-600">Nessun fatto strutturato rilevato.</p>}
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-600">Segnali e inferenze da verificare</h4>
              {currentReport.signals.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {currentReport.signals.map((signal, index) => (
                    <li key={`${currentReport.reportId}-signal-${index}`}>
                      <Badge variant={signal.type === "VERIFY" ? "warning" : "default"}>{signal.type}</Badge>
                      <span className="ml-2">{signal.text}</span>
                      <span className="block text-xs text-slate-500">Provenienza: {signal.basisRefs.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-slate-600">Nessun segnale rilevato.</p>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Lacune documentali</h4>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {currentReport.gaps.map((gap, index) => (
                    <li key={`${currentReport.reportId}-gap-${index}`}>{gap.text} ({gap.basisRefs.join(", ")})</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-600">Requisiti ancora aperti</h4>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {currentReport.openVerificationRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm font-medium text-amber-800">
              Conclusioni professionali: non formulate. La discovery preliminare non completa la verifica del fascicolo.
            </p>
          </section>
          </details>
        ) : null}

        {model.missions.length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Questioni e quesiti formulati</h3>
            {model.missions.map((mission) => (
              <section key={mission.missionId} className="space-y-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="max-w-3xl text-sm font-medium text-slate-900">{mission.question}</p>
                  <Badge variant={mission.status === "COMPLETED" ? "success" : mission.status === "REJECTED" ? "danger" : "default"}>
                    {mission.status === "COMPLETED" ? "Completata" : mission.status === "REJECTED" ? "Non completata" : "In corso"}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500">Data di riferimento: {formatDateIT(mission.referenceDate)}</p>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium">Dettagli esecuzione</summary>
                  <p className="mt-1">Stato: {mission.execution.status ? formatEnumLabel(mission.execution.status) : "Non disponibile"}. Tentativi: {mission.execution.attemptCount}.{mission.execution.callCount === null ? "" : ` Chiamate contabilizzate: ${mission.execution.callCount}.`}</p>
                </details>
                {mission.automationRequirementCode ? (
                  <p className="text-sm text-amber-800">
                    Requisito operativo: {researchRequirementLabel(mission.automationRequirementCode)}.
                  </p>
                ) : null}
                {mission.sources.length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-slate-600">Fonti candidate</h4>
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {mission.sources.map((source, index) => (
                        <li key={`${mission.missionId}-source-${index}`}>
                          {source.sourceUrl ? <a className="underline" href={source.sourceUrl}>{source.title}</a> : source.title}
                          {source.documentDate ? ` · ${source.documentDate}` : ""}
                          <details className="text-xs text-slate-500">
                            <summary className="cursor-pointer font-medium">Stato della fonte</summary>
                            <span className="block">Orientamento: {formatEnumLabel(source.supportDirection)}. Verifica: {formatEnumLabel(source.verificationState)}.</span>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {mission.gaps.length > 0 || mission.conflicts.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-slate-600">Dati mancanti</h4>
                      <p className="mt-1 text-sm text-slate-700">{mission.gaps.join(", ") || "Nessuno segnalato"}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-slate-600">Conflitti e orientamenti contrari</h4>
                      <p className="mt-1 text-sm text-slate-700">{mission.conflicts.join(", ") || "Nessuno documentato"}</p>
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-slate-500">
                  Le fonti sono risultati di ricerca. Fatti, inferenze e conclusioni professionali restano distinti e soggetti a verifica.
                </p>
              </section>
            ))}
          </div>
        ) : currentJob?.status === "SUCCEEDED" ? (
          <p className="text-sm text-slate-600">Nessun quesito di ricerca è stato formulato per questa versione.</p>
        ) : null}

        {model.jobs.some((job) => job.superseded) || model.reports.some((report) => report.status === "SUPERSEDED") ? (
          <p className="text-xs text-slate-500">Le analisi di versioni documentali precedenti sono conservate come superate.</p>
        ) : null}
        {model.historicalMissionCount > 0 ? (
          <p className="text-xs text-slate-500">Missioni storiche conservate: {model.historicalMissionCount}.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}