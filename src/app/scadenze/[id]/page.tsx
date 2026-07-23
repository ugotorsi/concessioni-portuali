import Link from "next/link";
import { differenceInCalendarDays, startOfDay } from "date-fns";
import { notFound } from "next/navigation";

import { GravitaBadge, StatoBadge as CriticitaStatoBadge } from "@/components/criticita/CriticitaBadges";
import { AppShell } from "@/components/layout/AppShell";
import { ScadenzaStatoBadge } from "@/components/scadenze/ScadenzeBadges";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getScadenzaDetail } from "@/server/queries/scadenze";

interface ScadenzaDetailPageProps {
  params: Promise<{ id: string }>;
}

function getAzioneConsigliata(tipologia: string, isScaduta: boolean): string {
  if (tipologia === "PAGAMENTO_CANONE" && isScaduta) {
    return "Verificare posizione contabile e valutare recupero canoni/diffida.";
  }

  if (["POLIZZA", "FIDEIUSSIONE", "CAUZIONE"].includes(tipologia) && isScaduta) {
    return "Richiedere aggiornamento tempestivo della garanzia con riscontro documentale.";
  }

  if (tipologia === "CONCESSIONE") {
    return "Programmare rinnovo, cessazione o nuova procedura concessoria in base allo stato del rapporto.";
  }

  if (tipologia === "TERMINE_PROCEDIMENTALE") {
    return "Verificare rispetto termini di contraddittorio e milestone istruttorie.";
  }

  if (tipologia === "SOPRALLUOGO") {
    return "Programmare verifica tecnica e formalizzare verbale di esito.";
  }

  if (tipologia === "VERIFICA_PERIODICA") {
    return "Aggiornare checklist e completare riscontri previsti dall obbligo.";
  }

  return "Valutare adempimento con verifica documentale e tecnico-amministrativa.";
}

export const dynamic = "force-dynamic";

export default async function ScadenzaDetailPage({ params }: ScadenzaDetailPageProps) {
  const { id } = await params;
  const scadenza = await getScadenzaDetail(id);

  if (!scadenza) {
    notFound();
  }

  const today = startOfDay(new Date());
  const delta = differenceInCalendarDays(scadenza.dataScadenza, today);
  const giorniResidui = delta >= 0 ? delta : null;
  const giorniRitardo = delta < 0 ? Math.abs(delta) : null;
  const azioneConsigliata = getAzioneConsigliata(scadenza.tipologia, delta < 0);

  return (
    <AppShell
      title={`Scadenza ${formatEnumLabel(scadenza.tipologia)}`}
      subtitle="Dettaglio read-only per supporto operativo su adempimenti e alert"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Scheda scadenza</h1>
            <p className="mt-1 text-sm text-slate-600">Analisi contestuale della scadenza e impatti istruttori.</p>
          </div>
          <Link href="/scadenze" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Torna alle scadenze
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header scadenza</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
              <p className="mt-1 text-slate-900">{formatEnumLabel(scadenza.tipologia)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
              <div className="mt-1">
                <ScadenzaStatoBadge value={scadenza.stato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data scadenza</p>
              <p className="mt-1 text-slate-900">{formatDateIT(scadenza.dataScadenza)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Giorni</p>
              <p className="mt-1 font-semibold text-slate-900">
                {giorniRitardo !== null ? `${giorniRitardo} giorni di ritardo` : `${giorniResidui ?? "-"} giorni residui`}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessione</p>
              <p className="mt-1 font-semibold text-slate-900">{scadenza.concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessionario</p>
              <p className="mt-1 text-slate-900">{scadenza.concessione.concessionario.denominazione}</p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Dati scadenza</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione</p>
                <p className="mt-1">{scadenza.descrizione ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Preavviso</p>
                <p className="mt-1">{scadenza.preavvisoGiorni} giorni</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contesto concessorio</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Numero atto</p>
                <p className="mt-1 font-semibold text-slate-900">{scadenza.concessione.numeroAtto}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Stato concessione</p>
                <div className="mt-1">
                  <Badge>{formatEnumLabel(scadenza.concessione.stato)}</Badge>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Scadenza concessione</p>
                <p className="mt-1">{formatDateIT(scadenza.concessione.dataScadenza)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Bene/Area</p>
                <p className="mt-1">{formatEnumLabel(scadenza.concessione.tipologiaBene)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
                <p className="mt-1">{scadenza.concessione.ubicazione ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
                <p className="mt-1">
                  {scadenza.concessione.canoneAnnuo !== null
                    ? formatCurrencyEUR(scadenza.concessione.canoneAnnuo)
                    : "-"}
                </p>
              </div>
              <div className="md:col-span-2">
                <Link
                  href={`/concessioni/${scadenza.concessione.id}`}
                  className="inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
                >
                  Apri scheda concessione
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Azione consigliata</CardTitle>
            <CardDescription>Indicazione operativa automatica in base a tipologia e stato temporale.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {azioneConsigliata}
            </p>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Criticità aperte collegate alla concessione</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gravità</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scadenza.criticitaAperte.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <GravitaBadge value={item.gravita} />
                      </TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell className="max-w-80 truncate">{item.descrizione}</TableCell>
                      <TableCell>
                        <CriticitaStatoBadge value={item.stato} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {scadenza.criticitaAperte.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna criticità aperta collegata.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pagamenti critici</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anno</TableHead>
                    <TableHead>Dovuto</TableHead>
                    <TableHead>Versato</TableHead>
                    <TableHead>Residuo</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scadenza.pagamentiCritici.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.annoRiferimento}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                      <TableCell className="font-semibold text-rose-700">{formatCurrencyEUR(item.residuo)}</TableCell>
                      <TableCell>
                        <Badge>{formatEnumLabel(item.stato)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {scadenza.pagamentiCritici.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        Nessun pagamento critico collegato.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Procedimenti in corso</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Termine</TableHead>
                    <TableHead>Rif. normativo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scadenza.procedimentiInCorso.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>
                        <Badge>{formatEnumLabel(item.stato)}</Badge>
                      </TableCell>
                      <TableCell>
                        {item.dataScadenzaContraddittorio ? formatDateIT(item.dataScadenzaContraddittorio) : "-"}
                      </TableCell>
                      <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                  {scadenza.procedimentiInCorso.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun procedimento in corso collegato.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documenti principali</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scadenza.documentiPrincipali.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-80 truncate">{item.nome}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>{item.dataDocumento ? formatDateIT(item.dataDocumento) : formatDateIT(item.createdAt)}</TableCell>
                      <TableCell>
                        <a href={item.url} className="text-sm underline underline-offset-4" target="_blank" rel="noreferrer">
                          Apri
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                  {scadenza.documentiPrincipali.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun documento principale disponibile.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
