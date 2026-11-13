import { createHash } from "node:crypto";
import { z } from "zod";

const workosUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  external_id: z.string().min(1).nullable(),
});

const workosAuthenticationSchema = z.object({
  user: workosUserSchema,
});

export type PreviewPasswordRecoveryConfig = Readonly<{
  apiKey: string;
  clientId: string;
}>;

export type VerifiedWorkosUser = z.infer<typeof workosUserSchema>;

export type PreviewPasswordRecoveryStage =
  | "IDENTITY_LOOKUP"
  | "MAGIC_AUTH_CREATE"
  | "MAGIC_AUTH_VERIFY";

export type PreviewPasswordRecoveryDiagnostic = Readonly<{
  stage: PreviewPasswordRecoveryStage;
  httpStatus?: number;
  providerCode?: string;
  providerRequestId?: string;
  providerMessageDigest?: string;
}>;

export class PreviewPasswordRecoveryError extends Error {
  constructor(
    readonly code:
      | "RECOVERY_UNAVAILABLE"
      | "WORKOS_IDENTITY_UNAVAILABLE"
      | "WORKOS_IDENTITY_MISMATCH"
      | "WORKOS_MAGIC_AUTH_UNAVAILABLE"
      | "WORKOS_VERIFICATION_FAILED",
    readonly diagnostic?: PreviewPasswordRecoveryDiagnostic,
  ) {
    super(code);
    this.name = "PreviewPasswordRecoveryError";
  }
}

export function isPreviewPasswordRecoveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.VERCEL_ENV === "preview"
    && env.PREVIEW_PASSWORD_RECOVERY_ENABLED === "true";
}

export function getPreviewPasswordRecoveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): PreviewPasswordRecoveryConfig | null {
  if (!isPreviewPasswordRecoveryEnabled(env)) return null;
  const apiKey = env.WORKOS_API_KEY?.trim();
  const clientId = env.WORKOS_CLIENT_ID?.trim();
  if (!apiKey || !clientId) return null;
  return { apiKey, clientId };
}

function authorizationHeaders(config: PreviewPasswordRecoveryConfig): HeadersInit {
  return {
    Authorization: ["Bearer", config.apiKey].join(" "),
    "Content-Type": "application/json",
  };
}

function safeProviderValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && /^[A-Za-z0-9_.:/-]{1,128}$/.test(normalized)
    ? normalized
    : undefined;
}

async function workosFailure(
  response: Response,
  code: PreviewPasswordRecoveryError["code"],
  stage: PreviewPasswordRecoveryStage,
): Promise<PreviewPasswordRecoveryError> {
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  const providerCode = safeProviderValue(
    body?.code ?? body?.error_code ?? body?.error,
  );
  const providerMessage = typeof body?.message === "string" ? body.message : undefined;
  const providerRequestId = safeProviderValue(
    response.headers.get("x-request-id")
      ?? response.headers.get("workos-request-id")
      ?? response.headers.get("x-workos-request-id"),
  );
  return new PreviewPasswordRecoveryError(code, {
    stage,
    httpStatus: response.status,
    ...(providerCode ? { providerCode } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(providerMessage
      ? {
          providerMessageDigest: createHash("sha256")
            .update(providerMessage, "utf8")
            .digest("hex")
            .slice(0, 16),
        }
      : {}),
  });
}

async function parseWorkosUser(response: Response): Promise<VerifiedWorkosUser> {
  if (!response.ok) {
    throw await workosFailure(
      response,
      "WORKOS_IDENTITY_UNAVAILABLE",
      "IDENTITY_LOOKUP",
    );
  }
  const parsed = workosUserSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PreviewPasswordRecoveryError("WORKOS_IDENTITY_UNAVAILABLE", {
      stage: "IDENTITY_LOOKUP",
      httpStatus: response.status,
      providerCode: "INVALID_WORKOS_USER_RESPONSE",
    });
  }
  return parsed.data;
}

export async function requireVerifiedWorkosIdentity(
  input: Readonly<{
    localUserId: string;
    email: string;
    config: PreviewPasswordRecoveryConfig;
    fetcher?: typeof fetch;
  }>,
): Promise<VerifiedWorkosUser> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://api.workos.com/user_management/users/external_id/${encodeURIComponent(input.localUserId)}`,
    {
      headers: authorizationHeaders(input.config),
      cache: "no-store",
    },
  );
  const user = await parseWorkosUser(response);
  if (
    user.external_id !== input.localUserId
    || user.email.toLowerCase() !== input.email.toLowerCase()
    || !user.email_verified
  ) {
    throw new PreviewPasswordRecoveryError("WORKOS_IDENTITY_MISMATCH");
  }
  return user;
}

export async function sendWorkosMagicAuthCode(
  input: Readonly<{
    email: string;
    config: PreviewPasswordRecoveryConfig;
    ipAddress?: string;
    userAgent?: string;
    fetcher?: typeof fetch;
  }>,
): Promise<void> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.workos.com/user_management/magic_auth", {
    method: "POST",
    headers: authorizationHeaders(input.config),
    body: JSON.stringify({
      email: input.email,
      ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent } : {}),
      locale: "it",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await workosFailure(
      response,
      "WORKOS_MAGIC_AUTH_UNAVAILABLE",
      "MAGIC_AUTH_CREATE",
    );
  }
}

export async function verifyWorkosMagicAuthCode(
  input: Readonly<{
    email: string;
    code: string;
    localUserId: string;
    config: PreviewPasswordRecoveryConfig;
    ipAddress?: string;
    userAgent?: string;
    fetcher?: typeof fetch;
  }>,
): Promise<VerifiedWorkosUser> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: input.config.clientId,
      client_secret: input.config.apiKey,
      grant_type: "urn:workos:oauth:grant-type:magic-auth:code",
      code: input.code,
      email: input.email,
      ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await workosFailure(
      response,
      "WORKOS_VERIFICATION_FAILED",
      "MAGIC_AUTH_VERIFY",
    );
  }
  const parsed = workosAuthenticationSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PreviewPasswordRecoveryError("WORKOS_VERIFICATION_FAILED", {
      stage: "MAGIC_AUTH_VERIFY",
      httpStatus: response.status,
      providerCode: "INVALID_WORKOS_AUTH_RESPONSE",
    });
  }
  const user = parsed.data.user;
  if (
    user.external_id !== input.localUserId
    || user.email.toLowerCase() !== input.email.toLowerCase()
    || !user.email_verified
  ) {
    throw new PreviewPasswordRecoveryError("WORKOS_IDENTITY_MISMATCH");
  }
  return user;
}
