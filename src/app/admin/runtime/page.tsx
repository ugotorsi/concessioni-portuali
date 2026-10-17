import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDateIT } from "@/lib/utils";
import { getRuntimeHealthSnapshot } from "@/server/runtime/health";
import { readDefaultProcedimentoBudgetAuthorization } from "@/server/runtime/procedimentoBudgetPolicy";

import {
  assignDefaultProcedimentoBudgetPolicy,
  recoverCurrentKnowledgeMissions,
  retryRuntimeJob,
} from "./actions";

export const dynamic = "force-dynamic";

function healthVariant(status: string): "success" | "warning" | "danger" {
  if (status === "HEALTHY") return "success";
  if (status === "DEGRADED") return "warning";
  return "danger";
}

function healthLabel(status: string) {
  if (status === "HEALTHY") return "Operativo";
  if (status === "DEGRADED") return "Attenzione richiesta";
  return "Non operativo";
}

export default async function RuntimeOperationsPage() {
  await requireRole(["ADMIN"]);
  const defaultProcedimentoBudget = readDefaultProcedimentoBudgetAuthorization();
  const [health, workers, failedJobs, policies, costs] = await Promise.all([
    getRuntimeHealthSnapshot(),
    prisma.runtimeWorkerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 20 }),
    prisma.asyncJob.findMany({
      where: { status: "TERMINAL_FAILED" },
      select: { id: true, operation: true, tenantId: true, procedimentoId: true, attemptCount: true, failureCode: true, completedAt: true },
      orderBy: { completedAt: "desc" }, take: 25,
    }),
    prisma.runtimeBudgetPolicy.findMany({ where: { enabled: true }, orderBy: [{ scope: "asc" }, { effectiveFrom: "desc" }] }),
    prisma.runtimeCostReservation.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
  ]);

  return (
    <AppShell title="Stato dei servizi" subtitle="Controllo delle elaborazioni automatiche e degli eventuali interventi richiesti">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge variant={healthVariant(health.status)}>{healthLabel(health.status)}</Badge>
        <span className="text-sm text-slate-600">Ultimo successo: {health.lastSuccessfulJobAt ? formatDateIT(health.lastSuccessfulJobAt) : "Nessuno"}</span>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-medium">Dettagli tecnici</summary>
          <p className="mt-1">Stato migrazioni: {health.migrationState}</p>
        </details>
      </div>

      <section aria-label="Riepilogo servizi" className="border-y border-slate-200 bg-white px-4 py-3">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Unità attive</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{health.activeWorkers}</dd></div>
          <div><dt className="text-xs text-slate-500">In attesa</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{health.queueDepth}</dd><p className="text-xs text-slate-500">Attesa massima {health.oldestPendingAgeSeconds ?? 0}s</p></div>
          <div><dt className="text-xs text-slate-500">In elaborazione</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{health.runningJobs}</dd></div>
          <div><dt className="text-xs text-slate-500">Da recuperare</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{health.staleLeases}</dd></div>
        </dl>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Unità di elaborazione</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Stato</TableHead><TableHead>Lane</TableHead><TableHead>Heartbeat</TableHead></TableRow></TableHeader><TableBody>
            {workers.map((worker) => <TableRow key={worker.id}><TableCell>{worker.workerId}</TableCell><TableCell>{worker.status}</TableCell><TableCell>{worker.concurrency}</TableCell><TableCell>{formatDateIT(worker.lastSeenAt)}</TableCell></TableRow>)}
          </TableBody></Table></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Limiti di spesa attivi</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Ambito</TableHead><TableHead>Finestra</TableHead><TableHead>Cap</TableHead></TableRow></TableHeader><TableBody>
            {policies.map((policy) => <TableRow key={policy.id}><TableCell>{policy.scope}</TableCell><TableCell>{policy.windowSeconds}s</TableCell><TableCell>{policy.hardCapAmount.toString()} {policy.currency}</TableCell></TableRow>)}
          </TableBody></Table></CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader><CardTitle>Elaborazioni non completate</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Operazione</TableHead><TableHead>Ambito</TableHead><TableHead>Tentativi</TableHead><TableHead>Codice</TableHead><TableHead>Azione</TableHead></TableRow></TableHeader><TableBody>
            {failedJobs.map((job) => <TableRow key={job.id}><TableCell>{job.operation}</TableCell><TableCell>{job.procedimentoId ?? job.tenantId ?? "Globale"}</TableCell><TableCell>{job.attemptCount}</TableCell><TableCell>{job.failureCode ?? "NON_CLASSIFICATO"}</TableCell><TableCell><form action={retryRuntimeJob}><input type="hidden" name="jobId" value={job.id} /><Button size="sm" variant="outline" type="submit">Riprova</Button></form></TableCell></TableRow>)}
          </TableBody></Table></CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader><CardTitle>Recupero missioni dalla conoscenza corrente</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Riconcilia in modo idempotente le missioni dalla revisione CURRENT senza ripetere l&apos;analisi AI.
              Senza un utente valido per il tenant, le missioni restano differite e richiedono assegnazione.
            </p>
            <form action={recoverCurrentKnowledgeMissions} className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                ID procedimento
                <input
                  className="h-10 min-w-80 rounded-md border border-slate-300 px-3 text-sm"
                  name="procedimentoId"
                  required
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                ID utente assegnatario
                <input
                  className="h-10 min-w-80 rounded-md border border-slate-300 px-3 text-sm"
                  name="assignedActorId"
                />
              </label>
              <Button type="submit">Recupera post-processing</Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader><CardTitle>Budget predefinito per fascicolo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {defaultProcedimentoBudget.authorized ? (
              <>
                <p className="text-sm text-slate-600">
                  Autorizzato: {defaultProcedimentoBudget.hardCapAmount} {defaultProcedimentoBudget.currency}
                  {" "}ogni {defaultProcedimentoBudget.windowSeconds}s. Le policy esistenti non vengono modificate.
                </p>
                <form action={assignDefaultProcedimentoBudgetPolicy} className="flex flex-wrap items-end gap-3">
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    ID procedimento
                    <input
                      className="h-10 min-w-80 rounded-md border border-slate-300 px-3 text-sm"
                      name="procedimentoId"
                      required
                    />
                  </label>
                  <Button type="submit">Assegna policy mancante</Button>
                </form>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                Creazione automatica non autorizzata. Configurare
                {" "}RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED,
                {" "}RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR e
                {" "}RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader><CardTitle>Costi recenti</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Servizio</TableHead><TableHead>Operazione</TableHead><TableHead>Stato</TableHead><TableHead>Stimato</TableHead><TableHead>Effettivo</TableHead><TableHead>Data</TableHead></TableRow></TableHeader><TableBody>
            {costs.map((cost) => <TableRow key={cost.id}><TableCell>{cost.provider}</TableCell><TableCell>{cost.operationType}</TableCell><TableCell>{cost.status}</TableCell><TableCell>{cost.estimatedAmount.toString()} {cost.currency}</TableCell><TableCell>{cost.actualAmount?.toString() ?? "-"}</TableCell><TableCell>{formatDateIT(cost.createdAt)}</TableCell></TableRow>)}
          </TableBody></Table></CardContent>
        </Card>
      </section>
    </AppShell>
  );
}