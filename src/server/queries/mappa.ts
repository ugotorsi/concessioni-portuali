import { prisma } from "@/lib/prisma";
import { buildTenantConcessioneWhere, getCurrentTenantContext } from "@/lib/tenant-auth";

const OPEN_CRITICALITY_STATUSES = ["APERTA", "IN_GESTIONE"] as const;
const RELEVANT_DEADLINE_STATUSES = ["APERTA", "SCADUTA"] as const;

export interface MappaConcessioneItem {
  id: string;
  numeroAtto: string;
  concessionarioId: string;
  concessionario: string;
  ubicazione: string | null;
  stato: string;
  dataScadenza: Date;
  lat: number;
  lng: number;
  criticitaAperteCount: number;
  scadenzeRilevantiCount: number;
  fascicoliCount: number;
  fascicoloId: string | null;
}

export interface MappaConcessioneNonGeolocalizzata {
  id: string;
  numeroAtto: string;
  concessionario: string;
  ubicazione: string | null;
}

export interface MappaWorkspaceData {
  markers: MappaConcessioneItem[];
  nonGeolocalizzate: MappaConcessioneNonGeolocalizzata[];
  concessionari: Array<{ id: string; denominazione: string }>;
  stati: string[];
  summary: {
    concessioniGeolocalizzate: number;
    fascicoliCollegati: number;
    criticitaAperte: number;
    concessioniNonGeolocalizzate: number;
  };
}

export function parseValidCoordinates(input: {
  latitudineGis: unknown;
  longitudineGis: unknown;
  coordinateGis: string | null;
}): { lat: number; lng: number } | null {
  let lat = input.latitudineGis === null || input.latitudineGis === undefined
    ? null
    : Number(input.latitudineGis);
  let lng = input.longitudineGis === null || input.longitudineGis === undefined
    ? null
    : Number(input.longitudineGis);

  if ((lat === null || lng === null) && input.coordinateGis) {
    const match = input.coordinateGis.match(
      /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*[,;]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/,
    );

    if (match) {
      lat = Number(match[1]);
      lng = Number(match[2]);
    }
  }

  if (
    lat === null
    || lng === null
    || !Number.isFinite(lat)
    || !Number.isFinite(lng)
    || lat < -90
    || lat > 90
    || lng < -180
    || lng > 180
  ) {
    return null;
  }

  return { lat, lng };
}

export async function getMappaWorkspaceData(): Promise<MappaWorkspaceData> {
  const tenantContext = await getCurrentTenantContext();
  const concessioneWhere = buildTenantConcessioneWhere(tenantContext);
  const rows = await prisma.concessione.findMany({
    where: concessioneWhere,
    select: {
      id: true,
      numeroAtto: true,
      stato: true,
      ubicazione: true,
      areaDescrizione: true,
      dataScadenza: true,
      latitudineGis: true,
      longitudineGis: true,
      coordinateGis: true,
      concessionario: {
        select: { id: true, denominazione: true },
      },
      procedimenti: {
        orderBy: { createdAt: "desc" },
        select: { id: true },
      },
      criticita: {
        where: { stato: { in: [...OPEN_CRITICALITY_STATUSES] } },
        select: { id: true },
      },
      scadenze: {
        where: { stato: { in: [...RELEVANT_DEADLINE_STATUSES] } },
        select: { id: true },
      },
    },
    orderBy: { numeroAtto: "asc" },
  });

  const markers: MappaConcessioneItem[] = [];
  const nonGeolocalizzate: MappaConcessioneNonGeolocalizzata[] = [];
  const concessionari = new Map<string, string>();
  const stati = new Set<string>();

  for (const row of rows) {
    const ubicazione = row.ubicazione ?? row.areaDescrizione;
    const coordinates = parseValidCoordinates(row);
    concessionari.set(row.concessionario.id, row.concessionario.denominazione);
    stati.add(row.stato);

    if (!coordinates) {
      nonGeolocalizzate.push({
        id: row.id,
        numeroAtto: row.numeroAtto,
        concessionario: row.concessionario.denominazione,
        ubicazione,
      });
      continue;
    }

    markers.push({
      id: row.id,
      numeroAtto: row.numeroAtto,
      concessionarioId: row.concessionario.id,
      concessionario: row.concessionario.denominazione,
      ubicazione,
      stato: row.stato,
      dataScadenza: row.dataScadenza,
      lat: coordinates.lat,
      lng: coordinates.lng,
      criticitaAperteCount: row.criticita.length,
      scadenzeRilevantiCount: row.scadenze.length,
      fascicoliCount: row.procedimenti.length,
      fascicoloId: row.procedimenti[0]?.id ?? null,
    });
  }

  return {
    markers,
    nonGeolocalizzate,
    concessionari: [...concessionari.entries()]
      .map(([id, denominazione]) => ({ id, denominazione }))
      .sort((left, right) => left.denominazione.localeCompare(right.denominazione, "it")),
    stati: [...stati].sort(),
    summary: {
      concessioniGeolocalizzate: markers.length,
      fascicoliCollegati: markers.reduce((total, item) => total + item.fascicoliCount, 0),
      criticitaAperte: markers.reduce((total, item) => total + item.criticitaAperteCount, 0),
      concessioniNonGeolocalizzate: nonGeolocalizzate.length,
    },
  };
}

export type MappaMarkerType = "CONCESSIONE" | "CRITICITA" | "SOPRALLUOGO";
export type MappaRiskLevel = "BASSO" | "MEDIO" | "ALTO" | "CRITICO";

export interface MappaDemoMarker {
  id: string;
  type: MappaMarkerType;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  riskLevel: MappaRiskLevel;
  status: string;
  href: string;
}

/** Compatibility adapter for immutable release copies included by the workspace tsconfig. */
export async function getMappaDemoData() {
  const data = await getMappaWorkspaceData();
  return {
    summary: {
      concessioni: data.summary.concessioniGeolocalizzate,
      criticita: 0,
      sopralluoghi: 0,
      art47: 0,
      altaPriorita: 0,
    },
    markers: data.markers.map((item): MappaDemoMarker => ({
      id: item.id,
      type: "CONCESSIONE",
      title: `Concessione ${item.numeroAtto}`,
      subtitle: item.ubicazione ?? item.concessionario,
      lat: item.lat,
      lng: item.lng,
      riskLevel: "BASSO",
      status: item.stato,
      href: `/concessioni/${item.id}`,
    })),
  };
}
