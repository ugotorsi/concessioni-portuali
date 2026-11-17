export const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(["app.noetra.it"]);

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function isProductionHost(host: string | null | undefined): boolean {
  return PRODUCTION_HOSTS.has(normalizeHost(host));
}

/**
 * A deployment built for any Vercel target other than production must never
 * serve the production hostname, even if a domain or alias is misconfigured.
 * Outside Vercel (VERCEL_ENV undefined) the guard is inactive.
 */
export function isMisroutedProductionHost(
  host: string | null | undefined,
  vercelEnv: string | undefined,
): boolean {
  if (!isProductionHost(host)) return false;
  if (vercelEnv === undefined || vercelEnv === "") return false;
  return vercelEnv !== "production";
}
