import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { StatoBadge } from "@/components/concessioni/ConcessioniBadges";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { requireRole } from "@/lib/auth";
import { isInvestorDemoMode } from "@/lib/investor-demo";
import { getInvestorDemoVerticalBySlug } from "@/lib/investor-demo-data";
import { formatDateIT } from "@/lib/utils";
import { getVerticaleWorkspaceBySlug } from "@/server/queries/verticali";

interface VerticaleWorkspacePageProps {
  params: Promise<{ verticale: string }>;
}

export const dynamic = "force-dynamic";

export default async function VerticaleWorkspacePage({ params }: VerticaleWorkspacePageProps) {
  const { verticale } = await params;

  if (isInvestorDemoMode()) {
    const normalizedSlug = verticale === "concessioni-portuali" ? "concessioni" : verticale;
    const data = getInvestorDemoVerticalBySlug(normalizedSlug);

    if (!data) {
      notFound();
    }

    return (
      <AppShell title={data.title} subtitle={data.subtitle}>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4" data-testid="investor-demo-verticale-detail">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{data.title}</CardTitle>
                  <CardDescription>{data.subtitle}</CardDescription>
                </div>
                <Badge variant="success">Demo statica</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {data.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/verticali"
                  className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Torna alle verticali
                </Link>
                {data.links.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  await requireRole();
  const data = await getVerticaleWorkspaceBySlug(verticale);

  if (!data) {
    notFound();
  }

  return (
    <AppShell title={data.verticale.label} subtitle="Workspace operativo verticale con dati concessori e collegamenti alle sezioni correlate.">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{data.verticale.label}</CardTitle>
                <CardDescription>{data.verticale.description}</CardDescription>
              </div>
              <Badge variant={data.verticale.hasConcessioni ? "success" : "default"}>
                {data.verticale.hasConcessioni
                  ? "Con concessioni nel perimetro"
                  : "Nessuna concessione nel perimetro corrente"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-600">{data.verticale.coverageLabel}</p>
            <div className="flex flex-wrap gap-2">
            <Link
              href={`/concessioni?concessionVertical=${data.verticale.value}`}
              data-testid="workspace-link-concessioni"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Apri concessioni filtrate
            </Link>
            <Link
              href="/documenti"
              data-testid="workspace-link-documenti"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Apri la sezione documenti
            </Link>
            <Link
              href="/report"
              data-testid="workspace-link-report"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Consulta i report del perimetro
            </Link>
            <Link
              href="/criticita"
              data-testid="workspace-link-criticita"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Apri le criticita
            </Link>
            <Link
              href="/scadenze"
              data-testid="workspace-link-scadenze"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Consulta le scadenze
            </Link>
            <Link
              href="/procedimenti"
              data-testid="workspace-link-procedimenti"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Apri i procedimenti
            </Link>
            </div>
            <p className="text-xs text-slate-600" data-testid="workspace-links-scope-note">
              La sezione si apre sul perimetro tenant corrente; non e applicato un filtro verticale.
            </p>
          </CardContent>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6" data-testid="vertical-workspace-kpi">
          <Card><CardHeader><CardDescription>Concessioni</CardDescription><CardTitle>{data.indicatori.concessioni}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Criticita aperte</CardDescription><CardTitle>{data.indicatori.criticitaAperte}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Scadenze aperte/scadute</CardDescription><CardTitle>{data.indicatori.scadenzeAperteScadute}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Procedimenti in corso</CardDescription><CardTitle>{data.indicatori.procedimentiInCorso}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Documenti</CardDescription><CardTitle>{data.indicatori.documenti}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Report</CardDescription><CardTitle>{data.indicatori.report}</CardTitle></CardHeader></Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Concessioni della verticale</CardTitle>
            <CardDescription>Elenco tenant-scoped delle concessioni collegate al perimetro selezionato.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Atto</TableHead>
                  <TableHead>Concessionario</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Criticita aperte</TableHead>
                  <TableHead>Scadenze critiche</TableHead>
                  <TableHead>Procedimenti in corso</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.concessioni.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold text-slate-900">{item.numeroAtto}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p>{item.concessionarioDenominazione}</p>
                        {item.ubicazione ? <p className="text-xs text-slate-500">{item.ubicazione}</p> : null}
                      </div>
                    </TableCell>
                    <TableCell><StatoBadge value={item.stato} /></TableCell>
                    <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                    <TableCell>{item.criticitaAperteCount}</TableCell>
                    <TableCell>{item.scadenzeAperteScaduteCount}</TableCell>
                    <TableCell>{item.procedimentiInCorsoCount}</TableCell>
                    <TableCell>
                      <Link
                        href={`/concessioni/${item.id}`}
                        className="text-sm font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:text-slate-700"
                      >
                        Apri scheda
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}

                {data.concessioni.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      Nessuna concessione visibile per questa verticale nel perimetro corrente.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
