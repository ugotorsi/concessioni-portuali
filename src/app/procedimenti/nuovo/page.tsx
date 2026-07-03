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
