import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { getS3StorageConfig } from "@/server/documents/storage/config";
import { verifyAutomaticResearchConnectorReadiness } from "@/server/legal-research/automatic-research-readiness";
import { isTechnicalSourcesChannelEnabled } from "@/server/technical-sources/technical-sources-m2m";

export const RUNTIME_DIAGNOSTIC_SERVICE_IDS = [
  "ai",
  "render-application",
  "render-ocr",
  "r2",
  "connectors",
] as const;

export type RuntimeDiagnosticServiceId =
  (typeof RUNTIME_DIAGNOSTIC_SERVICE_IDS)[number];
export type RuntimeDiagnosticStatus =
  | "READY"
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "ATTENTION"
  | "UNREACHABLE";

export interface RuntimeServiceDiagnostic {
  id: RuntimeDiagnosticServiceId;
  status: RuntimeDiagnosticStatus;
  code: string;
  summary: string;
  metrics: readonly { label: string; value: string }[];
}

export interface RuntimeServiceDiagnostics {
  checkedAt: Date;
  services: readonly RuntimeServiceDiagnostic[];
}

interface DiagnosticDependencies {
  fetch?: typeof fetch;
  probeR2?: () => Promise<void>;
  verifyResearchConnectors?: typeof verifyAutomaticResearchConnectorReadiness;
}

function configured(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): boolean {
  return names.every((name) => Boolean(environment[name]?.trim()));
}

function result(
  id: RuntimeDiagnosticServiceId,
  status: RuntimeDiagnosticStatus,
  code: string,
  summary: string,
  metrics: RuntimeServiceDiagnostic["metrics"] = [],
): RuntimeServiceDiagnostic {
  return { id, status, code, summary, metrics };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
}

async function diagnoseAi(
  environment: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch,
): Promise<RuntimeServiceDiagnostic> {
  const key = environment.AI_OPENAI_API_KEY?.trim();
  if (!key) {
    return result("ai", "NOT_CONFIGURED", "AI_CREDENTIAL_MISSING", "Credenziale OpenAI assente.");
  }
  try {
    const response = await fetchWithTimeout(fetchImpl, "https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.ok) {
      return result("ai", "READY", "AI_CREDENTIAL_VERIFIED", "Credenziale provider verificata senza generare contenuti.");
    }
    return result(
      "ai",
      response.status === 401 || response.status === 403 ? "ATTENTION" : "UNREACHABLE",
      `AI_PROVIDER_HTTP_${response.status}`,
      "Il provider ha rifiutato o non ha completato la diagnostica.",
      [{ label: "HTTP", value: String(response.status) }],
    );
  } catch (error) {
    return result(
      "ai",
      "UNREACHABLE",
      error instanceof Error && error.name === "TimeoutError"
        ? "AI_PROVIDER_TIMEOUT"
        : "AI_PROVIDER_UNREACHABLE",
      "Provider AI non raggiungibile entro il timeout diagnostico.",
    );
  }
}

async function diagnoseRender(
  id: "render-application" | "render-ocr",
  serviceId: string | undefined,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<RuntimeServiceDiagnostic> {
  const normalizedServiceId = serviceId?.trim();
  const normalizedApiKey = apiKey?.trim();
  if (!normalizedServiceId || !normalizedApiKey) {
    return result(id, "NOT_CONFIGURED", "RENDER_CONFIGURATION_MISSING", "Service ID o API key Render assente.");
  }
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `https://api.render.com/v1/services/${normalizedServiceId}`,
      { headers: { Authorization: `Bearer ${normalizedApiKey}` } },
    );
    if (!response.ok) {
      return result(
        id,
        response.status === 401 || response.status === 403 || response.status === 404
          ? "ATTENTION"
          : "UNREACHABLE",
        `RENDER_HTTP_${response.status}`,
        "Render non ha confermato il servizio configurato.",
        [{ label: "HTTP", value: String(response.status) }],
      );
    }
    const body = await response.json() as {
      id?: unknown;
      name?: unknown;
      type?: unknown;
      suspended?: unknown;
      service?: {
        id?: unknown;
        name?: unknown;
        type?: unknown;
        suspended?: unknown;
        serviceDetails?: {
          envSpecificDetails?: {
            startCommand?: unknown;
          };
        };
      };
      serviceDetails?: {
        envSpecificDetails?: {
          startCommand?: unknown;
        };
      };
    };
    const service = body.service ?? body;
    const suspended = typeof service.suspended === "string"
      ? service.suspended
      : service.suspended === true ? "suspended" : "not_suspended";
    const startCommand = typeof service.serviceDetails?.envSpecificDetails?.startCommand === "string"
      ? service.serviceDetails.envSpecificDetails.startCommand.trim()
      : "";
    const isSuspended = suspended !== "not_suspended";
    const expectedStartCommand = id === "render-application"
      ? "npm run worker:async"
      : "sleep infinity";
    const commandMatches = startCommand === expectedStartCommand;
    const ready = id === "render-application"
      ? !isSuspended && commandMatches
      : isSuspended && commandMatches;
    const code = !commandMatches
      ? "RENDER_START_COMMAND_MISMATCH"
      : id === "render-application"
        ? ready ? "RENDER_APPLICATION_WORKER_READY" : "RENDER_APPLICATION_WORKER_SUSPENDED"
        : ready ? "RENDER_OCR_TEMPLATE_READY" : "RENDER_OCR_TEMPLATE_RUNNING";
    const summary = !commandMatches
      ? `Il comando Render non corrisponde al ruolo previsto (${expectedStartCommand}).`
      : id === "render-application"
        ? ready
          ? "Worker applicativo persistente raggiungibile e operativo."
          : "Worker applicativo configurato correttamente ma sospeso."
        : ready
          ? "Template OCR one-off raggiungibile e correttamente sospeso."
          : "Il template OCR one-off è attivo senza necessità e può generare costi.";
    return result(
      id,
      ready ? "READY" : "ATTENTION",
      code,
      summary,
      [
        { label: "Nome", value: typeof service.name === "string" ? service.name : "Non esposto" },
        { label: "Tipo", value: typeof service.type === "string" ? service.type : "Non esposto" },
        { label: "Sospensione", value: suspended },
        { label: "Comando", value: startCommand || "Non esposto" },
      ],
    );
  } catch (error) {
    return result(
      id,
      "UNREACHABLE",
      error instanceof Error && error.name === "TimeoutError"
        ? "RENDER_TIMEOUT"
        : "RENDER_UNREACHABLE",
      "API Render non raggiungibile entro il timeout diagnostico.",
    );
  }
}

