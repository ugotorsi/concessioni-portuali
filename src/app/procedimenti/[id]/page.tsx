import Link from "next/link";
import { notFound } from "next/navigation";

import { SubmitButtonPending } from "@/components/forms/SubmitButtonPending";
import { GravitaBadge, StatoBadge as CriticitaStatoBadge } from "@/components/criticita/CriticitaBadges";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { AppShell } from "@/components/layout/AppShell";
import {
  ProcedimentoGiorniBadge,
  ProcedimentoChecklistBadge,
  ProcedimentoOrigineBadge,
  ProcedimentoPreavvisoBadge,
  ProcedimentoStatoBadge,
  ProcedimentoTipologiaBadge,
  ProcedimentoWarningBadge,
} from "@/components/procedimenti/ProcedimentiBadges";
import { ScadenzaStatoBadge } from "@/components/scadenze/ScadenzeBadges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";
import { canManageProcedimenti, canRegisterProcedimentoDecision, requireRole } from "@/lib/auth";
import {
  getChecklistContraddittorioItems,
  getOrigineProcedimentoLabel,
  getProcedimentoChecklistGuidance,
  getStatoPreavvisoRigettoDescription,
  getStatoPreavvisoRigettoLabel,
} from "@/lib/procedimento-checklist";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  finalizeProcedimentoDecisionAction,
  reassignProcedimentoResponsabileAction,
  updateProcedimentoChecklistAction,
} from "@/server/actions/procedimenti";
import { getDecisionRulePreviewForTipologia } from "@/server/procedimenti/decisioni";
import { getLetturaProcedimentale, getProcedimentoDetail } from "@/server/queries/procedimenti";
import { getNormeForProcedimento } from "@/server/queries/normativa";

import { PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES } from "@/server/queries/procedimenti";

interface ProcedimentoDetailPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

function getStatoEffettoLabel(value: "NON_PREVISTO" | "PENDENTE" | "PRONTO" | "APPLICATO" | "BLOCCATO" | "ERRORE") {
  switch (value) {
    case "NON_PREVISTO":
      return "Effetto non previsto";
    case "PENDENTE":
      return "Effetto pendente";
    case "PRONTO":
      return "Effetto pronto";
    case "APPLICATO":
      return "Effetto applicato";
    case "BLOCCATO":
      return "Effetto bloccato";
    case "ERRORE":
      return "Errore applicazione";
    default:
      return value;
  }
}

