import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
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
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { getDashboardData } from "@/server/queries/dashboard";
import { getVerticaliDashboardSummary } from "@/server/queries/verticali";

export const dynamic = "force-dynamic";

function getSeverityVariant(value: string): "default" | "success" | "warning" | "danger" {
  if (value === "URGENTE" || value === "ALTA") {
    return "danger";
  }
  if (value === "MEDIA") {
    return "warning";
  }
  return "default";
}

function getStateVariant(value: string): "default" | "success" | "warning" | "danger" {
  if (["SCADUTA", "SCADUTO", "NON_PAGATO", "INADEMPIUTO", "APERTA"].includes(value)) {
    return "danger";
  }
  if (["PARZIALE", "IN_GESTIONE", "DA_AVVIARE", "IN_CORSO", "SOSPESA"].includes(value)) {
    return "warning";
  }
  if (["PAGATO", "RISOLTA", "CONCLUSO", "ATTIVA", "ADEMPIUTO", "GESTITA"].includes(value)) {
    return "success";
  }
  return "default";
}

function formatDeltaLabel(giorniDelta: number): string {
  if (giorniDelta === 0) {
    return "Scadenza oggi";
  }

  if (giorniDelta < 0) {
    return `${Math.abs(giorniDelta)} gg di ritardo`;
  }

  return `${giorniDelta} gg residui`;
}

