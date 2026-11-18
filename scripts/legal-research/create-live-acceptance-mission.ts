import "dotenv/config";

import {
  LiveAcceptanceMissionError,
  runLiveAcceptanceMission,
} from "../../src/server/legal-research/live-acceptance-mission";

type Arguments = Readonly<{
  execute: boolean;
  referenceDate?: string;
  target?: string;
}>;

function parseArguments(argv: readonly string[]): Arguments {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    execute: argv.includes("--execute"),
    referenceDate: value("--reference-date"),
    target: value("--target"),
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (!args.referenceDate) throw new LiveAcceptanceMissionError("REFERENCE_DATE_REQUIRED");

  const persist = args.execute
    ? async (...parameters: Parameters<
      typeof import("../../src/server/legal-research/persistence")["createResearchMissionRecord"]
    >) => {
      const { createResearchMissionRecord } = await import("../../src/server/legal-research/persistence");
      return createResearchMissionRecord(...parameters);
    }
    : undefined;

  const result = await runLiveAcceptanceMission({
    referenceDate: args.referenceDate,
    target: args.target,
    vercelEnvironment: process.env.VERCEL_ENV,
    execute: args.execute,
    enabled: process.env.LEGAL_RESEARCH_LIVE_ACCEPTANCE,
    actorId: process.env.LEGAL_RESEARCH_ACCEPTANCE_ACTOR_ID,
    tenantId: process.env.LEGAL_RESEARCH_ACCEPTANCE_TENANT_ID,
    persist,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const code = error instanceof LiveAcceptanceMissionError
    ? error.code
    : "LIVE_ACCEPTANCE_MISSION_FAILED";
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
});