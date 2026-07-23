import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { BACKOFFICE_ROLES, canExportOperationalData, canManageCriticita, requireRole } from "@/lib/auth";
import { CriticitaFiltersBar } from "@/components/criticita/CriticitaFiltersBar";
import { GravitaBadge, StatoBadge, TipologiaBadge } from "@/components/criticita/CriticitaBadges";
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
import { formatDateIT } from "@/lib/utils";
import {
  getArt47Label,
  getEsitoRegolarizzazioneLabel,
  getRegolarizzazioneBadgeVariant,
  getRischioDecadenzaBadgeVariant,
  getRischioDecadenzaLabel,
} from "@/lib/art47";
import {
  CRITICITA_ART47_LETTERA_VALUES,
  CRITICITA_ESITO_REGOLARIZZAZIONE_VALUES,
  CRITICITA_FONTE_VALUES,
  CRITICITA_GRAVITA_VALUES,
  CRITICITA_REGOLARIZZAZIONE_VALUES,
  CRITICITA_RILEVANZA_ART47_VALUES,
  CRITICITA_RISCHIO_DECADENZA_VALUES,
  CRITICITA_STATO_VALUES,
  CRITICITA_TIPOLOGIA_VALUES,
  getCriticitaFilters,
  getCriticitaList,
  type GetCriticitaListParams,
} from "@/server/queries/criticita";

