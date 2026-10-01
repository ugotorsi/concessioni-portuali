import Link from "next/link";
import { ExternalLink, Plus, SearchX } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { buttonVariants } from "@/components/ui/Button";
import { BACKOFFICE_ROLES, canExportOperationalData, canManageProcedimenti, requireRole } from "@/lib/auth";
import {
  ProcedimentoGiorniBadge,
  ProcedimentoChecklistBadge,
  ProcedimentoOrigineBadge,
  ProcedimentoPreavvisoBadge,
  ProcedimentoStatoBadge,
  ProcedimentoTipologiaBadge,
  ProcedimentoWarningBadge,
} from "@/components/procedimenti/ProcedimentiBadges";
import { ProcedimentiFiltersBar } from "@/components/procedimenti/ProcedimentiFiltersBar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { cn, formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  PROCEDIMENTI_CHECKLIST_VALUES,
  PROCEDIMENTI_MEMORIE_VALUES,
  PROCEDIMENTI_PERIODO_VALUES,
  PROCEDIMENTO_BOOLEAN_FILTER_VALUES,
  PROCEDIMENTO_ORIGINE_VALUES,
  PROCEDIMENTO_STATO_PREAVVISO_RIGETTO_VALUES,
  PROCEDIMENTO_STATO_VALUES,
  PROCEDIMENTO_TIPOLOGIA_VALUES,
  getProcedimentiFilters,
  getProcedimentiList,
  type GetProcedimentiListParams,
  type ProcedimentiPeriodoValue,
  type ProcedimentiChecklistValue,
  type ProcedimentiMemorieValue,
  type ProcedimentoBooleanFilterValue,
  type ProcedimentoOrigineValue,
  type ProcedimentoStatoPreavvisoRigettoValue,
  type ProcedimentoStatoValue,
  type ProcedimentoTipologiaValue,
} from "@/server/queries/procedimenti";

