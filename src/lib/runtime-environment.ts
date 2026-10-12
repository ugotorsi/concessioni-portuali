export interface RuntimeEnvironment {
  vercelEnv: string | null;
  nodeEnv: string | null;
  isProductionRuntime: boolean;
  isPreviewRuntime: boolean;
  isDevelopmentRuntime: boolean;
}

export function resolveRuntimeEnvironment(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "VERCEL_ENV">>,
): RuntimeEnvironment {
  const nodeEnv = env.NODE_ENV ?? null;
  const vercelEnv = env.VERCEL_ENV ?? null;

  const isProductionRuntime = vercelEnv === "production" || (vercelEnv === null && nodeEnv === "production");
  const isPreviewRuntime = vercelEnv === "preview";
  const isDevelopmentRuntime = !isProductionRuntime && !isPreviewRuntime;

  return {
    vercelEnv,
    nodeEnv,
    isProductionRuntime,
    isPreviewRuntime,
    isDevelopmentRuntime,
  };
}

export function getRuntimeEnvironment(): RuntimeEnvironment {
  return resolveRuntimeEnvironment(process.env);
}