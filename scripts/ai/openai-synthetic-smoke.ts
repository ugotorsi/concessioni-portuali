import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  AI_FASCICOLO_ANALYSIS_V1_LIMITATIONS,
  AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
  AiFascicoloAnalysisError,
  analyzeFascicoloSnapshotV1,
  type AiAnalysisProvider,
} from "@/server/ai/fascicoloAnalysis";
import { AiProviderAdapterError } from "@/server/ai/providerErrors";
import {
  OPENAI_ANALYSIS_MODEL,
  createOpenAiAnalysisProvider,
  type OpenAiFetch,
  type OpenAiRegion,
} from "@/server/ai/providers/openai";

const SYNTHETIC_SNAPSHOT_SCHEMA_VERSION = "ai-fascicolo-snapshot/v1" as const;
const PROVIDER_NAME = "OpenAI" as const;

const REQUIRED_ENV_NAMES = [
  "AI_OPENAI_API_KEY",
  "AI_OPENAI_REGION",
  "AI_OPENAI_TIMEOUT_MS",
  "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
  "AI_OPENAI_MAX_OUTPUT_TOKENS",
  "AI_MAX_INPUT_BYTES",
] as const;

type RequiredEnvName = (typeof REQUIRED_ENV_NAMES)[number];
type SmokeEnv = Partial<Record<RequiredEnvName, string | undefined>>;
type TrustedSnapshot = Parameters<typeof analyzeFascicoloSnapshotV1>[0]["snapshot"];
type ProviderFactory = (config: {
  apiKey: string;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  region: OpenAiRegion;
  transport?: OpenAiFetch;
}) => AiAnalysisProvider;

interface ParsedSmokeConfig {
  apiKey: string;
  region: OpenAiRegion;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  maxInputBytes: number;
}

export interface SyntheticSmokeSuccess {
  ok: true;
  exitCode: 0;
  summary: {
    SMOKE_STATUS: "PASS";
    provider: typeof PROVIDER_NAME;
    model: typeof OPENAI_ANALYSIS_MODEL;
    region: OpenAiRegion;
    snapshotSchemaVersion: typeof SYNTHETIC_SNAPSHOT_SCHEMA_VERSION;
    snapshotContentHash: string;
    analysisSchemaVersion: typeof AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION;
    summaryItems: 1;
    timelineItems: number;
    signalItems: number;
    questionItems: number;
    activityItems: number;
    mandatoryLimitationsCount: number;
    elapsedMs: number;
    FORBIDDEN_STRUCTURAL_FIELDS_PRESENT: "NO";
  };
}

export interface SyntheticSmokeFailure {
  ok: false;
  exitCode: 1;
  summary: {
    SMOKE_STATUS: "FAIL";
    errorCategory:
      | "AI_CONFIGURATION_ERROR"
      | "AI_PROVIDER_TIMEOUT"
      | "AI_PROVIDER_RATE_LIMITED"
      | "AI_PROVIDER_UNAVAILABLE"
      | "INVALID_PROVIDER_OUTPUT"
      | "UNEXPECTED_SMOKE_FAILURE";
  };
}

export type SyntheticSmokeResult = SyntheticSmokeSuccess | SyntheticSmokeFailure;

class SmokeConfigurationError extends Error {
  readonly code = "AI_CONFIGURATION_ERROR" as const;

  constructor(readonly envName: RequiredEnvName) {
    super("AI_CONFIGURATION_ERROR");
    this.name = "SmokeConfigurationError";
  }
}

function failConfig(envName: RequiredEnvName): never {
  throw new SmokeConfigurationError(envName);
}

function requiredString(env: SmokeEnv, envName: RequiredEnvName): string {
  const value = env[envName];
  if (typeof value !== "string") {
    return failConfig(envName);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return failConfig(envName);
  }
  return trimmed;
}

function positiveInteger(env: SmokeEnv, envName: RequiredEnvName): number {
  const value = requiredString(env, envName);
  if (!/^[0-9]+$/.test(value)) {
    return failConfig(envName);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return failConfig(envName);
  }
  return parsed;
}

