import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { ConcessioniFiltersBar } from "@/components/concessioni/ConcessioniFiltersBar";
import { StatoBadge } from "@/components/concessioni/ConcessioniBadges";
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
import { getConcessionVerticalLabel } from "@/lib/concession-vertical-labels";
import { CONCESSION_VERTICAL_VALUES } from "@/lib/concession-vertical";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  ATTIVITA_CONCESSIONE_VALUES,
  STATO_CONCESSIONE_VALUES,
  TIPOLOGIA_BENE_VALUES,
  getConcessioniFilters,
  getConcessioniList,
  type ConcessioniScadenzaFilter,
  type GetConcessioniListParams,
} from "@/server/queries/concessioni";

interface ConcessioniPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const scadenzaValues: ConcessioniScadenzaFilter[] = [
  "SCADUTE",
  "ENTRO_30_GIORNI",
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

export default async function ConcessioniPage({ searchParams }: ConcessioniPageProps) {
  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetConcessioniListParams = {
    search: pickString(resolvedSearch.search),
    stato: (() => {
      const value = pickString(resolvedSearch.stato);
      return value && STATO_CONCESSIONE_VALUES.includes(value as (typeof STATO_CONCESSIONE_VALUES)[number])
        ? (value as (typeof STATO_CONCESSIONE_VALUES)[number])
        : undefined;
    })(),
    tipologiaBene: (() => {
      const value = pickString(resolvedSearch.tipologiaBene);
      return value && TIPOLOGIA_BENE_VALUES.includes(value as (typeof TIPOLOGIA_BENE_VALUES)[number])
        ? (value as (typeof TIPOLOGIA_BENE_VALUES)[number])
        : undefined;
    })(),
    attivita: (() => {
      const value = pickString(resolvedSearch.attivita);
      return value && ATTIVITA_CONCESSIONE_VALUES.includes(value as (typeof ATTIVITA_CONCESSIONE_VALUES)[number])
        ? (value as (typeof ATTIVITA_CONCESSIONE_VALUES)[number])
        : undefined;
    })(),
    concessionVertical: (() => {
      const value = pickString(resolvedSearch.concessionVertical);
      return value && CONCESSION_VERTICAL_VALUES.includes(value as (typeof CONCESSION_VERTICAL_VALUES)[number])
        ? (value as (typeof CONCESSION_VERTICAL_VALUES)[number])
        : undefined;
    })(),
    concessionarioId: pickString(resolvedSearch.concessionarioId),
    scadenza: (() => {
      const value = pickString(resolvedSearch.scadenza);
      if (value && scadenzaValues.includes(value as ConcessioniScadenzaFilter)) {
        return value as ConcessioniScadenzaFilter;
      }
      return undefined;
    })(),
  };

  const [filtersData, listData] = await Promise.all([
    getConcessioniFilters(),
    getConcessioniList(filters),
  ]);

  return (
    <AppShell
      title="Concessioni"
      subtitle="Anagrafe operativa dei rapporti concessori monitorati"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Totale concessioni</CardTitle>
            <CardDescription>Posizioni censite in piattaforma</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{listData.summary.totale}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Concessioni attive</CardTitle>
            <CardDescription>Rapporti in esercizio ordinario</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{listData.summary.attive}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Concessioni scadute</CardTitle>
            <CardDescription>Posizioni da riallineare</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{listData.summary.scadute}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>In scadenza entro 90 giorni</CardTitle>
            <CardDescription>Posizioni da programmare</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{listData.summary.inScadenza90}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <ConcessioniFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Elenco concessioni</CardTitle>
            <CardDescription>
              Vista read-only operativa: scadenze, criticità e pagamenti critici in evidenza.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Atto</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Bene/Area</TableHead>
                  <TableHead>Attività</TableHead>
                  <TableHead>Verticale</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Canone</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Criticità</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const rowClassName = item.isScaduta
                    ? "bg-rose-50"
                    : item.isInScadenza90
                      ? "bg-amber-50"
                      : item.criticitaAperteCount > 0 || item.pagamentiCriticiCount > 0
                        ? "bg-orange-50"
                        : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell className="font-semibold text-slate-900">{item.numeroAtto}</TableCell>
                      <TableCell>{item.concessionarioDenominazione}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{formatEnumLabel(item.tipologiaBene)}</p>
                          {item.ubicazione ? <p className="text-xs text-slate-500">{item.ubicazione}</p> : null}
                        </div>
                      </TableCell>
                      <TableCell>{formatEnumLabel(item.attivita)}</TableCell>
                      <TableCell>
                        <Badge data-testid={`concessione-vertical-${item.id}`}>
                          {getConcessionVerticalLabel(item.concessionVertical)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{formatDateIT(item.dataScadenza)}</p>
                          {item.isScaduta ? (
                            <Badge variant="danger">Scaduta</Badge>
                          ) : item.isInScadenza90 ? (
                            <Badge variant="warning">Entro 90 giorni</Badge>
                          ) : (
                            <Badge variant="success">Futura</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.canoneAnnuo !== null ? formatCurrencyEUR(item.canoneAnnuo) : "-"}
                      </TableCell>
                      <TableCell>
                        <StatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-600">
                            Aperte: <span className="font-semibold">{item.criticitaAperteCount}</span>
                          </p>
                          <p className="text-xs text-slate-600">
                            Scadenze critiche: <span className="font-semibold">{item.scadenzeAperteScaduteCount}</span>
                          </p>
                          <p className="text-xs text-slate-600">
                            Pagamenti critici: <span className="font-semibold">{item.pagamentiCriticiCount}</span>
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/concessioni/${item.id}`}
                          className="text-sm font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:text-slate-700"
                        >
                          Apri scheda
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {listData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-slate-500">
                      Nessuna concessione trovata con i filtri correnti.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
