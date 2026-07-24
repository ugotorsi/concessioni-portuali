import { addDays, startOfDay } from "date-fns";

import { prisma } from "@/lib/prisma";
import { buildTenantConcessioneWhere, getCurrentTenantContext } from "@/lib/tenant-auth";

export interface AdspKpi {
  concessioniMonitorate: number;
  criticitaAperte: number;
  procedimentiInCorso: number;
  reportValidati: number;
  scadenzeImminenti: number;
  pagamentiCritici: number;
}

export interface AdspReportItem {
  id: string;
  titolo: string;
  tipologia: string;
  createdAt: Date;
  concessioneNumeroAtto: string | null;
}

export interface AdspCriticitaItem {
  id: string;
  tipologia: string;
  gravita: string;
  stato: string;
  descrizione: string;
  concessioneNumeroAtto: string;
}

export interface AdspProcedimentoItem {
  id: string;
  tipologia: string;
  stato: string;
  riferimentoNormativo: string | null;
  concessioneNumeroAtto: string;
  dataScadenzaContraddittorio: Date | null;
}

export interface AdspData {
  kpi: AdspKpi;
  reportValidatiRecenti: AdspReportItem[];
  criticitaApertePrincipali: AdspCriticitaItem[];
  procedimentiInCorso: AdspProcedimentoItem[];
}

export async function getAdspData(): Promise<AdspData> {
  const today = startOfDay(new Date());
  const in30Days = addDays(today, 30);
  const tenantContext = await getCurrentTenantContext();
  const concessioneTenantWhere = buildTenantConcessioneWhere(tenantContext);
  const hasConcessioneTenantScope = Object.keys(concessioneTenantWhere).length > 0;

  const [
    concessioniMonitorate,
    criticitaAperte,
    procedimentiInCorso,
    reportValidati,
    scadenzeImminenti,
    pagamentiCritici,
    reportValidatiRecentiRows,
    criticitaApertePrincipaliRows,
    procedimentiInCorsoRows,
  ] = await Promise.all([
    prisma.concessione.count({ where: concessioneTenantWhere }),
    prisma.criticita.count({
      where: {
        stato: { in: ["APERTA", "IN_GESTIONE"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
    }),
    prisma.procedimento.count({
      where: {
        stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
    }),
    prisma.report.count({
      where: {
        validato: true,
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
    }),
    prisma.scadenza.count({
      where: {
        stato: { in: ["APERTA", "SCADUTA"] },
        dataScadenza: { lte: in30Days },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
    }),
    prisma.pagamento.count({
      where: {
        stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
    }),
    prisma.report.findMany({
      where: {
        validato: true,
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        titolo: true,
        tipologia: true,
        createdAt: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
    prisma.criticita.findMany({
      where: {
        stato: { in: ["APERTA", "IN_GESTIONE"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
      orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
      take: 6,
      select: {
        id: true,
        tipologia: true,
        gravita: true,
        stato: true,
        descrizione: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
    prisma.procedimento.findMany({
      where: {
        stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
      orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        tipologia: true,
        stato: true,
        riferimentoNormativo: true,
        dataScadenzaContraddittorio: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
  ]);

  return {
    kpi: {
      concessioniMonitorate,
      criticitaAperte,
      procedimentiInCorso,
      reportValidati,
      scadenzeImminenti,
      pagamentiCritici,
    },
    reportValidatiRecenti: reportValidatiRecentiRows.map((item) => ({
      id: item.id,
      titolo: item.titolo,
      tipologia: item.tipologia,
      createdAt: item.createdAt,
      concessioneNumeroAtto: item.concessione?.numeroAtto ?? null,
    })),
    criticitaApertePrincipali: criticitaApertePrincipaliRows.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: item.descrizione,
      concessioneNumeroAtto: item.concessione.numeroAtto,
    })),
    procedimentiInCorso: procedimentiInCorsoRows.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      riferimentoNormativo: item.riferimentoNormativo,
      concessioneNumeroAtto: item.concessione.numeroAtto,
      dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
    })),
  };
}
