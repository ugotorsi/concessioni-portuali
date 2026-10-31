const PREVIEW_SESSION_COOKIE = "__Secure-noetra-preview.session-token";
const PRODUCTION_SESSION_COOKIE = "__Secure-next-auth.session-token";
const DEVELOPMENT_SESSION_COOKIE = "next-auth.session-token";

export function resolveAuthSessionCookieName(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "VERCEL_ENV">> = process.env,
): string {
  if (env.VERCEL_ENV === "preview") {
    return PREVIEW_SESSION_COOKIE;
  }

  return env.NODE_ENV === "production"
    ? PRODUCTION_SESSION_COOKIE
    : DEVELOPMENT_SESSION_COOKIE;
}
