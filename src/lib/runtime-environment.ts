const INVESTOR_DEMO_MODE_ENV_KEY = "INVESTOR_DEMO_MODE";

export interface RuntimeEnvironment {
  vercelEnv: string | null;
  nodeEnv: string | null;
  isProductionRuntime: boolean;
  isPreviewRuntime: boolean;
  isDevelopmentRuntime: boolean;
  demoModeEnabled: boolean;
  productionDemoConflict: boolean;
  demoAuthenticationAllowed: boolean;
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "true";
}

export function resolveRuntimeEnvironment(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "VERCEL_ENV" | typeof INVESTOR_DEMO_MODE_ENV_KEY>>,
): RuntimeEnvironment {
  const nodeEnv = env.NODE_ENV ?? null;
  const vercelEnv = env.VERCEL_ENV ?? null;
  const demoModeEnabled = parseBooleanFlag(env[INVESTOR_DEMO_MODE_ENV_KEY]);

  const isProductionRuntime = vercelEnv === "production" || (vercelEnv === null && nodeEnv === "production");
  const isPreviewRuntime = vercelEnv === "preview";
  const isDevelopmentRuntime = !isProductionRuntime && !isPreviewRuntime;
  const productionDemoConflict = isProductionRuntime && demoModeEnabled;

  return {
    vercelEnv,
    nodeEnv,
    isProductionRuntime,
    isPreviewRuntime,
    isDevelopmentRuntime,
    demoModeEnabled,
    productionDemoConflict,
    demoAuthenticationAllowed: demoModeEnabled && !isProductionRuntime,
  };
}

export function getRuntimeEnvironment(): RuntimeEnvironment {
  return resolveRuntimeEnvironment(process.env);
}