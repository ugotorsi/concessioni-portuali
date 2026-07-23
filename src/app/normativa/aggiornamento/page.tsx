import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { canManageNormativaUpdate, requireRole } from "@/lib/auth";
import { formatDateIT } from "@/lib/utils";
import { getNormativaList } from "@/server/queries/normativa";

export const dynamic = "force-dynamic";

export default async function NormativaAggiornamentoPage() {
  const role = await requireRole();

  if (!canManageNormativaUpdate(role)) {
    redirect(role === "VIEWER_ADSP" ? "/adsp" : "/normativa");
  }

  const normativa = await getNormativaList({});

  return (
    <AppShell title="Aggiornamento Normativo" subtitle="Presidio interno su aggiornamenti e impatti operativi">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Workflow di aggiornamento</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>Registrare nuova versione della fonte normativa in archivio.</li>
              <li>Valutare impatti su criticità, procedimenti, report e concessioni.</li>
              <li>Aggiornare note operative e checklist istruttorie dei moduli coinvolti.</li>
              <li>Condividere outcome interno con i referenti di area.</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fonti da monitorare</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {normativa.items.map((item) => (
                <li key={item.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-900">{item.codice} - {item.titolo}</p>
                  <p className="text-xs text-slate-600">
                    Versione corrente: {item.versioneCorrente ?? "-"} | Entrata in vigore: {item.dataEntrataVigore ? formatDateIT(item.dataEntrataVigore) : "-"}
                  </p>
                  <Link href={`/normativa/${item.id}`} className="text-xs underline underline-offset-4">
                    Apri scheda normativa
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
