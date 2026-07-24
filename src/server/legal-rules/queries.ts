import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, isTenantContextConstrained } from "@/lib/tenant-auth";

export interface GetLegalSourcesParams {
  search?: string;
  authorityKey?: string;
  portKey?: string;
  legalRank?: string;
  status?: string;
  role?: string;
  referenceDate?: string;
  issuingBody?: string;
  sourceNumber?: string;
  page?: number;
  pageSize?: number;
}

export interface LegalSourceListItem {
  id: string;
  stableKey: string;
  title: string;
  documentType: string;
  status: string;
  role: string;
  legalRank: string;
  issuingBody: string | null;
  sourceNumber: string | null;
  publicationDate: Date | null;
  effectiveFrom: Date | null;
  relativePath: string | null;
  checksum: string | null;
  rulesCount: number;
}

export interface LegalOrchestrationSummary {
  sources: number;
  activeRules: number;
  openGaps: number;
  lastImportRunAt: Date | null;
}

function buildTenantWhere(
  tenantContext: Awaited<ReturnType<typeof getCurrentTenantContext>>,
): Prisma.LegalSourceWhereInput {
  if (!tenantContext || !isTenantContextConstrained(tenantContext)) {
    return {};
  }

  if (tenantContext.accessibleTenantIds.length === 0) {
    return { enteId: null };
  }

  return {
    OR: [{ enteId: { in: tenantContext.accessibleTenantIds } }, { enteId: null }],
  };
}

function parseReferenceDate(referenceDate: string | undefined): Date | null {
  if (!referenceDate) {
    return null;
  }

  const parsed = new Date(referenceDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function sanitizeRelativePath(pathValue: string | null): string | null {
  if (!pathValue) {
    return null;
  }

  const normalized = pathValue.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes(":/")) {
    return null;
  }

  return normalized;
}

export async function getLegalSources(
  params: GetLegalSourcesParams,
): Promise<{ items: LegalSourceListItem[]; total: number; page: number; pageSize: number }> {
  const tenantContext = await getCurrentTenantContext();
  const tenantWhere = buildTenantWhere(tenantContext);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
  const search = params.search?.trim();
  const referenceDate = parseReferenceDate(params.referenceDate);

  const filtersWhere: Prisma.LegalSourceWhereInput = {
    ...(search
      ? {
          OR: [
            { sourceKey: { contains: search } },
            { title: { contains: search } },
            { notes: { contains: search } },
          ],
        }
      : {}),
    ...(params.authorityKey ? { authority: { is: { code: params.authorityKey } } } : {}),
    ...(params.portKey ? { port: { is: { code: params.portKey } } } : {}),
    ...(params.legalRank ? { legalRank: params.legalRank as never } : {}),
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.role ? { role: params.role as never } : {}),
    ...(params.issuingBody ? { issuingBody: { contains: params.issuingBody } } : {}),
    ...(params.sourceNumber ? { sourceNumber: { contains: params.sourceNumber } } : {}),
    ...(referenceDate
      ? {
          AND: [
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: referenceDate } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }] },
          ],
        }
      : {}),
  };

  const where: Prisma.LegalSourceWhereInput =
    Object.keys(tenantWhere).length > 0 && Object.keys(filtersWhere).length > 0
      ? { AND: [tenantWhere, filtersWhere] }
      : Object.keys(tenantWhere).length > 0
        ? tenantWhere
        : filtersWhere;

  let rows: Array<{
    id: string;
    sourceKey: string;
    title: string;
    sourceType: string;
    status: string;
    role: string;
    legalRank: string;
    issuingBody: string | null;
    sourceNumber: string | null;
    publicationDate: Date | null;
    effectiveFrom: Date | null;
    filePath: string | null;
    fileChecksumSha256: string | null;
    _count: { rules: number };
  }> = [];
  let total = 0;

  try {
    [rows, total] = await Promise.all([
      prisma.legalSource.findMany({
        where,
        orderBy: [{ publicationDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sourceKey: true,
          title: true,
          sourceType: true,
          status: true,
          role: true,
          legalRank: true,
          issuingBody: true,
          sourceNumber: true,
          publicationDate: true,
          effectiveFrom: true,
          filePath: true,
          fileChecksumSha256: true,
          _count: {
            select: {
              rules: true,
            },
          },
        },
      }),
      prisma.legalSource.count({ where }),
    ]);
  } catch {
    rows = [];
    total = 0;
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      stableKey: row.sourceKey,
      title: row.title,
      documentType: row.sourceType,
      status: row.status,
      role: row.role,
      legalRank: row.legalRank,
      issuingBody: row.issuingBody,
      sourceNumber: row.sourceNumber,
      publicationDate: row.publicationDate,
      effectiveFrom: row.effectiveFrom,
      relativePath: sanitizeRelativePath(row.filePath),
      checksum: row.fileChecksumSha256,
      rulesCount: row._count.rules,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getLegalOrchestrationSummary(): Promise<LegalOrchestrationSummary> {
  const tenantContext = await getCurrentTenantContext();
  const tenantWhere = buildTenantWhere(tenantContext);
  const sourceWhere = tenantWhere;

  const ruleWhere: Prisma.LegalRuleWhereInput =
    Object.keys(tenantWhere).length === 0
      ? { status: "ATTIVA" }
      : {
          status: "ATTIVA",
          OR: [{ enteId: { in: tenantContext?.accessibleTenantIds ?? [] } }, { enteId: null }],
        };

  const gapWhere: Prisma.DocumentGapWhereInput =
    Object.keys(tenantWhere).length === 0
      ? { status: { in: ["APERTA", "IN_GESTIONE"] } }
      : {
          status: { in: ["APERTA", "IN_GESTIONE"] },
          OR: [{ enteId: { in: tenantContext?.accessibleTenantIds ?? [] } }, { enteId: null }],
        };

  const importWhere: Prisma.ImportRunWhereInput =
    Object.keys(tenantWhere).length === 0
      ? {}
      : {
          OR: [{ enteId: { in: tenantContext?.accessibleTenantIds ?? [] } }, { enteId: null }],
        };

  let sources = 0;
  let activeRules = 0;
  let openGaps = 0;
  let latestRun: { startedAt: Date } | null = null;

  try {
    [sources, activeRules, openGaps, latestRun] = await Promise.all([
      prisma.legalSource.count({ where: sourceWhere }),
      prisma.legalRule.count({ where: ruleWhere }),
      prisma.documentGap.count({ where: gapWhere }),
      prisma.importRun.findFirst({
        where: importWhere,
        orderBy: [{ startedAt: "desc" }],
        select: { startedAt: true },
      }),
    ]);
  } catch {
    // Keep UI accessible when DB is unavailable in local dev.
  }

  return {
    sources,
    activeRules,
    openGaps,
    lastImportRunAt: latestRun?.startedAt ?? null,
  };
}

export async function getRecentImportRuns(limit = 8) {
  const tenantContext = await getCurrentTenantContext();
  const isScoped = Boolean(tenantContext && isTenantContextConstrained(tenantContext));

  let where: Prisma.ImportRunWhereInput = {};

  if (isScoped && tenantContext) {
    where =
      tenantContext.accessibleTenantIds.length > 0
        ? {
            OR: [{ enteId: { in: tenantContext.accessibleTenantIds } }, { enteId: null }],
          }
        : { enteId: null };
  }

  try {
    return await prisma.importRun.findMany({
      where,
      orderBy: [{ startedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        packCode: true,
        packVersion: true,
        status: true,
        sourceCount: true,
        ruleCount: true,
        relationCount: true,
        gapCount: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
      },
    });
  } catch {
    return [];
  }
}
