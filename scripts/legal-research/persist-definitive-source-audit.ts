import { prisma } from "../../src/lib/prisma";
import { refreshStructuredReportAfterResearch } from "../../src/server/fascicolo-report/auto-refresh";
import {
  DEFINITIVE_SOURCE_AUDIT_ITEMS,
  persistDefinitiveSourceAudit,
} from "../../src/server/legal-research/definitive-source-audit";

const tenantId = process.env.NOETRA_AUDIT_TENANT_ID?.trim();
const caseId = process.env.NOETRA_AUDIT_CASE_ID?.trim();
const missionId = process.env.NOETRA_AUDIT_MISSION_ID?.trim();
const actorId = process.env.NOETRA_AUDIT_ACTOR_ID?.trim();

async function main(): Promise<void> {
  if (!tenantId || !caseId || !missionId || !actorId) {
    throw new Error(
      "NOETRA_AUDIT_TENANT_ID, NOETRA_AUDIT_CASE_ID, NOETRA_AUDIT_MISSION_ID and NOETRA_AUDIT_ACTOR_ID are required",
    );
  }
  const before = await prisma.structuredFascicoloReportSnapshot.findFirst({
    where: { tenantId, procedimentoId: caseId, status: "CURRENT" },
    select: { id: true, reportFingerprint: true },
  });
  const audit = await persistDefinitiveSourceAudit({ tenantId, caseId, missionId, actorId });
  const reportOutcome = await refreshStructuredReportAfterResearch({
    tenantId,
    procedimentoId: caseId,
  });
  const after = await prisma.structuredFascicoloReportSnapshot.findFirst({
    where: { tenantId, procedimentoId: caseId, status: "CURRENT" },
    select: { id: true, reportFingerprint: true },
  });
  console.log(JSON.stringify({
    audit: {
      attemptId: audit.attemptId,
      bundleId: audit.bundleId,
      providerCalls: 0,
      candidateCount: audit.candidates.length,
      classifications: Object.fromEntries(
        DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) => [item.canonicalIdentifier, item.classification]),
      ),
      assessments: audit.assessments.map((assessment) => ({
        id: assessment.id,
        outcome: assessment.outcome,
        usable: assessment.usable,
        blockingReasons: assessment.blockingReasons,
      })),
    },
    report: {
      outcome: reportOutcome,
      previousSnapshotId: before?.id ?? null,
      currentSnapshotId: after?.id ?? null,
      fingerprintChanged: before?.reportFingerprint !== after?.reportFingerprint,
    },
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
