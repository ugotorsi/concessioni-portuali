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
    <AppShell title="Nuova criticita" subtitle="Inserimento controllato per workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Nuova criticita</CardTitle>
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
                    Gravita
                  </label>
                  <Select id="gravita" name="gravita" required>
                    <option value="">Seleziona gravita</option>
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

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Salva criticita</Button>
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
