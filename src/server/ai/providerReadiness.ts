import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AI_MODEL_CATALOG,
  getAiModelCatalogEntry,
  type AiModelSelection,
  type AiProviderId,
} from "@/server/ai/providerCatalog";
import {
  AI_PROVIDER_ENVIRONMENT,
  aiProviderConfigurationFingerprint,
} from "@/server/ai/providerConfiguration";
import {
  AI_AUTOMATIC_WORKFLOW,
  getAiProviderControlSnapshot,
  type AiProviderControlSnapshot,
} from "@/server/ai/providerControl";

export const AI_PROVIDER_CONNECTION_VERIFICATION_ACTION =
  "AI_PROVIDER_CONNECTION_VERIFICATION";
export const AI_PROVIDER_CONNECTION_ENTITY = "AiProviderConnection";

export type AiProviderConnectionVerificationStatus =
  | "VERIFIED"
  | "FAILED"
  | "STALE"
  | "NOT_VERIFIED";

export interface AiProviderReadiness {
  readonly provider: AiProviderId;
  readonly label: string;
  readonly model: string;
  readonly credentialEnvironmentName: string;
  readonly credentialConfigured: boolean;
  readonly connectionStatus: AiProviderConnectionVerificationStatus;
  readonly credentialValid: boolean;
  readonly modelAvailable: boolean;
  readonly balanceSufficient: boolean | null;
  readonly verificationCode: string | null;
  readonly verificationHttpStatus: number | null;
  readonly modelTechnicallyQualified: boolean;
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

function metadataString(
  metadata: Record<string, Prisma.JsonValue> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function metadataNumber(
  metadata: Record<string, Prisma.JsonValue> | null,
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataBoolean(
  metadata: Record<string, Prisma.JsonValue> | null,
  key: string,
): boolean | null {
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : null;
}

function connectionFailureMessage(input: {
  readonly provider: AiProviderId;
  readonly code: string | null;
  readonly balanceSufficient: boolean | null;
}): string {
  if (
    input.provider === "DEEPSEEK"
    && (
      input.balanceSufficient === false
      || input.code === "AI_PROVIDER_BALANCE_INSUFFICIENT"
    )
  ) {
    return "Il saldo API DeepSeek non risulta utilizzabile.";
  }
  if (input.provider === "DEEPSEEK" && input.code?.startsWith("AI_PROVIDER_BALANCE_")) {
    return "La verifica read-only del saldo API DeepSeek non è riuscita.";
  }
  return "L'ultima verifica di connessione non è riuscita.";
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
    const environmentConfig = AI_PROVIDER_ENVIRONMENT[provider];
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
    const verification = verificationByProvider.get(provider);
    const verificationMetadata = metadataRecord(verification?.metadata ?? null);
    const fingerprintSecret = environment.NEXTAUTH_SECRET?.trim();
    const apiKey = environment[environmentConfig.credentialName]?.trim();
    const currentConfigurationFingerprint = credentialConfigured
      && apiKey
      && fingerprintSecret
      ? aiProviderConfigurationFingerprint({
          provider,
          model: entry.selection.model,
          apiKey,
          fingerprintSecret,
        })
      : null;
    const verificationMatchesCurrentConfiguration = Boolean(
      currentConfigurationFingerprint
      && verificationMetadata?.configurationFingerprint === currentConfigurationFingerprint
      && verificationMetadata?.model === entry.selection.model,
    );
    const credentialValid = verificationMatchesCurrentConfiguration
      && verificationMetadata?.credentialValid === true;
    const modelAvailable = verificationMatchesCurrentConfiguration
      && credentialValid
      && verificationMetadata?.modelAvailable === true;
    const balanceSufficient = verificationMatchesCurrentConfiguration
      ? metadataBoolean(verificationMetadata, "balanceSufficient")
      : null;
    const verificationCode = verificationMatchesCurrentConfiguration
      ? metadataString(verificationMetadata, "code")
      : null;
    const verificationHttpStatus = verificationMatchesCurrentConfiguration
      ? metadataNumber(verificationMetadata, "httpStatus")
      : null;
    const modelTechnicallyQualified =
      entry.capabilities.technicalQualificationApproved;
    const connectionStatus: AiProviderConnectionVerificationStatus = !verification
      ? "NOT_VERIFIED"
      : !verificationMatchesCurrentConfiguration
        ? "STALE"
        : verification.esito === "SUCCESS"
          && verificationMetadata?.verified === true
          && credentialValid
          && modelAvailable
        ? "VERIFIED"
        : "FAILED";
    const requiresVerifiedCurrentConfiguration = provider !== "OPENAI";
    const verificationSatisfied = !requiresVerifiedCurrentConfiguration
      || connectionStatus === "VERIFIED";
    const manualEligible = credentialConfigured
      && verificationSatisfied
      && modelTechnicallyQualified
      && realDataAuthorized
      && pricingApproved;
    const automaticEligible = manualEligible
      && entry.capabilities.automaticExecutionApproved;
    const operational = input.globalAiEnabled
      && manualEnabled
      && manualEligible;
    const error = !credentialConfigured
      ? "Credenziale API non configurata."
      : requiresVerifiedCurrentConfiguration && connectionStatus === "FAILED"
        ? connectionFailureMessage({
            provider,
            code: verificationCode,
            balanceSufficient,
          })
        : requiresVerifiedCurrentConfiguration && connectionStatus !== "VERIFIED"
          ? "La credenziale e il modello correnti richiedono una verifica positiva."
          : !entry.capabilities.realDataApproved
            ? "Provider non ancora autorizzato per fascicoli reali."
          : !modelTechnicallyQualified
            ? "Il modello non è ancora tecnicamente qualificato per NOETRA."
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
      credentialValid,
      modelAvailable,
      balanceSufficient,
      verificationCode,
      verificationHttpStatus,
      modelTechnicallyQualified,
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
