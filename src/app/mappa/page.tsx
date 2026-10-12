import { MapPinned } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { MappaWorkspace } from "@/components/mappa/MappaWorkspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { getMappaWorkspaceData } from "@/server/queries/mappa";

export const dynamic = "force-dynamic";

export default async function MappaPage() {
  await requireRole();
  const data = await getMappaWorkspaceData();

  return (
    <AppShell title="Mappa" subtitle="Distribuzione geografica delle concessioni e dei fascicoli collegati.">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Indicatori geografici">
        <Card>
          <CardHeader><CardTitle>Concessioni geolocalizzate</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-slate-950">{data.summary.concessioniGeolocalizzate}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Fascicoli collegati</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-cyan-800">{data.summary.fascicoliCollegati}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Criticità aperte</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-amber-800">{data.summary.criticitaAperte}</p></CardContent>
        </Card>
      </section>

      {data.markers.length > 0 ? (
        <MappaWorkspace data={data} />
      ) : (
        <section className="mt-5 rounded-md border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <MapPinned className="mx-auto h-7 w-7 text-slate-500" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-950">Non risultano concessioni geolocalizzate.</h2>
          <p className="mt-1 text-sm text-slate-600">Le concessioni prive di coordinate restano disponibili nell’elenco testuale.</p>
        </section>
      )}

      {data.nonGeolocalizzate.length > 0 ? (
        <details className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            {data.summary.concessioniNonGeolocalizzate} concessioni non geolocalizzate
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.nonGeolocalizzate.map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <p className="font-semibold">Concessione {item.numeroAtto}</p>
                <p className="text-slate-700">{item.concessionario}</p>
                {item.ubicazione ? <p className="mt-1 text-xs text-slate-500">{item.ubicazione}</p> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </AppShell>
  );
}
