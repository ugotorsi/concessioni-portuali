type SeedEnvironment = Readonly<Record<string, string | undefined>>;

export function assertDemoSeedAllowed(environment: SeedEnvironment): void {
  const vercelEnvironment = environment.VERCEL_ENV?.trim().toLowerCase();
  const deployed = environment.NODE_ENV === "production"
    || vercelEnvironment === "preview"
    || vercelEnvironment === "production";

  if (deployed) {
    throw new Error("Demo seed is forbidden in Preview and production environments.");
  }

  if (environment.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Demo seed requires ALLOW_DEMO_SEED=true in a local disposable environment.");
  }
}