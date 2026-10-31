import type { DatabaseIdentityDiagnostic } from "@/server/runtime/databaseIdentity";
import type { RuntimeHealthSnapshot } from "@/server/runtime/health";

export type ServiceCenterSeverity = "INFORMATION" | "ACTION_REQUIRED" | "BLOCKING";
export type ServiceCenterStatus = "OPERATIVE" | "STANDBY" | "ATTENTION" | "NOT_CONFIGURED";

export interface ServiceCenterItem {
  id: "ai" | "render" | "vercel" | "neon" | "r2" | "connectors";
  name: string;
  status: ServiceCenterStatus;
  severity: ServiceCenterSeverity;
  summary: string;
  metrics: readonly { label: string; value: string }[];
  alerts: readonly string[];
  guidedAction: string | null;
  controllable: boolean;
  dataSource: string;
}

export interface ServiceCenterSnapshot {
  generatedAt: Date;
  services: readonly ServiceCenterItem[];
  blockingCount: number;
  actionRequiredCount: number;
}

export interface ServiceCenterCostInput {
  actualLast30DaysEur: number;
  actualLast7DaysEur: number;
  reservedEur: number;
}

interface ServiceCenterInput {
  environment?: Readonly<Record<string, string | undefined>>;
  health: RuntimeHealthSnapshot;
  databaseIdentity: DatabaseIdentityDiagnostic;
  costs: ServiceCenterCostInput;
  now?: Date;
}

function configured(environment: Readonly<Record<string, string | undefined>>, names: readonly string[]): boolean {
  return names.every((name) => Boolean(environment[name]?.trim()));
}

