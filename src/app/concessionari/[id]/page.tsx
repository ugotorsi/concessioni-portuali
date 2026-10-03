import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, FileText, FolderOpen } from "lucide-react";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getConcessionarioDetail } from "@/server/queries/concessionari";

interface ConcessionarioDetailPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function ConcessionarioDetailPage({ params }: ConcessionarioDetailPageProps) {
  await requireRole(BACKOFFICE_ROLES);
  const { id } = await params;
  const concessionario = await getConcessionarioDetail(id);

  if (!concessionario) {
    notFound();
  }

  const fascicoli = concessionario.concessioni.flatMap((item) =>
    item.procedimenti.map((procedimento) => ({ ...procedimento, concessioneNumero: item.numeroAtto })),
  );

  return (
    <AppShell title={concessionario.denominazione} subtitle="Concessionario, concessioni e fascicoli collegati">
      <Link href="/concessionari" className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-950">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Torna ai concessionari
      </Link>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.36fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-slate-500"><Building2 className="h-4 w-4" aria-hidden="true" /><span className="text-xs font-medium uppercase">Dati principali</span></div>
              <CardTitle className="mt-2 text-lg">{concessionario.denominazione}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {concessionario.codiceFiscale ? <div><dt className="text-xs text-slate-500">Codice fiscale</dt><dd className="break-all font-medium">{concessionario.codiceFiscale}</dd></div> : null}
                {concessionario.partitaIva ? <div><dt className="text-xs text-slate-500">Partita IVA</dt><dd className="break-all font-medium">{concessionario.partitaIva}</dd></div> : null}
                {concessionario.legaleRappresentante ? <div><dt className="text-xs text-slate-500">Legale rappresentante</dt><dd className="font-medium">{concessionario.legaleRappresentante}</dd></div> : null}
                {concessionario.sedeLegale ? <div><dt className="text-xs text-slate-500">Sede legale</dt><dd className="font-medium">{concessionario.sedeLegale}</dd></div> : null}
                {concessionario.pec ? <div><dt className="text-xs text-slate-500">PEC</dt><dd className="break-all font-medium">{concessionario.pec}</dd></div> : null}
                {concessionario.email ? <div><dt className="text-xs text-slate-500">Email</dt><dd className="break-all font-medium">{concessionario.email}</dd></div> : null}
                {concessionario.telefono ? <div><dt className="text-xs text-slate-500">Telefono</dt><dd className="font-medium">{concessionario.telefono}</dd></div> : null}
              </dl>
            </CardContent>
          </Card>

          <section aria-labelledby="concessioni-collegate">
            <div className="mb-3 flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-500" aria-hidden="true" /><h2 id="concessioni-collegate" className="text-base font-semibold">Concessioni</h2></div>
            <div className="grid gap-3">
              {concessionario.concessioni.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div><CardTitle className="text-base">Concessione {item.numeroAtto}</CardTitle>{item.ubicazione ? <CardDescription>{item.ubicazione}</CardDescription> : null}</div>
                    <Badge variant={item.stato === "ATTIVA" ? "success" : "default"}>{formatEnumLabel(item.stato)}</Badge>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <div><dt className="text-xs text-slate-500">Rilascio</dt><dd className="font-medium">{formatDateIT(item.dataRilascio)}</dd></div>
                      <div><dt className="text-xs text-slate-500">Scadenza</dt><dd className="font-medium">{formatDateIT(item.dataScadenza)}</dd></div>
                      {item.canoneAnnuo !== null ? <div><dt className="text-xs text-slate-500">Canone annuo</dt><dd className="font-medium">{formatCurrencyEUR(item.canoneAnnuo)}</dd></div> : null}
                    </dl>
                    <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
                      {item.procedimenti[0] ? (
                        <Link href={`/procedimenti/${item.procedimenti[0].id}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2">
                          Apri fascicolo <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      ) : <span className="text-sm text-slate-500">Nessun fascicolo collegato</span>}
                      <Link href={`/concessioni/${item.id}`} className="inline-flex min-h-10 items-center justify-center px-3 py-2 text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950">Apri scheda concessione</Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-slate-500" aria-hidden="true" />Fascicoli</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {fascicoli.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-medium">{formatEnumLabel(item.tipologia)}</p><p className="text-xs text-slate-500">Concessione {item.concessioneNumero} · {formatEnumLabel(item.stato)}</p></div>
                  <Link href={`/procedimenti/${item.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4">Apri fascicolo <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                </div>
              ))}
              {fascicoli.length === 0 ? <p className="text-sm text-slate-500">Nessun fascicolo collegato.</p> : null}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          {concessionario.criticita.length > 0 ? <Card><CardHeader><CardTitle>Criticità aperte</CardTitle><CardDescription>Sintesi delle criticità collegate alle concessioni.</CardDescription></CardHeader><CardContent className="space-y-3">{concessionario.criticita.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"><div className="flex flex-wrap gap-2"><Badge variant="warning">{formatEnumLabel(item.gravita)}</Badge><Badge>{formatEnumLabel(item.stato)}</Badge></div><p className="mt-2 text-sm font-medium">{formatEnumLabel(item.tipologia)}</p><p className="mt-1 text-sm text-slate-600">{item.descrizione}</p><p className="mt-1 text-xs text-slate-500">Concessione {item.concessioneNumero}</p></div>)}</CardContent></Card> : null}

          {concessionario.scadenze.length > 0 ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-500" aria-hidden="true" />Scadenze</CardTitle></CardHeader><CardContent className="space-y-3">{concessionario.scadenze.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"><p className="text-sm font-medium">{formatEnumLabel(item.tipologia)}</p><p className="mt-1 text-sm">{formatDateIT(item.dataScadenza)} · {formatEnumLabel(item.stato)}</p>{item.descrizione ? <p className="mt-1 text-sm text-slate-600">{item.descrizione}</p> : null}<p className="mt-1 text-xs text-slate-500">Concessione {item.concessioneNumero}</p></div>)}</CardContent></Card> : null}

          {concessionario.documenti.length > 0 ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" aria-hidden="true" />Documenti</CardTitle><CardDescription>Documenti collegati alle concessioni.</CardDescription></CardHeader><CardContent className="space-y-3">{concessionario.documenti.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"><p className="break-words text-sm font-medium">{item.nome}</p><p className="mt-1 text-xs text-slate-500">{formatEnumLabel(item.tipologia)} · Concessione {item.concessioneNumero}</p>{item.dataDocumento ? <p className="mt-1 text-xs text-slate-500">{formatDateIT(item.dataDocumento)}</p> : null}</div>)}</CardContent></Card> : null}
        </aside>
      </section>
    </AppShell>
  );
}