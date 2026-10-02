import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SectionHeader } from "@/components/ui/PageHeader";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { getDashboardData } from "@/server/queries/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireRole(BACKOFFICE_ROLES);
  const data = await getDashboardData();

  return (
    <AppShell
      title="Dashboard"
      subtitle="Quadro operativo concessioni, criticità, scadenze e priorità istruttorie"
    >
      <section aria-labelledby="attenzione-oggi" className="space-y-4">
        <SectionHeader
          title="Richiede attenzione oggi"
          description="Priorità operative, scadenze e posizioni che richiedono una verifica tempestiva."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Scadenza entro 90 giorni"
          value={data.summary.concessioniInScadenza90}
          description="Concessioni da pianificare per rinnovo o nuova procedura"
          tone={data.summary.concessioniInScadenza90 > 0 ? "warning" : "default"}
          href="/scadenze?periodo=ENTRO_90_GIORNI"
        />
        <MetricCard
          title="Criticità urgenti"
          value={data.summary.criticitaUrgenti}
          description="Elementi ad alta priorità operativa"
          tone={data.summary.criticitaUrgenti > 0 ? "danger" : "default"}
          href="/criticita?gravita=URGENTE"
        />
        <MetricCard
          title="Morosità aperte"
          value={data.summary.morositaAperte}
          description="Posizioni critiche su canoni e versamenti"
          tone={data.summary.morositaAperte > 0 ? "danger" : "default"}
          href="/pagamenti?criticita=MOROSITA"
        />
        <MetricCard
          title="Procedimenti in corso"
          value={data.summary.procedimentiInCorso}
          description="Procedimenti istruttori attivi"
          tone={data.summary.procedimentiInCorso > 0 ? "warning" : "default"}
          href="/procedimenti?stato=IN_CORSO"
        />
        </div>
      </section>

      <section aria-label="Indicatori di contesto" className="mt-6 rounded-md border border-slate-200 bg-white p-4">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          compact
          title="Totale concessioni"
          value={data.summary.totaleConcessioni}
          description="Rapporti censiti"
        />
        <MetricCard
          compact
          title="Concessioni attive"
          value={data.summary.concessioniAttive}
          description="In regolare esercizio"
        />
        <MetricCard compact title="Criticità aperte" value={data.summary.criticitaAperte} description="Istruttorie aperte" />
        <MetricCard compact title="Garanzie critiche" value={data.summary.garanziePolizzeCritiche} description="Scadute o entro 60 giorni" />
        </div>
      </section>
    </AppShell>
  );
}
