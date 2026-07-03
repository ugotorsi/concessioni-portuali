import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { requireRole } from "@/lib/auth";
import { getAdspData } from "@/server/queries/adsp";

export const dynamic = "force-dynamic";

export default async function AdspPage() {
  await requireRole(["VIEWER_ADSP"]);
  const data = await getAdspData();

  return (
    <AppShell
      title="Portale consultivo AdSP"
      subtitle="Vista sintetica dei report validati, delle criticità aperte e dello stato dei rapporti concessori"
    >
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        La piattaforma supporta l&rsquo;attività istruttoria; le determinazioni provvedimentali restano in capo
        all&rsquo;Autorità competente.
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Concessioni monitorate" value={data.kpi.concessioniMonitorate} description="Rapporti censiti" />
        <MetricCard title="Criticità aperte" value={data.kpi.criticitaAperte} description="Posizioni in gestione" tone="danger" />
        <MetricCard title="Procedimenti in corso" value={data.kpi.procedimentiInCorso} description="Istruttorie attive" tone="warning" />
        <MetricCard title="Report validati" value={data.kpi.reportValidati} description="Output consultabili" />
        <MetricCard title="Scadenze imminenti" value={data.kpi.scadenzeImminenti} description="Entro 30 giorni" tone="warning" />
        <MetricCard title="Pagamenti critici" value={data.kpi.pagamentiCritici} description="Scaduti o parziali" tone="danger" />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Report validati recenti</CardTitle>
            <CardDescription>Elenco consultivo degli ultimi report validati.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Titolo</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.reportValidatiRecenti.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.titolo}</TableCell>
                    <TableCell>{item.concessioneNumeroAtto ?? "-"}</TableCell>
                    <TableCell>{formatDateIT(item.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data.reportValidatiRecenti.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      Nessun report validato disponibile.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Criticità aperte principali</CardTitle>
            <CardDescription>Elementi con priorità più elevata.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravità</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Descrizione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.criticitaApertePrincipali.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatEnumLabel(item.gravita)}</TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.concessioneNumeroAtto}</TableCell>
                    <TableCell className="max-w-80 truncate">{item.descrizione}</TableCell>
                  </TableRow>
                ))}
                {data.criticitaApertePrincipali.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      Nessuna criticità aperta rilevata.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Procedimenti in corso</CardTitle>
            <CardDescription>Quadro sintetico dello stato procedimentale.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Termine</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.procedimentiInCorso.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell>{formatEnumLabel(item.stato)}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.concessioneNumeroAtto}</TableCell>
                    <TableCell>
                      {item.dataScadenzaContraddittorio ? formatDateIT(item.dataScadenzaContraddittorio) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
                {data.procedimentiInCorso.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      Nessun procedimento in corso.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accessi consultivi</CardTitle>
            <CardDescription>Collegamenti principali per la consultazione.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <Link href="/report?validato=SI" className="underline underline-offset-4">
                Report validati
              </Link>
              <Link href="/dashboard" className="underline underline-offset-4">
                Dashboard
              </Link>
              <Link href="/concessioni" className="underline underline-offset-4">
                Concessioni
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
