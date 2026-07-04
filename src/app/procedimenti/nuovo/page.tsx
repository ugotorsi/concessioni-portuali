import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BACKOFFICE_ROLES, canManageProcedimenti, requireRole } from "@/lib/auth";
import { createProcedimentoAction } from "@/server/actions/procedimenti";
import { getProcedimentiFilters } from "@/server/queries/procedimenti";

interface NuovoProcedimentoPageProps {
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

export default async function NuovoProcedimentoPage({ searchParams }: NuovoProcedimentoPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);

  if (!canManageProcedimenti(role)) {
    redirect("/dashboard");
  }

  const resolvedSearch = (await searchParams) ?? {};
  const concessioneId = pickString(resolvedSearch.concessioneId);
  const criticitaId = pickString(resolvedSearch.criticitaId);
  const filtersData = await getProcedimentiFilters();

  return (
    <AppShell title="Nuovo procedimento" subtitle="Avvio procedura istruttoria in workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Nuovo procedimento</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createProcedimentoAction} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <label htmlFor="concessioneId" className="text-sm font-medium text-slate-700">
                    Concessione
                  </label>
                  <Select id="concessioneId" name="concessioneId" defaultValue={concessioneId} required>
                    <option value="">Seleziona concessione</option>
                    {filtersData.concessioni.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label htmlFor="criticitaId" className="text-sm font-medium text-slate-700">
                    Criticita collegata (opzionale)
                  </label>
                  <Select id="criticitaId" name="criticitaId" defaultValue={criticitaId}>
                    <option value="">Nessuna criticita collegata</option>
                    {filtersData.criticita.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="tipologia" className="text-sm font-medium text-slate-700">
                    Tipologia
                  </label>
                  <Select id="tipologia" name="tipologia" required>
                    <option value="">Seleziona tipologia</option>
                    {filtersData.tipologie.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="stato" className="text-sm font-medium text-slate-700">
                    Stato
                  </label>
                  <Select id="stato" name="stato" defaultValue="DA_AVVIARE" required>
                    {filtersData.stati.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="dataAvvio" className="text-sm font-medium text-slate-700">
                    Data avvio
                  </label>
                  <Input id="dataAvvio" name="dataAvvio" type="date" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dataScadenzaContraddittorio" className="text-sm font-medium text-slate-700">
                    Termine contraddittorio
                  </label>
                  <Input id="dataScadenzaContraddittorio" name="dataScadenzaContraddittorio" type="date" />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="riferimentoNormativo" className="text-sm font-medium text-slate-700">
                  Riferimento normativo
                </label>
                <Input id="riferimentoNormativo" name="riferimentoNormativo" />
              </div>

              <div className="space-y-1">
                <label htmlFor="noteIstruttorie" className="text-sm font-medium text-slate-700">
                  Note istruttorie
                </label>
                <Textarea id="noteIstruttorie" name="noteIstruttorie" />
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Origine del procedimento e art. 10-bis</p>
                  <p className="text-xs text-slate-600">
                    La sezione ha funzione istruttoria. L applicabilita del preavviso di rigetto ex art. 10-bis L. 241/1990 deve essere valutata dal responsabile del procedimento.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="origineProcedimento" className="text-sm font-medium text-slate-700">
                      Origine procedimento
                    </label>
                    <Select id="origineProcedimento" name="origineProcedimento" defaultValue="UFFICIO" required>
                      {filtersData.originiProcedimento.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="procedimentoUfficio" className="text-sm font-medium text-slate-700">
                      Procedimento d ufficio
                    </label>
                    <Select id="procedimentoUfficio" name="procedimentoUfficio" defaultValue="true" required>
                      <option value="true">Si</option>
                      <option value="false">No</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="preavvisoRigettoApplicabile" className="text-sm font-medium text-slate-700">
                      Preavviso rigetto applicabile
                    </label>
                    <Select id="preavvisoRigettoApplicabile" name="preavvisoRigettoApplicabile" defaultValue="false" required>
                      <option value="false">No / da verificare</option>
                      <option value="true">Si (secondo valutazione istruttoria)</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="statoPreavvisoRigetto" className="text-sm font-medium text-slate-700">
                      Stato preavviso rigetto
                    </label>
                    <Select id="statoPreavvisoRigetto" name="statoPreavvisoRigetto" defaultValue="NON_VALUTATO" required>
                      {filtersData.statiPreavvisoRigetto.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dataPreavvisoRigetto" className="text-sm font-medium text-slate-700">
                      Data preavviso rigetto
                    </label>
                    <Input id="dataPreavvisoRigetto" name="dataPreavvisoRigetto" type="date" />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="termineOsservazioniPreavviso" className="text-sm font-medium text-slate-700">
                      Termine osservazioni preavviso
                    </label>
                    <Input id="termineOsservazioniPreavviso" name="termineOsservazioniPreavviso" type="date" />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="osservazioniPreavvisoRicevute" className="text-sm font-medium text-slate-700">
                      Osservazioni preavviso ricevute
                    </label>
                    <Select id="osservazioniPreavvisoRicevute" name="osservazioniPreavvisoRicevute" defaultValue="false" required>
                      <option value="false">No</option>
                      <option value="true">Si</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dataOsservazioniPreavviso" className="text-sm font-medium text-slate-700">
                      Data osservazioni
                    </label>
                    <Input id="dataOsservazioniPreavviso" name="dataOsservazioniPreavviso" type="date" />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="valutazioneOsservazioniPreavviso" className="text-sm font-medium text-slate-700">
                      Valutazione osservazioni
                    </label>
                    <Textarea id="valutazioneOsservazioniPreavviso" name="valutazioneOsservazioniPreavviso" />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="motivazioneMancatoPreavviso" className="text-sm font-medium text-slate-700">
                      Motivazione mancato preavviso
                    </label>
                    <Textarea id="motivazioneMancatoPreavviso" name="motivazioneMancatoPreavviso" />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Contraddittorio e garanzie procedimentali</p>
                  <p className="text-xs text-slate-600">
                    La checklist ha funzione istruttoria e non sostituisce la valutazione del responsabile del procedimento.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="comunicazioneAvvioInviata" className="h-4 w-4" />
                    Comunicazione avvio inviata
                  </label>
                  <div className="space-y-1">
                    <label htmlFor="dataComunicazioneAvvio" className="text-sm font-medium text-slate-700">
                      Data comunicazione avvio
                    </label>
                    <Input id="dataComunicazioneAvvio" name="dataComunicazioneAvvio" type="date" />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="termineMemorieGiorni" className="text-sm font-medium text-slate-700">
                      Termine memorie (giorni)
                    </label>
                    <Input id="termineMemorieGiorni" name="termineMemorieGiorni" type="number" min={1} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="termineMemorieScadenza" className="text-sm font-medium text-slate-700">
                      Scadenza termine memorie
                    </label>
                    <Input id="termineMemorieScadenza" name="termineMemorieScadenza" type="date" />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="contestazioneFormaleInviata" className="h-4 w-4" />
                    Contestazione formale inviata
                  </label>
                  <div className="space-y-1">
                    <label htmlFor="dataContestazioneFormale" className="text-sm font-medium text-slate-700">
                      Data contestazione formale
                    </label>
                    <Input id="dataContestazioneFormale" name="dataContestazioneFormale" type="date" />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="memorieRicevute" className="h-4 w-4" />
                    Memorie ricevute
                  </label>
                  <div className="space-y-1">
                    <label htmlFor="dataRicezioneMemorie" className="text-sm font-medium text-slate-700">
                      Data ricezione memorie
                    </label>
                    <Input id="dataRicezioneMemorie" name="dataRicezioneMemorie" type="date" />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="audizioneRichiesta" className="h-4 w-4" />
                    Audizione richiesta
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="audizioneSvolta" className="h-4 w-4" />
                    Audizione svolta
                  </label>

                  <div className="space-y-1">
                    <label htmlFor="dataAudizione" className="text-sm font-medium text-slate-700">
                      Data audizione
                    </label>
                    <Input id="dataAudizione" name="dataAudizione" type="date" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="sopralluogoIstruttorioSvolto" className="h-4 w-4" />
                    Sopralluogo istruttorio svolto
                  </label>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="controdeduzioniValutate" className="h-4 w-4" />
                    Controdeduzioni valutate
                  </label>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="propostaEsitoIstruttorio" className="text-sm font-medium text-slate-700">
                      Proposta esito istruttorio
                    </label>
                    <Select id="propostaEsitoIstruttorio" name="propostaEsitoIstruttorio" defaultValue="">
                      <option value="">Non indicata</option>
                      {filtersData.esitiIstruttori.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="motivazioneValutazione" className="text-sm font-medium text-slate-700">
                      Motivazione valutazione
                    </label>
                    <Textarea id="motivazioneValutazione" name="motivazioneValutazione" />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="noteChecklistContraddittorio" className="text-sm font-medium text-slate-700">
                      Note checklist contraddittorio
                    </label>
                    <Textarea id="noteChecklistContraddittorio" name="noteChecklistContraddittorio" />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Salva procedimento</Button>
                <Link
                  href="/procedimenti"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Annulla
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
