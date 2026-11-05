import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  AI_MODEL_CATALOG,
  getAiModelCatalogEntry,
  type AiProviderId,
} from "@/server/ai/providerCatalog";
import {
  AI_PROVIDER_CONNECTION_ENTITY,
  AI_PROVIDER_CONNECTION_VERIFICATION_ACTION,
} from "@/server/ai/providerReadiness";

const connectionConfig = {
  OPENAI: {
    credentialName: "AI_OPENAI_API_KEY",
    url: "https://api.openai.com/v1/models",
    headers: (apiKey: string) => ({
      Authorization: "Bearer " + apiKey,
    }),
  },
  ANTHROPIC: {
    credentialName: "AI_ANTHROPIC_API_KEY",
    url: "https://api.anthropic.com/v1/models",
    headers: (apiKey: string) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }),
  },
  DEEPSEEK: {
    credentialName: "AI_DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/models",
    headers: (apiKey: string) => ({
      Authorization: "Bearer " + apiKey,
    }),
  },
} as const satisfies Record<AiProviderId, {
  credentialName: string;
  url: string;
  headers(apiKey: string): Record<string, string>;
}>;

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
  readonly httpStatus: number | null;
  readonly code: string;
  readonly generationRequested: false;
  readonly expectedGenerationCostEur: 0;
}> {
  const environment = input.environment ?? process.env;
  const config = connectionConfig[input.provider];
  const selection = AI_MODEL_CATALOG.find(
    (candidate) => candidate.selection.provider === input.provider,
  )?.selection;
  if (!selection) throw new Error("AI_MODEL_NOT_REGISTERED");
  const entry = getAiModelCatalogEntry(selection);
  const apiKey = environment[config.credentialName]?.trim();
  if (!apiKey || apiKey === "[SENSITIVE]") {
    const result = {
      provider: input.provider,
      verified: false,
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch.bind(globalThis))(config.url, {
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
        failureKind: error instanceof Error ? error.name : "UNKNOWN",
      },
    });
    return result;
  } finally {
    clearTimeout(timeout);
  }
  const verified = response.ok;
  const code = verified
    ? "AI_PROVIDER_CONNECTION_VERIFIED"
    : response.status === 401 || response.status === 403
      ? "AI_PROVIDER_CREDENTIAL_REJECTED"
      : `AI_PROVIDER_CONNECTION_HTTP_${response.status}`;
  const result = {
    provider: input.provider,
    verified,
    httpStatus: response.status,
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
    },
  });
  return result;
}
