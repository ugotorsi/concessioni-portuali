import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { BACKOFFICE_ROLES, canExportOperationalData, requireRole } from "@/lib/auth";
import { ScadenzeFiltersBar } from "@/components/scadenze/ScadenzeFiltersBar";
import { GiorniBadge, ScadenzaStatoBadge } from "@/components/scadenze/ScadenzeBadges";
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
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  SCADENZA_STATO_VALUES,
  SCADENZA_TIPOLOGIA_VALUES,
  getScadenzeFilters,
  getScadenzeList,
  type GetScadenzeListParams,
  type ScadenzePeriodoFilter,
} from "@/server/queries/scadenze";

interface ScadenzePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const periodoValues: ScadenzePeriodoFilter[] = [
  "SCADUTE",
  "ENTRO_30_GIORNI",
  "ENTRO_60_GIORNI",
  "ENTRO_90_GIORNI",
  "FUTURE",
];

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

export default async function ScadenzePage({ searchParams }: ScadenzePageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const canExport = canExportOperationalData(role);
  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetScadenzeListParams = {
    search: pickString(resolvedSearch.search),
    tipologia: (() => {
      const value = pickString(resolvedSearch.tipologia);
      return value && SCADENZA_TIPOLOGIA_VALUES.includes(value as (typeof SCADENZA_TIPOLOGIA_VALUES)[number])
        ? (value as (typeof SCADENZA_TIPOLOGIA_VALUES)[number])
        : undefined;
    })(),
    stato: (() => {
      const value = pickString(resolvedSearch.stato);
      return value && SCADENZA_STATO_VALUES.includes(value as (typeof SCADENZA_STATO_VALUES)[number])
        ? (value as (typeof SCADENZA_STATO_VALUES)[number])
        : undefined;
    })(),
    periodo: (() => {
      const value = pickString(resolvedSearch.periodo);
      return value && periodoValues.includes(value as ScadenzePeriodoFilter)
        ? (value as ScadenzePeriodoFilter)
        : undefined;
    })(),
    concessioneId: pickString(resolvedSearch.concessioneId),
  };

  const [filtersData, listData] = await Promise.all([
    getScadenzeFilters(),
    getScadenzeList(filters),
  ]);

  const letturaOperativa: string[] = [];

  if (listData.summary.scadute >= 3) {
    letturaOperativa.push(
      "Numero elevato di scadenze scadute: attivare bonifica urgente con piano di riallineamento operativo.",
    );
  }

  if (listData.summary.entro30 > 0) {
    letturaOperativa.push(
        "Sono presenti scadenze entro 30 giorni: programmare immediatamente responsabilità e verifiche.",
    );
  }

  const hasGaranzieInScadenza = listData.items.some((item) =>
    ["POLIZZA", "FIDEIUSSIONE", "CAUZIONE"].includes(item.tipologia),
  );

  if (hasGaranzieInScadenza) {
    letturaOperativa.push(
      "Polizze/fideiussioni/cauzioni rilevate nel perimetro: richiedere tempestivo aggiornamento garanzie.",
    );
  }

  const hasCanoniScaduti = listData.items.some(
    (item) => item.tipologia === "PAGAMENTO_CANONE" && item.giorniRitardo !== null,
  );

  if (hasCanoniScaduti) {
    letturaOperativa.push(
      "Scadenze canone scadute presenti: avviare verifica economica con eventuale proposta di diffida.",
    );
  }

  if (letturaOperativa.length === 0) {
    letturaOperativa.push(
      "Nessuna criticità temporale rilevante nel perimetro corrente: agenda adempimenti sotto controllo.",
    );
  }

  return (
    <AppShell title="Scadenze" subtitle="Calendario operativo degli adempimenti concessori">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardHeader>
            <CardTitle>Totale scadenze</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{listData.summary.totale}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scadute</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{listData.summary.scadute}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entro 30 giorni</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{listData.summary.entro30}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entro 60 giorni</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{listData.summary.entro60}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entro 90 giorni</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{listData.summary.entro90}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Gestite</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{listData.summary.gestite}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        {canExport ? (
          <div className="mb-4 flex justify-end">
            <Link
              href="/export/scadenze"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Esporta CSV
            </Link>
          </div>
        ) : null}
        <ScadenzeFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Elenco scadenze</CardTitle>
            <CardDescription>Vista operativa con priorità temporale e collegamenti ai moduli istruttori.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Giorni</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const isProcedimentale = item.tipologia === "TERMINE_PROCEDIMENTALE";
                  const isPagamentoCanone = item.tipologia === "PAGAMENTO_CANONE";
                  const isGaranzia = ["POLIZZA", "FIDEIUSSIONE", "CAUZIONE"].includes(item.tipologia);
                  const rowClassName = item.giorniRitardo !== null
                    ? "bg-rose-50"
                    : item.giorniResidui !== null && item.giorniResidui <= 30
                      ? "bg-amber-50"
                      : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                      <TableCell>
                        <GiorniBadge giorniResidui={item.giorniResidui} giorniRitardo={item.giorniRitardo} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{formatEnumLabel(item.tipologia)}</p>
                          {isProcedimentale ? <Badge variant="warning">Procedimentale</Badge> : null}
                          {isPagamentoCanone ? <Badge variant="danger">Canone</Badge> : null}
                          {isGaranzia ? <Badge variant="warning">Garanzia</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900">{item.concessione.numeroAtto}</TableCell>
                      <TableCell>{item.concessione.concessionarioDenominazione}</TableCell>
                      <TableCell>
                        <ScadenzaStatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{item.descrizione ?? "-"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/scadenze/${item.id}`}
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
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      Nessuna scadenza trovata con i filtri correnti.
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
            <CardTitle>Lettura operativa</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {letturaOperativa.map((item, index) => (
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
