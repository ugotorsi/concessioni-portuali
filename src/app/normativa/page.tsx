import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { AmbitoNormaBadge, StatoVersioneBadge } from "@/components/normativa/NormativaBadges";
import { NormativaFiltersBar } from "@/components/normativa/NormativaFiltersBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { canManageNormativaUpdate, canViewNormativa, requireRole } from "@/lib/auth";
import { isInvestorDemoMode } from "@/lib/investor-demo";
import { investorDemoNormativa } from "@/lib/investor-demo-data";
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
  if (isInvestorDemoMode()) {
    return (
      <AppShell title="Normativa" subtitle="Registro dimostrativo su fonti simulate">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Fonti censite</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{investorDemoNormativa.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Versioni vigenti</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-emerald-700">2</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>In consultazione</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-amber-700">1</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Impatti mappati</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">5</p>
            </CardContent>
          </Card>
        </section>

        <section className="mt-4">
          <div className="mb-4 flex justify-end">
            <Link
              href="/normativa/orchestrazione"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Orchestrazione regole
            </Link>
          </div>
        </section>

        <section className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Registro fonti normative demo</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titolo</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {investorDemoNormativa.map((item) => (
                    <TableRow key={item.title}>
                      <TableCell className="font-semibold text-slate-900">{item.title}</TableCell>
                      <TableCell>{item.status}</TableCell>
                      <TableCell>{item.note}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </AppShell>
    );
  }

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
    <AppShell title="Normativa" subtitle="Fonti, versioni vigenti e impatti operativi sui moduli">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Fonti censite</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{listData.summary.totaleFonti}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Versioni vigenti</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{listData.summary.versioniVigenti}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>In consultazione</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{listData.summary.versioniInConsultazione}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Impatti mappati</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{listData.summary.impattiAperti}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Link
            href="/normativa/orchestrazione"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Orchestrazione regole
          </Link>
          {canManageNormativaUpdate(role) ? (
            <Link
              href="/normativa/aggiornamento"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Aggiornamento normativo
            </Link>
          ) : null}
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
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold text-slate-900">{item.codice}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.titolo}</TableCell>
                    <TableCell>
                      <AmbitoNormaBadge value={item.ambito} />
                    </TableCell>
                    <TableCell>{item.versioneCorrente ?? "-"}</TableCell>
                    <TableCell>
                      {item.statoCorrente ? <StatoVersioneBadge value={item.statoCorrente} /> : "-"}
                    </TableCell>
                    <TableCell>{item.dataEntrataVigore ? formatDateIT(item.dataEntrataVigore) : "-"}</TableCell>
                    <TableCell>{item.impattiCount}</TableCell>
                    <TableCell>
                      <Link
                        href={`/normativa/${item.id}`}
                        className="text-sm font-medium text-slate-900 underline underline-offset-4"
                      >
                        Apri scheda
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {listData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
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
