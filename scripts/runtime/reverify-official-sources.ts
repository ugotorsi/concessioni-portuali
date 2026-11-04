/**
 * Re-runs the official-source verification chain (Normattiva only, no AI/research provider calls) for the
 * CURRENT primary missions of one procedimento, then archives a new structured report version.
 * Used to apply classifier corrections to already persisted research results without re-running research.
 *
 * Usage:
 *   EXPECTED_DATABASE_HOST_PREFIX=<isolated host prefix> DATABASE_URL=... \
 *   npx tsx scripts/runtime/reverify-official-sources.ts --procedimento <id> --confirm-procedimento <id> [--max-acquisitions 8]
 */
import { prisma } from "@/lib/prisma";
import { verifyOfficialResearchSources } from "@/server/legal-research/official-source-verification";
import { produceAndPersistAutomaticLegalApplicabilityReviews } from "@/server/legal-research/legal-applicability-producer";
import { refreshStructuredReportAfterResearch } from "@/server/fascicolo-report/auto-refresh";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (!process.env.EXPECTED_DATABASE_HOST_PREFIX?.trim()) {
    throw new Error("EXPECTED_DATABASE_HOST_PREFIX is required: this script writes to the database.");
  }
  const procedimentoId = argument("--procedimento");
  if (!procedimentoId || argument("--confirm-procedimento") !== procedimentoId) {
    throw new Error("Pass --procedimento <id> and the same value in --confirm-procedimento.");
  }
  const maxAcquisitions = Number(argument("--max-acquisitions") ?? "8");
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, enteId: true },
  });
  if (!procedimento) throw new Error("PROCEDIMENTO_NOT_FOUND");
  const missions = await prisma.researchMissionRecord.findMany({
    where: { caseId: procedimento.id, tenantId: procedimento.enteId, lifecycleStatus: "CURRENT" },
    select: { id: true, mode: true, assignedActorId: true },
    orderBy: { createdAt: "asc" },
  });
  const primary = missions.filter((mission) => mission.mode !== "ADVERSE_SEARCH");
  for (const mission of primary) {
    const results = await prisma.researchQuestionResultRecord.count({ where: { missionId: mission.id } });
    if (results === 0 || !mission.assignedActorId) {
      console.log(JSON.stringify({ missionId: mission.id, skipped: results === 0 ? "NO_RESULTS" : "NO_ASSIGNED_ACTOR" }));
      continue;
    }
    const scope = { missionId: mission.id, tenantId: procedimento.enteId, caseId: procedimento.id, actorId: mission.assignedActorId };
    const verification = await verifyOfficialResearchSources({ ...scope, maxAcquisitions });
    await produceAndPersistAutomaticLegalApplicabilityReviews(scope);
    console.log(JSON.stringify({ missionId: mission.id, results, ...verification }));
  }
  const report = await refreshStructuredReportAfterResearch({ tenantId: procedimento.enteId, procedimentoId: procedimento.id });
  console.log(JSON.stringify({ reportRefresh: report }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
