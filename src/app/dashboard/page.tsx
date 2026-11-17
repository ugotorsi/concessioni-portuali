import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/PageHeader";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import {
  buildDashboardFascicoloHref,
  type DashboardFascicoloSection,
} from "@/lib/dashboard-navigation";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getDashboardData } from "@/server/queries/dashboard";
import { getFascicoliIntakeList } from "@/server/queries/fascicolo-intake";
import { getConcessionVerticalLabel } from "@/lib/concession-vertical-labels";

export const dynamic = "force-dynamic";

interface AttentionItem {
  id: string;
  fascicoloId: string;
  section?: DashboardFascicoloSection;
  title: string;
  description: string;
  meta: string;
  variant: "warning" | "danger";
}

export default async function DashboardPage() {
  await requireRole(BACKOFFICE_ROLES);
  const [data, fascicoliIntake] = await Promise.all([
    getDashboardData(),
    getFascicoliIntakeList(),
  ]);
  const fascicoliRecenti = [
    ...data.procedimentiInCorso.map((item) => ({
      id: item.id,
      title: item.concessione,
      subtitle: formatEnumLabel(item.tipologia),
      status: formatEnumLabel(item.stato),
      updatedAt: item.updatedAt,
    })),
    ...fascicoliIntake.map((item) => ({
      id: item.id,
      title: item.denominazioneBreve || item.oggettoFascicolo,
      subtitle: getConcessionVerticalLabel(item.tipologiaConcessione),
      status: "In preparazione",
      updatedAt: item.updatedAt,
    })),
  ]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5);
  const contraddittorio = data.procedimentiInCorso.find((item) => item.termineContraddittorio);
  const criticita = data.criticitaPrioritarie.find((item) => item.fascicoloId);
  const scadenza = data.scadenzeImminenti.find((item) => item.fascicoloId);
  const pagamento = data.pagamentiCritici.find((item) => item.fascicoloId);
  const attentionItems: AttentionItem[] = [
    ...(contraddittorio?.termineContraddittorio ? [{
      id: `procedimento-${contraddittorio.id}`,
      fascicoloId: contraddittorio.id,
      section: "deadlines" as const,
      title: "Termine del contraddittorio",
      description: contraddittorio.concessione,
      meta: formatDateIT(contraddittorio.termineContraddittorio),
      variant: "warning" as const,
    }] : []),
    ...(criticita?.fascicoloId ? [{
      id: `criticita-${criticita.id}`,
      fascicoloId: criticita.fascicoloId,
      section: "issues" as const,
      title: formatEnumLabel(criticita.tipologia),
      description: criticita.concessione,
      meta: formatEnumLabel(criticita.gravita),
      variant: "danger" as const,
    }] : []),
    ...(scadenza?.fascicoloId ? [{
      id: `scadenza-${scadenza.id}`,
      fascicoloId: scadenza.fascicoloId,
      section: "deadlines" as const,
      title: formatEnumLabel(scadenza.tipologia),
      description: scadenza.concessione,
      meta: formatDateIT(scadenza.data),
      variant: "warning" as const,
    }] : []),
    ...(pagamento?.fascicoloId ? [{
      id: `pagamento-${pagamento.id}`,
      fascicoloId: pagamento.fascicoloId,
      title: "Pagamento da verificare",
      description: pagamento.concessione,
      meta: formatCurrencyEUR(pagamento.residuo),
      variant: "danger" as const,
    }] : []),
  ];

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
            title="Fascicoli in corso"
            value={data.summary.procedimentiInCorso}
            description="Fascicoli istruttori attivi"
            tone={data.summary.procedimentiInCorso > 0 ? "warning" : "default"}
            href="/procedimenti?stato=IN_CORSO"
          />
        </div>
        {attentionItems.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {attentionItems.map((item) => (
              <Link
                key={item.id}
                href={buildDashboardFascicoloHref(item.fascicoloId, item.section)}
                aria-label={`${item.title}. ${item.description}. Apri il fascicolo`}
                className="flex min-w-0 items-center justify-between gap-4 rounded-md border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-[#0b7285] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285] focus-visible:ring-offset-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-950">{item.title}</span>
                  <span className="mt-0.5 block truncate text-sm text-slate-600">{item.description}</span>
                </span>
                <Badge variant={item.variant}>{item.meta}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Nessuna priorità immediata collegata ai fascicoli.
          </p>
        )}
      </section>

      <section aria-labelledby="fascicoli-recenti" className="mt-6 space-y-4">
        <SectionHeader
          title="Fascicoli recenti"
          description="Ultimi fascicoli operativi aggiornati."
        />
        {fascicoliRecenti.length > 0 ? (
          <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {fascicoliRecenti.map((item) => (
              <Link
                key={item.id}
                href={buildDashboardFascicoloHref(item.id)}
                aria-label={`Apri fascicolo ${item.title}`}
                className="flex min-w-0 items-center justify-between gap-4 px-4 py-3 transition-colors first:rounded-t-md last:rounded-b-md hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b7285]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-950">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">{item.subtitle}</span>
                </span>
                <span className="shrink-0 text-right">
                  <Badge variant={item.status === "In corso" ? "warning" : "default"}>
                    {item.status}
                  </Badge>
                  <span className="mt-1 block text-xs text-slate-500">{formatDateIT(item.updatedAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Nessun fascicolo operativo disponibile.
          </p>
        )}
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
