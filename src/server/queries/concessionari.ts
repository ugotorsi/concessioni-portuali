import { startOfDay } from "date-fns";

import { prisma } from "@/lib/prisma";
import {
  buildTenantConcessioneWhere,
  getCurrentTenantContext,
} from "@/lib/tenant-auth";

const OPEN_CRITICALITY_STATUSES = ["APERTA", "IN_GESTIONE"] as const;
const RELEVANT_DEADLINE_STATUSES = ["APERTA", "SCADUTA"] as const;
const CRITICAL_PAYMENT_STATUSES = ["NON_PAGATO", "PARZIALE", "SCADUTO"] as const;

export interface ConcessionarioListItem {
  id: string;
  denominazione: string;
  codiceFiscale: string | null;
  partitaIva: string | null;
  contatto: string | null;
  concessioniCount: number;
  concessioniAttiveCount: number;
  fascicoliCount: number;
  criticitaAperteCount: number;
  pagamentiCriticiCount: number;
  prossimaScadenza: Date | null;
  numeriConcessione: string[];
}

export interface ConcessionariListResult {
  items: ConcessionarioListItem[];
  summary: {
    concessionari: number;
    concessioniAttive: number;
    criticitaAperte: number;
  };
}

export interface ConcessionarioDetail {
  id: string;
  denominazione: string;
  codiceFiscale: string | null;
  partitaIva: string | null;
  sedeLegale: string | null;
  pec: string | null;
  email: string | null;
  telefono: string | null;
  legaleRappresentante: string | null;
  concessioni: Array<{
    id: string;
    numeroAtto: string;
    stato: string;
    ubicazione: string | null;
    dataRilascio: Date;
    dataScadenza: Date;
    canoneAnnuo: number | null;
    procedimenti: Array<{
      id: string;
      tipologia: string;
      stato: string;
      createdAt: Date;
    }>;
  }>;
  criticita: Array<{
    id: string;
    concessioneNumero: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
  }>;
  scadenze: Array<{
    id: string;
    concessioneNumero: string;
    tipologia: string;
    stato: string;
    dataScadenza: Date;
    descrizione: string | null;
  }>;
  documenti: Array<{
    id: string;
    concessioneNumero: string;
    nome: string;
    tipologia: string;
    dataDocumento: Date | null;
  }>;
}

function tenantConcessioneWhere(
  tenantContext: Awaited<ReturnType<typeof getCurrentTenantContext>>,
) {
  return buildTenantConcessioneWhere(tenantContext);
}