export default async function DashboardPage() {
  await requireRole(BACKOFFICE_ROLES);
  const [data, verticaliSummary] = await Promise.all([getDashboardData(), getVerticaliDashboardSummary()]);

  return (
    <AppShell
      title="Dashboard"
      subtitle="Quadro operativo concessioni, criticità, scadenze e priorità istruttorie"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          title="Totale concessioni"
          value={data.summary.totaleConcessioni}
          description="Rapporti concessori attualmente censiti"
        />
        <MetricCard
          title="Concessioni attive"
          value={data.summary.concessioniAttive}
          description="Posizioni operative in regolare esercizio"
          tone="warning"
        />
        <MetricCard
          title="Scadenza entro 90 giorni"
          value={data.summary.concessioniInScadenza90}
          description="Concessioni da pianificare per rinnovo o nuova procedura"
          tone={data.summary.concessioniInScadenza90 > 0 ? "warning" : "default"}
        />
        <MetricCard
          title="Criticità aperte"
          value={data.summary.criticitaAperte}
          description="Segnalazioni con istruttoria ancora aperta"
          tone={data.summary.criticitaAperte > 0 ? "danger" : "default"}
        />
        <MetricCard
          title="Criticità urgenti"
          value={data.summary.criticitaUrgenti}
          description="Elementi ad alta priorità operativa"
          tone={data.summary.criticitaUrgenti > 0 ? "danger" : "default"}
        />
        <MetricCard
          title="Morosità aperte"
          value={data.summary.morositaAperte}
          description="Posizioni critiche su canoni e versamenti"
          tone={data.summary.morositaAperte > 0 ? "danger" : "default"}
        />
        <MetricCard
          title="Pagamenti critici"
          value={data.summary.pagamentiCritici}
          description="Pagamenti non pagati, parziali o scaduti"
          tone={data.summary.pagamentiCritici > 0 ? "danger" : "default"}
        />
        <MetricCard
          title="Procedimenti in corso"
          value={data.summary.procedimentiInCorso}
          description="Procedimenti istruttori attivi"
          tone={data.summary.procedimentiInCorso > 0 ? "warning" : "default"}
        />
        <MetricCard
          title="Garanzie e polizze critiche"
          value={data.summary.garanziePolizzeCritiche}
          description="Scadute o in scadenza entro 60 giorni"
          tone={data.summary.garanziePolizzeCritiche > 0 ? "danger" : "default"}
        />
        <MetricCard
          title="Fonti normative"
          value={data.summary.fontiNormative}
          description="Archivio fonti e riferimenti regolatori"
        />
        <MetricCard
          title="Norme in consultazione"
          value={data.summary.versioniNormativeInConsultazione}
          description="Versioni da monitorare con possibile impatto operativo"
          tone={data.summary.versioniNormativeInConsultazione > 0 ? "warning" : "default"}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Verticali</CardTitle>
            <CardDescription>
              Dati disponibili nel perimetro corrente per i workspace verticali configurati.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3" data-testid="dashboard-verticali-operative">
            <p className="text-sm text-slate-700">
              Verticali configurate: <span className="font-semibold">{verticaliSummary.totalVerticaliConfigurate}</span>
            </p>
            <p className="text-sm text-slate-700">
              Verticali con concessioni nel perimetro: <span className="font-semibold">{verticaliSummary.verticaliConConcessioniNelPerimetro}</span>
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {verticaliSummary.items.map((item) => (
                <Link
                  key={item.slug}
                  href={`/verticali/${item.slug}`}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                >
                  <p className="font-medium">{item.label}</p>
                  <p className="text-xs text-slate-600">Concessioni per verticale: {item.concessioniCount}</p>
                </Link>
              ))}
            </div>

            <div>
              <Link
                href="/verticali"
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                Apri area verticali
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scenari demo istituzionali</CardTitle>
            <CardDescription>
              Percorsi guidati su morosità Art. 47, occupazione difforme, regolarizzazione e art. 10-bis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/demo-scenari"
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                Apri scenari demo
              </Link>
              <Link
                href="/documenti"
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Apri fascicolo documentale
              </Link>
              <Link
                href="/mappa"
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Apri mappa demo
              </Link>
              <Link
                href="/demo-guidata"
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Apri demo guidata AI
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mappa concessioni e criticità</CardTitle>
            <CardDescription>
              Accesso rapido alla vista territoriale dimostrativa con marker geolocalizzati e link alle schede.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/mappa"
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                Apri mappa concessioni e criticità
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Criticità prioritarie</CardTitle>
            <CardDescription>Massimo 6 elementi ordinati per gravità e data.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravità</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Rif. normativo</TableHead>
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.criticitaPrioritarie.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant={getSeverityVariant(item.gravita)}>{formatEnumLabel(item.gravita)}</Badge>
                    </TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.concessione}</TableCell>
                    <TableCell className="max-w-80 truncate">{item.descrizione}</TableCell>
                    <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={getStateVariant(item.stato)}>{formatEnumLabel(item.stato)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {data.criticitaPrioritarie.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      Nessuna criticità prioritaria presente.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scadenze imminenti</CardTitle>
            <CardDescription>Massimo 8 scadenze aperte o già scadute, ordinate per data.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Delta giorni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.scadenzeImminenti.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDateIT(item.data)}</TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.concessione}</TableCell>
                    <TableCell>
                      <Badge variant={getStateVariant(item.stato)}>{formatEnumLabel(item.stato)}</Badge>
                    </TableCell>
                    <TableCell className={item.giorniDelta < 0 ? "font-semibold text-rose-700" : "text-slate-700"}>
                      {formatDeltaLabel(item.giorniDelta)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.scadenzeImminenti.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Nessuna scadenza imminente da monitorare.
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
            <CardTitle>Morosità e pagamenti critici</CardTitle>
            <CardDescription>Posizioni con stato NON PAGATO, PARZIALE o SCADUTO.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Anno</TableHead>
                  <TableHead>Dovuto</TableHead>
                  <TableHead>Versato</TableHead>
                  <TableHead>Residuo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Scadenza</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pagamentiCritici.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-slate-900">{item.concessione}</TableCell>
                    <TableCell>{item.anno}</TableCell>
                    <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                    <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                    <TableCell className="font-semibold text-rose-700">{formatCurrencyEUR(item.residuo)}</TableCell>
                    <TableCell>
                      <Badge variant={getStateVariant(item.stato)}>{formatEnumLabel(item.stato)}</Badge>
                    </TableCell>
                    <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                  </TableRow>
                ))}
                {data.pagamentiCritici.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500">
                      Nessun pagamento critico presente.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Procedimenti in corso</CardTitle>
            <CardDescription>Massimo 5 procedimenti non conclusi con focus sul contraddittorio.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Termine contraddittorio</TableHead>
                  <TableHead>Rif. normativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.procedimentiInCorso.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.concessione}</TableCell>
                    <TableCell>
                      <Badge variant={getStateVariant(item.stato)}>{formatEnumLabel(item.stato)}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.termineContraddittorio ? formatDateIT(item.termineContraddittorio) : "-"}
                    </TableCell>
                    <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                  </TableRow>
                ))}
                {data.procedimentiInCorso.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Nessun procedimento in corso.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Azioni consigliate</CardTitle>
            <CardDescription>Priorità operative generate automaticamente dal quadro attuale.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {data.azioniConsigliate.map((item, index) => (
                <li key={`${index}-${item}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
