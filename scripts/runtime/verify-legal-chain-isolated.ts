/**
 * Isolated end-to-end proof of the manual legal-analysis chain with AUTOMAZIONE OFF:
 * DOCUMENT -> EXTRACTION -> KNOWLEDGE -> FACTS -> ISSUES -> SOURCE RESEARCH -> APPLICATION
 * -> REPORT -> PROPOSALS -> ACTS.
 *
 * Every component runs its real code path against a disposable PostgreSQL database. Only the
 * external services are simulated, at their network/tool boundary:
 * - OpenAI Responses API (global fetch): returns the reviewed offline Selvara output, grounded
 *   on the evidence spans that the real extraction produced;
 * - Moonlit MCP tools (adapter callTool): fixed candidate list;
 * - Normattiva open-data search and AKN download (global fetch).
 * Any other outbound HTTP request is refused and reported. No provider is contacted, nothing is paid.
 *
 * Usage (disposable database only):
 *   npx tsx scripts/runtime/verify-legal-chain-isolated.ts --execute-isolated-legal-chain \
 *     --pdf <path> --run-id <id> --storage-root <dir> --report <file.json>
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ISOLATED_HOST = "127.0.0.1";
const ISOLATED_PORT = "55432";
const ISOLATED_DATABASE = "noetra_legal_chain";
const ISOLATED_USER = "noetra_test";
const SIMULATED_APPROVAL_ID = "ISOLATED-LEGAL-CHAIN-SIMULATED";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}.`);
  return value;
}

if (!process.argv.includes("--execute-isolated-legal-chain")) {
  throw new Error("Refusing to run without --execute-isolated-legal-chain.");
}
const pdfPath = argument("--pdf");
const runId = argument("--run-id");
const storageRoot = path.resolve(argument("--storage-root"));
const reportPath = path.resolve(argument("--report"));
if (!/^[a-z0-9-]{4,40}$/.test(runId)) throw new Error("Invalid --run-id.");

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.protocol !== "postgresql:" || databaseUrl.hostname !== ISOLATED_HOST
  || databaseUrl.port !== ISOLATED_PORT || databaseUrl.pathname !== `/${ISOLATED_DATABASE}`
  || decodeURIComponent(databaseUrl.username) !== ISOLATED_USER) {
  throw new Error("DATABASE_URL must point to the disposable isolated database.");
}

// Autonomous execution stays OFF: the chain must run only through the manual path.
for (const name of [
  "AUTOMATIC_RESEARCH_EXECUTION_ENABLED",
  "SERVER_AUTONOMOUS_RESEARCH_ENABLED",
  "AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED",
  "AUTOMATIC_FASCICOLO_ANALYSIS_ENABLED",
]) {
  if (process.env[name]?.trim().toLowerCase() === "true") throw new Error(`${name} must stay OFF.`);
  process.env[name] = "false";
}
for (const name of ["LEGAL_DATA_HUNTER_API_KEY", "RESEARCH_PROVIDER_CREDENTIAL_KEY", "AI_GLOBAL_EMERGENCY_DISABLED"]) {
  delete process.env[name];
}
Object.assign(process.env, {
  DOCUMENT_STORAGE_BACKEND: "local",
  DOCUMENT_STORAGE_ROOT: storageRoot,
  EXPECTED_DATABASE_HOST_PREFIX: ISOLATED_HOST,
  MANUAL_LEGAL_ANALYSIS_PIPELINE: "true",
  ASYNC_PROVIDER_EXECUTION_ENABLED: "true",
  AI_OPENAI_API_KEY: "isolated-simulated-key-not-a-secret",
  AI_OPENAI_TIMEOUT_MS: "60000",
  AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "4000000",
  AI_OPENAI_MAX_OUTPUT_TOKENS: "64000",
  AI_OPENAI_MAX_INPUT_TOKENS: "400000",
  AI_MAX_INPUT_BYTES: "4000000",
  AI_OPENAI_USD_TO_EUR_RATE: "0.92",
  AI_OPENAI_USD_TO_EUR_RATE_DATE: "2026-11-04",
  AI_OPENAI_USD_TO_EUR_RATE_SOURCE: "ISOLATED_SIMULATION",
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: SIMULATED_APPROVAL_ID,
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
  ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR: "0.50",
  ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR: "0.01",
  MANUAL_RESEARCH_EXECUTION_ENABLED: "true",
  MANUAL_RESEARCH_ALLOWED_CAPABILITIES: "SEMANTIC_DISCOVERY,KEYWORD_DISCOVERY,EXACT_RETRIEVAL,ADVERSE_AUTHORITY_DISCOVERY",
  MANUAL_RESEARCH_MAX_CALLS: "6",
  MANUAL_RESEARCH_LEASE_MS: "60000",
  MANUAL_RESEARCH_PROVIDER_TIMEOUT_MS: "5000",
  MANUAL_OFFICIAL_SOURCE_VERIFICATION_ENABLED: "true",
  MANUAL_OFFICIAL_SOURCE_MAX_ACQUISITIONS: "2",
});

// ---------------------------------------------------------------------------------------------
// Network boundary simulation
// ---------------------------------------------------------------------------------------------

const L84_CODE = "094G0105";
const L84_TITLE = "LEGGE 28 gennaio 1994, n. 84 (Riordino della legislazione in materia portuale)";
const L84_DETAIL_URL = `https://www.normattiva.it/atto/caricaDettaglioAtto?atto.dataPubblicazioneGazzetta=1994-02-04&atto.codiceRedazionale=${L84_CODE}`;
// Text of art. 18, paragraphs 1 and 7, L. 84/1994 (official act, art. 5 L. 633/1941), delivered
// here by the simulator instead of Normattiva.
const L84_AKN = `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act name="${L84_CODE}">
<meta><identification source="#simulator">
<FRBRWork><FRBRthis value="/akn/it/act/legge/stato/1994-01-28/84/!main"/><FRBRuri value="/akn/it/act/legge/stato/1994-01-28/84"/><FRBRdate date="1994-01-28" name="emanazione"/></FRBRWork>
<FRBRExpression><FRBRthis value="/akn/it/act/legge/stato/1994-01-28/84/ita@/!main"/><FRBRuri value="/akn/it/act/legge/stato/1994-01-28/84/ita@"/><FRBRdate date="2023-07-14" name="vigenza"/></FRBRExpression>
</identification><proprietary source="#simulator"><codiceRedazionale>${L84_CODE}</codiceRedazionale></proprietary></meta>
<preface><docTitle>Riordino della legislazione in materia portuale</docTitle></preface>
<body><article eId="art_18"><num>Art. 18</num><heading>Concessione di aree e banchine</heading>
<paragraph eId="art_18__para_1"><content><p>1. L'Autorita' di sistema portuale e, laddove non istituita, l'autorita' marittima danno in concessione le aree demaniali e le banchine comprese nell'ambito portuale alle imprese di cui all'articolo 16, comma 3, per l'espletamento delle operazioni portuali, fatta salva l'utilizzazione degli immobili da parte di amministrazioni pubbliche per lo svolgimento di funzioni attinenti ad attivita' marittime e portuali.</p></content></paragraph>
<paragraph eId="art_18__para_7"><content><p>7. In ciascun porto l'impresa concessionaria di un'area demaniale deve esercitare direttamente l'attivita' per la quale ha ottenuto la concessione. Su motivata richiesta dell'impresa concessionaria, l'autorita' concedente puo' autorizzare l'affidamento ad altre imprese portuali, autorizzate ai sensi dell'articolo 16, dell'esercizio di alcune attivita' comprese nel ciclo operativo.</p></content></paragraph>
</article></body></act></akomaNtoso>`;

const moonlitItems = [{
  identifier: "MNLT:IT:SIM:L84-1994",
  secondaryIdentifier: L84_CODE,
  title: L84_TITLE,
  sourceUrl: L84_DETAIL_URL,
  year: 1994,
  sources: [{ id: "normattiva-italiana", name: "Normattiva" }],
}, {
  identifier: "MNLT:IT:SIM:CDS-SIMULATA",
  title: "Consiglio di Stato - decisione simulata per il collaudo isolato (non esistente)",
  court: "Consiglio di Stato",
  year: 2024,
  sourceUrl: "https://www.giustizia-amministrativa.it/simulata",
  sources: [{ id: "giustizia-amministrativa", name: "Giustizia amministrativa" }],
}];

const network = {
  openAiResponses: 0,
  normattivaSearch: 0,
  normattivaSession: 0,
  normattivaAkn: 0,
  moonlitToolCalls: {} as Record<string, number>,
  refused: [] as string[],
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function findDocumentPayload(body: Record<string, unknown>): { documentVersionId: string; spans: { id: string; basisRef: string }[] } {
  const input = body.input as { content: { text: string }[] }[];
  const text = input[0].content[0].text;
  const lines = text.split("\n");
  if (lines[0] !== "BEGIN_UNTRUSTED_DOCUMENT_DATA" || lines.at(-1) !== "END_UNTRUSTED_DOCUMENT_DATA") {
    throw new Error("SIMULATED_OPENAI_UNEXPECTED_INPUT");
  }
  const parsed = JSON.parse(lines.slice(1, -1).join("\n")) as {
    content: { documentVersionId: string; evidenceSpans: { id: string; basisRef: string }[] };
  };
  return { documentVersionId: parsed.content.documentVersionId, spans: parsed.content.evidenceSpans };
}

let buildProviderOutput: ((documentVersionId: string, spans: readonly { id: string; basisRef: string }[]) => unknown) | null = null;
let openAiModel = "";
const realFetch = globalThis.fetch.bind(globalThis);
void realFetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname.endsWith("api.openai.com") && url.pathname === "/v1/responses") {
    network.openAiResponses += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const document = findDocumentPayload(body);
    const outputText = JSON.stringify(buildProviderOutput!(document.documentVersionId, document.spans));
    const inputTokens = Math.ceil(String(init?.body).length / 4);
    const outputTokens = Math.ceil(outputText.length / 4);
    return jsonResponse({
      model: openAiModel,
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: outputText }] }],
      usage: {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: outputTokens,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: inputTokens + outputTokens,
      },
    });
  }
  if (url.hostname === "api.normattiva.it" && url.pathname.endsWith("/ricerca/avanzata")) {
    network.normattivaSearch += 1;
    const query = JSON.parse(String(init?.body)) as { denominazioneAtto: string; annoProvvedimento: number; numeroProvvedimento: string };
    const l84 = query.denominazioneAtto === "LEGGE" && query.annoProvvedimento === 1994 && query.numeroProvvedimento === "84";
    return jsonResponse({
      listaAtti: l84 ? [{
        codiceRedazionale: L84_CODE,
        denominazioneAtto: "LEGGE",
        numeroProvvedimento: "84",
        annoProvvedimento: 1994,
        dataEmanazione: "1994-01-28",
        titoloAtto: "Riordino della legislazione in materia portuale",
        dataGU: "1994-02-04",
      }] : [],
    });
  }
  if (url.hostname === "www.normattiva.it" && url.pathname === "/atto/caricaDettaglioAtto") {
    network.normattivaSession += 1;
    // A plain Headers object keeps the session cookie visible to the caller.
    return { ok: true, status: 200, headers: new Headers({ "set-cookie": "JSESSIONID=isolated-simulation; Path=/" }), body: null } as unknown as Response;
  }
  if (url.hostname === "www.normattiva.it" && url.pathname === "/do/atto/caricaAKN") {
    network.normattivaAkn += 1;
    if (url.searchParams.get("codiceRedaz") !== L84_CODE) return new Response("", { status: 404 });
    return new Response(L84_AKN, { status: 200, headers: { "content-type": "application/xml" } });
  }
  network.refused.push(`${url.origin}${url.pathname}`);
  throw new TypeError("ISOLATED_NETWORK_REFUSED");
}) as typeof fetch;

function simulatedMoonlit(request: { name: string; arguments: Readonly<Record<string, unknown>> }): Promise<unknown> {
  network.moonlitToolCalls[request.name] = (network.moonlitToolCalls[request.name] ?? 0) + 1;
  if (request.name === "get_document") {
    const item = moonlitItems.find((candidate) => candidate.identifier === request.arguments.document_identifier);
    if (!item) return Promise.resolve({ isError: true, content: [] });
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(item) }] });
  }
  return Promise.resolve({
    content: [{ type: "text", text: JSON.stringify({ success: true, result: { results: moonlitItems } }) }],
  });
}

// ---------------------------------------------------------------------------------------------

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const identity = await prisma.$queryRaw<Array<{ database: string; username: string; port: number }>>`
    SELECT current_database() AS database, current_user AS username, inet_server_port() AS port
  `;
  if (identity[0]?.database !== ISOLATED_DATABASE || identity[0]?.username !== ISOLATED_USER
    || identity[0]?.port !== Number(ISOLATED_PORT)) {
    throw new Error("The server did not identify itself as the disposable legal-chain database.");
  }

  const { OPENAI_ANALYSIS_MODEL } = await import("@/server/ai/providers/openai");
  openAiModel = OPENAI_ANALYSIS_MODEL;
  const { buildSelvaraOfflineProviderOutput } = await import("../../tests/fixtures/selvara-offline-provider-output");
  buildProviderOutput = (documentVersionId, spans) => buildSelvaraOfflineProviderOutput(documentVersionId, spans);

  const { setGlobalAiControlState } = await import("@/server/ai/globalAiControl");
  const { storeDocumentFileAtKey } = await import("@/server/documents/storage");
  const { runManualLegalAnalysisPipeline } = await import("@/server/legal-research/manual-legal-analysis-pipeline");
  const { createApplicationAsyncJobRegistry } = await import("@/server/async-jobs/applicationWorker");
  const { drainOneAsyncJob } = await import("@/server/async-jobs/worker");
  const {
    createMoonlitResearchAdapter,
    createMoonlitKeywordResearchAdapter,
    createMoonlitExactRetrievalAdapter,
  } = await import("@/server/legal-research/provider-research-adapters");
  const { getCurrentKnowledgeRevision } = await import("@/server/fascicolo-knowledge/repository");
  const { listReferenceDateReviewQuestions, confirmKnowledgeReferenceDate } =
    await import("@/server/fascicolo-knowledge/referenceDateConfirmation");
  const { getFascicoloAutomaticWorkflowReadModelForTenant } = await import("@/server/queries/fascicolo-automatic-workflow");
  const { generateOperationalProposalCandidates, reconcileOperationalProposals, reviewOperationalProposal, listOperationalProposals } =
    await import("@/server/fascicolo-operational-proposals");
  const { proposalReconciliationFingerprint } = await import("@/server/fascicolo-operational-proposals/reconciliation-state");
  const { buildActivitySpecs } = await import("@/server/fascicolo-operational-activities/model");
  const { appendActivityCommand, listOperationalActivities } = await import("@/server/fascicolo-operational-activities/repository");
  const { buildActTemplateCatalog, findActTemplate } = await import("@/server/fascicolo-acts/templates");
  const { stableActDraftKey } = await import("@/server/fascicolo-acts/model");
  const { saveActDraftVersion, listActDrafts } = await import("@/server/fascicolo-acts/repository");

  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@demo.local" },
    select: { id: true, email: true, tenantMemberships: { where: { isDefault: true }, select: { enteId: true } } },
  });
  const tenantId = admin.tenantMemberships[0]?.enteId;
  if (!tenantId) throw new Error("The isolated administrator has no default tenant.");
  process.env.MANUAL_RESEARCH_WORKER_ACTOR_ID = admin.id;
  process.env.MANUAL_RESEARCH_TENANT_ALLOWLIST = tenantId;
  const actor = { id: admin.id, email: admin.email, role: "ADMIN" as const };

  const concession = await prisma.concessione.findFirstOrThrow({ where: { enteId: tenantId }, orderBy: { id: "asc" }, select: { id: true } });
  const procedimentoId = `legal-chain-${runId}`;
  process.env.MANUAL_RESEARCH_PROCEDIMENTO_ALLOWLIST = procedimentoId;

  // Professional setup that an administrator performs once: global AI switch and budget caps.
  await setGlobalAiControlState({
    enabled: true,
    actor: { userId: admin.id, userEmail: admin.email, userRole: "ADMIN" },
    reason: "Collaudo isolato della catena giuridica con provider simulati",
  });
  await prisma.procedimento.create({
    data: {
      id: procedimentoId,
      enteId: tenantId,
      concessioneId: concession.id,
      tipologia: "ALTRO",
      stato: "IN_CORSO",
      noteIstruttorie: "Collaudo isolato della catena giuridica sul PDF canonico Selvara.",
    },
  });
  const now = new Date(Date.now() - 60_000);
  for (const scope of [
    { scope: "GLOBAL" as const, tenantId: null, procedimentoId: null },
    { scope: "TENANT" as const, tenantId, procedimentoId: null },
    { scope: "PROCEDIMENTO" as const, tenantId, procedimentoId },
  ]) {
    const existing = await prisma.runtimeBudgetPolicy.findFirst({
      where: { scope: scope.scope, tenantId: scope.tenantId, procedimentoId: scope.procedimentoId, currency: "EUR", windowSeconds: 86_400 },
      select: { id: true },
    });
    if (!existing) {
      await prisma.runtimeBudgetPolicy.create({
        data: { ...scope, currency: "EUR", hardCapAmount: 10, windowSeconds: 86_400, enabled: true, effectiveFrom: now },
      });
    }
  }

  // DOCUMENT: the canonical PDF, stored exactly as an upload would store it.
  const pdf = await readFile(pdfPath);
  const pdfSha = sha256(pdf);
  const documentId = `${procedimentoId}-canonical-pdf`;
  const storageKey = `${procedimentoId}/canonical.pdf`;
  await mkdir(storageRoot, { recursive: true });
  await storeDocumentFileAtKey({
    storageKey,
    file: new File([pdf], "NOETRA_SELVARA_CASO_CIECO_FASCICOLO_UNICO.pdf", { type: "application/pdf" }),
  });
  await prisma.documento.create({
    data: {
      id: documentId,
      enteId: tenantId,
      procedimentoId,
      concessioneId: concession.id,
      nome: "Fascicolo unico Selvara (copia isolata)",
      tipologia: "NOTA",
      mimeType: "application/pdf",
      storageProvider: "local",
      storageKey,
      storagePath: storageKey,
      checksumSha256: pdfSha,
      dimensioneBytes: pdf.length,
    },
  });
  const fileVersion = await prisma.documentFileVersion.create({
    data: {
      documentId,
      canonicalEnteId: tenantId,
      storageProvider: "local",
      storageKey,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      sha256: pdfSha,
      createdByUserId: admin.id,
      createdByActorId: admin.id,
      createdByRole: "ADMIN",
    },
  });
  await prisma.documento.update({ where: { id: documentId }, data: { currentFileVersionId: fileVersion.id } });

  const registry = createApplicationAsyncJobRegistry({
    automaticResearchDependencies: {
      createProviderAdapters: async () => [
        createMoonlitResearchAdapter(simulatedMoonlit),
        createMoonlitKeywordResearchAdapter(simulatedMoonlit),
        createMoonlitExactRetrievalAdapter(simulatedMoonlit),
      ],
    },
  });
  const drained: { operation: string; outcome: string; failureCode: string | null }[] = [];
  const drain = async () => {
    for (let index = 0; index < 60; index += 1) {
      const result = await drainOneAsyncJob({
        workerId: `isolated-legal-chain-${runId}`,
        leaseDurationMs: 300_000,
        retryDelayMs: 1_000,
        registry,
        procedimentoAllowlist: [procedimentoId],
      });
      if (result.outcome === "IDLE") return;
      const job = await prisma.asyncJob.findUniqueOrThrow({
        where: { id: result.jobId },
        select: { operation: true, failureCode: true },
      });
      drained.push({ operation: job.operation, outcome: result.outcome, failureCode: job.failureCode });
    }
    throw new Error("Worker drain did not converge.");
  };
  const pipeline = () => runManualLegalAnalysisPipeline(
    { tenantId, procedimentoId, executionId: randomUUID(), actor },
    { activateWorker: async () => ({ outcome: "ISOLATED_WORKER" }) as never },
  );

  const steps: Record<string, unknown>[] = [];
  // 1. Manual request: the never-extracted PDF is extracted first (local, no provider).
  steps.push({ step: "request-1", result: await pipeline() });
  await drain();
  // 2. Manual request: AI analysis of the extracted corpus (OpenAI simulated at the HTTP boundary).
  steps.push({ step: "request-2", result: await pipeline() });
  await drain();

  // The professional confirms the legal reference date for each research question, as in the UI.
  const revision = await getCurrentKnowledgeRevision({ tenantId, procedimentoId });
  if (!revision || revision.status !== "CURRENT") throw new Error("Knowledge revision not CURRENT after analysis.");
  const confirmations: Record<string, unknown>[] = [];
  for (const question of listReferenceDateReviewQuestions(revision)) {
    const hint = question.documentaryHints[0];
    const confirmedDate = hint?.date ?? "2023-07-14";
    const confirmation = await confirmKnowledgeReferenceDate({
      tenantId,
      procedimentoId,
      questionSemanticKey: question.questionSemanticKey,
      confirmedDate,
      rationale: hint
        ? `Data documentale ${hint.kind} ${hint.semanticKey} confermata nel collaudo isolato.`
        : "Data di rilascio del titolo concessorio confermata nel collaudo isolato.",
      actor: { userId: admin.id, userEmail: admin.email, userRole: "ADMIN" },
    });
    confirmations.push({ question: question.questionSemanticKey, confirmedDate, documentaryHint: hint?.semanticKey ?? null, auditId: confirmation.sourceId });
  }

  // 3. Manual request: research on the current revision, then the worker drains it.
  steps.push({ step: "request-3", result: await pipeline() });
  await drain();
  // 4. Repeated request: must not duplicate jobs, revisions or missions.
  const jobsBeforeRepeat = await prisma.asyncJob.count({ where: { procedimentoId } });
  steps.push({ step: "request-4-repeat", result: await pipeline() });
  await drain();
  const jobsAfterRepeat = await prisma.asyncJob.count({ where: { procedimentoId } });
  // Every question has now been executed on this revision: a further request must not spend again.
  steps.push({ step: "request-5-repeat-after-all-executed", result: await pipeline() });
  await drain();
  const jobsAfterSecondRepeat = await prisma.asyncJob.count({ where: { procedimentoId } });

  // ------------------------------------------------------------------ evidence collection
  const attempts = await prisma.documentExtractionAttempt.findMany({
    where: { procedimentoId },
    select: { outcome: true, pages: { select: { pageNumber: true, text: true } } },
  });
  const pages = attempts.flatMap((attempt) => attempt.pages);
  const revisions = await prisma.fascicoloKnowledgeRevision.findMany({
    where: { tenantId, procedimentoId },
    select: { id: true, status: true, corpusFingerprint: true },
  });
  const currentRevision = revisions.find((item) => item.status === "CURRENT");
  const items = currentRevision ? await prisma.fascicoloKnowledgeItem.groupBy({
    by: ["kind"],
    where: { revisionId: currentRevision.id },
    _count: { _all: true },
  }) : [];
  const evidenceCount = currentRevision ? await prisma.fascicoloKnowledgeEvidence.count({ where: { item: { revisionId: currentRevision.id } } }) : 0;
  const missions = await prisma.researchMissionRecord.findMany({
    where: { tenantId, caseId: procedimentoId },
    select: { id: true, status: true, lifecycleStatus: true, researchQuestionSemanticKey: true, mode: true, referenceDate: true },
  });
  const results = await prisma.researchQuestionResultRecord.findMany({
    where: { tenantId, caseId: procedimentoId },
    select: { missionId: true, candidateSnapshot: true },
  });
  const officialOutcomes: Record<string, number> = {};
  for (const result of results) {
    const relevance = (result.candidateSnapshot as { officialRelevance?: { status?: string; reason?: string } }).officialRelevance;
    const key = relevance ? `${relevance.status}:${relevance.reason}` : "NOT_CHECKED";
    officialOutcomes[key] = (officialOutcomes[key] ?? 0) + 1;
  }
  const sourceAssessments = await prisma.researchSourceAssessmentRecord.findMany({
    where: { tenantId, caseId: procedimentoId },
    select: { usable: true, officiality: true, temporalState: true, blockingReasons: true },
  });
  const temporalAssessments = await prisma.legalSourceTemporalAssessment.count();
  const reservations = await prisma.runtimeCostReservation.findMany({
    where: { procedimentoId },
    select: { provider: true, operationType: true, status: true, estimatedAmount: true, actualAmount: true },
  });
  const jobs = await prisma.asyncJob.findMany({
    where: { procedimentoId },
    select: { operation: true, status: true, failureCode: true },
  });
  const model = await getFascicoloAutomaticWorkflowReadModelForTenant({ tenantId, procedimentoId });
  const report = model?.structuredReport ?? null;

  // PROPOSALS: generation through the same repository call as the confirmed UI action.
  let proposalsSummary: Record<string, unknown> = { generated: false };
  let actsSummary: Record<string, unknown> = { created: false };
  if (model && report && model.analysisUpdate.status === "CURRENT") {
    const snapshot = model.structuredReportSnapshots.find((item) =>
      item.reportFingerprint === report.reportFingerprint && item.effectiveStatus === "CURRENT");
    if (snapshot) {
      const candidates = generateOperationalProposalCandidates({
        tenantId,
        procedimentoId,
        structuredReportId: snapshot.snapshotId,
        structuredReportFingerprint: report.reportFingerprint,
        report: report.payload,
      });
      const fingerprints = [...new Set(candidates.map((candidate) => candidate.proposalFingerprint))];
      const reconciliation = await reconcileOperationalProposals({
        tenantId,
        procedimentoId,
        knowledgeRevisionId: report.payload.knowledgeRevisionId,
        structuredReportId: snapshot.snapshotId,
        structuredReportFingerprint: report.reportFingerprint,
        expectedCorpusFingerprint: model.analysisUpdate.corpusFingerprint,
        expectedPreviewFingerprint: proposalReconciliationFingerprint({
          tenantId, procedimentoId, reportFingerprint: report.reportFingerprint, candidateFingerprints: fingerprints, states: [],
        }),
        candidates,
        actor: { actorId: admin.id, actorEmail: admin.email, actorRole: "ADMIN" },
      });
      const proposals = await listOperationalProposals({ tenantId, procedimentoId });
      const byType: Record<string, number> = {};
      for (const proposal of proposals) byType[proposal.proposalType] = (byType[proposal.proposalType] ?? 0) + 1;
      const scope = { tenantId, procedimentoId, concessioneId: concession.id };
      const specs = buildActivitySpecs(report.payload);
      const specsWithAct = specs.filter((item) => item.necessity !== "NOT_JUSTIFIED" && item.documents.length > 0);
      const activityProposals = await prisma.fascicoloOperationalProposal.findMany({
        where: { tenantId, procedimentoId, proposalType: "ACTIVITY", status: "PROPOSED", supersededAt: null },
        select: { id: true, reviewVersion: true, originatingIssueSemanticKeys: true, proposedPayload: true },
      });
      const pairs = specsWithAct.flatMap((item) => activityProposals
        .filter((proposal) => proposal.originatingIssueSemanticKeys.includes(item.issueSemanticKey)
          && (proposal.proposedPayload as { activityCode?: string }).activityCode === item.activityCode)
        .map((proposal) => ({ spec: item, proposal })));
      const pair = pairs[0];
      let approved: string | null = null;
      if (pair) {
        const reviewed = await reviewOperationalProposal({
          tenantId,
          procedimentoId,
          proposalId: pair.proposal.id,
          action: "APPROVE",
          expectedReviewVersion: pair.proposal.reviewVersion,
          reviewNote: "Approvazione professionale nel collaudo isolato.",
          actor: { actorId: admin.id, actorEmail: admin.email, actorRole: "ADMIN" },
        });
        approved = `${reviewed.proposalType}:${reviewed.status}`;
      }
      proposalsSummary = {
        generated: true,
        created: reconciliation.created,
        total: proposals.length,
        byType,
        approvedExample: approved,
        activityProposalsLinkedToActTemplates: pairs.length,
        sampleTitles: proposals.slice(0, 6).map((proposal) => (proposal as { title?: string }).title ?? proposal.proposalType),
      };

      // ACTS: adopt the approved proposal as activity and create its draft twice (idempotent).
      const spec = pair?.spec;
      if (spec && pair) {
        await appendActivityCommand({
          scope,
          actor: { actorId: admin.id, actorEmail: admin.email, actorRole: "ADMIN" },
          knowledgeRevisionId: report.payload.knowledgeRevisionId,
          reportFingerprint: report.reportFingerprint,
          specs,
          activityKey: spec.activityKey,
          expectedSpecFingerprint: spec.fingerprint,
          expectedCorpusFingerprint: model.analysisUpdate.corpusFingerprint,
          expectedVersion: 0,
          requestId: randomUUID(),
          command: { kind: "ADOPT_APPROVAL", proposalId: pair.proposal.id, note: "Attivita adottata dalla proposta approvata.", confirmed: true },
        });
        const adopted = (await listOperationalActivities(scope)).find((item) => item.activityKey === spec.activityKey);
        await appendActivityCommand({
          scope,
          actor: { actorId: admin.id, actorEmail: admin.email, actorRole: "ADMIN" },
          knowledgeRevisionId: report.payload.knowledgeRevisionId,
          reportFingerprint: report.reportFingerprint,
          specs,
          activityKey: spec.activityKey,
          expectedSpecFingerprint: spec.fingerprint,
          expectedCorpusFingerprint: model.analysisUpdate.corpusFingerprint,
          expectedVersion: adopted?.current.version ?? 1,
          requestId: randomUUID(),
          command: { kind: "TAKE_CHARGE", note: "Presa in carico nel collaudo isolato." },
        });
        const activity = (await listOperationalActivities(scope)).find((item) => item.activityKey === spec.activityKey);
        const catalog = buildActTemplateCatalog({
          payload: report.payload,
          context: { procedimentoLabel: `Procedimento ${procedimentoId}`, responsabile: null, unitaOrganizzativa: null },
        });
        const template = findActTemplate(catalog, spec.documents[0].templateKey);
        if (activity && template) {
          const create = () => saveActDraftVersion({
            scope,
            draftKey: stableActDraftKey(template.templateKey, template.issueSemanticKey),
            expectedVersion: 0,
            idempotentCreate: true,
            creationIdentity: { legacyTemplateKeys: template.legacyTemplateKeys ?? [], ambiguousLegacyKeys: [] },
            guidedContext: {
              knowledgeRevisionId: report.payload.knowledgeRevisionId,
              reportFingerprint: report.reportFingerprint,
              expectedCorpusFingerprint: model.analysisUpdate.corpusFingerprint,
              specs,
              spec,
              expectedActivityVersion: activity.current.version,
              templateKey: template.templateKey,
            },
            actor: { actorId: admin.id, actorEmail: admin.email, actorRole: "ADMIN" },
            content: {
              templateKey: template.templateKey,
              issueSemanticKey: template.issueSemanticKey,
              title: template.title,
              body: template.body,
              status: "BOZZA",
              assignee: null,
              dueDate: null,
              progress: 0,
              dependencies: [],
              attachments: [],
              changeNote: `Creata dal modello: ${template.title} (${template.legalBasis}).`,
            },
          });
          const first = await create();
          const second = await create();
          const drafts = await listActDrafts(scope);
          actsSummary = {
            created: true,
            activity: spec.title,
            template: template.title,
            legalBasis: template.legalBasis,
            draftKey: first.draftKey,
            repeatedCreationReusedSameVersion: first.draftKey === second.draftKey && first.version === second.version,
            draftsForProcedure: drafts.length,
            bodyCharacters: template.body.length,
          };
        } else {
          actsSummary = { created: false, reason: activity ? "TEMPLATE_NOT_FOUND" : "ACTIVITY_NOT_RECORDED" };
        }
      } else {
        actsSummary = { created: false, reason: "NO_ACTIVITY_WITH_ACT_TEMPLATE" };
      }
    }
  }

  const { researchMissionDisplayState } = await import("@/server/legal-research/research-mission-display-state");
  const missionStates: Record<string, number> = {};
  for (const mission of model?.missions ?? []) {
    const jobStatus = mission.execution.status;
    const state = researchMissionDisplayState({
      status: mission.status,
      lifecycleStatus: mission.lifecycleStatus,
      claimExpiresAt: null,
      results: mission.results.map((result) => ({ classificationReviewStatus: result.classificationReviewStatus })),
      job: jobStatus ? {
        status: jobStatus as never,
        failureCode: mission.execution.failureCode,
        availableAt: mission.updatedAt,
        leaseExpiresAt: null,
        createdAt: mission.updatedAt,
      } : null,
      now: new Date(),
    }).state;
    missionStates[state] = (missionStates[state] ?? 0) + 1;
  }

  const output = {
    runId,
    generatedAt: new Date().toISOString(),
    simulated: {
      openAi: "HTTP boundary (api.openai.com/v1/responses) -> reviewed offline Selvara output grounded on real extracted spans",
      moonlit: "adapter callTool -> fixed list: L. 84/1994 + one fictitious Consiglio di Stato decision",
      normattiva: "HTTP boundary (open-data search, session, AKN) -> L. 84/1994 art. 18 commi 1 e 7",
    },
    network,
    pdf: { sha256: pdfSha, bytes: pdf.length },
    steps,
    referenceDateConfirmations: confirmations,
    extraction: {
      attempts: attempts.map((attempt) => attempt.outcome),
      pages: pages.length,
      pagesWithText: pages.filter((page) => (page.text ?? "").trim().length > 0).length,
      characters: pages.reduce((total, page) => total + (page.text ?? "").length, 0),
    },
    knowledge: {
      revisions: revisions.map((item) => item.status),
      itemsByKind: Object.fromEntries(items.map((item) => [item.kind, item._count._all])),
      evidenceLinks: evidenceCount,
      analysisUpdateStatus: model?.analysisUpdate.status ?? null,
    },
    research: {
      missions: missions.map((mission) => ({
        question: mission.researchQuestionSemanticKey,
        status: mission.status,
        lifecycle: mission.lifecycleStatus,
        mode: mission.mode,
        referenceDate: mission.referenceDate?.toISOString().slice(0, 10) ?? null,
      })),
      displayStates: missionStates,
      candidates: results.length,
      officialOutcomes,
      sourceAssessments: {
        total: sourceAssessments.length,
        usable: sourceAssessments.filter((item) => item.usable).length,
        detail: sourceAssessments.map((item) => ({
          officiality: item.officiality,
          temporalState: item.temporalState,
          blockingReasons: item.blockingReasons,
        })),
      },
      temporalAssessments,
      legalSource: await prisma.legalSource.findUnique({
        where: { sourceKey: `official:normattiva:${L84_CODE}` },
        select: { sourceKey: true, status: true, title: true },
      }),
    },
    report: report ? {
      fingerprint: report.reportFingerprint,
      issues: (report.payload.legalApplication ?? []).length,
      operationalPlans: (report.payload.operationalPlans ?? []).length,
      snapshots: model?.structuredReportSnapshots.map((item) => item.effectiveStatus) ?? [],
    } : null,
    proposals: proposalsSummary,
    acts: actsSummary,
    costs: reservations.map((reservation) => ({
      provider: reservation.provider,
      operation: reservation.operationType,
      status: reservation.status,
      estimatedEur: Number(reservation.estimatedAmount),
      actualEur: reservation.actualAmount === null ? null : Number(reservation.actualAmount),
    })),
    jobs: jobs.map((job) => `${job.operation}:${job.status}${job.failureCode ? `:${job.failureCode}` : ""}`),
    drained,
    idempotency: { jobsBeforeRepeat, jobsAfterRepeat, jobsAfterSecondRepeat },
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
