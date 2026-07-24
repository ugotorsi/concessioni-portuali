import { prisma } from "@/lib/prisma";
import { buildTenantConcessioneWhere, getCurrentTenantContext } from "@/lib/tenant-auth";

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
  scenarioSlug?: string;
}

export interface MappaDemoData {
  summary: {
    concessioni: number;
    criticita: number;
    sopralluoghi: number;
    art47: number;
    altaPriorita: number;
  };
  markers: MappaDemoMarker[];
}

const SCENARIO_BY_CONCESSIONE: Record<string, string> = {
  "CP-014/2020": "morosita-art47",
  "CP-001/2021": "occupazione-difforme",
  "CP-067/2018": "regolarizzazione-pre-provvedimento",
  "CP-058/2019": "istanza-parte-art10bis",
};

function resolveRiskForConcessione(stato: string): MappaRiskLevel {
  if (["DECADUTA", "REVOCATA"].includes(stato)) {
    return "CRITICO";
  }

  if (["SCADUTA", "SOSPESA"].includes(stato)) {
    return "ALTO";
  }

  if (stato === "IN_PROROGA") {
    return "MEDIO";
  }

  return "BASSO";
}

function resolveRiskForCriticita(args: { gravita: string; rischioDecadenza: string | null }): MappaRiskLevel {
  if (args.rischioDecadenza === "CRITICO" || args.gravita === "URGENTE") {
    return "CRITICO";
  }

  if (args.rischioDecadenza === "ALTO" || args.gravita === "ALTA") {
    return "ALTO";
  }

  if (args.rischioDecadenza === "MEDIO" || args.gravita === "MEDIA") {
    return "MEDIO";
  }

  return "BASSO";
}

function resolveRiskForSopralluogo(esito: string): MappaRiskLevel {
  if (esito === "NEGATIVO") {
    return "CRITICO";
  }

  if (esito === "CON_RILIEVI") {
    return "ALTO";
  }

  return "BASSO";
}

function pickCoordinates(args: {
  lat: unknown;
  lng: unknown;
  fallbackLat?: unknown;
  fallbackLng?: unknown;
}): { lat: number; lng: number } | null {
  const lat = typeof args.lat === "number" ? args.lat : null;
  const lng = typeof args.lng === "number" ? args.lng : null;

  if (lat !== null && lng !== null) {
    return { lat, lng };
  }

  const fallbackLat = typeof args.fallbackLat === "number" ? args.fallbackLat : null;
  const fallbackLng = typeof args.fallbackLng === "number" ? args.fallbackLng : null;

  if (fallbackLat !== null && fallbackLng !== null) {
    return { lat: fallbackLat, lng: fallbackLng };
  }

  return null;
}

