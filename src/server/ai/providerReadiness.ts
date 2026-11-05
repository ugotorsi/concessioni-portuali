import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AI_MODEL_CATALOG,
  getAiModelCatalogEntry,
  type AiModelSelection,
  type AiProviderId,
} from "@/server/ai/providerCatalog";
import {
  AI_AUTOMATIC_WORKFLOW,
  getAiProviderControlSnapshot,
  type AiProviderControlSnapshot,
} from "@/server/ai/providerControl";

export const AI_PROVIDER_CONNECTION_VERIFICATION_ACTION =
  "AI_PROVIDER_CONNECTION_VERIFICATION";
export const AI_PROVIDER_CONNECTION_ENTITY = "AiProviderConnection";

const providerEnvironment = {
  OPENAI: {
    credentialName: "AI_OPENAI_API_KEY",
    estimateName: "ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR",
  },
  ANTHROPIC: {
    credentialName: "AI_ANTHROPIC_API_KEY",
    estimateName: "ASYNC_COST_ANTHROPIC_ANALYSIS_ESTIMATE_EUR",
  },
  DEEPSEEK: {
    credentialName: "AI_DEEPSEEK_API_KEY",
    estimateName: "ASYNC_COST_DEEPSEEK_ANALYSIS_ESTIMATE_EUR",
  },
} as const satisfies Record<AiProviderId, {
  credentialName: string;
  estimateName: string;
}>;

export type AiProviderConnectionVerificationStatus =
  | "VERIFIED"
  | "FAILED"
  | "NOT_VERIFIED";

export interface AiProviderReadiness {
  readonly provider: AiProviderId;
  readonly label: string;
  readonly model: string;
  readonly credentialEnvironmentName: string;
  readonly credentialConfigured: boolean;
  readonly connectionStatus: AiProviderConnectionVerificationStatus;
  readonly lastVerifiedAt: Date | null;
  readonly realDataAuthorized: boolean;
  readonly manualEnabled: boolean;
  readonly manualEligible: boolean;
  readonly automaticSelected: boolean;
  readonly automaticEligible: boolean;
  readonly globalAiEnabled: boolean;
  readonly generalAutomationEnabled: boolean;
  readonly operational: boolean;
  readonly estimatedCostLimitEur: number | null;
  readonly pricingVersion: string | null;
  readonly billingApproval: "INTERNAL_LIMIT_CONFIGURED" | "NOT_APPROVED";
  readonly status: "READY" | "DISABLED" | "BLOCKED" | "ATTENTION";
  readonly error: string | null;
}

function metadataRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function configuredSecret(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "[SENSITIVE]");
}

