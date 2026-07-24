import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { RuleOrchestratorPanel } from "@/components/normativa/RuleOrchestratorPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { canViewNormativa, requireRole } from "@/lib/auth";
import { isInvestorDemoMode } from "@/lib/investor-demo";
import { investorDemoOrchestration } from "@/lib/investor-demo-data";
import { formatDateIT } from "@/lib/utils";
import { getLegalOrchestrationSummary, getLegalSources, getRecentImportRuns } from "@/server/legal-rules/queries";

export const dynamic = "force-dynamic";

export default async function NormativaOrchestrazionePage() {
  if (isInvestorDemoMode()) {
    return (
      <AppShell
        title="Orchestrazione Regole"
        subtitle="Tassonomia e valutazione assistita su dataset dimostrativo"
      >
        <div className="grid gap-4" data-testid="investor-demo-orchestrazione">
          <div className="flex items-center justify-between">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {investorDemoOrchestration.professionalBadge}
            </div>
            <Link href="/normativa" className="text-sm font-medium text-slate-700 underline underline-offset-4">
              Torna alla normativa
            </Link>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Valutazione assistita demo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <p><span className="font-semibold text-slate-900">Autorita:</span> {investorDemoOrchestration.authority}</p>
              <p><span className="font-semibold text-slate-900">Porto:</span> {investorDemoOrchestration.port}</p>
              <p><span className="font-semibold text-slate-900">Confidence:</span> {investorDemoOrchestration.confidence}</p>
              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-800">{investorDemoOrchestration.disclaimer}</p>
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Coverage fonti</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">Applicabili</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.applicableSources.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Escluse per territorio</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.excludedByTerritory.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Storiche</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.historicalSources.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">In attesa integrazione</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.pendingSources.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reasoning trace</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">Conflitti</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.conflicts.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Gap</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.gaps.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Trace</p>
                  <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                    {investorDemoOrchestration.reasoningTrace.map((item) => <li key={item}>{item}</li>)}
                  </ol>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </AppShell>
    );
  }

  const role = await requireRole();
  if (!canViewNormativa(role)) {
    return null;
  }

  const [summary, sources, importRuns] = await Promise.all([
    getLegalOrchestrationSummary(),
    getLegalSources({ page: 1, pageSize: 12 }),
    getRecentImportRuns(8),
  ]);

  return (
    <AppShell
      title="Orchestrazione Regole"
      subtitle="Tassonomia fonti legali, import pack AdSP MTC e motore deterministico di applicabilita"
    >
      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Output sempre assistivo: nessun automatismo decisorio, human review obbligatoria.
          </div>
          <Link href="/normativa" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Torna alla normativa
          </Link>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Fonti legali</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{summary.sources}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Regole attive</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{summary.activeRules}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gap aperti</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-amber-700">{summary.openGaps}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ultimo import</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-semibold text-slate-900">
                {summary.lastImportRunAt ? formatDateIT(summary.lastImportRunAt) : "Nessun import eseguito"}
              </p>
            </CardContent>
          </Card>
        </section>

        <RuleOrchestratorPanel />

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Fonti importate recenti</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source key</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Regole</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.items.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell className="font-semibold text-slate-900">{source.stableKey}</TableCell>
                      <TableCell>{source.documentType}</TableCell>
                      <TableCell>{source.status} / {source.role}</TableCell>
                      <TableCell>{source.rulesCount}</TableCell>
                    </TableRow>
                  ))}
                  {sources.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna fonte disponibile. Eseguire import pack.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storico import run</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pack</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Conteggi</TableHead>
                    <TableHead>Avvio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-semibold text-slate-900">{run.packCode} {run.packVersion}</TableCell>
                      <TableCell>{run.status}</TableCell>
                      <TableCell>
                        S:{run.sourceCount} R:{run.ruleCount} Rel:{run.relationCount} G:{run.gapCount}
                      </TableCell>
                      <TableCell>{formatDateIT(run.startedAt)}</TableCell>
                    </TableRow>
                  ))}
                  {importRuns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna esecuzione registrata.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
