import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

const procedimentoId = process.argv[2]?.trim();
if (!procedimentoId) {
  throw new Error("PROCEDIMENTO_ID_REQUIRED");
}

function digest(value: string | null): string | null {
  return value ? createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16) : null;
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return "INVALID_URL";
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const database = new URL(databaseUrl);
  const procedureRows = await prisma.$queryRawUnsafe<{
  id: string;
  tenantId: string;
}[]>(`
  SELECT "id", "enteId" AS "tenantId"
  FROM "Procedimento"
  WHERE "id" = $1
`, procedimentoId);

  const procedure = procedureRows[0] ?? null;
  const currentRevisions = await prisma.$queryRawUnsafe<{
    id: string;
    status: string;
    reportCount: number;
  }[]>(`
    SELECT
      revision."id",
      revision."status"::text,
      (
        SELECT count(*)::int
        FROM "StructuredFascicoloReportSnapshot" report
        WHERE report."knowledgeRevisionId" = revision."id"
      ) AS "reportCount"
    FROM "FascicoloKnowledgeRevision" revision
    WHERE revision."procedimentoId" = $1 AND revision."status" = 'CURRENT'
    ORDER BY revision."createdAt" DESC
  `, procedimentoId);
  const missionRows = await prisma.$queryRawUnsafe<{
  id: string;
  caseId: string;
  tenantId: string | null;
  status: string;
  lifecycleStatus: string;
  mode: string;
  knowledgeRevisionId: string | null;
  legalIssueSemanticKey: string | null;
  researchQuestionSemanticKey: string | null;
  assignedActorId: string | null;
  resultCount: number;
  bundleCount: number;
}[]>(`
  SELECT
    m."id",
    m."caseId",
    m."tenantId",
    m."status"::text,
    m."lifecycleStatus"::text,
    m."mode",
    m."knowledgeRevisionId",
    m."legalIssueSemanticKey",
    m."researchQuestionSemanticKey",
    m."assignedActorId",
    (SELECT count(*)::int FROM "ResearchQuestionResultRecord" r WHERE r."missionId" = m."id") AS "resultCount",
    (
      SELECT count(*)::int
      FROM "ResearchEvidenceBundleRecord" b
      WHERE b."missionId" = m."id"
    ) AS "bundleCount"
  FROM "ResearchMissionRecord" m
  WHERE m."caseId" = $1
  ORDER BY m."createdAt", m."id"
`, procedimentoId);

  const statusRows = await prisma.$queryRawUnsafe<{
  caseId: string;
  status: string;
  tenantId: string | null;
  assignedActorId: string | null;
  count: number;
}[]>(`
SELECT "caseId", "status"::text, "tenantId", "assignedActorId", count(*)::int AS "count"
FROM "ResearchMissionRecord"
WHERE "lifecycleStatus" = 'CURRENT'
GROUP BY "caseId", "status", "tenantId", "assignedActorId"
ORDER BY "caseId", "status", "assignedActorId"
`);

  console.log(JSON.stringify({
  environment: {
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    nextAuthOrigin: safeOrigin(process.env.NEXTAUTH_URL),
    mcpResourceOrigin: safeOrigin(process.env.MCP_RESOURCE_URI),
    databaseHostDigest: digest(database.hostname),
    databaseName: database.pathname.replace(/^\//, ""),
  },
  requestedProcedure: {
    id: procedimentoId,
    exists: procedure !== null,
    tenantDigest: digest(procedure?.tenantId ?? null),
    currentRevisions,
  },
  missions: missionRows.map((mission) => ({
    id: mission.id,
    caseId: mission.caseId,
    tenantMatchesProcedure: procedure !== null && mission.tenantId === procedure.tenantId,
    status: mission.status,
    lifecycleStatus: mission.lifecycleStatus,
    mode: mission.mode,
    knowledgeRevisionId: mission.knowledgeRevisionId,
    hasLegalIssueLink: mission.legalIssueSemanticKey !== null,
    hasResearchQuestionLink: mission.researchQuestionSemanticKey !== null,
    assignedActorDigest: digest(mission.assignedActorId),
    resultCount: mission.resultCount,
    bundleCount: mission.bundleCount,
  })),
  currentMissionInventory: statusRows.map((row) => ({
    caseId: row.caseId,
    status: row.status,
    tenantDigest: digest(row.tenantId),
    assignedActorDigest: digest(row.assignedActorId),
    count: row.count,
  })),
  }, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
