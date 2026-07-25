import { getRuntimeEnvironment } from "@/lib/runtime-environment";

export const INVESTOR_DEMO_MODE_ENV_KEY = "INVESTOR_DEMO_MODE";

const DEMO_ROUTE_PREFIXES = [
  "/dashboard",
  "/demo",
  "/verticali",
  "/concessioni",
  "/procedimenti",
  "/documenti",
  "/scadenze",
  "/normativa",
] as const;

export function isInvestorDemoMode(): boolean {
  return getRuntimeEnvironment().demoAuthenticationAllowed;
}

export function isInvestorDemoRoute(pathname: string): boolean {
  return DEMO_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