function eur(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function buildServiceCenterSnapshot(input: ServiceCenterInput): ServiceCenterSnapshot {
  const environment = input.environment ?? process.env;
  const projectedMonthlyEur = input.costs.actualLast7DaysEur / 7 * 30;
  const aiConfigured = configured(environment, ["AI_OPENAI_API_KEY"]);
  const renderConfigured = configured(environment, [
    "RENDER_APPLICATION_WORKER_SERVICE_ID",
    "RENDER_WORKER_API_KEY",
  ]);
  const vercelConfigured = configured(environment, ["VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_ID"]);
  const r2Configured = environment.DOCUMENT_STORAGE_BACKEND === "s3"
    && configured(environment, [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ]);
  const connectorStates = [
    { name: "WorkOS", configured: configured(environment, ["WORKOS_API_KEY"]) },
    { name: "Legal Data Hunter", configured: configured(environment, ["LEGAL_DATA_HUNTER_API_KEY"]) },
    {
      name: "Rate limit condiviso",
      configured: environment.RATE_LIMIT_BACKEND !== "redis"
        || configured(environment, ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])
        || configured(environment, ["KV_REST_API_URL", "KV_REST_API_TOKEN"]),
    },
  ];
  const missingConnectors = connectorStates.filter((connector) => !connector.configured).map((connector) => connector.name);

  const services: ServiceCenterItem[] = [
    {
      id: "ai",
      name: "AI e budget",
      status: aiConfigured ? "STANDBY" : "NOT_CONFIGURED",
      severity: aiConfigured ? "INFORMATION" : "BLOCKING",
      summary: aiConfigured
        ? "Provider configurato; l'operatività resta subordinata ai gate e ai budget."
        : "Credenziale provider AI mancante.",
      metrics: [
        { label: "Costo effettivo 30 giorni", value: eur(input.costs.actualLast30DaysEur) },
        { label: "Riservato", value: eur(input.costs.reservedEur) },
        { label: "Proiezione a 30 giorni", value: eur(projectedMonthlyEur) },
      ],
      alerts: aiConfigured
        ? ["Crediti, rinnovi e pagamenti del provider non sono esposti da un'integrazione billing autorizzata."]
        : ["Configurare AI_OPENAI_API_KEY prima di autorizzare elaborazioni reali."],
      guidedAction: aiConfigured
        ? "Verificare crediti e fatturazione nel portale provider prima di riattivare i gate."
        : "Aggiungere la credenziale nel secret store dell'ambiente corretto.",
      controllable: true,
      dataSource: "Contabilità runtime NOETRA e configurazione ambiente",
    },
    {
      id: "render",
      name: "Render worker",
      status: renderConfigured
        ? input.health.queueDepth > 0 && input.health.activeWorkers === 0 ? "ATTENTION" : "STANDBY"
        : "NOT_CONFIGURED",
      severity: !renderConfigured || (input.health.queueDepth > 0 && input.health.activeWorkers === 0)
        ? "BLOCKING"
        : "INFORMATION",
      summary: renderConfigured
        ? "Controllo API autorizzato disponibile; nessun acquisto o upgrade può essere eseguito."
        : "Integrazione API Render incompleta.",
      metrics: [
        { label: "Worker attivi", value: String(input.health.activeWorkers) },
        { label: "Job in attesa", value: String(input.health.queueDepth) },
      ],
      alerts: renderConfigured
        ? ["Quote, rinnovi e pagamenti Render non sono disponibili tramite l'integrazione operativa configurata."]
        : ["Configurare service ID e API key Render per controllare il worker."],
      guidedAction: renderConfigured ? null : "Configurare RENDER_APPLICATION_WORKER_SERVICE_ID e RENDER_WORKER_API_KEY.",
      controllable: renderConfigured,
      dataSource: "Heartbeat NOETRA e configurazione Render",
    },
    {
      id: "vercel",
      name: "Vercel Preview",
      status: vercelConfigured ? "OPERATIVE" : "NOT_CONFIGURED",
      severity: vercelConfigured ? "INFORMATION" : "BLOCKING",
      summary: vercelConfigured
        ? `Ambiente ${environment.VERCEL_ENV} sul progetto ${environment.VERCEL_PROJECT_ID}.`
        : "Identità deployment Vercel non disponibile.",
      metrics: [
        { label: "Ambiente", value: environment.VERCEL_ENV ?? "Non rilevato" },
        { label: "Commit", value: environment.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "Non rilevato" },
      ],
      alerts: ["Quote, rinnovi e pagamenti Vercel richiedono un'integrazione billing separata o un controllo guidato nel portale."],
      guidedAction: vercelConfigured ? "Controllare Usage e Billing nel progetto Vercel prima del rilascio Production." : "Distribuire dal progetto Vercel esplicitamente autorizzato.",
      controllable: false,
      dataSource: "Metadati immutabili del deployment Vercel",
    },
    {
      id: "neon",
      name: "Neon PostgreSQL",
      status: input.databaseIdentity.outcome === "MATCH" ? "OPERATIVE" : "ATTENTION",
      severity: input.databaseIdentity.outcome === "MATCH" ? "INFORMATION" : "BLOCKING",
      summary: input.databaseIdentity.outcome === "MATCH"
        ? "Database Preview verificato e coerente con l'identità attesa."
        : "Identità o raggiungibilità database non verificata.",
      metrics: [
        { label: "Progetto", value: input.databaseIdentity.neonProjectId ?? "Non rilevato" },
        { label: "Branch", value: input.databaseIdentity.neonBranchId ?? "Non rilevato" },
      ],
      alerts: ["Consumi compute/storage, rinnovi e pagamenti Neon non sono esposti dalla connessione PostgreSQL."],
      guidedAction: "Configurare un'integrazione Neon API in sola lettura per quote e consumi, se autorizzata.",
      controllable: false,
      dataSource: "Identità della connessione PostgreSQL attiva",
    },
    {
      id: "r2",
      name: "Cloudflare R2 / storage documentale",
      status: r2Configured ? "OPERATIVE" : "NOT_CONFIGURED",
      severity: r2Configured ? "INFORMATION" : "BLOCKING",
      summary: r2Configured ? "Storage S3-compatible configurato." : "Storage persistente S3/R2 incompleto.",
      metrics: [
        { label: "Backend", value: environment.DOCUMENT_STORAGE_BACKEND ?? "Non configurato" },
        { label: "Bucket", value: environment.S3_BUCKET ?? "Non rilevato" },
      ],
      alerts: r2Configured
        ? ["Consumi e quote R2 non sono disponibili senza una Cloudflare Analytics API autorizzata."]
        : ["I documenti non devono dipendere da storage locale effimero in produzione."],
      guidedAction: r2Configured
        ? "Aggiungere una credenziale Analytics in sola lettura per monitorare capacità e operazioni."
        : "Configurare endpoint, regione, bucket e credenziali R2 nel secret store.",
      controllable: false,
      dataSource: "Configurazione storage NOETRA",
    },
    {
      id: "connectors",
      name: "Connettori e servizi collegati",
      status: missingConnectors.length ? "ATTENTION" : "OPERATIVE",
      severity: missingConnectors.length ? "ACTION_REQUIRED" : "INFORMATION",
      summary: missingConnectors.length
        ? `Integrazioni non configurate: ${missingConnectors.join(", ")}.`
        : "Connettori applicativi configurati.",
      metrics: [
        { label: "Configurati", value: String(connectorStates.length - missingConnectors.length) },
        { label: "Da integrare", value: String(missingConnectors.length) },
      ],
      alerts: missingConnectors.map((name) => `${name}: API o credenziale non disponibile.`),
      guidedAction: missingConnectors.length ? "Aggiungere soltanto le integrazioni necessarie e autorizzate per l'ambiente." : null,
      controllable: false,
      dataSource: "Configurazione connettori NOETRA",
    },
  ];

  return {
    generatedAt: input.now ?? new Date(),
    services,
    blockingCount: services.filter((service) => service.severity === "BLOCKING").length,
    actionRequiredCount: services.filter((service) => service.severity === "ACTION_REQUIRED").length,
  };
}
