import Link from "next/link";
import { redirect } from "next/navigation";
import { Paperclip } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BACKOFFICE_ROLES, canManageProcedimenti, requireRole } from "@/lib/auth";
import { VERTICALI_CONFIG } from "@/lib/verticali-config";
import { createFascicoloIntakeAction } from "@/server/actions/fascicolo-intake";
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
  const filtersData = await getProcedimentiFilters();

  return (
    <AppShell
      title="Nuovo Fascicolo"
      subtitle="Crea un nuovo fascicolo e inserisci le informazioni iniziali disponibili. Potrai completarle successivamente anche attraverso i documenti caricati."
    >
      <form action={createFascicoloIntakeAction} className="mx-auto w-full max-w-4xl space-y-6">

        <section aria-labelledby="inquadramento-title" className="space-y-3 border-b border-slate-200 pb-6">
          <div>
            <h2 id="inquadramento-title" className="text-lg font-semibold text-slate-950">Inquadramento</h2>
            <p className="mt-1 text-sm text-slate-600">Definisci il perimetro essenziale dell&apos;incarico.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Tipologia di concessione
              <Select name="tipologiaConcessioneIniziale" required defaultValue="">
                <option value="" disabled>Seleziona tipologia</option>
                {VERTICALI_CONFIG.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Nome fascicolo
              <Input name="denominazioneBreve" placeholder="Grassi Junior – TPL Costiera Amalfitana" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              Oggetto del fascicolo
              <Input name="oggettoFascicolo" required placeholder="Es. Concessione demaniale marittima – servizio TPL Salerno/Amalfi" />
            </label>
          </div>
        </section>

        <section aria-labelledby="documenti-title" className="space-y-3 border-b border-slate-200 pb-6">
          <div>
            <h2 id="documenti-title" className="text-lg font-semibold text-slate-950">Documenti iniziali</h2>
            <p className="mt-1 text-sm text-slate-600">Carica gli atti e i documenti disponibili. Potrai aggiungerne altri anche dopo la creazione del fascicolo.</p>
          </div>
          <div className="flex min-h-28 flex-col items-center justify-center rounded-md border border-dashed border-slate-400 bg-slate-50 px-4 py-5 text-center">
            <Paperclip className="h-5 w-5 text-[#173d4f]" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Trascina qui gli atti oppure selezionali dal computer</p>
            <p className="mt-1 text-xs text-slate-600">Il sistema li analizzerà dopo la creazione del fascicolo.</p>
            <p className="mt-1 text-xs text-slate-500">Formati supportati: PDF, PNG, JPG, WEBP, TXT e CSV.</p>
            <Input
              name="documentiIniziali"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
              multiple
              className="mt-3 max-w-md bg-white"
            />
          </div>
        </section>

        <section aria-labelledby="concessione-title" className="space-y-3 border-b border-slate-200 pb-6">
          <div>
            <h2 id="concessione-title" className="text-lg font-semibold text-slate-950">Dati della concessione</h2>
            <p className="mt-1 text-sm text-slate-600">Inserisci solo le informazioni già disponibili. Potrai completarle in seguito.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">Concessionario / titolare<Input name="concessionarioIniziale" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Ente concedente<Input name="enteConcedenteIniziale" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Numero / riferimento concessione<Input name="numeroConcessioneIniziale" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Scadenza<Input name="scadenzaIniziale" type="date" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Località / porto / Comune<Input name="localitaIniziale" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Oggetto della concessione<Input name="oggettoConcessioneIniziale" /></label>
          </div>

          <details className="rounded-md border border-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Altri dati della concessione</summary>
            <div className="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">Autorità / amministrazione competente<Input name="autoritaCompetenteIniziale" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Data rilascio<Input name="dataRilascioIniziale" type="date" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Decorrenza<Input name="decorrenzaIniziale" type="date" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Bene / area / servizio interessato<Textarea name="beneAreaServizioIniziale" rows={2} /></label>
            </div>
          </details>

          <details className="rounded-md border border-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-600">
              Collega a concessione già presente <span className="font-normal">(opzionale)</span>
            </summary>
            <div className="border-t border-slate-200 p-3">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                Concessione esistente (opzionale)
                <Select name="concessioneId" defaultValue={concessioneId ?? ""}>
                  <option value="">Nessun collegamento iniziale</option>
                  {filtersData.concessioni.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </Select>
              </label>
            </div>
          </details>
        </section>

        <section aria-labelledby="soggetti-title" className="space-y-3 border-b border-slate-200 pb-6">
          <div>
            <h2 id="soggetti-title" className="text-lg font-semibold text-slate-950">Soggetti iniziali</h2>
            <p className="mt-1 text-sm text-slate-600">Indica i soggetti principali, se già noti.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">Soggetto assistito<Input name="soggettoAssistito" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Controparte / amministrazione<Input name="controparteAmministrazione" /></label>
          </div>
        </section>

        <section aria-labelledby="contesto-title" className="space-y-3">
          <div>
            <h2 id="contesto-title" className="text-lg font-semibold text-slate-950">Contesto iniziale</h2>
            <p className="mt-1 text-sm text-slate-600">Indica il problema, ciò che è stato richiesto o eventuali informazioni non presenti nei documenti.</p>
          </div>
          <label className="space-y-1 text-sm font-medium text-slate-700">Indicazioni iniziali / motivo dell&apos;incarico<Textarea name="noteIstruttorie" rows={4} /></label>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <Button type="submit">Crea Fascicolo</Button>
          <Link href="/procedimenti" className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100">Annulla</Link>
        </div>
      </form>
    </AppShell>
  );
}
