import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { ReportTipologiaBadge, ReportValidatoBadge } from "@/components/report/ReportBadges";
import { ReportFiltersBar } from "@/components/report/ReportFiltersBar";
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
import {
  REPORT_TIPOLOGIA_VALUES,
  REPORT_VALIDATO_VALUES,
  getReportDashboardSummary,
  getReportFilters,
  getReportList,
  type GetReportListParams,
  type ReportTipologiaValue,
  type ReportValidatoValue,
} from "@/server/queries/report";
import { canExportOperationalData, getCurrentRole } from "@/lib/auth";

interface ReportPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value.trim() === "" ? undefined : value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0]?.trim() === "" ? undefined : value[0];
  }

  return undefined;
}

export const dynamic = "force-dynamic";

export default async function ReportPage({ searchParams }: ReportPageProps) {
  const resolvedSearch = (await searchParams) ?? {};
  const role = await getCurrentRole();
  const isAdspViewer = role === "VIEWER_ADSP";
  const canExport = role ? canExportOperationalData(role) : false;

  const filters: GetReportListParams = {
    search: pickString(resolvedSearch.search),
    tipologia: (() => {
      const value = pickString(resolvedSearch.tipologia);
      return value && REPORT_TIPOLOGIA_VALUES.includes(value as ReportTipologiaValue)
        ? (value as ReportTipologiaValue)
        : undefined;
    })(),
    validato: (() => {
      const value = pickString(resolvedSearch.validato);
      if (isAdspViewer) {
        return "SI";
      }
      return value && REPORT_VALIDATO_VALUES.includes(value as ReportValidatoValue)
        ? (value as ReportValidatoValue)
        : "TUTTI";
    })(),
    concessioneId: pickString(resolvedSearch.concessioneId),
  };

  const [filtersData, listData, summary] = await Promise.all([
    getReportFilters(),
    getReportList(filters),
    getReportDashboardSummary(),
  ]);

  const nonValidati = listData.items.filter((item) => !item.validato).length;
  const dossierIstruttori = listData.items.filter((item) => item.tipologia === "DOSSIER_ISTRUTTORIO").length;
  const reportMorosita = listData.items.filter((item) => item.tipologia === "REPORT_MOROSITA").length;
  const proposteBando = listData.items.filter((item) => item.tipologia === "PROPOSTA_BANDO").length;

  const letturaDirezionale: string[] = [];

  if (nonValidati > 0) {
    letturaDirezionale.push("Sono presenti report non validati: programmare revisione interna prima di diffusione operativa.");
  }

  if (dossierIstruttori > 0) {
    letturaDirezionale.push("Sono presenti dossier istruttori: il sistema supporta procedimenti conseguenti con base documentale consolidata.");
  }

  if (reportMorosita > 0) {
    letturaDirezionale.push("Sono presenti report morosità: valorizzare il potenziale recupero economico con priorità su posizioni scadute.");
  }

  if (proposteBando > 0) {
    letturaDirezionale.push("Sono presenti proposte bando: la reportistica supporta valorizzazione degli asset e nuove procedure.");
  }

  if (letturaDirezionale.length === 0) {
    letturaDirezionale.push("Reportistica regolare sul perimetro corrente: non emergono elementi aperti prioritari.");
  }

  return (
    <AppShell
      title="Report"
      subtitle="Output istruttori, dossier e reportistica del servizio di monitoraggio"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-8">
        <Card>
          <CardHeader>
            <CardTitle>Totale report</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{summary.totaleReport}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Validati</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{summary.reportValidati}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Non validati</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{summary.reportNonValidati}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mensili</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{summary.reportMensili}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dossier istruttori</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{summary.dossierIstruttori}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Report criticita</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{summary.reportCriticita}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Report morosita</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{summary.reportMorosita}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Proposte bando</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{summary.proposteBando}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        {canExport ? (
          <div className="mb-4 flex justify-end">
            <Link
              href="/export/report"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Esporta CSV
            </Link>
          </div>
        ) : null}
        {isAdspViewer ? (
          <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Profilo Viewer AdSP: visualizzazione prioritaria dei report validati in modalità consultiva.
          </div>
        ) : null}
        <ReportFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Registro report</CardTitle>
            <CardDescription>
              Vista read-only con evidenza su output da validare e reportistica a maggiore impatto operativo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Titolo</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead>Validato</TableHead>
                  <TableHead>Creato il</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const isCritico =
                    !item.validato ||
                    item.tipologia === "DOSSIER_ISTRUTTORIO" ||
                    item.tipologia === "REPORT_MOROSITA" ||
                    item.tipologia === "PROPOSTA_BANDO" ||
                    item.tipologia === "REPORT_CRITICITA";

                  const rowClassName = !item.validato
                    ? "bg-rose-50"
                    : isCritico
                      ? "bg-amber-50"
                      : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell>
                        <ReportTipologiaBadge value={item.tipologia} />
                      </TableCell>
                      <TableCell className="max-w-96 truncate font-medium text-slate-900">{item.titolo}</TableCell>
                      <TableCell>{item.concessione?.numeroAtto ?? "-"}</TableCell>
                      <TableCell>{item.concessione?.concessionario.denominazione ?? "-"}</TableCell>
                      <TableCell>{formatEnumLabel(item.formato)}</TableCell>
                      <TableCell>
                        <ReportValidatoBadge value={item.validato} />
                      </TableCell>
                      <TableCell>{formatDateIT(item.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/report/${item.id}`}
                            className="text-sm font-medium text-slate-900 underline underline-offset-4"
                          >
                            Apri report
                          </Link>
                          {item.concessione ? (
                            <Link
                              href={`/concessioni/${item.concessione.id}`}
                              className="text-xs text-slate-600 underline underline-offset-4"
                            >
                              Concessione
                            </Link>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {listData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      Nessun report trovato con i filtri correnti.
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
            <CardTitle>Lettura direzionale</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {letturaDirezionale.map((item, index) => (
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
