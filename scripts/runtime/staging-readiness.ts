import { prisma } from "../../src/lib/prisma";
import { parseApplicationAsyncWorkerConfig } from "../../src/server/async-jobs/applicationWorkerRuntime";
import { getRuntimeHealthSnapshot } from "../../src/server/runtime/health";

function enabled(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("INVALID_READINESS_CONFIGURATION");
}

async function main(): Promise<void> {
  const config = parseApplicationAsyncWorkerConfig(process.env);
  const requireLiveWorker = enabled(process.env.ASYNC_READINESS_REQUIRE_LIVE_WORKER);
  const [health, policies] = await Promise.all([
    getRuntimeHealthSnapshot(),
    prisma.runtimeBudgetPolicy.findMany({
      where: { enabled: true, currency: "EUR" },
      select: { scope: true },
    }),
  ]);
  const configuredScopes = new Set<string>(policies.map((policy) => policy.scope));
  const missingBudgetScopes = config.providerExecutionEnabled
    ? ["GLOBAL", "TENANT", "PROCEDIMENTO"].filter((scope) => !configuredScopes.has(scope))
    : [];
  const checks = {
    databaseConnected: health.databaseConnected,
    migrationCompatible: health.migrationState === "COMPATIBLE",
    providerExecutionEnabled: config.providerExecutionEnabled ?? false,
    missingBudgetScopes,
    liveWorkerRequired: requireLiveWorker,
    activeWorkers: health.activeWorkers,
    workerRequirementMet: !requireLiveWorker || health.activeWorkers > 0,
  };
  const ready = checks.databaseConnected
    && checks.migrationCompatible
    && checks.missingBudgetScopes.length === 0
    && checks.workerRequirementMet;
  console.log(JSON.stringify({ event: "ASYNC_RUNTIME_STAGING_READINESS", ready, checks }));
  if (!ready) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      event: "ASYNC_RUNTIME_STAGING_READINESS_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());