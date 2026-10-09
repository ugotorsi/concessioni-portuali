import Link from "next/link";
import { redirect } from "next/navigation";

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
      title="Nuovo fascicolo"
      subtitle="Inserisci le informazioni disponibili ora. Potrai completare il fascicolo in qualsiasi momento."
    >
      <form action={createFascicoloIntakeAction} className="mx-auto w-full max-w-3xl space-y-7">
        <section aria-labelledby="inquadramento-title" className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
          <div>
            <h2 id="inquadramento-title" className="text-lg font-semibold text-slate-950">Inquadramento</h2>
            <p className="mt-1 text-sm text-slate-600">Definisci gli elementi essenziali del fascicolo.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              Titolo fascicolo
              <Input name="titoloFascicolo" required placeholder="Es. Concessione molo sud" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Tipo
              <Select name="tipologiaConcessioneIniziale" required defaultValue="">
                <option value="" disabled>Seleziona il tipo</option>
                {VERTICALI_CONFIG.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              Descrizione / contesto iniziale <span className="font-normal text-slate-500">(opzionale)</span>
              <Textarea
                name="descrizioneIniziale"
                rows={3}
                placeholder="Descrivi brevemente la pratica o il contesto disponibile."
              />
            </label>
          </div>
        </section>

        <section aria-labelledby="riferimenti-title" className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
          <div>
            <h2 id="riferimenti-title" className="text-lg font-semibold text-slate-950">Riferimenti</h2>
            <p className="mt-1 text-sm text-slate-600">Aggiungi solo i riferimenti già disponibili.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Numero / riferimento pratica
              <Input name="numeroConcessioneIniziale" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Ente / amministrazione
              <Input name="autoritaCompetenteIniziale" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              Località / porto
              <Input name="localitaIniziale" />
            </label>
          </div>
        </section>

        <section aria-labelledby="concessione-title" className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
          <div>
            <h2 id="concessione-title" className="text-lg font-semibold text-slate-950">Dati concessione</h2>
            <p className="mt-1 text-sm text-slate-600">Puoi inserire i dati disponibili ora e completarli successivamente.</p>
          </div>
          <label className="block space-y-1 text-sm font-medium text-slate-700">
            Collegamento a una concessione esistente <span className="font-normal text-slate-500">(opzionale)</span>
            <Select name="concessioneId" defaultValue={concessioneId ?? ""}>
              <option value="">Crea fascicolo senza collegare una concessione esistente</option>
              {filtersData.concessioni.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </Select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Ente concedente
              <Input name="enteConcedenteIniziale" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Oggetto
              <Input name="oggettoConcessioneIniziale" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Decorrenza
              <Input name="decorrenzaIniziale" type="date" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Scadenza
              <Input name="scadenzaIniziale" type="date" />
            </label>
          </div>
        </section>

        <section aria-labelledby="soggetti-title" className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
          <div>
            <h2 id="soggetti-title" className="text-lg font-semibold text-slate-950">Soggetti</h2>
            <p className="mt-1 text-sm text-slate-600">Indica i soggetti principali, se già noti.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Soggetto principale / concessionario
              <Input name="concessionarioIniziale" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Soggetto assistito
              <Input name="soggettoAssistito" />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
          <Button type="submit">Crea fascicolo</Button>
          <Link
            href="/procedimenti"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285] focus-visible:ring-offset-2"
          >
            Annulla
          </Link>
        </div>
      </form>
    </AppShell>
  );
}