async function defaultR2Probe(): Promise<void> {
  const config = getS3StorageConfig();
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
}

async function diagnoseR2(
  environment: Readonly<Record<string, string | undefined>>,
  probeR2: () => Promise<void>,
): Promise<RuntimeServiceDiagnostic> {
  if (
    environment.DOCUMENT_STORAGE_BACKEND !== "s3"
    || !configured(environment, [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ])
  ) {
    return result("r2", "NOT_CONFIGURED", "R2_CONFIGURATION_MISSING", "Configurazione R2 incompleta.");
  }
  try {
    await probeR2();
    return result(
      "r2",
      "READY",
      "R2_BUCKET_REACHABLE",
      "Bucket R2 raggiungibile con una verifica non distruttiva.",
      [{ label: "Bucket", value: environment.S3_BUCKET!.trim() }],
    );
  } catch {
    return result(
      "r2",
      "UNREACHABLE",
      "R2_BUCKET_UNREACHABLE",
      "Il bucket configurato non ha superato la verifica non distruttiva.",
      [{ label: "Bucket", value: environment.S3_BUCKET!.trim() }],
    );
  }
}

async function diagnoseConnectors(
  environment: Readonly<Record<string, string | undefined>>,
  verifyResearchConnectors: typeof verifyAutomaticResearchConnectorReadiness,
): Promise<RuntimeServiceDiagnostic> {
  const automaticResearchEnabled =
    environment.AUTOMATIC_RESEARCH_EXECUTION_ENABLED?.trim().toLowerCase() === "true";
  const mcpEnabled =
    environment.MCP_PRODUCTION_ENABLED?.trim().toLowerCase() === "true";
  const technicalSourcesRequested =
    environment.TECHNICAL_SOURCES_MCP_ENABLED?.trim().toLowerCase() === "true";
  const technicalSourcesEnabled = isTechnicalSourcesChannelEnabled(environment);
  if (!automaticResearchEnabled && !mcpEnabled && !technicalSourcesEnabled) {
    return result(
      "connectors",
      "DISABLED",
      "CONNECTORS_OPTIONAL_DISABLED",
      "Nessun canale esterno opzionale è abilitato dai gate.",
    );
  }

  const research = automaticResearchEnabled
    ? await verifyResearchConnectors(environment)
    : null;
  const workosReady = !mcpEnabled || configured(environment, ["WORKOS_API_KEY"]);
  const ready = (research?.ready ?? true)
    && workosReady
    && (!technicalSourcesRequested || technicalSourcesEnabled);
  return result(
    "connectors",
    ready ? "READY" : "ATTENTION",
    ready ? "CONNECTORS_READY" : "CONNECTORS_INCOMPLETE",
    ready
      ? "I connettori richiesti dai gate attivi risultano configurati."
      : "Uno o più connettori richiesti dai gate attivi non sono configurati.",
    [
      { label: "Ricerca automatica", value: research ? (research.ready ? "Pronta" : "Incompleta") : "Disabilitata" },
      { label: "MCP WorkOS", value: mcpEnabled ? (workosReady ? "Configurato" : "Incompleto") : "Disabilitato" },
      { label: "Fonti tecniche", value: technicalSourcesEnabled ? "Configurate" : "Disabilitate" },
    ],
  );
}

export async function getRuntimeServiceDiagnostics(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: DiagnosticDependencies = {},
): Promise<RuntimeServiceDiagnostics> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const [ai, renderApplication, renderOcr, r2, connectors] = await Promise.all([
    diagnoseAi(environment, fetchImpl),
    diagnoseRender(
      "render-application",
      environment.RENDER_APPLICATION_WORKER_SERVICE_ID,
      environment.RENDER_WORKER_API_KEY,
      fetchImpl,
    ),
    diagnoseRender(
      "render-ocr",
      environment.RENDER_DOCUMENT_OCR_WORKER_SERVICE_ID,
      environment.RENDER_WORKER_API_KEY,
      fetchImpl,
    ),
    diagnoseR2(environment, dependencies.probeR2 ?? defaultR2Probe),
    diagnoseConnectors(
      environment,
      dependencies.verifyResearchConnectors ?? verifyAutomaticResearchConnectorReadiness,
    ),
  ]);
  return {
    checkedAt: new Date(),
    services: [ai, renderApplication, renderOcr, r2, connectors],
  };
}
