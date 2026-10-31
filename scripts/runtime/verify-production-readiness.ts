import { prisma } from "../../src/lib/prisma";
import { VERCEL_PREVIEW_DEPLOYMENT } from "../deploy/vercel-preview";

async function main(): Promise<void> {
  if (
    process.env.VERCEL_ENV !== "production"
    || process.env.VERCEL_PROJECT_ID !== VERCEL_PREVIEW_DEPLOYMENT.projectId
  ) {
    throw new Error("PRODUCTION_READINESS_SCOPE_MISMATCH");
  }

  const now = new Date();
  const recentThreshold = new Date(now.getTime() - 30 * 60 * 1000);
  const [admins, schemaTables, recentAuthFailures] = await Promise.all([
    prisma.user.findMany({
      where: { ruolo: "ADMIN" },
      select: {
        attivo: true,
        passwordHash: true,
        lockedUntil: true,
        mfaEnabled: true,
        mfaSecret: true,
      },
    }),
    prisma.$queryRaw<Array<{
      knowledgeRevisionTable: string | null;
      structuredReportTable: string | null;
    }>>`
      SELECT
        to_regclass('"FascicoloKnowledgeRevision"')::text AS "knowledgeRevisionTable",
        to_regclass('"StructuredFascicoloReportSnapshot"')::text AS "structuredReportTable"
    `,
    prisma.activityLog.findMany({
      where: {
        azione: { in: ["AUTH_LOGIN_FAILURE", "AUTH_MFA_FAILURE", "AUTH_ACCOUNT_LOCKED"] },
        createdAt: { gte: recentThreshold },
      },
      select: { azione: true, metadata: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  const knowledgeRevisionTableAvailable = Boolean(schemaTables[0]?.knowledgeRevisionTable);
  const structuredReportTableAvailable = Boolean(schemaTables[0]?.structuredReportTable);
  const [currentKnowledgeRevisions, currentStructuredReports] = await Promise.all([
    knowledgeRevisionTableAvailable
      ? prisma.fascicoloKnowledgeRevision.count({ where: { status: "CURRENT" } })
      : Promise.resolve(0),
    structuredReportTableAvailable
      ? prisma.structuredFascicoloReportSnapshot.count({ where: { status: "CURRENT" } })
      : Promise.resolve(0),
  ]);
  const readiness = {
    adminTotal: admins.length,
    adminReady: admins.filter((admin) => (
      admin.attivo
      && Boolean(admin.passwordHash)
      && (!admin.lockedUntil || admin.lockedUntil <= now)
      && admin.mfaEnabled
      && Boolean(admin.mfaSecret)
    )).length,
    adminActive: admins.filter((admin) => admin.attivo).length,
    adminUnlocked: admins.filter((admin) => !admin.lockedUntil || admin.lockedUntil <= now).length,
    adminWithPassword: admins.filter((admin) => Boolean(admin.passwordHash)).length,
    adminWithMfa: admins.filter((admin) => admin.mfaEnabled && Boolean(admin.mfaSecret)).length,
    knowledgeRevisionTableAvailable,
    structuredReportTableAvailable,
    currentKnowledgeRevisions,
    currentStructuredReports,
    recentAuthFailureReasons: recentAuthFailures.map((entry) => {
      const metadata = entry.metadata;
      const reason = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        && typeof (metadata as Record<string, unknown>).reason === "string"
        ? (metadata as Record<string, unknown>).reason
        : "UNCLASSIFIED";
      return { action: entry.azione, reason };
    }),
  };

  console.info(`NOETRA_PRODUCTION_READINESS=${JSON.stringify(readiness)}`);
  if (readiness.adminReady < 1 || readiness.currentStructuredReports < 1) {
    throw new Error("PRODUCTION_READINESS_BLOCKED");
  }
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "PRODUCTION_READINESS_FAILED");
    process.exitCode = 1;
  });