function positiveAmount(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function getAiProviderReadiness(input: {
  readonly globalAiEnabled: boolean;
  readonly generalAutomationEnabled: boolean;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly control?: AiProviderControlSnapshot;
}): Promise<readonly AiProviderReadiness[]> {
  const environment = input.environment ?? process.env;
  const control = input.control ?? await getAiProviderControlSnapshot();
  const latestVerifications = await prisma.activityLog.findMany({
    where: {
      azione: AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
      entita: AI_PROVIDER_CONNECTION_ENTITY,
      entitaId: { in: AI_MODEL_CATALOG.map((entry) => entry.selection.provider) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entitaId: true, esito: true, metadata: true, createdAt: true },
  });
  const verificationByProvider = new Map<AiProviderId, typeof latestVerifications[number]>();
  for (const verification of latestVerifications) {
    const provider = AI_MODEL_CATALOG.find(
      (entry) => entry.selection.provider === verification.entitaId,
    )?.selection.provider;
    if (provider && !verificationByProvider.has(provider)) {
      verificationByProvider.set(provider, verification);
    }
  }
  return AI_MODEL_CATALOG.map((entry) => {
    const provider = entry.selection.provider;
    const environmentConfig = providerEnvironment[provider];
    const providerControl = control.providers.find(
      (candidate) => candidate.provider === provider,
    );
    const credentialConfigured = configuredSecret(
      environment[environmentConfig.credentialName],
    );
    const estimatedCostLimitEur = positiveAmount(
      environment[environmentConfig.estimateName],
    );
    const pricingApproved = entry.pricingVersion !== null
      && estimatedCostLimitEur !== null;
    const realDataAuthorized = entry.capabilities.realDataApproved
      && environment.AI_REAL_DATA_ENABLED?.trim().toLowerCase() === "true"
      && Boolean(environment.AI_REAL_DATA_APPROVAL_ID?.trim())
      && environment.AI_PROVIDER_PROJECT_CLASS?.trim() === "REAL_DATA_APPROVED";
    const manualEnabled = providerControl?.manualEnabled
      ?? provider === "OPENAI";
    const automaticSelected = control.automaticSelection.provider === provider;
    const manualEligible = credentialConfigured
      && realDataAuthorized
      && pricingApproved;
    const automaticEligible = manualEligible
      && entry.capabilities.automaticExecutionApproved;
    const operational = input.globalAiEnabled
      && manualEnabled
      && manualEligible;
    const verification = verificationByProvider.get(provider);
    const verificationMetadata = metadataRecord(verification?.metadata ?? null);
    const connectionStatus: AiProviderConnectionVerificationStatus = !verification
      ? "NOT_VERIFIED"
      : verification.esito === "SUCCESS" && verificationMetadata?.verified === true
        ? "VERIFIED"
        : "FAILED";
    const error = !credentialConfigured
      ? "Credenziale API non configurata."
      : !entry.capabilities.realDataApproved
        ? "Provider non ancora autorizzato per fascicoli reali."
        : !entry.pricingVersion
          ? "Pricing del modello non approvato."
          : estimatedCostLimitEur === null
            ? "Limite economico preventivo non configurato."
            : connectionStatus === "FAILED"
              ? "L'ultima verifica di connessione non è riuscita."
              : !input.globalAiEnabled
                ? "Controllo generale AI disabilitato."
                : !manualEnabled
                  ? "Modalità manuale disabilitata."
                  : null;
    const status = operational
      ? connectionStatus === "FAILED" ? "ATTENTION" : "READY"
      : credentialConfigured && !manualEnabled ? "DISABLED" : "BLOCKED";
    return {
      provider,
      label: entry.label,
      model: entry.selection.model,
      credentialEnvironmentName: environmentConfig.credentialName,
      credentialConfigured,
      connectionStatus,
      lastVerifiedAt: verification?.createdAt ?? null,
      realDataAuthorized,
      manualEnabled,
      manualEligible,
      automaticSelected,
      automaticEligible,
      globalAiEnabled: input.globalAiEnabled,
      generalAutomationEnabled: input.generalAutomationEnabled,
      operational,
      estimatedCostLimitEur,
      pricingVersion: entry.pricingVersion,
      billingApproval: pricingApproved
        ? "INTERNAL_LIMIT_CONFIGURED"
        : "NOT_APPROVED",
      status,
      error,
    };
  });
}

export async function getAutomaticAiSelectionForAdmission(input: {
  readonly globalAiEnabled: boolean;
  readonly generalAutomationEnabled: boolean;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<{
  readonly workflow: typeof AI_AUTOMATIC_WORKFLOW;
  readonly selection: AiModelSelection;
  readonly authorizationRef: string;
} | null> {
  if (!input.globalAiEnabled || !input.generalAutomationEnabled) return null;
  const control = await getAiProviderControlSnapshot();
  const readiness = await getAiProviderReadiness({
    ...input,
    control,
  });
  const selected = readiness.find((provider) => provider.automaticSelected);
  if (!selected?.automaticEligible) return null;
  const authorizationRef = (input.environment ?? process.env)
    .AI_REAL_DATA_APPROVAL_ID?.trim();
  if (!authorizationRef) return null;
  return {
    workflow: AI_AUTOMATIC_WORKFLOW,
    selection: getAiModelCatalogEntry(control.automaticSelection).selection,
    authorizationRef,
  };
}