export async function getMappaDemoData(): Promise<MappaDemoData> {
  const tenantContext = await getCurrentTenantContext();
  const concessioneTenantWhere = buildTenantConcessioneWhere(tenantContext);
  const hasConcessioneTenantScope = Object.keys(concessioneTenantWhere).length > 0;

  const [concessioniRows, criticitaRows, sopralluoghiRows] = await Promise.all([
    prisma.concessione.findMany({
      where: concessioneTenantWhere,
      select: {
        id: true,
        numeroAtto: true,
        stato: true,
        ubicazione: true,
        areaDescrizione: true,
        zonaPortuale: true,
        latitudineGis: true,
        longitudineGis: true,
      },
      orderBy: [{ numeroAtto: "asc" }],
      take: 120,
    }),
    prisma.criticita.findMany({
      where: {
        stato: { in: ["APERTA", "IN_GESTIONE"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
      select: {
        id: true,
        tipologia: true,
        gravita: true,
        stato: true,
        rischioDecadenza: true,
        rilevanzaArt47: true,
        localizzazioneDescrizione: true,
        latitudineGis: true,
        longitudineGis: true,
        concessione: {
          select: {
            id: true,
            numeroAtto: true,
            latitudineGis: true,
            longitudineGis: true,
          },
        },
      },
      orderBy: [{ dataRilevazione: "desc" }],
      take: 160,
    }),
    prisma.sopralluogo.findMany({
      where: {
        esito: { in: ["CON_RILIEVI", "NEGATIVO", "POSITIVO"] },
        ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
      },
      select: {
        id: true,
        esito: true,
        localizzazioneDescrizione: true,
        latitudineGis: true,
        longitudineGis: true,
        concessione: {
          select: {
            id: true,
            numeroAtto: true,
            latitudineGis: true,
            longitudineGis: true,
          },
        },
      },
      orderBy: [{ data: "desc" }],
      take: 160,
    }),
  ]);

  const concessioni = concessioniRows.flatMap((row) => {
    const coordinates = pickCoordinates({
      lat: row.latitudineGis ? Number(row.latitudineGis) : null,
      lng: row.longitudineGis ? Number(row.longitudineGis) : null,
    });

    if (!coordinates) {
      return [];
    }

    return [
      {
        id: row.id,
        type: "CONCESSIONE",
        title: `Concessione ${row.numeroAtto}`,
        subtitle: row.areaDescrizione ?? row.zonaPortuale ?? row.ubicazione ?? "Area non specificata",
        lat: coordinates.lat,
        lng: coordinates.lng,
        riskLevel: resolveRiskForConcessione(row.stato),
        status: row.stato,
        href: `/concessioni/${row.id}`,
        scenarioSlug: SCENARIO_BY_CONCESSIONE[row.numeroAtto],
      } satisfies MappaDemoMarker,
    ];
  });

  const criticita = criticitaRows.flatMap((row) => {
    const coordinates = pickCoordinates({
      lat: row.latitudineGis ? Number(row.latitudineGis) : null,
      lng: row.longitudineGis ? Number(row.longitudineGis) : null,
      fallbackLat: row.concessione.latitudineGis ? Number(row.concessione.latitudineGis) : null,
      fallbackLng: row.concessione.longitudineGis ? Number(row.concessione.longitudineGis) : null,
    });

    if (!coordinates) {
      return [];
    }

    return [
      {
        id: row.id,
        type: "CRITICITA",
        title: `Criticità ${row.tipologia}`,
        subtitle: row.localizzazioneDescrizione ?? `Concessione ${row.concessione.numeroAtto}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
        riskLevel: resolveRiskForCriticita({ gravita: row.gravita, rischioDecadenza: row.rischioDecadenza }),
        status: row.stato,
        href: `/criticita/${row.id}`,
        scenarioSlug: SCENARIO_BY_CONCESSIONE[row.concessione.numeroAtto],
      } satisfies MappaDemoMarker,
    ];
  });

  const sopralluoghi = sopralluoghiRows.flatMap((row) => {
    const coordinates = pickCoordinates({
      lat: row.latitudineGis ? Number(row.latitudineGis) : null,
      lng: row.longitudineGis ? Number(row.longitudineGis) : null,
      fallbackLat: row.concessione.latitudineGis ? Number(row.concessione.latitudineGis) : null,
      fallbackLng: row.concessione.longitudineGis ? Number(row.concessione.longitudineGis) : null,
    });

    if (!coordinates) {
      return [];
    }

    return [
      {
        id: row.id,
        type: "SOPRALLUOGO",
        title: `Sopralluogo ${row.esito}`,
        subtitle: row.localizzazioneDescrizione ?? `Concessione ${row.concessione.numeroAtto}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
        riskLevel: resolveRiskForSopralluogo(row.esito),
        status: row.esito,
        href: `/sopralluoghi/${row.id}`,
        scenarioSlug: SCENARIO_BY_CONCESSIONE[row.concessione.numeroAtto],
      } satisfies MappaDemoMarker,
    ];
  });

  const markers = [...concessioni, ...criticita, ...sopralluoghi];

  return {
    summary: {
      concessioni: concessioni.length,
      criticita: criticita.length,
      sopralluoghi: sopralluoghi.length,
      art47: criticitaRows.filter((item) => item.rilevanzaArt47).length,
      altaPriorita: markers.filter((item) => item.riskLevel === "ALTO" || item.riskLevel === "CRITICO").length,
    },
    markers,
  };
}
