export const DEEPSEEK_READONLY_VERIFICATION_AUTHORIZATION_ID =
  "GH_ISSUE_70_2026_11_07_DEEPSEEK_READONLY" as const;
export const DEEPSEEK_READONLY_VERIFICATION_PATH =
  "/admin/deepseek-readonly-verification" as const;
export const DEEPSEEK_READONLY_VERIFICATION_API_PATH =
  "/api/admin/deepseek-readonly-verification" as const;
const EXPECTED_VERCEL_PROJECT_ID = "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu";

const ALLOWED_PATHS = new Set([
  "/login",
  "/logout",
  DEEPSEEK_READONLY_VERIFICATION_PATH,
  DEEPSEEK_READONLY_VERIFICATION_API_PATH,
  "/api/auth/providers",
  "/api/auth/csrf",
  "/api/auth/session",
  "/api/auth/callback/credentials",
  "/api/auth/error",
  "/api/auth/signout",
]);
const ALLOWED_PREFIXES = [
  "/_next/static/",
  "/_next/image",
] as const;

export type DeepSeekReadOnlyVerificationEnvironment =
  Readonly<Record<string, string | undefined>>;

function normalizedHost(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export function isDeepSeekReadOnlyVerificationDeployment(
  env: DeepSeekReadOnlyVerificationEnvironment,
): boolean {
  return env.NOETRA_DEEPSEEK_READONLY_VERIFICATION_ENABLED === "true"
    && env.NOETRA_DEEPSEEK_READONLY_VERIFICATION_AUTHORIZATION_ID
      === DEEPSEEK_READONLY_VERIFICATION_AUTHORIZATION_ID
    && env.VERCEL_ENV === "production"
    && env.VERCEL_PROJECT_ID === EXPECTED_VERCEL_PROJECT_ID
    && /^dpl_[a-z0-9]+$/i.test(env.VERCEL_DEPLOYMENT_ID ?? "");
}

export function deepSeekReadOnlyVerificationHost(
  env: DeepSeekReadOnlyVerificationEnvironment,
): string {
  return normalizedHost(env.VERCEL_URL);
}

export function deepSeekReadOnlyVerificationOrigin(
  env: DeepSeekReadOnlyVerificationEnvironment,
): string | null {
  if (!isDeepSeekReadOnlyVerificationDeployment(env)) return null;
  const host = deepSeekReadOnlyVerificationHost(env);
  return host && host !== "app.noetra.it" ? `https://${host}` : null;
}

export function assertDeepSeekReadOnlyVerificationRequest(input: {
  readonly env: DeepSeekReadOnlyVerificationEnvironment;
  readonly requestHost: string | null | undefined;
}): void {
  const expectedHost = deepSeekReadOnlyVerificationHost(input.env);
  const requestHost = normalizedHost(input.requestHost);
  if (
    !isDeepSeekReadOnlyVerificationDeployment(input.env)
    || !expectedHost
    || expectedHost === "app.noetra.it"
    || requestHost !== expectedHost
  ) {
    throw new Error("DEEPSEEK_READONLY_VERIFICATION_DEPLOYMENT_REJECTED");
  }
}

export function isDeepSeekReadOnlyVerificationRequestAllowed(input: {
  readonly pathname: string;
  readonly hasNextActionHeader: boolean;
}): boolean {
  if (input.hasNextActionHeader) return false;
  return ALLOWED_PATHS.has(input.pathname)
    || input.pathname === "/favicon.ico"
    || ALLOWED_PREFIXES.some((prefix) => input.pathname.startsWith(prefix));
}

export function isTrustedDeepSeekReadOnlyVerificationMutation(input: {
  readonly env: DeepSeekReadOnlyVerificationEnvironment;
  readonly request: Request;
}): boolean {
  const expectedOrigin = deepSeekReadOnlyVerificationOrigin(input.env);
  const origin = input.request.headers.get("origin");
  const contentType = input.request.headers.get("content-type")?.toLowerCase() ?? "";
  return expectedOrigin !== null
    && origin === expectedOrigin
    && (
    contentType.startsWith("application/x-www-form-urlencoded")
    || contentType.startsWith("multipart/form-data")
    );
}
