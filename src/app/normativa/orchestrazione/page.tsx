import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { RuleOrchestratorPanel } from "@/components/normativa/RuleOrchestratorPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { canViewNormativa, requireRole } from "@/lib/auth";
import { formatDateIT } from "@/lib/utils";
import { getLegalOrchestrationSummary, getLegalSources, getRecentImportRuns } from "@/server/legal-rules/queries";

export const dynamic = "force-dynamic";

export default async function NormativaOrchestrazionePage() {
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
