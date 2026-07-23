import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BACKOFFICE_ROLES, canManageCriticita, requireRole } from "@/lib/auth";
import { updateCriticitaAction } from "@/server/actions/criticita";
import { getCriticitaDetail, getCriticitaFilters } from "@/server/queries/criticita";

interface ModificaCriticitaPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function ModificaCriticitaPage({ params }: ModificaCriticitaPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);

  if (!canManageCriticita(role)) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [detail, filtersData] = await Promise.all([getCriticitaDetail(id), getCriticitaFilters()]);

  if (!detail) {
    notFound();
  }

  return (
    <AppShell title="Modifica criticità" subtitle="Aggiornamento controllato per workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Modifica criticità</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateCriticitaAction} className="space-y-4">
              <input type="hidden" name="id" value={detail.id} />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Concessione</label>
                  <Input value={detail.concessione.numeroAtto} disabled />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Tipologia</label>
                  <Input value={detail.tipologia} disabled />
                </div>
                <div className="space-y-1">
                  <label htmlFor="gravita" className="text-sm font-medium text-slate-700">
                    Gravità
                  </label>
                  <Select id="gravita" name="gravita" defaultValue={detail.gravita} required>
                    {filtersData.gravita.map((item) => (
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
                  <Select id="stato" name="stato" defaultValue={detail.stato} required>
                    {filtersData.stati.map((item) => (
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
                <Textarea id="descrizione" name="descrizione" defaultValue={detail.descrizione} required />
              </div>

              <div className="space-y-1">
                <label htmlFor="noteIstruttorie" className="text-sm font-medium text-slate-700">
                  Azione consigliata / note istruttorie
                </label>
                <Input
                  id="noteIstruttorie"
                  name="noteIstruttorie"
                  defaultValue={detail.azioneConsigliata ?? ""}
                />
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Rilevanza ex art. 47 Cod. Nav.</p>
                  <p className="text-xs text-slate-600">
                    Classificazione istruttoria interna non vincolante: la decisione resta in capo all'Autorità competente.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="rilevanzaArt47" className="text-sm font-medium text-slate-700">
                      Rilevanza art. 47
                    </label>
                    <Select
                      id="rilevanzaArt47"
                      name="rilevanzaArt47"
                      defaultValue={detail.rilevanzaArt47 ? "true" : "false"}
                      required
                    >
                      <option value="false">Non rilevante</option>
                      <option value="true">Rilevante</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="rischioDecadenza" className="text-sm font-medium text-slate-700">
                      Livello rischio decadenza
                    </label>
                    <Select
                      id="rischioDecadenza"
                      name="rischioDecadenza"
                      defaultValue={detail.rischioDecadenza ?? ""}
                    >
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
                    <Select id="letteraArt47" name="letteraArt47" defaultValue={detail.letteraArt47 ?? ""}>
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
                      defaultValue={detail.motivazioneArt47 ?? ""}
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="azioneIstruttoriaArt47" className="text-sm font-medium text-slate-700">
                      Azione istruttoria art. 47
                    </label>
                    <Input
                      id="azioneIstruttoriaArt47"
                      name="azioneIstruttoriaArt47"
                      defaultValue={detail.azioneIstruttoriaArt47 ?? ""}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Regolarizzazione / sanatoria della criticità</p>
                  <p className="text-xs text-slate-600">
                    Informazione istruttoria: la regolarizzazione incide sulla valutazione del caso ma non determina automatismi provvedimentali.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="regolarizzata" className="text-sm font-medium text-slate-700">
                      Criticità regolarizzata
                    </label>
                    <Select id="regolarizzata" name="regolarizzata" defaultValue={detail.regolarizzata ? "true" : "false"} required>
                      <option value="false">No</option>
                      <option value="true">Sì</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dataRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Data regolarizzazione
                    </label>
                    <Input
                      id="dataRegolarizzazione"
                      name="dataRegolarizzazione"
                      type="date"
                      defaultValue={detail.dataRegolarizzazione ? detail.dataRegolarizzazione.toISOString().slice(0, 10) : ""}
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="esitoRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Esito regolarizzazione
                    </label>
                    <Select id="esitoRegolarizzazione" name="esitoRegolarizzazione" defaultValue={detail.esitoRegolarizzazione ?? ""}>
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
                    <Select
                      id="verificataRegolarizzazione"
                      name="verificataRegolarizzazione"
                      defaultValue={detail.verificataRegolarizzazione ? "true" : "false"}
                      required
                    >
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
                      defaultValue={detail.descrizioneRegolarizzazione ?? ""}
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dataVerificaRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Data verifica regolarizzazione
                    </label>
                    <Input
                      id="dataVerificaRegolarizzazione"
                      name="dataVerificaRegolarizzazione"
                      type="date"
                      defaultValue={detail.dataVerificaRegolarizzazione ? detail.dataVerificaRegolarizzazione.toISOString().slice(0, 10) : ""}
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="noteVerificaRegolarizzazione" className="text-sm font-medium text-slate-700">
                      Note verifica regolarizzazione
                    </label>
                    <Input
                      id="noteVerificaRegolarizzazione"
                      name="noteVerificaRegolarizzazione"
                      defaultValue={detail.noteVerificaRegolarizzazione ?? ""}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Salva modifiche</Button>
                <Link
                  href={`/criticita/${detail.id}`}
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
