import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { evaluateChatGptResearchPreflight } from "@/server/legal-research/chatgpt-research-preflight";
import type { ResearchMission } from "@/server/legal-research/bridge";

const missionId = "research-mission:c0cf02cb6dfdd5ff5eab8c0bfac2817ad7a63149b6df8bc51129fe50a06d59e6";
const tenantId = "cmrzd08yp000dqwudd9dvaidl";
const procedimentoId = "procedimento-intake-9e04f4d4cdbf092845b57c66";

function pseudonym(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

async function main(): Promise<void> {
  const record = await prisma.researchMissionRecord.findUnique({
    where: { id: missionId },
    select: {
      id: true,
      tenantId: true,
      assignedActorId: true,
      caseId: true,
      lifecycleStatus: true,
      status: true,
      payload: true,
    },
  });
  if (!record || record.tenantId !== tenantId || record.caseId !== procedimentoId) {
    throw new Error("SELVARA_CHATGPT_MISSION_NOT_FOUND");
  }
  const mission = {
    ...(record.payload as unknown as ResearchMission),
    missionId: record.id,
    status: record.status,
    caseReference: {
      caseId: record.caseId,
      fascicoloReference: procedimentoId,
    },
  };
  const result = evaluateChatGptResearchPreflight({
    mission,
    assignedActorId: record.assignedActorId,
    lifecycleStatus: record.lifecycleStatus,
    autonomousExecutionGates: {
      aiRealDataEnabled: process.env.AI_REAL_DATA_ENABLED,
      asyncProviderExecutionEnabled: process.env.ASYNC_PROVIDER_EXECUTION_ENABLED,
      automaticResearchExecutionEnabled: process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED,
    },
  });
  if (!result.ready) {
    throw new Error(`SELVARA_CHATGPT_PREFLIGHT_BLOCKED:${result.blockers.join(",")}`);
  }
  console.log(JSON.stringify({
    status: "SELVARA_CHATGPT_RESEARCH_READY",
    missionId: record.id,
    actor: pseudonym(record.assignedActorId!),
    lifecycleStatus: record.lifecycleStatus,
    missionStatus: record.status,
    autonomousExecution: "DISABLED",
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "SELVARA_CHATGPT_PREFLIGHT_FAILED");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
