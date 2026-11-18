import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { z } from "zod";
import {
  AI_MODEL_CATALOG,
  getAiModelCatalogEntry,
  type AiProviderId,
} from "@/server/ai/providerCatalog";
import {
  AI_PROVIDER_ENVIRONMENT,
  aiProviderConfigurationFingerprint,
} from "@/server/ai/providerConfiguration";
import {
  AI_PROVIDER_CONNECTION_ENTITY,
  AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
} from "@/server/ai/providerReadiness";

const providerModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string().trim().min(1).max(256),
  }).passthrough()).max(10_000),
}).passthrough();

const MAX_MODELS_RESPONSE_BYTES = 1_000_000;
const MAX_BALANCE_RESPONSE_BYTES = 64_000;
const deepSeekBalanceResponseSchema = z.object({
  is_available: z.boolean(),
}).passthrough();

interface ProviderConnectionActor {
  readonly userId: string;
  readonly userEmail: string;
  readonly userRole: "ADMIN";
}

export async function verifyAiProviderConnection(input: {
  readonly provider: AiProviderId;
  readonly actor: ProviderConnectionActor;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
}): Promise<{
  readonly provider: AiProviderId;
  readonly verified: boolean;
  readonly credentialValid: boolean;
  readonly modelAvailable: boolean;
  readonly balanceSufficient: boolean | null;
  readonly modelTechnicallyQualified: boolean;
  readonly httpStatus: number | null;
  readonly code: string;
  readonly generationRequested: false;
  readonly expectedGenerationCostEur: 0;
}> {
  const environment = input.environment ?? process.env;
  const config = AI_PROVIDER_ENVIRONMENT[input.provider];
  const selection = AI_MODEL_CATALOG.find(
    (candidate) => candidate.selection.provider === input.provider,
  )?.selection;
  if (!selection) throw new Error("AI_MODEL_NOT_REGISTERED");
  const entry = getAiModelCatalogEntry(selection);
  const apiKey = environment[config.credentialName]?.trim();
  const fingerprintSecret = environment.NEXTAUTH_SECRET?.trim();
  if (!apiKey || apiKey === "[SENSITIVE]") {
    const result = {
      provider: input.provider,
      verified: false,
      credentialValid: false,
      modelAvailable: false,
      balanceSufficient: null,
      modelTechnicallyQualified: entry.capabilities.technicalQualificationApproved,
      httpStatus: null,
      code: "AI_PROVIDER_CREDENTIAL_MISSING",
      generationRequested: false as const,
      expectedGenerationCostEur: 0 as const,
    };
    await auditFailure({
      azione: AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
      entita: AI_PROVIDER_CONNECTION_ENTITY,
      entitaId: input.provider,
      actor: input.actor,
      metadata: {
        ...result,
        model: entry.selection.model,
        credentialEnvironmentName: config.credentialName,
        credentialValueLogged: false,
      },
    });
    return result;
  }
  if (!fingerprintSecret) {
    const result = {
      provider: input.provider,
      verified: false,
      credentialValid: false,
      modelAvailable: false,
      balanceSufficient: null,
      modelTechnicallyQualified: entry.capabilities.technicalQualificationApproved,
      httpStatus: null,
      code: "AI_PROVIDER_VERIFICATION_SECRET_MISSING",
      generationRequested: false as const,
      expectedGenerationCostEur: 0 as const,
    };
    await auditFailure({
      azione: AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
      entita: AI_PROVIDER_CONNECTION_ENTITY,
      entitaId: input.provider,
      actor: input.actor,
      metadata: {
        ...result,
        model: entry.selection.model,
        credentialEnvironmentName: config.credentialName,
        credentialValueLogged: false,
      },
    });
    return result;
  }
  const configurationFingerprint = aiProviderConfigurationFingerprint({
    provider: input.provider,
    model: entry.selection.model,
    apiKey,
    fingerprintSecret,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch.bind(globalThis))(config.modelsUrl, {
      method: "GET",
      headers: config.headers(apiKey),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    const code = controller.signal.aborted
      ? "AI_PROVIDER_CONNECTION_TIMEOUT"
      : "AI_PROVIDER_CONNECTION_UNREACHABLE";
    const result = {
      provider: input.provider,
      verified: false,
      credentialValid: false,
      modelAvailable: false,
      balanceSufficient: null,
      modelTechnicallyQualified: entry.capabilities.technicalQualificationApproved,
      httpStatus: null,
      code,
      generationRequested: false as const,
      expectedGenerationCostEur: 0 as const,
    };
    await auditFailure({
      azione: AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
      entita: AI_PROVIDER_CONNECTION_ENTITY,
      entitaId: input.provider,
      actor: input.actor,
      metadata: {
        ...result,
        model: entry.selection.model,
        credentialEnvironmentName: config.credentialName,
        credentialValueLogged: false,
        configurationFingerprint,
        failureKind: error instanceof Error ? error.name : "UNKNOWN",
      },
    });
    return result;
  } finally {
    clearTimeout(timeout);
  }
  const credentialValid = response.ok;
  let modelAvailable = false;
  let modelResponseValid = false;
  if (credentialValid) {
    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isFinite(contentLength) || contentLength <= MAX_MODELS_RESPONSE_BYTES) {
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") <= MAX_MODELS_RESPONSE_BYTES) {
        try {
          const parsed = providerModelsResponseSchema.safeParse(JSON.parse(body));
          if (parsed.success) {
            modelResponseValid = true;
            modelAvailable = parsed.data.data.some(
              (model) => model.id === entry.selection.model,
            );
          }
        } catch {
          modelResponseValid = false;
        }
      }
    }
  }
  const deepSeekBalanceRejected = input.provider === "DEEPSEEK"
    && response.status === 402;
  let balanceSufficient: boolean | null = deepSeekBalanceRejected ? false : null;
  let balanceHttpStatus: number | null = deepSeekBalanceRejected
    ? response.status
    : null;
  let balanceResponseValid = false;
  let balanceFailureCode: string | null = deepSeekBalanceRejected
    ? "AI_PROVIDER_BALANCE_INSUFFICIENT"
    : null;
  if (input.provider === "DEEPSEEK"
    && credentialValid
    && modelResponseValid
    && modelAvailable) {
    const balanceController = new AbortController();
    const balanceTimeout = setTimeout(() => balanceController.abort(), 8_000);
    try {
      const balanceResponse = await (input.fetch ?? globalThis.fetch.bind(globalThis))(
        AI_PROVIDER_ENVIRONMENT.DEEPSEEK.balanceUrl,
        {
          method: "GET",
          headers: config.headers(apiKey),
          signal: balanceController.signal,
          cache: "no-store",
          redirect: "error",
        },
      );
      balanceHttpStatus = balanceResponse.status;
      if (balanceResponse.ok) {
        const contentLength = Number(balanceResponse.headers.get("content-length"));
        if (!Number.isFinite(contentLength)
          || contentLength <= MAX_BALANCE_RESPONSE_BYTES) {
          const body = await balanceResponse.text();
          if (Buffer.byteLength(body, "utf8") <= MAX_BALANCE_RESPONSE_BYTES) {
            try {
              const parsed = deepSeekBalanceResponseSchema.safeParse(JSON.parse(body));
              if (parsed.success) {
                balanceResponseValid = true;
                balanceSufficient = parsed.data.is_available;
              }
            } catch {
              balanceResponseValid = false;
            }
          }
        }
      } else if (balanceResponse.status === 402) {
        balanceSufficient = false;
        balanceFailureCode = "AI_PROVIDER_BALANCE_INSUFFICIENT";
      } else {
        balanceFailureCode = `AI_PROVIDER_BALANCE_HTTP_${balanceResponse.status}`;
      }
    } catch {
      balanceFailureCode = balanceController.signal.aborted
        ? "AI_PROVIDER_BALANCE_TIMEOUT"
        : "AI_PROVIDER_BALANCE_UNREACHABLE";
    } finally {
      clearTimeout(balanceTimeout);
    }
    if (!balanceFailureCode && !balanceResponseValid) {
      balanceFailureCode = "AI_PROVIDER_BALANCE_RESPONSE_INVALID";
    } else if (!balanceFailureCode && balanceSufficient === false) {
      balanceFailureCode = "AI_PROVIDER_BALANCE_INSUFFICIENT";
    }
  }
  const balanceVerified = input.provider !== "DEEPSEEK"
    || balanceSufficient === true;
  const verified = credentialValid
    && modelResponseValid
    && modelAvailable
    && balanceVerified;
  const code = balanceFailureCode
    ?? (!credentialValid
    ? response.status === 401 || response.status === 403
      ? "AI_PROVIDER_CREDENTIAL_REJECTED"
      : `AI_PROVIDER_CONNECTION_HTTP_${response.status}`
    : !modelResponseValid
      ? "AI_PROVIDER_MODELS_RESPONSE_INVALID"
      : !modelAvailable
        ? "AI_PROVIDER_MODEL_UNAVAILABLE"
        : "AI_PROVIDER_CONNECTION_VERIFIED");
  const result = {
    provider: input.provider,
    verified,
    credentialValid,
    modelAvailable,
    balanceSufficient,
    modelTechnicallyQualified: entry.capabilities.technicalQualificationApproved,
    httpStatus: balanceFailureCode ? balanceHttpStatus : response.status,
    code,
    generationRequested: false as const,
    expectedGenerationCostEur: 0 as const,
  };
  const audit = verified ? auditSuccess : auditFailure;
  await audit({
    azione: AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
    entita: AI_PROVIDER_CONNECTION_ENTITY,
    entitaId: input.provider,
    actor: input.actor,
    metadata: {
      ...result,
      model: entry.selection.model,
      credentialEnvironmentName: config.credentialName,
      credentialValueLogged: false,
      configurationFingerprint,
    },
  });
  return result;
}
