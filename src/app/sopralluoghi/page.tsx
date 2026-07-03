import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { BACKOFFICE_ROLES, canManageSopralluoghi, requireRole } from "@/lib/auth";
import {
  ConformitaBadge,
  EsitoSopralluogoBadge,
  ProblemaTecnicoBadge,
} from "@/components/sopralluoghi/SopralluoghiBadges";
import { SopralluoghiFiltersBar } from "@/components/sopralluoghi/SopralluoghiFiltersBar";
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
  SOPRALLUOGHI_PERIODO_VALUES,
  SOPRALLUOGO_ESITO_VALUES,
  getSopralluoghiFilters,
  getSopralluoghiList,
  type GetSopralluoghiListParams,
  type SopralluoghiPeriodoValue,
  type SopralluogoEsitoValue,
} from "@/server/queries/sopralluoghi";

interface SopralluoghiPageProps {
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

function hasIssueText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();
  if (lower.includes("ok") || lower.includes("regolare") || lower.includes("nessuna")) {
    return false;
  }

  return [
    "critic",
    "risch",
    "elevat",
    "non conform",
    "difform",
    "manc",
    "inadegu",
    "violaz",
    "interferenz",
    "ostru",
    "sicurez",
    "occupaz",
  ].some((token) => lower.includes(token));
}

export const dynamic = "force-dynamic";

export default async function SopralluoghiPage({ searchParams }: SopralluoghiPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const canWrite = canManageSopralluoghi(role);
  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetSopralluoghiListParams = {
    search: pickString(resolvedSearch.search),
    esito: (() => {
      const value = pickString(resolvedSearch.esito);
      return value && SOPRALLUOGO_ESITO_VALUES.includes(value as SopralluogoEsitoValue)
        ? (value as SopralluogoEsitoValue)
        : undefined;
    })(),
    concessioneId: pickString(resolvedSearch.concessioneId),
    periodo: (() => {
      const value = pickString(resolvedSearch.periodo);
      return value && SOPRALLUOGHI_PERIODO_VALUES.includes(value as SopralluoghiPeriodoValue)
        ? (value as SopralluoghiPeriodoValue)
        : "TUTTI";
    })(),
  };

  const [filtersData, listData] = await Promise.all([
    getSopralluoghiFilters(),
    getSopralluoghiList(filters),
  ]);

  const totale = listData.items.length;
  const positivi = listData.items.filter((item) => item.esito === "POSITIVO").length;
  const conRilievi = listData.items.filter((item) => item.esito === "CON_RILIEVI").length;
  const negativi = listData.items.filter((item) => item.esito === "NEGATIVO").length;
  const nonConformi = listData.items.filter((item) => !item.conformitaPlanimetrica).length;
  const conCriticitaCollegate = listData.items.filter((item) => item.criticitaCollegateCount > 0).length;

  const problemiSicurezza = listData.items.filter((item) => hasIssueText(item.sicurezza)).length;

  const letturaTecnica: string[] = [];
  if (negativi > 0) {
    letturaTecnica.push("Sono presenti sopralluoghi con esito negativo: attivare verifica tecnica prioritaria.");
  }
  if (nonConformi > 0) {
    letturaTecnica.push(
      "Sono presenti rilievi planimetrici: confrontare titolo concessorio, planimetria assentita e area occupata.",
    );
  }
  if (problemiSicurezza > 0) {
    letturaTecnica.push("Sono emersi profili di sicurezza: programmare intervento tecnico urgente con riscontro prescrizioni.");
  }
  if (letturaTecnica.length === 0) {
    letturaTecnica.push("Quadro tecnico regolare sui dati caricati: non emergono rilievi significativi.");
  }

  return (
    <AppShell
      title="Sopralluoghi"
      subtitle="Verifiche tecniche sullo stato dei luoghi, occupazioni e prescrizioni"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardHeader>
            <CardTitle>Totale sopralluoghi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{totale}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Positivi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{positivi}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Con rilievi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{conRilievi}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Negativi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{negativi}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Non conformi planimetricamente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{nonConformi}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Con criticità collegate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{conCriticitaCollegate}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        {canWrite ? (
          <div className="mb-4 flex justify-end">
            <Link
              href="/sopralluoghi/nuovo"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Nuovo sopralluogo
            </Link>
          </div>
        ) : null}
        <SopralluoghiFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Registro sopralluoghi</CardTitle>
            <CardDescription>Vista read-only per supporto tecnico-istruttorio e monitoraggio rilievi.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Esito</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Area/Bene</TableHead>
                  <TableHead>Conformita</TableHead>
                  <TableHead>Sicurezza</TableHead>
                  <TableHead>Occupazione</TableHead>
                  <TableHead>Interferenze</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const issueSicurezza = hasIssueText(item.sicurezza);
                  const issueOccupazione = hasIssueText(item.occupazione);
                  const issueInterferenze = hasIssueText(item.interferenze);

                  const rowClassName = item.esito === "NEGATIVO"
                    ? "bg-rose-50"
                    : item.esito === "CON_RILIEVI" || !item.conformitaPlanimetrica || issueSicurezza || issueOccupazione || issueInterferenze
                      ? "bg-amber-50"
                      : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell>{formatDateIT(item.data)}</TableCell>
                      <TableCell>
                        <EsitoSopralluogoBadge value={item.esito} />
                      </TableCell>
                      <TableCell>{item.concessione.numeroAtto}</TableCell>
                      <TableCell>{item.concessione.concessionario.denominazione}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{formatEnumLabel(item.concessione.tipologiaBene)}</p>
                          <p className="text-xs text-slate-500">{item.concessione.ubicazione ?? "-"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ConformitaBadge value={item.conformitaPlanimetrica} />
                      </TableCell>
                      <TableCell>
                        <ProblemaTecnicoBadge hasIssue={issueSicurezza} />
                      </TableCell>
                      <TableCell>
                        <ProblemaTecnicoBadge hasIssue={issueOccupazione} />
                      </TableCell>
                      <TableCell>
                        <ProblemaTecnicoBadge hasIssue={issueInterferenze} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/sopralluoghi/${item.id}`}
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
                      Nessun sopralluogo trovato con i filtri correnti.
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
            <CardTitle>Lettura tecnica</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {letturaTecnica.map((item, index) => (
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
