import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BACKOFFICE_ROLES, canManageCriticita, requireRole } from "@/lib/auth";
import { createCriticitaAction } from "@/server/actions/criticita";
import { getCriticitaFilters } from "@/server/queries/criticita";

interface NuovaCriticitaPageProps {
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

export default async function NuovaCriticitaPage({ searchParams }: NuovaCriticitaPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);

  if (!canManageCriticita(role)) {
    redirect("/dashboard");
  }

  const resolvedSearch = (await searchParams) ?? {};
  const filtersData = await getCriticitaFilters();

  const concessioneId = pickString(resolvedSearch.concessioneId);
  const fonte = pickString(resolvedSearch.fonte);
  const tipologia = pickString(resolvedSearch.tipologia);

  return (
    <AppShell title="Nuova criticità" subtitle="Inserimento controllato per workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Nuova criticità</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createCriticitaAction} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
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
                <div className="space-y-1">
                  <label htmlFor="tipologia" className="text-sm font-medium text-slate-700">
                    Tipologia
                  </label>
                  <Select id="tipologia" name="tipologia" defaultValue={tipologia} required>
                    <option value="">Seleziona tipologia</option>
                    {filtersData.tipologie.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="gravita" className="text-sm font-medium text-slate-700">
                    Gravità
                  </label>
                  <Select id="gravita" name="gravita" required>
                    <option value="">Seleziona gravità</option>
                    {filtersData.gravita.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="fonte" className="text-sm font-medium text-slate-700">
                    Fonte
                  </label>
                  <Select id="fonte" name="fonte" defaultValue={fonte} required>
                    <option value="">Seleziona fonte</option>
                    {filtersData.fonti.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="descrizione" className="text-sm font-medium text-slate-700">
                  Descrizione
                </label>
                <Textarea
                  id="descrizione"
                  name="descrizione"
                  placeholder="Descrivi il rilievo emerso..."
                  required
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="noteIstruttorie" className="text-sm font-medium text-slate-700">
                  Azione consigliata / note istruttorie
                </label>
                <Input id="noteIstruttorie" name="noteIstruttorie" placeholder="Indicazioni operative" />
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Rilevanza ex art. 47 Cod. Nav.</p>
                  <p className="text-xs text-slate-600">
                    Supporto istruttorio interno: la qualificazione finale resta in capo all'Autorità competente.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="rilevanzaArt47" className="text-sm font-medium text-slate-700">
                      Rilevanza art. 47
                    </label>
                    <Select id="rilevanzaArt47" name="rilevanzaArt47" defaultValue="false" required>
                      <option value="false">Non rilevante</option>
                      <option value="true">Rilevante</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="rischioDecadenza" className="text-sm font-medium text-slate-700">
                      Livello rischio decadenza
                    </label>
                    <Select id="rischioDecadenza" name="rischioDecadenza" defaultValue="">
                      <option value="">Seleziona rischio</option>
                      {filtersData.rischioDecadenza.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="letteraArt47" className="text-sm font-medium text-slate-700">
                      Lettera art. 47
                    </label>
                    <Select id="letteraArt47" name="letteraArt47" defaultValue="">
                      <option value="">Seleziona lettera</option>
                      {filtersData.lettereArt47.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="motivazioneArt47" className="text-sm font-medium text-slate-700">
                      Motivazione art. 47
                    </label>
                    <Textarea
                      id="motivazioneArt47"
                      name="motivazioneArt47"
                      placeholder="Motivazione istruttoria della rilevanza art. 47..."
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="azioneIstruttoriaArt47" className="text-sm font-medium text-slate-700">
                      Azione istruttoria art. 47
                    </label>
                    <Input
                      id="azioneIstruttoriaArt47"
                      name="azioneIstruttoriaArt47"
                      placeholder="Indicare la prossima azione istruttoria"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Regolarizzazione / sanatoria della criticità</p>
                  <p className="text-xs text-slate-600">
                    Informazione utile alla fase istruttoria: la regolarizzazione non comporta automatica esclusione di eventuali misure decadenziali.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="regolarizzata" className="text-sm font-medium text-slate-700">
                      Criticità regolarizzata
                    </label>
                    <Select id="regolarizzata" name="regolarizzata" defaultValue="false" required>
                      <option value="false">No</option>
                      <option value="true">Sì</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dataRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Data regolarizzazione
                    </label>
                    <Input id="dataRegolarizzazione" name="dataRegolarizzazione" type="date" />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="esitoRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Esito regolarizzazione
                    </label>
                    <Select id="esitoRegolarizzazione" name="esitoRegolarizzazione" defaultValue="">
                      <option value="">Seleziona esito</option>
                      {filtersData.esitoRegolarizzazione.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="verificataRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Verifica regolarizzazione
                    </label>
                    <Select id="verificataRegolarizzazione" name="verificataRegolarizzazione" defaultValue="false" required>
                      <option value="false">Da verificare</option>
                      <option value="true">Verificata</option>
                    </Select>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="descrizioneRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Descrizione regolarizzazione
                    </label>
                    <Textarea
                      id="descrizioneRegolarizzazione"
                      name="descrizioneRegolarizzazione"
                      placeholder="Descrivere gli elementi di regolarizzazione o sanatoria..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dataVerificaRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Data verifica regolarizzazione
                    </label>
                    <Input id="dataVerificaRegolarizzazione" name="dataVerificaRegolarizzazione" type="date" />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="noteVerificaRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Note verifica regolarizzazione
                    </label>
                    <Input
                      id="noteVerificaRegolarizzazione"
                      name="noteVerificaRegolarizzazione"
                      placeholder="Esito del riscontro tecnico-amministrativo"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Salva criticità</Button>
                <Link
                  href="/criticita"
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
