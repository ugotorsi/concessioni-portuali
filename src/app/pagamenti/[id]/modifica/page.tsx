import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { BACKOFFICE_ROLES, canManagePagamenti, requireRole } from "@/lib/auth";
import { updatePagamentoAction } from "@/server/actions/pagamenti";
import { formatCurrencyEUR, formatDateInputValue } from "@/lib/utils";
import { getPagamentoDetail } from "@/server/queries/pagamenti";

interface ModificaPagamentoPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function ModificaPagamentoPage({ params }: ModificaPagamentoPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);

  if (!canManagePagamenti(role)) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const detail = await getPagamentoDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <AppShell title="Aggiorna pagamento" subtitle="Aggiornamento posizione economica in workflow demo">
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Aggiorna pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updatePagamentoAction} className="space-y-4">
              <input type="hidden" name="id" value={detail.pagamento.id} />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Concessione</label>
                  <Input value={detail.concessione.numeroAtto} disabled />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Anno riferimento</label>
                  <Input value={String(detail.pagamento.annoRiferimento)} disabled />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Importo dovuto</label>
                  <Input value={formatCurrencyEUR(detail.pagamento.importoDovuto)} disabled />
                </div>
                <div className="space-y-1">
                  <label htmlFor="importoVersato" className="text-sm font-medium text-slate-700">
                    Importo versato
                  </label>
                  <Input
                    id="importoVersato"
                    name="importoVersato"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={String(detail.pagamento.importoVersato)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dataVersamento" className="text-sm font-medium text-slate-700">
                    Data versamento
                  </label>
                  <Input
                    id="dataVersamento"
                    name="dataVersamento"
                    type="date"
                    defaultValue={formatDateInputValue(detail.pagamento.dataVersamento)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="stato" className="text-sm font-medium text-slate-700">
                    Stato
                  </label>
                  <Select id="stato" name="stato" defaultValue={detail.pagamento.stato} required>
                    <option value="PAGATO">Pagato</option>
                    <option value="PARZIALE">Parziale</option>
                    <option value="NON_PAGATO">Non pagato</option>
                    <option value="SCADUTO">Scaduto</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="interessiMora" className="text-sm font-medium text-slate-700">
                    Interessi mora
                  </label>
                  <Input
                    id="interessiMora"
                    name="interessiMora"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={detail.pagamento.interessiMora ?? ""}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="note" className="text-sm font-medium text-slate-700">
                  Note
                </label>
                <Input id="note" name="note" defaultValue={detail.pagamento.note ?? ""} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Salva aggiornamento</Button>
                <Link
                  href={`/pagamenti/${detail.pagamento.id}`}
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
