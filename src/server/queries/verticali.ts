import { prisma } from "@/lib/prisma";
import { buildTenantConcessioneWhere, getCurrentTenantContext } from "@/lib/tenant-auth";
import { getVerticaleBySlug, VERTICALI_CONFIG, type ConcessionVerticalValue } from "@/lib/verticali-config";

export interface VerticaleOverviewItem {
  value: ConcessionVerticalValue;
  slug: string;
  label: string;
  description: string;
  coverageLabel: string;
  concessioniCount: number;
  hasConcessioni: boolean;
}

export interface VerticaleWorkspaceConcessioneItem {
  id: string;
  numeroAtto: string;
  stato: string;
  dataScadenza: Date;
  concessionarioDenominazione: string;
  ubicazione: string | null;
  criticitaAperteCount: number;
  scadenzeAperteScaduteCount: number;
  procedimentiInCorsoCount: number;
}

export interface VerticaleWorkspaceData {
  verticale: VerticaleOverviewItem;
  indicatori: {
    concessioni: number;
    criticitaAperte: number;
    scadenzeAperteScadute: number;
    procedimentiInCorso: number;
    documenti: number;
    report: number;
  };
  concessioni: VerticaleWorkspaceConcessioneItem[];
}

export interface VerticaliDashboardSummaryItem {
  value: ConcessionVerticalValue;
  slug: string;
  label: string;
  concessioniCount: number;
}

function buildVerticalConcessioneWhere(baseWhere: Record<string, unknown>, verticalValue: ConcessionVerticalValue) {
  return {
    ...baseWhere,
    concessionVertical: verticalValue,
  };
}

export async function getVerticaliOverview(): Promise<VerticaleOverviewItem[]> {
  const tenantContext = await getCurrentTenantContext();
  const tenantWhere = buildTenantConcessioneWhere(tenantContext);

  const counts = await Promise.all(
    VERTICALI_CONFIG.map((verticale) =>
      prisma.concessione.count({
        where: buildVerticalConcessioneWhere(tenantWhere, verticale.value),
      }),
    ),
  );

  return VERTICALI_CONFIG.map((verticale, index) => {
    const concessioniCount = counts[index] ?? 0;
    return {
      value: verticale.value,
      slug: verticale.slug,
      label: verticale.label,
      description: verticale.description,
      coverageLabel: verticale.coverageLabel,
      concessioniCount,
      hasConcessioni: concessioniCount > 0,
    };
  });
}

export async function getVerticaliDashboardSummary(): Promise<{
  totalVerticaliConfigurate: number;
  verticaliConConcessioniNelPerimetro: number;
  items: VerticaliDashboardSummaryItem[];
}> {
  const rows = await getVerticaliOverview();
  const verticaliConConcessioniNelPerimetro = rows.filter((item) => item.hasConcessioni).length;

  return {
    totalVerticaliConfigurate: rows.length,
    verticaliConConcessioniNelPerimetro,
    items: rows.map((item) => ({
      value: item.value,
      slug: item.slug,
      label: item.label,
      concessioniCount: item.concessioniCount,
    })),
  };
}

export async function getVerticaleWorkspaceBySlug(slug: string): Promise<VerticaleWorkspaceData | null> {
  const verticale = getVerticaleBySlug(slug);
  if (!verticale) {
    return null;
  }

  const tenantContext = await getCurrentTenantContext();
  const tenantWhere = buildTenantConcessioneWhere(tenantContext);
  const concessioneWhere = buildVerticalConcessioneWhere(tenantWhere, verticale.value);

  const concessioniRows = await prisma.concessione.findMany({
    where: concessioneWhere,
    orderBy: [{ dataScadenza: "asc" }, { numeroAtto: "asc" }],
    select: {
      id: true,
      numeroAtto: true,
      stato: true,
      dataScadenza: true,
      ubicazione: true,
      concessionario: {
        select: {
          denominazione: true,
        },
      },
    },
  });

  const concessioneIds = concessioniRows.map((item) => item.id);

  const [criticitaGrouped, scadenzeGrouped, procedimentiGrouped, indicatori] = await Promise.all([
    concessioneIds.length > 0
      ? prisma.criticita.groupBy({
          by: ["concessioneId"],
          where: {
            concessioneId: { in: concessioneIds },
            stato: { in: ["APERTA", "IN_GESTIONE"] },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    concessioneIds.length > 0
      ? prisma.scadenza.groupBy({
          by: ["concessioneId"],
          where: {
            concessioneId: { in: concessioneIds },
            stato: { in: ["APERTA", "SCADUTA"] },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    concessioneIds.length > 0
      ? prisma.procedimento.groupBy({
          by: ["concessioneId"],
          where: {
            concessioneId: { in: concessioneIds },
            stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    Promise.all([
      prisma.concessione.count({ where: concessioneWhere }),
      prisma.criticita.count({
        where: {
          stato: { in: ["APERTA", "IN_GESTIONE"] },
          concessione: { is: concessioneWhere },
        },
      }),
      prisma.scadenza.count({
        where: {
          stato: { in: ["APERTA", "SCADUTA"] },
          concessione: { is: concessioneWhere },
        },
      }),
      prisma.procedimento.count({
        where: {
          stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
          concessione: { is: concessioneWhere },
        },
      }),
      prisma.documento.count({
        where: {
          concessione: { is: concessioneWhere },
        },
      }),
      prisma.report.count({
        where: {
          concessione: { is: concessioneWhere },
        },
      }),
    ]),
  ]);

  const criticitaMap = new Map(criticitaGrouped.map((item) => [item.concessioneId, item._count._all]));
  const scadenzeMap = new Map(scadenzeGrouped.map((item) => [item.concessioneId, item._count._all]));
  const procedimentiMap = new Map(procedimentiGrouped.map((item) => [item.concessioneId, item._count._all]));

  return {
    verticale: {
      value: verticale.value,
      slug: verticale.slug,
      label: verticale.label,
      description: verticale.description,
      coverageLabel: verticale.coverageLabel,
      concessioniCount: indicatori[0],
      hasConcessioni: indicatori[0] > 0,
    },
    indicatori: {
      concessioni: indicatori[0],
      criticitaAperte: indicatori[1],
      scadenzeAperteScadute: indicatori[2],
      procedimentiInCorso: indicatori[3],
      documenti: indicatori[4],
      report: indicatori[5],
    },
    concessioni: concessioniRows.map((item) => ({
      id: item.id,
      numeroAtto: item.numeroAtto,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      concessionarioDenominazione: item.concessionario.denominazione,
      ubicazione: item.ubicazione,
      criticitaAperteCount: criticitaMap.get(item.id) ?? 0,
      scadenzeAperteScaduteCount: scadenzeMap.get(item.id) ?? 0,
      procedimentiInCorsoCount: procedimentiMap.get(item.id) ?? 0,
    })),
  };
}