interface CriticitaPageProps {
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

export default async function CriticitaPage({ searchParams }: CriticitaPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const canWrite = canManageCriticita(role);
  const canExport = canExportOperationalData(role);
  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetCriticitaListParams = {
    search: pickString(resolvedSearch.search),
    tipologia: (() => {
      const value = pickString(resolvedSearch.tipologia);
      return value && CRITICITA_TIPOLOGIA_VALUES.includes(value as (typeof CRITICITA_TIPOLOGIA_VALUES)[number])
        ? (value as (typeof CRITICITA_TIPOLOGIA_VALUES)[number])
        : undefined;
    })(),
    gravita: (() => {
      const value = pickString(resolvedSearch.gravita);
      return value && CRITICITA_GRAVITA_VALUES.includes(value as (typeof CRITICITA_GRAVITA_VALUES)[number])
        ? (value as (typeof CRITICITA_GRAVITA_VALUES)[number])
        : undefined;
    })(),
    stato: (() => {
      const value = pickString(resolvedSearch.stato);
      return value && CRITICITA_STATO_VALUES.includes(value as (typeof CRITICITA_STATO_VALUES)[number])
        ? (value as (typeof CRITICITA_STATO_VALUES)[number])
        : undefined;
    })(),
    fonte: (() => {
      const value = pickString(resolvedSearch.fonte);
      return value && CRITICITA_FONTE_VALUES.includes(value as (typeof CRITICITA_FONTE_VALUES)[number])
        ? (value as (typeof CRITICITA_FONTE_VALUES)[number])
        : undefined;
    })(),
    rilevanzaArt47: (() => {
      const value = pickString(resolvedSearch.rilevanzaArt47);
      return value && CRITICITA_RILEVANZA_ART47_VALUES.includes(value as (typeof CRITICITA_RILEVANZA_ART47_VALUES)[number])
        ? (value as (typeof CRITICITA_RILEVANZA_ART47_VALUES)[number])
        : undefined;
    })(),
    letteraArt47: (() => {
      const value = pickString(resolvedSearch.letteraArt47);
      return value && CRITICITA_ART47_LETTERA_VALUES.includes(value as (typeof CRITICITA_ART47_LETTERA_VALUES)[number])
        ? (value as (typeof CRITICITA_ART47_LETTERA_VALUES)[number])
        : undefined;
    })(),
    rischioDecadenza: (() => {
      const value = pickString(resolvedSearch.rischioDecadenza);
      return value && CRITICITA_RISCHIO_DECADENZA_VALUES.includes(value as (typeof CRITICITA_RISCHIO_DECADENZA_VALUES)[number])
        ? (value as (typeof CRITICITA_RISCHIO_DECADENZA_VALUES)[number])
        : undefined;
    })(),
    regolarizzazione: (() => {
      const value = pickString(resolvedSearch.regolarizzazione);
      return value && CRITICITA_REGOLARIZZAZIONE_VALUES.includes(value as (typeof CRITICITA_REGOLARIZZAZIONE_VALUES)[number])
        ? (value as (typeof CRITICITA_REGOLARIZZAZIONE_VALUES)[number])
        : undefined;
    })(),
    esitoRegolarizzazione: (() => {
      const value = pickString(resolvedSearch.esitoRegolarizzazione);
      return value && CRITICITA_ESITO_REGOLARIZZAZIONE_VALUES.includes(value as (typeof CRITICITA_ESITO_REGOLARIZZAZIONE_VALUES)[number])
        ? (value as (typeof CRITICITA_ESITO_REGOLARIZZAZIONE_VALUES)[number])
        : undefined;
    })(),
    concessioneId: pickString(resolvedSearch.concessioneId),
  };

  const [filtersData, listData] = await Promise.all([
    getCriticitaFilters(),
    getCriticitaList(filters),
  ]);

  return (
    <AppShell
      title="Criticità"
      subtitle="Registro operativo delle anomalie tecniche, giuridiche ed economiche"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardHeader>
            <CardTitle>Totale</CardTitle>
            <CardDescription>Criticità censite</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{listData.summary.totale}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Aperte</CardTitle>
            <CardDescription>Da presidiare</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{listData.summary.aperte}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Urgenti</CardTitle>
            <CardDescription>Trattazione prioritaria</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-rose-700">{listData.summary.urgenti}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Alte</CardTitle>
            <CardDescription>Rischio significativo</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{listData.summary.alte}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>In gestione</CardTitle>
            <CardDescription>Istruttoria attiva</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{listData.summary.inGestione}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Risolte</CardTitle>
            <CardDescription>Storico interventi</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{listData.summary.risolte}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        {canWrite ? (
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            {canExport ? (
              <Link
                href="/export/criticita"
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Esporta CSV
              </Link>
            ) : null}
            <Link
              href="/criticita/nuova"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Nuova criticità
            </Link>
          </div>
        ) : canExport ? (
          <div className="mb-4 flex justify-end">
            <Link
              href="/export/criticita"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Esporta CSV
            </Link>
          </div>
        ) : null}
        <CriticitaFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Registro criticità</CardTitle>
            <CardDescription>
              Vista read-only orientata a rischio, norma collegata e azione istruttoria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravità</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Riferimento normativo</TableHead>
                  <TableHead>Art. 47</TableHead>
                  <TableHead>Regolarizzazione</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Procedimenti</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const isRischio = ["RISCHIO_DECADENZA", "RISCHIO_REVOCA"].includes(item.tipologia);
                  const rowClassName = item.gravita === "URGENTE"
                    ? "bg-rose-50"
                    : item.gravita === "ALTA"
                      ? "bg-amber-50"
                      : item.stato === "APERTA"
                        ? "bg-orange-50"
                        : isRischio
                          ? "bg-red-50"
                          : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell>
                        <GravitaBadge value={item.gravita} />
                      </TableCell>
                      <TableCell>
                        <TipologiaBadge value={item.tipologia} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">{item.concessione.numeroAtto}</p>
                          <p className="text-xs text-slate-500">{formatDateIT(item.concessione.dataScadenza)}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.concessione.concessionarioDenominazione}</TableCell>
                      <TableCell className="max-w-72 truncate">{item.descrizione}</TableCell>
                      <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                      <TableCell>
                        {item.rilevanzaArt47 ? (
                          <div className="space-y-1">
                            <Badge variant="danger">Art. 47</Badge>
                            <p className="text-xs text-slate-600">{getArt47Label(item.letteraArt47)}</p>
                            <Badge variant={getRischioDecadenzaBadgeVariant(item.rischioDecadenza)}>
                              {getRischioDecadenzaLabel(item.rischioDecadenza)}
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="default">Non rilevante</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.regolarizzata ? (
                          <div className="space-y-1">
                            <Badge variant="success">Regolarizzata</Badge>
                            <Badge variant={getRegolarizzazioneBadgeVariant(item.esitoRegolarizzazione)}>
                              {getEsitoRegolarizzazioneLabel(item.esitoRegolarizzazione)}
                            </Badge>
                            {!item.verificataRegolarizzazione ? (
                              <Badge variant="warning">Da verificare</Badge>
                            ) : null}
                          </div>
                        ) : (
                          <Badge variant="default">Non regolarizzata</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.procedimentiCount > 0 ? "warning" : "default"}>
                          {item.procedimentiCount}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/criticita/${item.id}`}
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
                    <TableCell colSpan={11} className="text-center text-slate-500">
                      Nessuna criticità trovata con i filtri correnti.
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
