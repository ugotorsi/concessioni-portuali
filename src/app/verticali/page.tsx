import Link from "next/link";
import { ArrowRight, Building2, FolderOpen, Layers3 } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { getVerticaliOverview } from "@/server/queries/verticali";

export const dynamic = "force-dynamic";

export default async function VerticaliPage() {
  await requireRole();
  const verticali = await getVerticaliOverview();

  return (
    <AppShell
      title="Verticali"
      subtitle="Perimetri concessori e normativi costruiti sul patrimonio informativo comune."
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
        <section className="border-b border-slate-200 pb-5" aria-labelledby="core-comune">
          <div className="flex items-start gap-3">
            <Layers3 className="mt-0.5 h-5 w-5 text-cyan-800" aria-hidden="true" />
            <div>
              <h2 id="core-comune" className="text-base font-semibold text-slate-950">Un core comune, tre perimetri concessori</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Concessioni, fascicoli, scadenze e documenti restano nel patrimonio informativo comune; ogni verticale ne offre una lettura coerente con il relativo ambito.</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="verticali-cards-grid">
          {verticali.map((item) => (
            <Card key={item.slug} data-testid={`vertical-card-${item.slug}`}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <CardTitle className="text-lg">{item.label}</CardTitle>
                  <Badge variant={item.hasConcessioni ? "success" : "default"}>
                    {item.hasConcessioni ? "Operativa" : "Configurata, senza dati"}
                  </Badge>
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
                  <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />Concessioni</dt><dd className="mt-1 font-semibold" data-testid={`vertical-count-${item.slug}`}>{item.concessioniCount}</dd></div>
                  <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />Fascicoli</dt><dd className="mt-1 font-semibold" data-testid={`vertical-fascicoli-${item.slug}`}>{item.fascicoliCount}</dd></div>
                </dl>

                {item.hasConcessioni ? null : (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Nessuna concessione associata a questa verticale.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/verticali/${item.slug}`}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Apri verticale <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Link>
                  <Link
                    href={`/concessioni?concessionVertical=${item.value}`}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Vedi concessioni
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <aside className="border-t border-slate-200 pt-4" data-testid="verticale-patrimonio-roadmap">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-slate-900">Patrimonio immobiliare pubblico</h2><Badge variant="default">Non disponibile</Badge></div>
          <p className="mt-1 text-sm text-slate-600">Ambito previsto dalla roadmap, privo al momento di una verticale configurata e di dati operativi dedicati.</p>
        </aside>
      </div>
    </AppShell>
  );
}
