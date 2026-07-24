export const INVESTOR_DEMO_MODE_ENV_KEY = "INVESTOR_DEMO_MODE";

const DEMO_ROUTE_PREFIXES = [
  "/dashboard",
  "/concessioni",
  "/procedimenti",
  "/documenti",
  "/scadenze",
  "/normativa",
] as const;

export function isInvestorDemoMode(): boolean {
  return process.env[INVESTOR_DEMO_MODE_ENV_KEY] === "true";
}

export function isInvestorDemoRoute(pathname: string): boolean {
  return DEMO_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
