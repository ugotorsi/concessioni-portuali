import { AppShell } from "@/components/layout/AppShell";
import { ConcessionariWorkspace } from "@/components/concessionari/ConcessionariWorkspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { getConcessionariList } from "@/server/queries/concessionari";

export const dynamic = "force-dynamic";

export default async function ConcessionariPage() {
  await requireRole(BACKOFFICE_ROLES);
  const data = await getConcessionariList();

  return (
    <AppShell title="Concessionari" subtitle="Soggetti titolari di concessioni e relativi fascicoli.">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Indicatori concessionari">
        <Card>
          <CardHeader><CardTitle>Concessionari</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-slate-950">{data.summary.concessionari}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Concessioni attive</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-emerald-800">{data.summary.concessioniAttive}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Criticità aperte</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-amber-800">{data.summary.criticitaAperte}</p></CardContent>
        </Card>
      </section>

      <ConcessionariWorkspace items={data.items} />
    </AppShell>
  );
}
