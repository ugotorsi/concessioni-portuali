import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BACKOFFICE_ROLES, canManageSopralluoghi, requireRole } from "@/lib/auth";
import { createSopralluogoAction } from "@/server/actions/sopralluoghi";
import { getSopralluoghiFilters } from "@/server/queries/sopralluoghi";

interface NuovoSopralluogoPageProps {
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

export default async function NuovoSopralluogoPage({ searchParams }: NuovoSopralluogoPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);

  if (!canManageSopralluoghi(role)) {
    redirect("/dashboard");
  }

  const resolvedSearch = (await searchParams) ?? {};
  const filtersData = await getSopralluoghiFilters();
  const concessioneId = pickString(resolvedSearch.concessioneId);

  return (
    <AppShell title="Nuovo sopralluogo" subtitle="Inserimento verifica tecnica in workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Nuovo sopralluogo</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createSopralluogoAction} className="space-y-4">
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
                <div className="space-y-1">
                  <label htmlFor="data" className="text-sm font-medium text-slate-700">
                    Data sopralluogo
                  </label>
                  <Input id="data" name="data" type="date" required />
                </div>
                <div className="space-y-1">
                  <label htmlFor="operatori" className="text-sm font-medium text-slate-700">
                    Operatori
                  </label>
                  <Input id="operatori" name="operatori" placeholder="Nominativo/i" required />
                </div>
                <div className="space-y-1">
                  <label htmlFor="esito" className="text-sm font-medium text-slate-700">
                    Esito
                  </label>
                  <Select id="esito" name="esito" required>
                    <option value="">Seleziona esito</option>
                    {filtersData.esiti.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="conformitaPlanimetrica" className="text-sm font-medium text-slate-700">
                    Conformita planimetrica
                  </label>
                  <Select id="conformitaPlanimetrica" name="conformitaPlanimetrica" required>
                    <option value="SI">Si</option>
                    <option value="NO">No</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="statoManutentivo" className="text-sm font-medium text-slate-700">
                    Stato manutentivo
                  </label>
                  <Input id="statoManutentivo" name="statoManutentivo" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="sicurezza" className="text-sm font-medium text-slate-700">
                    Sicurezza
                  </label>
                  <Input id="sicurezza" name="sicurezza" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="occupazione" className="text-sm font-medium text-slate-700">
                    Occupazione
                  </label>
                  <Input id="occupazione" name="occupazione" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="interferenze" className="text-sm font-medium text-slate-700">
                    Interferenze
                  </label>
                  <Input id="interferenze" name="interferenze" />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="descrizione" className="text-sm font-medium text-slate-700">
                  Descrizione
                </label>
                <Textarea id="descrizione" name="descrizione" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Salva sopralluogo</Button>
                <Link
                  href="/sopralluoghi"
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