function parseSmokeConfig(env: SmokeEnv): ParsedSmokeConfig {
  const region = requiredString(env, "AI_OPENAI_REGION");
  if (region !== "GLOBAL" && region !== "EU") {
    return failConfig("AI_OPENAI_REGION");
  }
  return {
    apiKey: requiredString(env, "AI_OPENAI_API_KEY"),
    region,
    timeoutMs: positiveInteger(env, "AI_OPENAI_TIMEOUT_MS"),
    maxRawResponseBytes: positiveInteger(env, "AI_OPENAI_MAX_RAW_RESPONSE_BYTES"),
    maxOutputTokens: positiveInteger(env, "AI_OPENAI_MAX_OUTPUT_TOKENS"),
    maxInputBytes: positiveInteger(env, "AI_MAX_INPUT_BYTES"),
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

export function createSyntheticFascicoloSnapshot(): TrustedSnapshot {
  const content = {
    identityContext: {
      procedimentoId: "SYNTHETIC-PROCEDIMENTO-001",
      canonicalEnteId: "SYNTHETIC-ENTE-001",
    },
    procedimento: {
      id: "SYNTHETIC-PROCEDIMENTO-001",
      tipologia: "SYNTHETIC_NEUTRAL_CHECK",
      stato: "SYNTHETIC_RECORDED",
      origineProcedimento: "SYNTHETIC",
      procedimentoUfficio: false,
      riferimentoNormativo: null,
      dataAvvio: "2026-01-10T09:00:00.000Z",
      dataScadenzaContraddittorio: null,
      dataProvvedimentoFinale: null,
      checklistProfile: "SYNTHETIC_CORE",
      noteIstruttorie: "Fixture tecnica sintetica senza dati reali.",
      responsabileProcedimentoNome: null,
      unitaOrganizzativaResponsabile: "UNITÀ TEST SINTETICA",
      responsabileAssegnatoAt: null,
      responsibilityAssignments: [],
      comunicazioneAvvioInviata: false,
      dataComunicazioneAvvio: null,
      termineMemorieGiorni: null,
      termineMemorieScadenza: null,
      memorieRicevute: false,
      dataRicezioneMemorie: null,
      audizioneRichiesta: false,
      audizioneSvolta: false,
      dataAudizione: null,
      sopralluogoIstruttorioSvolto: false,
      contestazioneFormaleInviata: false,
      dataContestazioneFormale: null,
      controdeduzioniValutate: false,
      motivazioneValutazione: null,
      propostaEsitoIstruttorio: null,
      preavvisoRigettoApplicabile: false,
      statoPreavvisoRigetto: "SYNTHETIC_NOT_EVALUATED",
      dataPreavvisoRigetto: null,
      termineOsservazioniPreavviso: null,
      osservazioniPreavvisoRicevute: false,
      dataOsservazioniPreavviso: null,
      valutazioneOsservazioniPreavviso: null,
      motivazioneMancatoPreavviso: null,
      createdAt: "2026-01-10T09:00:00.000Z",
    },
    concessione: {
      id: "SYNTHETIC-CONCESSIONE-001",
      numeroAtto: "SYNTHETIC-ACT-001",
      stato: "SYNTHETIC_RECORDED",
      dataRilascio: "2025-01-01T00:00:00.000Z",
      dataScadenza: "2030-01-01T00:00:00.000Z",
      tipologiaBene: "SYNTHETIC_ASSET",
      attivita: "SYNTHETIC_ACTIVITY",
      ubicazione: "AREA TEST SINTETICA",
      canoneAnnuo: "100.00",
      categoriaCanone: "SYNTHETIC_CATEGORY",
    },
    concessionario: {
      id: "SYNTHETIC-CONCESSIONARIO-001",
      denominazione: "CONCESSIONARIO TEST SINTETICO",
    },
    requirements: [{
      id: "SYNTHETIC-REQUIREMENT-001",
      status: "SYNTHETIC_RECORDED",
      screeningFingerprint: "synthetic-fingerprint-001",
      matcherAlgorithmVersion: "synthetic-v1",
      sourceStableKeySnapshot: "SYNTHETIC-SOURCE-001",
      sourceTitleSnapshot: "Fonte test sintetica",
      ruleCodeSnapshot: "SYNTHETIC-RULE-001",
      ruleContractVersionSnapshot: "1",
      gapKeySnapshot: "SYNTHETIC-GAP-001",
      gapLabelSnapshot: "Verifica tecnica sintetica",
      gapDescriptionSnapshot: "Requisito neutro per smoke tecnico.",
      createdAt: "2026-01-10T10:00:00.000Z",
      createdByActorId: "SYNTHETIC-ACTOR-001",
      createdByRole: "SYNTHETIC_ROLE",
      reviewedAt: null,
      reviewedByActorId: null,
      reviewedByRole: null,
      reviewNote: null,
    }],
    evidence: [{
      id: "SYNTHETIC-EVIDENCE-001",
      proposalId: "SYNTHETIC-REQUIREMENT-001",
      documentoId: "SYNTHETIC-DOCUMENT-001",
      createdAt: "2026-01-10T11:00:00.000Z",
      createdByActorId: "SYNTHETIC-ACTOR-001",
      createdByRole: "SYNTHETIC_ROLE",
      revokedAt: null,
      revokedByActorId: null,
      revokedByRole: null,
      revocationNote: null,
    }],
    humanReviewReceipts: [],
    checklist: {
      checklistProfile: "SYNTHETIC_CORE",
      checklistContraddittorioCompleta: false,
      checklistCompletedItems: 0,
      checklistTotalItems: 1,
      checklistPercentage: 0,
      checklistMissingItems: ["Voce test sintetica"],
      checklistWarningLevel: "default",
      noteChecklistContraddittorio: null,
      evidence: [],
    },
    fascicoloObservations: [{
      id: "SYNTHETIC-OBSERVATION-001",
      documentoId: "SYNTHETIC-DOCUMENT-001",
      status: "SYNTHETIC_RECORDED",
      ruleCode: "SYNTHETIC-OBS-RULE-001",
      ruleVersion: 1,
      detectedAt: "2026-01-10T12:00:00.000Z",
      reviewedAt: null,
      reviewNote: null,
      currentConditionDetected: true,
      text: "Osservazione tecnica neutra e sintetica.",
      disclaimer: "Dato esclusivamente sintetico per verifica tecnica.",
    }],
    documents: [{
      id: "SYNTHETIC-DOCUMENT-001",
      nome: "DOCUMENTO-SINTETICO.pdf",
      tipologia: "SYNTHETIC_DOCUMENT",
      statoDocumento: "SYNTHETIC_RECORDED",
      dataDocumento: "2026-01-09T00:00:00.000Z",
      createdAt: "2026-01-10T08:00:00.000Z",
    }],
    criticita: { coverage: "SELECTED", items: [] },
    pagamenti: { coverage: "SELECTED", items: [] },
    scadenze: {
      coverage: "SELECTED",
      items: [{
        id: "SYNTHETIC-DEADLINE-001",
        tipologia: "SYNTHETIC_REMINDER",
        stato: "SYNTHETIC_RECORDED",
        dataScadenza: "2026-02-01T00:00:00.000Z",
        descrizione: "Promemoria test sintetico.",
      }],
    },
    sopralluoghi: { coverage: "SELECTED", items: [] },
    finalActContext: null,
  } as unknown as TrustedSnapshot["content"];

  const contentHash = createHash("sha256")
    .update(stableSerialize({ schemaVersion: SYNTHETIC_SNAPSHOT_SCHEMA_VERSION, content }))
    .digest("hex");

  return {
    content,
    metadata: {
      schemaVersion: SYNTHETIC_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: "2026-01-15T00:00:00.000Z",
      generatedByActorId: "SYNTHETIC-ACTOR-001",
      generatedByRole: "ADMIN",
      contentHashAlgorithm: "sha256",
      contentHash,
    },
  };
}

function collectPropertyNames(value: unknown, names = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") {
    return names;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPropertyNames(item, names);
    }
    return names;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    names.add(key);
    collectPropertyNames(item, names);
  }
  return names;
}