interface ProcedimentiPageProps {
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

export default async function ProcedimentiPage({ searchParams }: ProcedimentiPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const canWrite = canManageProcedimenti(role);
  const canExport = canExportOperationalData(role);
  const resolvedSearch = (await searchParams) ?? {};

  const filters: GetProcedimentiListParams = {
    search: pickString(resolvedSearch.search),
    tipologia: (() => {
      const value = pickString(resolvedSearch.tipologia);
      return value && PROCEDIMENTO_TIPOLOGIA_VALUES.includes(value as ProcedimentoTipologiaValue)
        ? (value as ProcedimentoTipologiaValue)
        : undefined;
    })(),
    stato: (() => {
      const value = pickString(resolvedSearch.stato);
      return value && PROCEDIMENTO_STATO_VALUES.includes(value as ProcedimentoStatoValue)
        ? (value as ProcedimentoStatoValue)
        : undefined;
    })(),
    concessioneId: pickString(resolvedSearch.concessioneId),
    criticitaId: pickString(resolvedSearch.criticitaId),
    periodo: (() => {
      const value = pickString(resolvedSearch.periodo);
      return value && PROCEDIMENTI_PERIODO_VALUES.includes(value as ProcedimentiPeriodoValue)
        ? (value as ProcedimentiPeriodoValue)
        : "TUTTI";
    })(),
    checklist: (() => {
      const value = pickString(resolvedSearch.checklist);
      return value && PROCEDIMENTI_CHECKLIST_VALUES.includes(value as ProcedimentiChecklistValue)
        ? (value as ProcedimentiChecklistValue)
        : "TUTTE";
    })(),
    memorie: (() => {
      const value = pickString(resolvedSearch.memorie);
      return value && PROCEDIMENTI_MEMORIE_VALUES.includes(value as ProcedimentiMemorieValue)
        ? (value as ProcedimentiMemorieValue)
        : "TUTTE";
    })(),
    origineProcedimento: (() => {
      const value = pickString(resolvedSearch.origineProcedimento);
      return value && PROCEDIMENTO_ORIGINE_VALUES.includes(value as ProcedimentoOrigineValue)
        ? (value as ProcedimentoOrigineValue)
        : undefined;
    })(),
    procedimentoUfficio: (() => {
      const value = pickString(resolvedSearch.procedimentoUfficio);
      return value && PROCEDIMENTO_BOOLEAN_FILTER_VALUES.includes(value as ProcedimentoBooleanFilterValue)
        ? (value as ProcedimentoBooleanFilterValue)
        : "TUTTI";
    })(),
    preavvisoRigettoApplicabile: (() => {
      const value = pickString(resolvedSearch.preavvisoRigettoApplicabile);
      return value && PROCEDIMENTO_BOOLEAN_FILTER_VALUES.includes(value as ProcedimentoBooleanFilterValue)
        ? (value as ProcedimentoBooleanFilterValue)
        : "TUTTI";
    })(),
    statoPreavvisoRigetto: (() => {
      const value = pickString(resolvedSearch.statoPreavvisoRigetto);
      return value && PROCEDIMENTO_STATO_PREAVVISO_RIGETTO_VALUES.includes(value as ProcedimentoStatoPreavvisoRigettoValue)
        ? (value as ProcedimentoStatoPreavvisoRigettoValue)
        : undefined;
    })(),
  };

  const [filtersData, listData] = await Promise.all([
    getProcedimentiFilters(),
    getProcedimentiList(filters),
  ]);

  const totale = listData.items.length;
  const daAvviare = listData.items.filter((item) => item.stato === "DA_AVVIARE").length;
  const inCorso = listData.items.filter((item) => item.stato === "IN_CORSO").length;
  const conclusi = listData.items.filter((item) => ["CONCLUSO", "ARCHIVIATO"].includes(item.stato)).length;
  const terminiScaduti = listData.items.filter((item) => item.giorniRitardoContraddittorio !== null).length;
  const avviiDecRev = listData.items.filter((item) => ["AVVIO_DECADENZA", "AVVIO_REVOCA"].includes(item.tipologia)).length;
  const recuperiGaranzie = listData.items.filter((item) => ["RECUPERO_CANONI", "ESCUSSIONE_GARANZIA"].includes(item.tipologia)).length;
  const checklistIncompleta = listData.items.filter((item) => !item.checklistContraddittorioCompleta).length;

  const letturaIstruttoria: string[] = [];
  if (daAvviare > 0) {
    letturaIstruttoria.push("Sono presenti procedimenti da avviare: definire tempestivamente fascicolo istruttorio e assegnazione istruttore.");
  }
  if (terminiScaduti > 0) {
    letturaIstruttoria.push("Sono presenti termini di contraddittorio scaduti: attribuire priorità alta alla chiusura dei passaggi istruttori.");
  }
  if (avviiDecRev > 0) {
    letturaIstruttoria.push("Per i procedimenti di decadenza/revoca verificare presupposti, contraddittorio e proporzionalità prima della proposta conclusiva.");
  }
  if (checklistIncompleta > 0) {
    letturaIstruttoria.push("Sono presenti checklist contraddittorio incomplete: verificare i passaggi essenziali mancanti prima della fase conclusiva.");
  }
  if (recuperiGaranzie > 0) {
    letturaIstruttoria.push("Sono presenti procedimenti economici: rafforzare verifica contabile su canoni, residui, interessi e garanzie.");
  }
  if (letturaIstruttoria.length === 0) {
    letturaIstruttoria.push("Quadro procedimentale regolare sui dati caricati: non emergono priorità istruttorie critiche.");
  }

  return (
    <AppShell
      title="Fascicoli"
      subtitle="Gestione dei fascicoli istruttori e dei procedimenti collegati"
    >
      <section className="space-y-4" aria-label="Quadro operativo fascicoli">
        <SectionHeader
          title="Quadro operativo"
          description="Volumi correnti e termini che richiedono monitoraggio."
          actions={canWrite ? (
            <Link href="/procedimenti/nuovo" className={buttonVariants()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuovo fascicolo
            </Link>
          ) : null}
        />
        <dl className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            ["Totale fascicoli", totale],
            ["Da avviare", daAvviare],
            ["In corso", inCorso],
            ["Conclusi", conclusi],
            ["Termini scaduti", terminiScaduti],
            ["Avvii decadenza/revoca", avviiDecRev],
            ["Recuperi e garanzie", recuperiGaranzie],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-slate-200 px-4 py-3 last:border-b-0 sm:border-r lg:border-b-0">
              <dt className="text-xs font-medium leading-4 text-slate-600">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-950">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6">
        {canWrite ? (
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            {canExport ? (
              <Link
                href="/export/procedimenti"
                className={buttonVariants({ variant: "secondary" })}
              >
                Esporta CSV
              </Link>
            ) : null}
          </div>
        ) : canExport ? (
          <div className="mb-4 flex justify-end">
            <Link
              href="/export/procedimenti"
              className={buttonVariants({ variant: "secondary" })}
            >
              Esporta CSV
            </Link>
          </div>
        ) : null}
        <ProcedimentiFiltersBar filtersData={filtersData} current={filters} />
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader>
            <SectionHeader
              title="Registro fascicoli"
              count={listData.items.length}
              description="Risultati ordinati per aggiornamento. Scorri orizzontalmente per consultare tutti i dati istruttori."
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead>Warning</TableHead>
                  <TableHead>Origine</TableHead>
                  <TableHead>Preavviso</TableHead>
                  <TableHead>Concessione</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Criticità collegata</TableHead>
                  <TableHead>Riferimento normativo</TableHead>
                  <TableHead>Termine memorie</TableHead>
                  <TableHead>Termine contraddittorio</TableHead>
                  <TableHead>Giorni</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listData.items.map((item) => {
                  const isCriticoTipologia = [
                    "AVVIO_DECADENZA",
                    "AVVIO_REVOCA",
                    "RECUPERO_CANONI",
                    "ORDINE_RIPRISTINO",
                  ].includes(item.tipologia);

                  const rowClassName = item.stato === "DA_AVVIARE" || item.giorniRitardoContraddittorio !== null
                    ? "bg-rose-50"
                    : item.stato === "IN_CORSO" || isCriticoTipologia
                      ? "bg-amber-50"
                      : "";

                  return (
                    <TableRow key={item.id} className={rowClassName}>
                      <TableCell>
                        <ProcedimentoTipologiaBadge value={item.tipologia} />
                      </TableCell>
                      <TableCell>
                        <ProcedimentoStatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell>
                        <ProcedimentoChecklistBadge complete={item.checklistContraddittorioCompleta} />
                      </TableCell>
                      <TableCell>
                        <ProcedimentoWarningBadge level={item.checklistWarningLevel} />
                      </TableCell>
                      <TableCell>
                        <ProcedimentoOrigineBadge value={item.origineProcedimento} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <ProcedimentoPreavvisoBadge
                            applicabile={item.preavvisoRigettoApplicabile}
                            stato={item.statoPreavvisoRigetto}
                          />
                          <p className="text-xs text-slate-500">{formatEnumLabel(item.statoPreavvisoRigetto)}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.concessione.numeroAtto}</TableCell>
                      <TableCell>{item.concessione.concessionario.denominazione}</TableCell>
                      <TableCell>
                        {item.criticita ? (
                          <div className="space-y-1">
                            <p>{formatEnumLabel(item.criticita.tipologia)}</p>
                            <Badge variant={item.criticita.stato === "APERTA" ? "danger" : "warning"}>
                              {formatEnumLabel(item.criticita.gravita)}
                            </Badge>
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                      <TableCell>
                        {item.termineMemorieScadenza ? formatDateIT(item.termineMemorieScadenza) : "-"}
                      </TableCell>
                      <TableCell>
                        {item.dataScadenzaContraddittorio ? formatDateIT(item.dataScadenzaContraddittorio) : "-"}
                      </TableCell>
                      <TableCell>
                        <ProcedimentoGiorniBadge
                          giorniResiduiContraddittorio={item.giorniResiduiContraddittorio}
                          giorniRitardoContraddittorio={item.giorniRitardoContraddittorio}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/procedimenti/${item.id}`}
                            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full justify-start")}
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Apri scheda
                          </Link>
                          <Link
                            href={`/concessioni/${item.concessione.id}`}
                            className="text-xs text-slate-600 underline underline-offset-4"
                          >
                            Concessione
                          </Link>
                          {item.criticita ? (
                            <Link
                              href={`/criticita/${item.criticita.id}`}
                              className="text-xs text-slate-600 underline underline-offset-4"
                            >
                              Criticità
                            </Link>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {listData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14}>
                      <EmptyState
                        icon={SearchX}
                        title="Nessun fascicolo trovato"
                        description="Modifica i filtri applicati oppure crea un nuovo fascicolo."
                        action={canWrite ? (
                          <Link href="/procedimenti/nuovo" className={buttonVariants({ variant: "secondary" })}>
                            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                            Nuovo fascicolo
                          </Link>
                        ) : null}
                      />
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
            <CardTitle>Lettura istruttoria</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {letturaIstruttoria.map((item, index) => (
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
