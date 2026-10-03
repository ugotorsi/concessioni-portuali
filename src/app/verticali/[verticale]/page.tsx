import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, FileText, FolderOpen, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { StatoBadge } from "@/components/concessioni/ConcessioniBadges";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getVerticaleWorkspaceBySlug } from "@/server/queries/verticali";

interface VerticaleWorkspacePageProps {
  params: Promise<{ verticale: string }>;
}

export const dynamic = "force-dynamic";

const generalLinks = [
  { href: "/documenti", label: "Apri tutti i documenti", testId: "workspace-link-documenti", icon: FileText },
  { href: "/report", label: "Apri tutti i rapporti", testId: "workspace-link-report", icon: FileText },
  { href: "/criticita", label: "Apri tutte le criticita", testId: "workspace-link-criticita", icon: TriangleAlert },
  { href: "/scadenze", label: "Apri tutte le scadenze", testId: "workspace-link-scadenze", icon: CalendarDays },
  { href: "/procedimenti", label: "Apri tutti i fascicoli", testId: "workspace-link-procedimenti", icon: FolderOpen },
] as const;

export default async function VerticaleWorkspacePage({ params }: VerticaleWorkspacePageProps) {
  const { verticale } = await params;

  await requireRole();
  const data = await getVerticaleWorkspaceBySlug(verticale);

  if (!data) {
    notFound();
  }

  return (
    <AppShell title={data.verticale.label} subtitle={data.verticale.description}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
        <Link href="/verticali" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Torna alle verticali
        </Link>

        <section className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between" aria-labelledby="sintesi-verticale">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sintesi-verticale" className="text-lg font-semibold text-slate-950">Sintesi del perimetro</h2>
              <Badge variant={data.verticale.hasConcessioni ? "success" : "default"}>
                {data.verticale.hasConcessioni ? "Operativa" : "Configurata, senza dati"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">Dati reali collegati alle concessioni classificate in questa verticale.</p>
          </div>
          <Link
            href={`/concessioni?concessionVertical=${data.verticale.value}`}
            data-testid="workspace-link-concessioni"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Vedi concessioni <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4" data-testid="vertical-workspace-kpi" aria-label="Indicatori della verticale">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
            <div><dt className="text-xs text-slate-500">Concessioni</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{data.indicatori.concessioni}</dd></div>
            <div><dt className="text-xs text-slate-500">Fascicoli collegati</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{data.indicatori.fascicoli}</dd></div>
            <div><dt className="text-xs text-slate-500">Criticita aperte</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{data.indicatori.criticitaAperte}</dd></div>
            <div><dt className="text-xs text-slate-500">Scadenze aperte/scadute</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{data.indicatori.scadenzeAperteScadute}</dd></div>
            <div><dt className="text-xs text-slate-500">Documenti</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{data.indicatori.documenti}</dd></div>
            <div><dt className="text-xs text-slate-500">Rapporti</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{data.indicatori.report}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="concessioni-verticale">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <h2 id="concessioni-verticale" className="text-base font-semibold text-slate-950">Concessioni della verticale</h2>
          </div>

          <div className="grid gap-3">
            {data.concessioni.map((item) => (
              <Card key={item.id} data-testid="vertical-concessione-item">
                <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base">Concessione {item.numeroAtto}</CardTitle>
                    <CardDescription className="mt-1">
                      {item.concessionarioDenominazione}{item.ubicazione ? ` · ${item.ubicazione}` : ""}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatoBadge value={item.stato} />
                    <Badge>{item.fascicoli.length} {item.fascicoli.length === 1 ? "fascicolo" : "fascicoli"}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-slate-500">Scadenza</dt><dd className="mt-1 font-medium">{formatDateIT(item.dataScadenza)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Criticita aperte</dt><dd className="mt-1 font-medium">{item.criticitaAperteCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Scadenze aperte/scadute</dt><dd className="mt-1 font-medium">{item.scadenzeAperteScaduteCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Fascicoli collegati</dt><dd className="mt-1 font-medium">{item.fascicoli.length}</dd></div>
                  </dl>

                  {item.fascicoli.length > 1 ? (
                    <div className="mt-4 border-t border-slate-100 pt-4" data-testid="vertical-multiple-fascicoli">
                      <p className="text-sm font-semibold text-slate-900">Scegli un fascicolo</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {item.fascicoli.map((fascicolo) => (
                          <Link key={fascicolo.id} href={`/procedimenti/${fascicolo.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                            <span><span className="block font-medium text-slate-900">{formatEnumLabel(fascicolo.tipologia)}</span><span className="text-xs text-slate-500">{formatEnumLabel(fascicolo.stato)}</span></span>
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-800">Apri fascicolo <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center" data-testid="vertical-concessione-actions">
                    {item.fascicoli.length === 1 ? (
                      <Link href={`/procedimenti/${item.fascicoli[0].id}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        Apri fascicolo <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                    {item.fascicoli.length === 0 ? <span className="text-sm text-slate-500">Nessun fascicolo collegato</span> : null}
                    <Link href={`/concessioni/${item.id}`} className="inline-flex min-h-10 items-center justify-center px-3 py-2 text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950">
                      Apri concessione
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}

            {data.concessioni.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-700">Nessuna concessione associata a questa verticale.</p>
                <p className="mt-1 text-xs text-slate-500">Il perimetro resta configurato e pronto a ricevere dati reali.</p>
              </div>
            ) : null}
          </div>
        </section>

        <details className="rounded-md border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Navigazione generale</summary>
          <p className="mt-2 text-xs text-slate-600" data-testid="workspace-links-scope-note">Gli elenchi sono generali per il tuo perimetro di accesso e non sono filtrati per questa verticale.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {generalLinks.map(({ href, label, testId, icon: Icon }) => (
              <Link key={href} href={href} data-testid={testId} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Icon className="h-4 w-4" aria-hidden="true" />{label}
              </Link>
            ))}
          </div>
        </details>
      </div>
    </AppShell>
  );
}
