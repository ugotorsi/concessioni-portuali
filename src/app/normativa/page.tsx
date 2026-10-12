import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { AmbitoNormaBadge, StatoVersioneBadge } from "@/components/normativa/NormativaBadges";
import { NormativaFiltersBar } from "@/components/normativa/NormativaFiltersBar";
import { buttonVariants } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ClickableTableRow } from "@/components/ui/ClickableTableRow";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { canManageNormativaUpdate, canViewNormativa, requireRole } from "@/lib/auth";
import { formatDateIT } from "@/lib/utils";
import {
  NORMA_AMBITO_VALUES,
  NORMA_STATO_VALUES,
  getNormativaFilters,
  getNormativaList,
  type GetNormativaListParams,
  type NormaAmbitoValue,
  type NormaStatoValue,
} from "@/server/queries/normativa";

interface NormativaPageProps {
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

export default async function NormativaPage({ searchParams }: NormativaPageProps) {
  const role = await requireRole();

  if (!canViewNormativa(role)) {
    return null;
  }

  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetNormativaListParams = {
    search: pickString(resolvedSearch.search),
    ambito: (() => {
      const value = pickString(resolvedSearch.ambito);
      return value && NORMA_AMBITO_VALUES.includes(value as NormaAmbitoValue)
        ? (value as NormaAmbitoValue)
        : undefined;
    })(),
    stato: (() => {
      const value = pickString(resolvedSearch.stato);
      return value && NORMA_STATO_VALUES.includes(value as NormaStatoValue)
        ? (value as NormaStatoValue)
        : undefined;
    })(),
  };

  const [filtersData, listData] = await Promise.all([getNormativaFilters(), getNormativaList(filters)]);

  return (
    <AppShell title="Normativa" subtitle="Fonti giuridiche, versioni e impatti sulle concessioni">
      <section aria-label="Riepilogo normativa">
        <dl className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Fonti censite", listData.summary.totaleFonti],
            ["Versioni vigenti", listData.summary.versioniVigenti],
            ["In consultazione", listData.summary.versioniInConsultazione],
            ["Impatti mappati", listData.summary.impattiAperti],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-slate-200 px-4 py-3 last:border-b-0 sm:border-r sm:border-b-0">
              <dt className="text-xs font-medium text-slate-600">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-950">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4">
        <div className="mb-4 flex flex-wrap items-start justify-end gap-2">
          {canManageNormativaUpdate(role) ? (
            <Link href="/normativa/aggiornamento" className={buttonVariants()}>
              Aggiornamento normativo
            </Link>
          ) : null}
          <details className="relative">
            <summary className={buttonVariants({ variant: "secondary" })}>Altro</summary>
            <div className="absolute right-0 z-20 mt-2 grid min-w-56 gap-1 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {["ADMIN", "GIURIDICO"].includes(role) ? (
                <Link href="/normativa/riconciliazione" className="rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                  Riconciliazione fonti
                </Link>
              ) : null}
              <Link href="/normativa/orchestrazione" className="rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                Orchestrazione regole
              </Link>
            </div>
          </details>
        </div>
        <NormativaFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Registro fonti normative</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Codice</TableHead>
                  <TableHead>Titolo</TableHead>
                  <TableHead>Ambito</TableHead>
                  <TableHead>Versione corrente</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Data entrata vigore</TableHead>
                  <TableHead>Impatti</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => (
                  <ClickableTableRow key={item.id} href={`/normativa/${item.id}`} label={`Apri fonte ${item.codice}`}>
                    <TableCell className="font-semibold text-slate-900">{item.codice}</TableCell>
                    <TableCell className="max-w-96 truncate">
                      <Link href={`/normativa/${item.id}`} className="font-medium text-[#173d4f] underline decoration-slate-300 underline-offset-4 hover:decoration-[#173d4f]">
                        {item.titolo}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AmbitoNormaBadge value={item.ambito} />
                    </TableCell>
                    <TableCell>{item.versioneCorrente ?? "-"}</TableCell>
                    <TableCell>
                      {item.statoCorrente ? <StatoVersioneBadge value={item.statoCorrente} /> : "-"}
                    </TableCell>
                    <TableCell>{item.dataEntrataVigore ? formatDateIT(item.dataEntrataVigore) : "-"}</TableCell>
                    <TableCell>{item.impattiCount}</TableCell>
                  </ClickableTableRow>
                ))}
                {listData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500">
                      Nessuna fonte normativa trovata con i filtri correnti.
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
