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
    <AppShell title="Modifica criticita" subtitle="Aggiornamento controllato per workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Modifica criticita</CardTitle>
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
                    Gravita
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
