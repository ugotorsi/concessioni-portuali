import Link from "next/link";

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
      subtitle="Accesso operativo ai principali ambiti concessori con vista dedicata per ciascun perimetro."
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <section className="grid gap-4 md:grid-cols-2" data-testid="verticali-strategiche-grid">
          <Card data-testid="verticale-strategica-demanio-marittimo">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">Porti, concessioni portuali e demanio marittimo-costiero</CardTitle>
                <Badge variant="success">Verticale strategica</Badge>
              </div>
              <CardDescription>
                Perimetro principale operativo. Il marittimo turistico-ricreativo e trattato come sottoambito della verticale demaniale.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/verticali/portuale-adsp"
                  className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Apri workspace demaniale marittimo
                </Link>
                <Link
                  href="/concessioni?concessionVertical=MARITTIMA_TURISTICO_RICREATIVA"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Apri sottoambito marittimo turistico-ricreativo
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="verticale-strategica-patrimonio">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">Patrimonio immobiliare pubblico</CardTitle>
                <Badge variant="warning">In implementazione</Badge>
              </div>
              <CardDescription>
                Verticale strategica dedicata al fascicolo unico del bene pubblico e ai rapporti amministrativi collegati.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/verticali/patrimonio-immobiliare-pubblico"
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                Apri workspace patrimonio immobiliare pubblico
              </Link>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Sottoambiti demaniali marittimo-costieri configurati</CardTitle>
            <CardDescription>
              Vista operativa dei sottoambiti oggi presenti nel modello concessorio, mantenendo i filtri tenant gia applicati.
            </CardDescription>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="verticali-cards-grid">
          {verticali.map((item) => (
            <Card key={item.slug} data-testid={`vertical-card-${item.slug}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">{item.label}</CardTitle>
                  <Badge variant={item.hasConcessioni ? "success" : "default"}>
                    {item.hasConcessioni
                      ? "Con concessioni nel perimetro"
                      : "Nessuna concessione nel perimetro corrente"}
                  </Badge>
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-600">{item.coverageLabel}</p>
                <p className="text-sm text-slate-700">
                  Concessioni visibili nel perimetro corrente: <span className="font-semibold" data-testid={`vertical-count-${item.slug}`}>{item.concessioniCount}</span>
                </p>

                {item.hasConcessioni ? null : (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Nessuna concessione visibile in questo momento per il tuo perimetro di accesso.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/verticali/${item.slug}`}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Apri workspace verticale
                  </Link>
                  <Link
                    href={`/concessioni?concessionVertical=${item.value}`}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Vedi concessioni correlate
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