export async function getConcessionariList(): Promise<ConcessionariListResult> {
  const tenantContext = await getCurrentTenantContext();
  const today = startOfDay(new Date());
  const concessioneWhere = tenantConcessioneWhere(tenantContext);

  const rows = await prisma.concessionario.findMany({
    where: { concessioni: { some: concessioneWhere } },
    select: {
      id: true,
      denominazione: true,
      codiceFiscale: true,
      partitaIva: true,
      pec: true,
      email: true,
      telefono: true,
      concessioni: {
        where: concessioneWhere,
        select: {
          numeroAtto: true,
          stato: true,
          dataScadenza: true,
          procedimenti: { select: { id: true } },
          criticita: {
            where: { stato: { in: [...OPEN_CRITICALITY_STATUSES] } },
            select: { id: true },
          },
          pagamenti: {
            where: { stato: { in: [...CRITICAL_PAYMENT_STATUSES] } },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { denominazione: "asc" },
  });

  const items = rows.map((row) => {
    const futureExpiryDates = row.concessioni
      .map((concessione) => concessione.dataScadenza)
      .filter((date) => date >= today)
      .sort((left, right) => left.getTime() - right.getTime());

    return {
      id: row.id,
      denominazione: row.denominazione,
      codiceFiscale: row.codiceFiscale,
      partitaIva: row.partitaIva,
      contatto: row.pec ?? row.email ?? row.telefono,
      concessioniCount: row.concessioni.length,
      concessioniAttiveCount: row.concessioni.filter((item) => item.stato === "ATTIVA").length,
      fascicoliCount: row.concessioni.reduce((total, item) => total + item.procedimenti.length, 0),
      criticitaAperteCount: row.concessioni.reduce((total, item) => total + item.criticita.length, 0),
      pagamentiCriticiCount: row.concessioni.reduce((total, item) => total + item.pagamenti.length, 0),
      prossimaScadenza: futureExpiryDates[0] ?? null,
      numeriConcessione: row.concessioni.map((item) => item.numeroAtto),
    };
  });

  return {
    items,
    summary: {
      concessionari: items.length,
      concessioniAttive: items.reduce((total, item) => total + item.concessioniAttiveCount, 0),
      criticitaAperte: items.reduce((total, item) => total + item.criticitaAperteCount, 0),
    },
  };
}

export async function getConcessionarioDetail(id: string): Promise<ConcessionarioDetail | null> {
  const tenantContext = await getCurrentTenantContext();
  const concessioneWhere = tenantConcessioneWhere(tenantContext);
  const row = await prisma.concessionario.findFirst({
    where: { id, concessioni: { some: concessioneWhere } },
    select: {
      id: true,
      denominazione: true,
      codiceFiscale: true,
      partitaIva: true,
      sedeLegale: true,
      pec: true,
      email: true,
      telefono: true,
      legaleRappresentante: true,
      concessioni: {
        where: concessioneWhere,
        orderBy: { dataScadenza: "asc" },
        select: {
          id: true,
          numeroAtto: true,
          stato: true,
          ubicazione: true,
          dataRilascio: true,
          dataScadenza: true,
          canoneAnnuo: true,
          procedimenti: {
            orderBy: { createdAt: "desc" },
            select: { id: true, tipologia: true, stato: true, createdAt: true },
          },
          criticita: {
            where: { stato: { in: [...OPEN_CRITICALITY_STATUSES] } },
            orderBy: { dataRilevazione: "desc" },
            select: { id: true, tipologia: true, gravita: true, stato: true, descrizione: true },
          },
          scadenze: {
            where: { stato: { in: [...RELEVANT_DEADLINE_STATUSES] } },
            orderBy: { dataScadenza: "asc" },
            select: { id: true, tipologia: true, stato: true, dataScadenza: true, descrizione: true },
          },
          documenti: {
            orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
            select: { id: true, nome: true, tipologia: true, dataDocumento: true },
          },
        },
      },
    },
  });

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    denominazione: row.denominazione,
    codiceFiscale: row.codiceFiscale,
    partitaIva: row.partitaIva,
    sedeLegale: row.sedeLegale,
    pec: row.pec,
    email: row.email,
    telefono: row.telefono,
    legaleRappresentante: row.legaleRappresentante,
    concessioni: row.concessioni.map((item) => ({
      id: item.id,
      numeroAtto: item.numeroAtto,
      stato: item.stato,
      ubicazione: item.ubicazione,
      dataRilascio: item.dataRilascio,
      dataScadenza: item.dataScadenza,
      canoneAnnuo: item.canoneAnnuo === null ? null : Number(item.canoneAnnuo),
      procedimenti: item.procedimenti,
    })),
    criticita: row.concessioni.flatMap((concessione) =>
      concessione.criticita.map((item) => ({
        ...item,
        concessioneNumero: concessione.numeroAtto,
      })),
    ),
    scadenze: row.concessioni.flatMap((concessione) =>
      concessione.scadenze.map((item) => ({
        ...item,
        concessioneNumero: concessione.numeroAtto,
      })),
    ),
    documenti: row.concessioni.flatMap((concessione) =>
      concessione.documenti.map((item) => ({
        ...item,
        concessioneNumero: concessione.numeroAtto,
      })),
    ),
  };
}