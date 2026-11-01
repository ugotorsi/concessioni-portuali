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
  activeBudgetPolicyScopes?: readonly string[];
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
  const aiExecutionRequested = [
    "AI_REAL_DATA_ENABLED",
    "ASYNC_PROVIDER_EXECUTION_ENABLED",
    "AUTOMATIC_RESEARCH_EXECUTION_ENABLED",
    "AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED",
  ].some((name) => environment[name]?.trim().toLowerCase() === "true");
  const globalBudgetConfigured = input.activeBudgetPolicyScopes?.includes("GLOBAL") ?? false;
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
  const automaticResearchEnabled =
    environment.AUTOMATIC_RESEARCH_EXECUTION_ENABLED?.trim().toLowerCase() === "true";
  const mcpProductionEnabled =
    environment.MCP_PRODUCTION_ENABLED?.trim().toLowerCase() === "true";
  const connectorStates = [
    {
      name: "WorkOS MCP",
      configured: configured(environment, ["WORKOS_API_KEY"]),
      required: mcpProductionEnabled,
    },
    {
      name: "Legal Data Hunter",
      configured: configured(environment, ["LEGAL_DATA_HUNTER_API_KEY"]),
      required: automaticResearchEnabled,
    },
    {
      name: "Moonlit OAuth",
      configured: configured(environment, ["MOONLIT_OAUTH_STORAGE_PATH"]),
      required: automaticResearchEnabled,
    },
    {
      name: "Simpliciter OAuth",
      configured: configured(environment, ["SIMPLICITER_OAUTH_STORAGE_PATH"]),
      required: automaticResearchEnabled,
    },
    {
      name: "Rate limit condiviso",
      configured: environment.RATE_LIMIT_BACKEND !== "redis"
        || configured(environment, ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])
        || configured(environment, ["KV_REST_API_URL", "KV_REST_API_TOKEN"]),
      required: true,
    },
  ];
  const missingRequiredConnectors = connectorStates
    .filter((connector) => connector.required && !connector.configured)
    .map((connector) => connector.name);
  const unavailableOptionalConnectors = connectorStates
    .filter((connector) => !connector.required && !connector.configured)
    .map((connector) => connector.name);

  const services: ServiceCenterItem[] = [
    {
      id: "ai",
      name: "AI e budget",
      status: aiExecutionRequested
        ? aiConfigured && globalBudgetConfigured ? "STANDBY" : "NOT_CONFIGURED"
        : "STANDBY",
      severity: aiExecutionRequested && (!aiConfigured || !globalBudgetConfigured)
        ? "BLOCKING"
        : "INFORMATION",
      summary: !aiExecutionRequested
        ? "Esecuzione provider intenzionalmente disabilitata dai gate ambientali."
        : !aiConfigured
          ? "Credenziale provider AI mancante."
          : !globalBudgetConfigured
            ? "Provider configurato, ma manca il limite di spesa globale obbligatorio."
            : "Provider e limite globale configurati; restano applicabili i budget tenant e fascicolo.",
      metrics: [
        { label: "Costo effettivo 30 giorni", value: eur(input.costs.actualLast30DaysEur) },
        { label: "Riservato", value: eur(input.costs.reservedEur) },
        { label: "Proiezione a 30 giorni", value: eur(projectedMonthlyEur) },
        { label: "Gate provider", value: aiExecutionRequested ? "Richiesto" : "Disabilitato" },
        { label: "Budget globale", value: globalBudgetConfigured ? "Configurato" : "Assente" },
      ],
      alerts: [
        ...(!aiConfigured && aiExecutionRequested
          ? ["Configurare AI_OPENAI_API_KEY prima di autorizzare elaborazioni reali."]
          : []),
        ...(!globalBudgetConfigured && aiExecutionRequested
          ? ["Creare un limite di spesa globale prima di abilitare chiamate provider."]
          : []),
        "Crediti, rinnovi e pagamenti del provider non sono esposti da un'integrazione billing autorizzata.",
      ],
      guidedAction: aiExecutionRequested
        ? "Completare credenziale e budget mancanti, quindi verificare il provider senza generare contenuti."
        : "Per attivare il provider servono autorizzazione di spesa, budget, credenziale e una nuova configurazione deployment.",
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
      status: input.databaseIdentity.databaseConnected
        ? input.databaseIdentity.outcome === "MISMATCH" ? "ATTENTION" : "OPERATIVE"
        : "ATTENTION",
      severity: !input.databaseIdentity.databaseConnected
        || input.databaseIdentity.outcome === "MISMATCH"
        ? "BLOCKING"
        : "INFORMATION",
      summary: !input.databaseIdentity.databaseConnected
        ? "Connessione PostgreSQL non riuscita."
        : input.databaseIdentity.outcome === "MISMATCH"
          ? "Database raggiungibile, ma diverso dall'identità attesa configurata."
          : input.databaseIdentity.outcome === "MATCH"
            ? "Database raggiungibile e coerente con l'identità attesa."
            : "Database raggiungibile; identità Neon rilevata senza un confronto atteso completo.",
      metrics: [
        { label: "Progetto", value: input.databaseIdentity.neonProjectId ?? "Non rilevato" },
        { label: "Branch", value: input.databaseIdentity.neonBranchId ?? "Non rilevato" },
      ],
      alerts: ["Consumi compute/storage, rinnovi e pagamenti Neon non sono esposti dalla connessione PostgreSQL."],
      guidedAction: input.databaseIdentity.databaseConnected
        ? "Configurare aspettative esplicite o una Neon API in sola lettura solo se serve verificare identità, quote e consumi."
        : "Verificare DATABASE_URL e raggiungibilità PostgreSQL.",
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
      status: missingRequiredConnectors.length
        ? "ATTENTION"
        : unavailableOptionalConnectors.length ? "STANDBY" : "OPERATIVE",
      severity: missingRequiredConnectors.length ? "BLOCKING" : "INFORMATION",
      summary: missingRequiredConnectors.length
        ? `Integrazioni richieste dai gate ma non configurate: ${missingRequiredConnectors.join(", ")}.`
        : unavailableOptionalConnectors.length
          ? `Connettori opzionali non attivi: ${unavailableOptionalConnectors.join(", ")}.`
          : "Connettori applicativi configurati.",
      metrics: [
        { label: "Configurati", value: String(connectorStates.filter((connector) => connector.configured).length) },
        { label: "Richiesti mancanti", value: String(missingRequiredConnectors.length) },
        { label: "Opzionali inattivi", value: String(unavailableOptionalConnectors.length) },
      ],
      alerts: missingRequiredConnectors.map((name) => `${name}: configurazione richiesta dal gate attivo ma non disponibile.`),
      guidedAction: missingRequiredConnectors.length
        ? "Configurare soltanto le integrazioni richieste dai gate già autorizzati."
        : null,
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
