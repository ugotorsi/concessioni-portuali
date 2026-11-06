export const LIVE_QUALIFICATION_AUTHORIZATION_ID = "GH_ISSUE_70_2026_11_05" as const;
export const LIVE_QUALIFICATION_BRANCH =
  "qualification/multi-ai-synthetic-20261105" as const;
const LIVE_QUALIFICATION_ALLOWED_PATHS = new Set([
  "/login",
  "/logout",
  "/admin/ai-live-qualification",
  "/api/admin/ai-live-qualification",
  "/api/auth/providers",
  "/api/auth/csrf",
  "/api/auth/session",
  "/api/auth/callback/credentials",
  "/api/auth/error",
  "/api/auth/signout",
]);
const LIVE_QUALIFICATION_ALLOWED_PREFIXES = [
  "/_next/static/",
  "/_next/image",
] as const;

export type LiveQualificationDeploymentEnvironment =
  Readonly<Record<string, string | undefined>>;

export function isLiveQualificationDeployment(
  env: LiveQualificationDeploymentEnvironment,
): boolean {
  return env.NOETRA_LIVE_QUALIFICATION_ENABLED === "true"
    && env.NOETRA_LIVE_QUALIFICATION_AUTHORIZATION_ID
      === LIVE_QUALIFICATION_AUTHORIZATION_ID;
}

export function liveQualificationDeploymentHost(
  env: LiveQualificationDeploymentEnvironment,
): string {
  return (env.NOETRA_LIVE_QUALIFICATION_HOST ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function isLiveQualificationAllowedPath(pathname: string): boolean {
  return LIVE_QUALIFICATION_ALLOWED_PATHS.has(pathname)
    || pathname === "/favicon.ico"
    || LIVE_QUALIFICATION_ALLOWED_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix));
}

export function isLiveQualificationRequestAllowed(input: {
  pathname: string;
  hasNextActionHeader: boolean;
}): boolean {
  return !input.hasNextActionHeader
    && isLiveQualificationAllowedPath(input.pathname);
}
