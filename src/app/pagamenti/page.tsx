import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { BACKOFFICE_ROLES, canExportOperationalData, requireRole } from "@/lib/auth";
import { PagamentiFiltersBar } from "@/components/pagamenti/PagamentiFiltersBar";
import { PagamentoStatoBadge, ResiduoBadge, RitardoBadge } from "@/components/pagamenti/PagamentiBadges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { formatCurrencyEUR, formatDateIT } from "@/lib/utils";
import {
  PAGAMENTI_CRITICITA_VALUES,
  PAGAMENTO_STATO_VALUES,
  getPagamentiFilters,
  getPagamentiList,
  getPagamentiSummary,
  type GetPagamentiListParams,
  type PagamentiCriticitaFilter,
  type PagamentoStatoValue,
} from "@/server/queries/pagamenti";

interface PagamentiPageProps {
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

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const dynamic = "force-dynamic";

export default async function PagamentiPage({ searchParams }: PagamentiPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const canExport = canExportOperationalData(role);
  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetPagamentiListParams = {
    search: pickString(resolvedSearch.search),
    stato: (() => {
      const value = pickString(resolvedSearch.stato);
      return value && PAGAMENTO_STATO_VALUES.includes(value as PagamentoStatoValue)
        ? (value as PagamentoStatoValue)
        : undefined;
    })(),
    anno: parseNumber(pickString(resolvedSearch.anno)),
    concessioneId: pickString(resolvedSearch.concessioneId),
    concessionarioId: pickString(resolvedSearch.concessionarioId),
    criticita: (() => {
      const value = pickString(resolvedSearch.criticita);
      return value && PAGAMENTI_CRITICITA_VALUES.includes(value as PagamentiCriticitaFilter)
        ? (value as PagamentiCriticitaFilter)
        : undefined;
    })(),
  };

  const [filtersData, listData, summary] = await Promise.all([
    getPagamentiFilters(),
    getPagamentiList(filters),
    getPagamentiSummary(filters),
  ]);

  const letturaEconomica: string[] = [];

  if (summary.esposizioneResidua > 0) {
    letturaEconomica.push(
      `Esposizione residua complessiva pari a ${formatCurrencyEUR(summary.esposizioneResidua)} da verificare e recuperare.`,
    );
  }

  if (summary.pagamentiScadutiONonPagati > 0) {
    letturaEconomica.push(
      "Sono presenti pagamenti scaduti/non pagati: valutare sollecito, diffida o recupero canoni in base al quadro istruttorio.",
    );
  }

  if (summary.pagamentiParziali > 0) {
    letturaEconomica.push("Sono presenti pagamenti parziali: attivare verifica contabile su residui e causali.");
  }

  if (summary.concessioniConMorosita > 0) {
    letturaEconomica.push(
      "Morosità ripetute su concessioni del perimetro: verificare i presupposti di cui all'art. 47 lett. d cod. nav.",
    );
  }

  if (letturaEconomica.length === 0) {
    letturaEconomica.push("Quadro economico regolare sui dati caricati: non emergono criticità rilevanti nel perimetro corrente.");
  }

  return (
    <AppShell
      title="Pagamenti"
      subtitle="Monitoraggio economico dei canoni, morosità e posizioni residue"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        <Card>
          <CardHeader>
            <CardTitle>Totale dovuto</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-900">{formatCurrencyEUR(summary.totaleDovuto)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Totale versato</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-emerald-700">{formatCurrencyEUR(summary.totaleVersato)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Esposizione residua</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-rose-700">{formatCurrencyEUR(summary.esposizioneResidua)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pagamenti critici</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-rose-700">{summary.pagamentiCritici}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scaduti / non pagati</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-rose-700">{summary.pagamentiScadutiONonPagati}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pagamenti parziali</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-amber-700">{summary.pagamentiParziali}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Concessioni con morosità</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-amber-700">{summary.concessioniConMorosita}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        {canExport ? (
          <div className="mb-4 flex justify-end">
            <Link
              href="/export/pagamenti"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Esporta CSV
            </Link>
          </div>
        ) : null}
        <PagamentiFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Registro pagamenti</CardTitle>
            <CardDescription>
              Vista read-only con priorita su esposizione residua, ritardi e possibili azioni istruttorie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Anno</TableHead>
                  <TableHead>Dovuto</TableHead>
                  <TableHead>Versato</TableHead>
                  <TableHead>Residuo</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Giorni ritardo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const rowClassName = item.stato === "SCADUTO" || item.stato === "NON_PAGATO"
                    ? "bg-rose-50"
                    : item.stato === "PARZIALE" || item.residuo > 0
                      ? "bg-amber-50"
                      : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">{item.concessione.numeroAtto}</p>
                          <p className="text-xs text-slate-500">{item.concessione.ubicazione ?? "-"}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.concessione.concessionario.denominazione}</TableCell>
                      <TableCell>{item.annoRiferimento}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className={item.residuo > 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>
                            {formatCurrencyEUR(item.residuo)}
                          </p>
                          <ResiduoBadge residuo={item.residuo} />
                        </div>
                      </TableCell>
                      <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                      <TableCell>
                        <RitardoBadge giorniRitardo={item.giorniRitardo} />
                      </TableCell>
                      <TableCell>
                        <PagamentoStatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/pagamenti/${item.id}`}
                            className="text-sm font-medium text-slate-900 underline underline-offset-4"
                          >
                            Apri scheda
                          </Link>
                          <Link
                            href={`/concessioni/${item.concessione.id}`}
                            className="text-xs text-slate-600 underline underline-offset-4"
                          >
                            Concessione
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {listData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-slate-500">
                      Nessun pagamento trovato con i filtri correnti.
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
            <CardTitle>Lettura economica</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {letturaEconomica.map((item, index) => (
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