export default async function ProcedimentoDetailPage({ params }: ProcedimentoDetailPageProps) {
  const role = await requireRole();
  const canWriteChecklist = canManageProcedimenti(role);
  const canRegisterDecision = canRegisterProcedimentoDecision(role);
  const { id } = await params;
  const detail = await getProcedimentoDetail(id);

  if (!detail) {
    notFound();
  }

  const checklist = getChecklistContraddittorioItems(detail.procedimento);
  const checklistGuidance = getProcedimentoChecklistGuidance(detail.procedimento);
  const preavvisoWarningApplicabileNonInviato =
    detail.procedimento.preavvisoRigettoApplicabile &&
    ["APPLICABILE_DA_INVIARE", "NON_VALUTATO"].includes(detail.procedimento.statoPreavvisoRigetto);
  const preavvisoWarningOsservazioniNonValutate =
    detail.procedimento.osservazioniPreavvisoRicevute &&
    detail.procedimento.statoPreavvisoRigetto !== "OSSERVAZIONI_VALUTATE" &&
    !(detail.procedimento.valutazioneOsservazioniPreavviso && detail.procedimento.valutazioneOsservazioniPreavviso.trim() !== "");

  const lettura = getLetturaProcedimentale({
    tipologia: detail.procedimento.tipologia,
    stato: detail.procedimento.stato,
    riferimentoNormativo: detail.procedimento.riferimentoNormativo,
    giorniRitardoContraddittorio: detail.procedimento.giorniRitardoContraddittorio,
  });
  const normeCollegate = await getNormeForProcedimento(detail.procedimento.id);
  const decisionRules = getDecisionRulePreviewForTipologia(detail.procedimento.tipologia);
  const hasDecision = detail.procedimento.decisioneConclusiva !== null;
  const decisioneConclusiva = detail.procedimento.decisioneConclusiva;
  const canRenderFinalizeForm =
    canRegisterDecision &&
    !hasDecision &&
    ["DA_AVVIARE", "IN_CORSO"].includes(detail.procedimento.stato);

  return (
    <AppShell
      title={`Procedimento ${formatEnumLabel(detail.procedimento.tipologia)}`}
      subtitle="Scheda procedimentale read-only orientata a checklist e lettura istruttoria"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dettaglio procedimento</h1>
            <p className="mt-1 text-sm text-slate-600">Quadro istruttorio con collegamenti a criticità, pagamenti, sopralluoghi e scadenze.</p>
          </div>
          <Link href="/procedimenti" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Torna ai procedimenti
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header procedimento</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
              <div className="mt-1">
                <ProcedimentoTipologiaBadge value={detail.procedimento.tipologia} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
              <div className="mt-1">
                <ProcedimentoStatoBadge value={detail.procedimento.stato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessione</p>
              <p className="mt-1 font-semibold text-slate-900">{detail.concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessionario</p>
              <p className="mt-1 text-slate-900">{detail.concessionario.denominazione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Riferimento normativo</p>
              <p className="mt-1 text-slate-900">{detail.procedimento.riferimentoNormativo ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data avvio</p>
              <p className="mt-1 text-slate-900">
                {detail.procedimento.dataAvvio ? formatDateIT(detail.procedimento.dataAvvio) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Termine contraddittorio</p>
              <p className="mt-1 text-slate-900">
                {detail.procedimento.dataScadenzaContraddittorio
                  ? formatDateIT(detail.procedimento.dataScadenzaContraddittorio)
                  : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data provvedimento finale</p>
              <p className="mt-1 text-slate-900">
                {detail.procedimento.dataProvvedimentoFinale
                  ? formatDateIT(detail.procedimento.dataProvvedimentoFinale)
                  : "-"}
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Dati procedimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
                <p className="mt-1">{formatEnumLabel(detail.procedimento.tipologia)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
                <div className="mt-1">
                  <ProcedimentoStatoBadge value={detail.procedimento.stato} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Giorni contraddittorio</p>
                <div className="mt-1">
                  <ProcedimentoGiorniBadge
                    giorniResiduiContraddittorio={detail.procedimento.giorniResiduiContraddittorio}
                    giorniRitardoContraddittorio={detail.procedimento.giorniRitardoContraddittorio}
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Note istruttorie</p>
                <p className="mt-1">{detail.procedimento.noteIstruttorie ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Responsabile attuale</p>
                <p className="mt-1">{detail.procedimento.responsabileProcedimentoNome ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Email responsabile</p>
                <p className="mt-1">{detail.procedimento.responsabileProcedimentoEmail ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Unita organizzativa</p>
                <p className="mt-1">{detail.procedimento.unitaOrganizzativaResponsabile ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Data assegnazione responsabile</p>
                <p className="mt-1">{detail.procedimento.responsabileAssegnatoAt ? formatDateIT(detail.procedimento.responsabileAssegnatoAt) : "-"}</p>
              </div>
              <p className="md:col-span-2 text-xs text-slate-500">
                Il responsabile amministrativo e distinto dal soggetto che registra l assegnazione nel software e non implica competenza all adozione del provvedimento finale.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storico responsabilita</CardTitle>
              <CardDescription>Registro cronologico delle assegnazioni amministrative.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWriteChecklist ? (
                <form action={reassignProcedimentoResponsabileAction} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <input type="hidden" name="procedimentoId" value={detail.procedimento.id} />
                  <p className="text-sm font-medium text-slate-900">Riassegna responsabile</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-slate-700">
                      Responsabile
                      <Input name="responsabileNome" required />
                    </label>
                    <label className="text-sm text-slate-700">
                      Email responsabile (opzionale)
                      <Input name="responsabileEmail" type="email" />
                    </label>
                    <label className="text-sm text-slate-700">
                      Unita organizzativa
                      <Input name="unitaOrganizzativa" required />
                    </label>
                    <label className="text-sm text-slate-700">
                      Decorrenza
                      <Input name="decorrenza" type="date" required />
                    </label>
                    <label className="text-sm text-slate-700 md:col-span-2">
                      Motivo assegnazione (opzionale)
                      <Textarea name="motivoAssegnazione" rows={2} />
                    </label>
                  </div>
                  <Button type="submit">Riassegna responsabile</Button>
                </form>
              ) : null}

              <div className="space-y-3">
                {detail.procedimento.responsabileAssignments.map((assignment) => (
                  <div key={assignment.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    <div className="grid gap-2 md:grid-cols-2">
                      <p><span className="font-medium text-slate-900">Responsabile:</span> {assignment.responsabileNome}</p>
                      <p><span className="font-medium text-slate-900">Email:</span> {assignment.responsabileEmail ?? "-"}</p>
                      <p><span className="font-medium text-slate-900">Unita:</span> {assignment.unitaOrganizzativa}</p>
                      <p><span className="font-medium text-slate-900">Dal:</span> {formatDateIT(assignment.decorrenza)}</p>
                      <p><span className="font-medium text-slate-900">Al:</span> {assignment.cessazione ? formatDateIT(assignment.cessazione) : "In corso"}</p>
                      <p><span className="font-medium text-slate-900">Comunicata:</span> {assignment.comunicataAt ? formatDateIT(assignment.comunicataAt) : "Non comunicata"}</p>
                      <p><span className="font-medium text-slate-900">Registrata da:</span> {assignment.registeredByUserEmail ?? assignment.registeredByUserId ?? "-"}</p>
                      <p><span className="font-medium text-slate-900">Motivo:</span> {assignment.motivoAssegnazione ?? "-"}</p>
                    </div>
                  </div>
                ))}
                {detail.procedimento.responsabileAssignments.length === 0 ? (
                  <p className="text-sm text-slate-500">Nessuna assegnazione storica registrata.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Checklist contraddittorio</CardTitle>
              <CardDescription>
                Supporto istruttorio non vincolante: non sostituisce la valutazione del responsabile del procedimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato checklist</p>
                  <div className="mt-1">
                    <ProcedimentoChecklistBadge complete={detail.procedimento.checklistContraddittorioCompleta} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Warning</p>
                  <div className="mt-1">
                    <ProcedimentoWarningBadge level={detail.procedimento.checklistWarningLevel} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Completamento</p>
                  <p className="mt-1 text-slate-900">
                    {detail.procedimento.checklistCompletedItems}/{detail.procedimento.checklistTotalItems} ({detail.procedimento.checklistPercentage}%)
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Termine memorie</p>
                  <p className="mt-1 text-slate-900">
                    {detail.procedimento.termineMemorieScadenza ? formatDateIT(detail.procedimento.termineMemorieScadenza) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Origine procedimento</p>
                  <div className="mt-1">
                    <ProcedimentoOrigineBadge value={detail.procedimento.origineProcedimento} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Procedimento d ufficio</p>
                  <p className="mt-1 text-slate-900">{detail.procedimento.procedimentoUfficio ? "Si" : "No"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato preavviso rigetto</p>
                  <div className="mt-1">
                    <ProcedimentoPreavvisoBadge
                      applicabile={detail.procedimento.preavvisoRigettoApplicabile}
                      stato={detail.procedimento.statoPreavvisoRigetto}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{getStatoPreavvisoRigettoLabel(detail.procedimento.statoPreavvisoRigetto)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Termine osservazioni preavviso</p>
                  <p className="mt-1 text-slate-900">
                    {detail.procedimento.termineOsservazioniPreavviso
                      ? formatDateIT(detail.procedimento.termineOsservazioniPreavviso)
                      : "-"}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {getStatoPreavvisoRigettoDescription(detail.procedimento.statoPreavvisoRigetto)}
              </div>

              {preavvisoWarningApplicabileNonInviato ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Preavviso di rigetto indicato come applicabile secondo valutazione istruttoria ma non ancora inviato.
                </div>
              ) : null}

              {preavvisoWarningOsservazioniNonValutate ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Osservazioni sul preavviso ricevute ma non ancora valutate in motivazione istruttoria.
                </div>
              ) : null}

              {detail.criticitaCollegata?.rilevanzaArt47 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Per profili decadenziali ex art. 47, la checklist aiuta a verificare il rispetto del contraddittorio prima di ogni valutazione finale.
                </p>
              ) : null}

              <div className="space-y-2">
                {checklist.map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div>
                      <p className="text-slate-900">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.required ? "Passaggio essenziale" : "Passaggio consigliato"}</p>
                    </div>
                    <Badge variant={item.completed ? "success" : item.required ? "danger" : "default"}>
                      {item.completed ? "Presente" : item.required ? "Mancante" : "Non compilato"}
                    </Badge>
                  </div>
                ))}
              </div>

              {detail.procedimento.checklistMissingItems.length > 0 ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <p className="font-medium">Passaggi essenziali mancanti</p>
                  <ul className="mt-2 list-disc pl-5">
                    {detail.procedimento.checklistMissingItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Motivazione valutazione</p>
                  <p className="mt-1">{detail.procedimento.motivazioneValutazione ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Proposta esito istruttorio</p>
                  <p className="mt-1">{detail.procedimento.propostaEsitoIstruttorio ? formatEnumLabel(detail.procedimento.propostaEsitoIstruttorio) : "-"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Nota checklist contraddittorio</p>
                  <p className="mt-1">{detail.procedimento.noteChecklistContraddittorio ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Data preavviso rigetto</p>
                  <p className="mt-1">{detail.procedimento.dataPreavvisoRigetto ? formatDateIT(detail.procedimento.dataPreavvisoRigetto) : "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Data osservazioni preavviso</p>
                  <p className="mt-1">{detail.procedimento.dataOsservazioniPreavviso ? formatDateIT(detail.procedimento.dataOsservazioniPreavviso) : "-"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Valutazione osservazioni preavviso</p>
                  <p className="mt-1">{detail.procedimento.valutazioneOsservazioniPreavviso ?? "-"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Motivazione mancato preavviso</p>
                  <p className="mt-1">{detail.procedimento.motivazioneMancatoPreavviso ?? "-"}</p>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {checklistGuidance}
              </div>

              {canWriteChecklist ? (
                <form action={updateProcedimentoChecklistAction} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                  <input type="hidden" name="procedimentoId" value={detail.procedimento.id} />
                  <p className="text-sm font-medium text-slate-900">Aggiorna checklist</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Select name="origineProcedimento" defaultValue={detail.procedimento.origineProcedimento}>
                      <option value="UFFICIO">{getOrigineProcedimentoLabel("UFFICIO")}</option>
                      <option value="ISTANZA_PARTE">{getOrigineProcedimentoLabel("ISTANZA_PARTE")}</option>
                      <option value="ALTRO">{getOrigineProcedimentoLabel("ALTRO")}</option>
                    </Select>
                    <Select name="procedimentoUfficio" defaultValue={detail.procedimento.procedimentoUfficio ? "true" : "false"}>
                      <option value="true">Procedimento d ufficio: Si</option>
                      <option value="false">Procedimento d ufficio: No</option>
                    </Select>
                    <Select name="preavvisoRigettoApplicabile" defaultValue={detail.procedimento.preavvisoRigettoApplicabile ? "true" : "false"}>
                      <option value="false">Preavviso applicabile: No / da verificare</option>
                      <option value="true">Preavviso applicabile: Si</option>
                    </Select>
                    <Select name="statoPreavvisoRigetto" defaultValue={detail.procedimento.statoPreavvisoRigetto}>
                      <option value="NON_VALUTATO">{getStatoPreavvisoRigettoLabel("NON_VALUTATO")}</option>
                      <option value="NON_APPLICABILE">{getStatoPreavvisoRigettoLabel("NON_APPLICABILE")}</option>
                      <option value="APPLICABILE_DA_INVIARE">{getStatoPreavvisoRigettoLabel("APPLICABILE_DA_INVIARE")}</option>
                      <option value="INVIATO">{getStatoPreavvisoRigettoLabel("INVIATO")}</option>
                      <option value="OSSERVAZIONI_RICEVUTE">{getStatoPreavvisoRigettoLabel("OSSERVAZIONI_RICEVUTE")}</option>
                      <option value="OSSERVAZIONI_VALUTATE">{getStatoPreavvisoRigettoLabel("OSSERVAZIONI_VALUTATE")}</option>
                    </Select>
                    <Input name="dataPreavvisoRigetto" type="date" defaultValue={detail.procedimento.dataPreavvisoRigetto ? detail.procedimento.dataPreavvisoRigetto.toISOString().slice(0, 10) : ""} />
                    <Input name="termineOsservazioniPreavviso" type="date" defaultValue={detail.procedimento.termineOsservazioniPreavviso ? detail.procedimento.termineOsservazioniPreavviso.toISOString().slice(0, 10) : ""} />
                    <Select name="osservazioniPreavvisoRicevute" defaultValue={detail.procedimento.osservazioniPreavvisoRicevute ? "true" : "false"}>
                      <option value="false">Osservazioni preavviso: No</option>
                      <option value="true">Osservazioni preavviso: Si</option>
                    </Select>
                    <Input name="dataOsservazioniPreavviso" type="date" defaultValue={detail.procedimento.dataOsservazioniPreavviso ? detail.procedimento.dataOsservazioniPreavviso.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="comunicazioneAvvioInviata" defaultChecked={detail.procedimento.comunicazioneAvvioInviata} className="h-4 w-4" />
                      Comunicazione avvio inviata
                    </label>
                    <Input name="dataComunicazioneAvvio" type="date" defaultValue={detail.procedimento.dataComunicazioneAvvio ? detail.procedimento.dataComunicazioneAvvio.toISOString().slice(0, 10) : ""} />
                    <Input name="termineMemorieGiorni" type="number" min={1} defaultValue={detail.procedimento.termineMemorieGiorni ?? ""} />
                    <Input name="termineMemorieScadenza" type="date" defaultValue={detail.procedimento.termineMemorieScadenza ? detail.procedimento.termineMemorieScadenza.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="contestazioneFormaleInviata" defaultChecked={detail.procedimento.contestazioneFormaleInviata} className="h-4 w-4" />
                      Contestazione formale inviata
                    </label>
                    <Input name="dataContestazioneFormale" type="date" defaultValue={detail.procedimento.dataContestazioneFormale ? detail.procedimento.dataContestazioneFormale.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="memorieRicevute" defaultChecked={detail.procedimento.memorieRicevute} className="h-4 w-4" />
                      Memorie ricevute
                    </label>
                    <Input name="dataRicezioneMemorie" type="date" defaultValue={detail.procedimento.dataRicezioneMemorie ? detail.procedimento.dataRicezioneMemorie.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="audizioneRichiesta" defaultChecked={detail.procedimento.audizioneRichiesta} className="h-4 w-4" />
                      Audizione richiesta
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="audizioneSvolta" defaultChecked={detail.procedimento.audizioneSvolta} className="h-4 w-4" />
                      Audizione svolta
                    </label>
                    <Input name="dataAudizione" type="date" defaultValue={detail.procedimento.dataAudizione ? detail.procedimento.dataAudizione.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="sopralluogoIstruttorioSvolto" defaultChecked={detail.procedimento.sopralluogoIstruttorioSvolto} className="h-4 w-4" />
                      Sopralluogo istruttorio svolto
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="controdeduzioniValutate" defaultChecked={detail.procedimento.controdeduzioniValutate} className="h-4 w-4" />
                      Controdeduzioni valutate
                    </label>
                    <Select name="propostaEsitoIstruttorio" defaultValue={detail.procedimento.propostaEsitoIstruttorio ?? ""}>
                      <option value="">Nessuna proposta</option>
                      {PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES.map((item) => (
                        <option key={item} value={item}>{formatEnumLabel(item)}</option>
                      ))}
                    </Select>
                    <Textarea name="motivazioneValutazione" defaultValue={detail.procedimento.motivazioneValutazione ?? ""} className="md:col-span-2" />
                    <Textarea name="valutazioneOsservazioniPreavviso" defaultValue={detail.procedimento.valutazioneOsservazioniPreavviso ?? ""} className="md:col-span-2" />
                    <Textarea name="motivazioneMancatoPreavviso" defaultValue={detail.procedimento.motivazioneMancatoPreavviso ?? ""} className="md:col-span-2" />
                    <Textarea name="noteChecklistContraddittorio" defaultValue={detail.procedimento.noteChecklistContraddittorio ?? ""} className="md:col-span-2" />
                  </div>
                  <Button type="submit">Aggiorna checklist</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Provvedimento finale registrato</CardTitle>
            <CardDescription>
              Registrazione di atto gia adottato: la registrazione nel sistema non costituisce adozione del provvedimento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Proposta istruttoria (non vincolante)</p>
                <p className="mt-1">{detail.procedimento.propostaEsitoIstruttorio ? formatEnumLabel(detail.procedimento.propostaEsitoIstruttorio) : "Nessuna proposta"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Checklist contraddittorio</p>
                <div className="mt-1">
                  <ProcedimentoChecklistBadge complete={detail.procedimento.checklistContraddittorioCompleta} />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Matrice decisionale applicata in questo incremento</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {decisionRules.map((rule) => (
                  <li key={rule.tipoDecisione} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <span className="font-medium text-slate-900">{rule.label}</span>: {rule.effettoLabel}
                  </li>
                ))}
              </ul>
            </div>

            {decisioneConclusiva ? (
              <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">Provvedimento registrato (read-only)</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <p><span className="font-medium">Tipo decisione:</span> {formatEnumLabel(decisioneConclusiva.tipoDecisione)}</p>
                  <p><span className="font-medium">Effetto:</span> {formatEnumLabel(decisioneConclusiva.effettoTitolo)}</p>
                  <p><span className="font-medium">Numero atto:</span> {decisioneConclusiva.numeroAtto}</p>
                  <p><span className="font-medium">Protocollo atto:</span> {decisioneConclusiva.protocolloAtto ?? "-"}</p>
                  <p><span className="font-medium">Data atto:</span> {formatDateIT(decisioneConclusiva.dataAtto)}</p>
                  <p><span className="font-medium">Data efficacia:</span> {formatDateIT(decisioneConclusiva.dataEfficacia)}</p>
                  <p><span className="font-medium">Stato effetto:</span> {getStatoEffettoLabel(decisioneConclusiva.statoEffetto)}</p>
                  <p><span className="font-medium">Effetto applicato il:</span> {decisioneConclusiva.effettoApplicatoAt ? formatDateIT(decisioneConclusiva.effettoApplicatoAt) : "Non ancora applicato"}</p>
                  <p><span className="font-medium">Organo competente:</span> {decisioneConclusiva.organoCompetente}</p>
                  <p><span className="font-medium">Adottante nominativo:</span> {decisioneConclusiva.adottanteNome ?? "-"}</p>
                  <p><span className="font-medium">Adottante qualifica:</span> {decisioneConclusiva.adottanteQualifica ?? "-"}</p>
                  <p><span className="font-medium">Registrato da:</span> {decisioneConclusiva.registeredByUserEmail ?? decisioneConclusiva.registeredByUserId}</p>
                  <p><span className="font-medium">Stato concessione:</span> {decisioneConclusiva.statoConcessionePrecedente ? `${formatEnumLabel(decisioneConclusiva.statoConcessionePrecedente)} -> ${decisioneConclusiva.statoConcessioneSuccessivo ? formatEnumLabel(decisioneConclusiva.statoConcessioneSuccessivo) : "nessuna variazione"}` : "Nessuna variazione"}</p>
                </div>
                <p>
                  <span className="font-medium">Scostamento da istruttoria:</span> {decisioneConclusiva.scostamentoDaIstruttoria ? "Si" : "No"}
                </p>
                <p>
                  <span className="font-medium">Motivazione scostamento:</span> {decisioneConclusiva.motivazioneScostamentoIstruttoria ?? "-"}
                </p>
                {decisioneConclusiva.statoEffetto === "PENDENTE" ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                    Decisione registrata - effetto previsto dal {formatDateIT(decisioneConclusiva.dataEfficacia)} - non ancora applicato.
                  </p>
                ) : null}
                <p><span className="font-medium">Motivazione sintetica:</span> {decisioneConclusiva.motivazioneSintetica}</p>
                <div className="flex flex-wrap gap-3">
                  {decisioneConclusiva.documentoId ? (
                    <Link href={`/documenti/${decisioneConclusiva.documentoId}/download`} className="text-sm underline underline-offset-4">
                      Apri documento atto conclusivo
                    </Link>
                  ) : null}
                  <Link href={`/concessioni/${detail.concessione.id}`} className="text-sm underline underline-offset-4">
                    Apri concessione collegata
                  </Link>
                  <Link href="/audit" className="text-sm underline underline-offset-4">
                    Apri audit trail
                  </Link>
                </div>
              </div>
            ) : null}

            {canRenderFinalizeForm ? (
              <form action={finalizeProcedimentoDecisionAction} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                <input type="hidden" name="procedimentoId" value={detail.procedimento.id} />
                <input type="hidden" name="confermaFinalizzazione" value="CONFIRMO_REGISTRAZIONE_ATTO" />
                <p className="text-sm font-medium text-slate-900">Registra provvedimento finale</p>
                <p className="text-xs text-slate-500">La registrazione nel sistema non costituisce adozione del provvedimento. L atto deve essere gia stato adottato dall organo competente.</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Tipo decisione
                    <Select name="decisionType" required defaultValue={decisionRules[0]?.tipoDecisione ?? ""}>
                      {decisionRules.map((rule) => (
                        <option key={rule.tipoDecisione} value={rule.tipoDecisione}>
                          {rule.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Documento atto conclusivo
                    <Select name="documentoId" defaultValue="" required>
                      <option value="">Seleziona documento</option>
                      {detail.documentiPrincipali.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.nome} ({formatEnumLabel(doc.tipologia)})
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Numero atto
                    <Input name="numeroAtto" required placeholder="Es. DEL-2026-001" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Protocollo atto
                    <Input name="protocolloAtto" required placeholder="Es. PROT-2026-12345" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Data atto
                    <Input name="dataAtto" type="date" required />
                  </label>
                  <label className="text-sm text-slate-700">
                    Data efficacia
                    <Input name="dataEfficacia" type="date" required />
                  </label>
                  <label className="text-sm text-slate-700">
                    Organo competente (adotta l atto)
                    <Input name="organoCompetente" required placeholder="Es. Comitato di Gestione" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Adottante nome (opzionale)
                    <Input name="adottanteNome" placeholder="Es. Mario Rossi" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Adottante qualifica (opzionale)
                    <Input name="adottanteQualifica" placeholder="Es. Presidente del Comitato" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Scostamento da istruttoria
                    <Select name="scostamentoDaIstruttoria" defaultValue="false" required>
                      <option value="false">No</option>
                      <option value="true">Si</option>
                    </Select>
                  </label>
                  <label className="text-sm text-slate-700 md:col-span-2">
                    Motivazione scostamento istruttoria (obbligatoria se scostamento=Si)
                    <Textarea name="motivazioneScostamentoIstruttoria" rows={2} />
                  </label>
                  <label className="text-sm text-slate-700 md:col-span-2">
                    Motivazione sintetica
                    <Textarea name="motivazioneSintetica" rows={3} required />
                  </label>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Conferma esplicita richiesta: la registrazione nel software non prova la competenza amministrativa dell utente registrante.
                </div>
                <SubmitButtonPending pendingLabel="Registrazione provvedimento in corso...">Conferma registrazione provvedimento</SubmitButtonPending>
              </form>
            ) : null}

            {!canRegisterDecision ? (
              <p className="text-sm text-slate-500">Profilo non autorizzato alla registrazione del provvedimento finale.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Lettura procedimentale e azione consigliata</CardTitle>
            <CardDescription>{lettura.avvertenza}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Qualificazione procedimentale</p>
              <p className="mt-1">{lettura.qualificazioneProcedimentale}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Livello attenzione</p>
              <p className="mt-1 font-semibold text-slate-900">{lettura.livelloAttenzione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Passaggi istruttori consigliati</p>
              <p className="mt-1">{lettura.passaggiIstruttoriConsigliati}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Riferimenti normativi suggeriti</p>
              <p className="mt-1">{lettura.riferimentiNormativiSuggeriti}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riferimenti normativi collegati</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Codice</TableHead>
                  <TableHead>Titolo</TableHead>
                  <TableHead>Ambito</TableHead>
                  <TableHead>Severita</TableHead>
                  <TableHead>Impatto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {normeCollegate.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold text-slate-900">{item.codice}</TableCell>
                    <TableCell className="max-w-80 truncate">{item.titolo}</TableCell>
                    <TableCell>{formatEnumLabel(item.ambito)}</TableCell>
                    <TableCell>{formatEnumLabel(item.severita)}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione}</TableCell>
                  </TableRow>
                ))}
                {normeCollegate.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Nessun riferimento normativo collegato al procedimento.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Contesto concessorio</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Numero atto</p>
              <p className="mt-1 font-semibold text-slate-900">{detail.concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato concessione</p>
              <div className="mt-1">
                <Badge>{formatEnumLabel(detail.concessione.stato)}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data rilascio</p>
              <p className="mt-1">{formatDateIT(detail.concessione.dataRilascio)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data scadenza</p>
              <p className="mt-1">{formatDateIT(detail.concessione.dataScadenza)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Bene/Area</p>
              <p className="mt-1">{formatEnumLabel(detail.concessione.tipologiaBene)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Attività</p>
              <p className="mt-1">{formatEnumLabel(detail.concessione.attivita)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
              <p className="mt-1">{detail.concessione.ubicazione ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
              <p className="mt-1">
                {detail.concessione.canoneAnnuo !== null ? formatCurrencyEUR(detail.concessione.canoneAnnuo) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Categoria canone</p>
              <p className="mt-1">{detail.concessione.categoriaCanone ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Scheda concessione</p>
              <Link
                href={`/concessioni/${detail.concessione.id}`}
                className="mt-1 inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
              >
                Apri concessione
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Criticità collegata</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.criticitaCollegata ? (
              <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
                  <p className="mt-1">{formatEnumLabel(detail.criticitaCollegata.tipologia)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Gravità</p>
                  <div className="mt-1">
                    <GravitaBadge value={detail.criticitaCollegata.gravita} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
                  <div className="mt-1">
                    <CriticitaStatoBadge value={detail.criticitaCollegata.stato} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Data rilevazione</p>
                  <p className="mt-1">{formatDateIT(detail.criticitaCollegata.dataRilevazione)}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione</p>
                  <p className="mt-1">{detail.criticitaCollegata.descrizione}</p>
                </div>
                <div className="md:col-span-2">
                  <Link
                    href={`/criticita/${detail.criticitaCollegata.id}`}
                    className="inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
                  >
                    Apri criticità collegata
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nessuna criticità collegata al procedimento.</p>
            )}
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>6. Altre criticità aperte della concessione</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gravità</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.altreCriticitaAperte.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <GravitaBadge value={item.gravita} />
                      </TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell className="max-w-80 truncate">{item.descrizione}</TableCell>
                      <TableCell>
                        <CriticitaStatoBadge value={item.stato} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.altreCriticitaAperte.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna ulteriore criticità aperta.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>7. Pagamenti critici</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anno</TableHead>
                    <TableHead>Dovuto</TableHead>
                    <TableHead>Versato</TableHead>
                    <TableHead>Residuo</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.pagamentiCritici.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.annoRiferimento}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                      <TableCell className="font-semibold text-rose-700">{formatCurrencyEUR(item.residuo)}</TableCell>
                      <TableCell>
                        <Badge>{formatEnumLabel(item.stato)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.pagamentiCritici.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        Nessun pagamento critico collegato.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>8. Scadenze rilevanti</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.scadenzeRilevanti.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell className="max-w-80 truncate">{item.descrizione ?? "-"}</TableCell>
                      <TableCell>
                        <ScadenzaStatoBadge value={item.stato} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.scadenzeRilevanti.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna scadenza rilevante.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>9. Sopralluoghi recenti</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Esito</TableHead>
                    <TableHead>Operatori</TableHead>
                    <TableHead>Conformità</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.sopralluoghiRecenti.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatDateIT(item.data)}</TableCell>
                      <TableCell>
                        <Badge>{formatEnumLabel(item.esito)}</Badge>
                      </TableCell>
                      <TableCell>{item.operatori}</TableCell>
                      <TableCell>
                        <Badge variant={item.conformitaPlanimetrica ? "success" : "danger"}>
                          {item.conformitaPlanimetrica ? "Conforme" : "Non conforme"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.sopralluoghiRecenti.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun sopralluogo recente disponibile.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <EntityDocumentsPanel
            title="10. Documenti principali"
            entityType="procedimento"
            entityId={detail.procedimento.id}
            documents={detail.documentiPrincipali}
            canUpload={canWriteChecklist}
          />

          <Card>
            <CardHeader>
              <CardTitle>11. Report collegati</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titolo</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Validato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.reportCollegati.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-80 truncate">{item.titolo}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>{item.formato}</TableCell>
                      <TableCell>
                        <Badge variant={item.validato ? "success" : "warning"}>
                          {item.validato ? "Validato" : "Da validare"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.reportCollegati.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun report collegato disponibile.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
