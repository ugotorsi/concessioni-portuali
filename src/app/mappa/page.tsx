import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { formatEnumLabel } from "@/lib/utils";
import { getMappaDemoData, type MappaDemoMarker } from "@/server/queries/mappa";

export const dynamic = "force-dynamic";

function markerVariant(type: MappaDemoMarker["type"]): "default" | "success" | "warning" | "danger" {
  if (type === "CONCESSIONE") {
    return "success";
  }

  if (type === "SOPRALLUOGO") {
    return "warning";
  }

  return "danger";
}

function riskVariant(riskLevel: MappaDemoMarker["riskLevel"]): "default" | "warning" | "danger" {
  if (riskLevel === "CRITICO" || riskLevel === "ALTO") {
    return "danger";
  }

  if (riskLevel === "MEDIO") {
    return "warning";
  }

  return "default";
}

function markerLabel(type: MappaDemoMarker["type"]): string {
  if (type === "CONCESSIONE") {
    return "Concessione";
  }

  if (type === "CRITICITA") {
    return "Criticita";
  }

  return "Sopralluogo";
}

function normalizeToCanvas(markers: MappaDemoMarker[]): Array<MappaDemoMarker & { x: number; y: number }> {
  if (markers.length === 0) {
    return [];
  }

  const minLat = Math.min(...markers.map((item) => item.lat));
  const maxLat = Math.max(...markers.map((item) => item.lat));
  const minLng = Math.min(...markers.map((item) => item.lng));
  const maxLng = Math.max(...markers.map((item) => item.lng));

  const latRange = Math.max(maxLat - minLat, 0.0001);
  const lngRange = Math.max(maxLng - minLng, 0.0001);

  return markers.map((marker) => {
    const x = 7 + ((marker.lng - minLng) / lngRange) * 86;
    const y = 7 + (1 - (marker.lat - minLat) / latRange) * 86;

    return {
      ...marker,
      x,
      y,
    };
  });
}

function markerColor(marker: MappaDemoMarker): string {
  if (marker.type === "CONCESSIONE") {
    return "#0f766e";
  }

  if (marker.type === "CRITICITA") {
    return "#be123c";
  }

  return "#b45309";
}

export default async function MappaPage() {
  await requireRole();
  const data = await getMappaDemoData();
  const canvasMarkers = normalizeToCanvas(data.markers);

  return (
    <AppShell
      title="Mappa demo concessioni e criticita"
      subtitle="Vista territoriale dimostrativa delle concessioni, criticita e sopralluoghi registrati nella piattaforma."
    >
      <div className="mx-auto flex w-full max-w-[1460px] flex-col gap-4">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardHeader>
              <CardDescription>Concessioni geolocalizzate</CardDescription>
              <CardTitle>{data.summary.concessioni}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Criticita geolocalizzate</CardDescription>
              <CardTitle>{data.summary.criticita}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Sopralluoghi geolocalizzati</CardDescription>
              <CardTitle>{data.summary.sopralluoghi}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Criticita con profilo art. 47</CardDescription>
              <CardTitle>{data.summary.art47}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Punti ad alta priorita</CardDescription>
              <CardTitle>{data.summary.altaPriorita}</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[380px,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Lista marker territoriali</CardTitle>
              <CardDescription>Con collegamenti rapidi alle schede di dettaglio.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-h-[560px] gap-2 overflow-y-auto" data-testid="mappa-marker-list">
              {data.markers.slice(0, 60).map((marker) => (
                <div key={`${marker.type}-${marker.id}`} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={markerVariant(marker.type)}>{markerLabel(marker.type)}</Badge>
                    <Badge variant={riskVariant(marker.riskLevel)}>Rischio {marker.riskLevel}</Badge>
                    <span className="text-xs text-slate-500">{formatEnumLabel(marker.status)}</span>
                  </div>
                  <p className="mt-1 font-medium text-slate-900">{marker.title}</p>
                  <p className="text-xs text-slate-600">{marker.subtitle}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      {marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}
                    </span>
                    <Link href={marker.href} className="text-xs font-medium text-slate-900 underline underline-offset-4">
                      Apri scheda
                    </Link>
                  </div>
                </div>
              ))}

              {data.markers.length === 0 ? (
                <p className="text-sm text-slate-600">Nessun marker geolocalizzato disponibile nel dataset demo.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mappa placeholder GIS-ready</CardTitle>
              <CardDescription>
                Canvas dimostrativo senza provider esterni/API key, con posizionamento relativo su coordinate normalizzate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative h-[560px] overflow-hidden rounded-xl border border-slate-300 bg-[radial-gradient(circle_at_18%_14%,#bfdbfe_0,#dbeafe_28%,#eef2ff_56%,#f8fafc_100%)]" data-testid="mappa-placeholder">
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.09)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.09)_1px,transparent_1px)] bg-[size:40px_40px]" />
                <div className="pointer-events-none absolute right-8 top-8 h-24 w-52 rounded-lg border border-white/70 bg-white/70 p-3 text-xs text-slate-700 shadow-sm backdrop-blur">
                  <p className="font-semibold">Scenario demo territoriale</p>
                  <p className="mt-1">Distribuzione sintetica concessioni, criticita e sopralluoghi su aree portuali demo.</p>
                </div>

                {canvasMarkers.map((marker) => (
                  <Link
                    key={`${marker.type}-${marker.id}`}
                    href={marker.href}
                    data-testid="mappa-point"
                    className="group absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                    title={`${marker.title} - ${marker.subtitle}`}
                  >
                    <span
                      className="block h-3.5 w-3.5 rounded-full border-2 border-white shadow-md ring-2 ring-slate-900/20 transition-transform group-hover:scale-110"
                      style={{ backgroundColor: markerColor(marker) }}
                    />
                  </Link>
                ))}

                {canvasMarkers.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">
                    Nessun punto disponibile: eseguire seed demo per popolare la vista territoriale.
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-700">
                <Badge variant="success">Concessione</Badge>
                <Badge variant="danger">Criticita</Badge>
                <Badge variant="warning">Sopralluogo</Badge>
                <Badge variant="danger">Rischio alto/critico</Badge>
              </div>

              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Vista dimostrativa GIS-ready. Le coordinate sono dati demo o approssimativi e non sostituiscono rilievi tecnici o cartografie ufficiali.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