function validateTrustedResult(
  snapshot: TrustedSnapshot,
  analysis: Awaited<ReturnType<typeof analyzeFascicoloSnapshotV1>>,
  providerCalls: number,
): void {
  if (providerCalls !== 1) {
    throw new Error("UNEXPECTED_SMOKE_FAILURE");
  }
  if (
    analysis.schemaVersion !== AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION
    || analysis.snapshotSchemaVersion !== SYNTHETIC_SNAPSHOT_SCHEMA_VERSION
    || analysis.snapshotContentHash !== snapshot.metadata.contentHash
    || analysis.limitations.length !== AI_FASCICOLO_ANALYSIS_V1_LIMITATIONS.length
  ) {
    throw new Error("UNEXPECTED_SMOKE_FAILURE");
  }
  const limitationCodes = new Set(analysis.limitations.map((item) => item.code));
  for (const requiredCode of [
    "DOCUMENT_CONTENT_NOT_EXAMINED",
    "NON_BINDING_HUMAN_VERIFICATION_REQUIRED",
    "NO_ADMINISTRATIVE_DECISION_OR_LEGAL_EFFECT",
  ]) {
    if (!limitationCodes.has(requiredCode as never)) {
      throw new Error("UNEXPECTED_SMOKE_FAILURE");
    }
  }
  const keys = collectPropertyNames(analysis);
  for (const forbidden of [
    "approved",
    "approval",
    "validity",
    "sufficiency",
    "compliance",
    "proceduralReadiness",
    "decision",
    "finalDecision",
  ]) {
    if (keys.has(forbidden)) {
      throw new Error("UNEXPECTED_SMOKE_FAILURE");
    }
  }
}

function failureCategory(error: unknown): SyntheticSmokeFailure["summary"]["errorCategory"] {
  if (error instanceof SmokeConfigurationError) {
    return "AI_CONFIGURATION_ERROR";
  }
  if (error instanceof AiProviderAdapterError) {
    switch (error.category) {
      case "CONFIGURATION":
        return "AI_CONFIGURATION_ERROR";
      case "TIMEOUT":
        return "AI_PROVIDER_TIMEOUT";
      case "RATE_LIMITED":
        return "AI_PROVIDER_RATE_LIMITED";
      case "UNAVAILABLE":
        return "AI_PROVIDER_UNAVAILABLE";
    }
  }
  if (error instanceof AiFascicoloAnalysisError && error.code === "INVALID_PROVIDER_OUTPUT") {
    return "INVALID_PROVIDER_OUTPUT";
  }
  return "UNEXPECTED_SMOKE_FAILURE";
}

export async function runOpenAiSyntheticSmoke(options: {
  env?: SmokeEnv;
  transport?: OpenAiFetch;
  providerFactory?: ProviderFactory;
  now?: () => number;
} = {}): Promise<SyntheticSmokeResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    const config = parseSmokeConfig(options.env ?? process.env as unknown as SmokeEnv);
    const snapshot = createSyntheticFascicoloSnapshot();
    const serializedSnapshotBytes = Buffer.byteLength(JSON.stringify(snapshot.content), "utf8");
    if (serializedSnapshotBytes > config.maxInputBytes) {
      throw new SmokeConfigurationError("AI_MAX_INPUT_BYTES");
    }
    const provider = (options.providerFactory ?? createOpenAiAnalysisProvider)({
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      maxRawResponseBytes: config.maxRawResponseBytes,
      maxOutputTokens: config.maxOutputTokens,
      region: config.region,
      ...(options.transport ? { transport: options.transport } : {}),
    });
    let providerCalls = 0;
    const countedProvider: AiAnalysisProvider = {
      async analyze(request) {
        providerCalls += 1;
        if (providerCalls > 1) {
          throw new Error("UNEXPECTED_SMOKE_FAILURE");
        }
        return provider.analyze(request);
      },
    };
    const analysis = await analyzeFascicoloSnapshotV1({ snapshot, provider: countedProvider });
    validateTrustedResult(snapshot, analysis, providerCalls);
    return {
      ok: true,
      exitCode: 0,
      summary: {
        SMOKE_STATUS: "PASS",
        provider: PROVIDER_NAME,
        model: OPENAI_ANALYSIS_MODEL,
        region: config.region,
        snapshotSchemaVersion: SYNTHETIC_SNAPSHOT_SCHEMA_VERSION,
        snapshotContentHash: snapshot.metadata.contentHash,
        analysisSchemaVersion: AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
        summaryItems: 1,
        timelineItems: analysis.analysis.timeline.length,
        signalItems: analysis.analysis.signals.length,
        questionItems:
          analysis.analysis.investigativeQuestions.length + analysis.analysis.legalResearchQuestions.length,
        activityItems: analysis.analysis.suggestedActivities.length,
        mandatoryLimitationsCount: analysis.limitations.length,
        elapsedMs: Math.max(0, now() - startedAt),
        FORBIDDEN_STRUCTURAL_FIELDS_PRESENT: "NO",
      },
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      summary: {
        SMOKE_STATUS: "FAIL",
        errorCategory: failureCategory(error),
      },
    };
  }
}

export function formatSyntheticSmokeResult(result: SyntheticSmokeResult): string {
  return Object.entries(result.summary)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
}

async function runCli(): Promise<void> {
  const result = await runOpenAiSyntheticSmoke();
  process.stdout.write(`${formatSyntheticSmokeResult(result)}\n`);
  process.exitCode = result.exitCode;
}

const directlyInvoked = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (directlyInvoked) {
  void runCli();
}
