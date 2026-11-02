import Link from "next/link";

import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { formatDateIT } from "@/lib/utils";
import {
  buildSelvaraMissionInstructions,
  type LegalWorkbenchSnapshot,
} from "@/server/runtime/legalWorkbench";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "In attesa di esecuzione",
  CLAIMED: "In esecuzione",
  COMPLETED: "Completata",
  DEFERRED: "Rinviata",
  FAILED: "Non riuscita",
  CURRENT: "Corrente",
  SUPERSEDED: "Storico (sostituita)",
  STALE: "Da aggiornare",
  BUILDING: "In costruzione",
  QUEUED: "In coda",
  RUNNING: "In elaborazione",
  SUCCEEDED: "Completata",
  TERMINAL_FAILED: "Non riuscita",
  CANCELLED: "Annullata",
};

function statusVariant(status: string): BadgeVariant {
  if (["COMPLETED", "SUCCEEDED", "CURRENT"].includes(status)) return "success";
  if (["FAILED", "TERMINAL_FAILED"].includes(status)) return "danger";
  if (["SUPERSEDED", "CANCELLED"].includes(status)) return "muted";
  if (["CLAIMED", "RUNNING", "QUEUED", "BUILDING"].includes(status)) return "info";
  return "warning";
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABELS[status] ?? status}</Badge>;
}

interface Props {
  procedimenti: readonly { id: string; label: string }[];
  selectedProcedimentoId: string | null;
  snapshot: LegalWorkbenchSnapshot | null;
  assignedActorId: string;
  confirmReferenceDateAction: (formData: FormData) => Promise<void>;
  recoverMissionsAction: (formData: FormData) => Promise<void>;
  startLegalAnalysisAction: (formData: FormData) => Promise<void>;
}

const CHANNEL_LABELS: Record<string, string> = {
  SERVER_AUTONOMOUS: "Automatica dal server (worker NOETRA)",
  CHATGPT_CONNECTOR: "ChatGPT con connettore Selvara",
};

const REQUIREMENT_LABELS: Record<string, string> = {
  MANUAL_RESEARCH_POLICY_DISABLED: "ricerca su richiesta non abilitata in questo ambiente",
  MANUAL_RESEARCH_TENANT_NOT_ALLOWED: "ente non autorizzato alla ricerca su richiesta",
  MANUAL_RESEARCH_PROCEDIMENTO_NOT_ALLOWED: "fascicolo non autorizzato alla ricerca su richiesta",
  MANUAL_RESEARCH_CAPABILITY_NOT_ALLOWED: "capacità richiesta non autorizzata",
  MANUAL_RESEARCH_BUDGET_NOT_ALLOWED: "budget della missione superiore al limite autorizzato",
  MANUAL_RESEARCH_POLICY_INVALID: "configurazione della ricerca su richiesta incompleta",
  AUTOMATIC_RESEARCH_POLICY_DISABLED: "ricerca autonoma non abilitata in questo ambiente",
  AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED: "ente non autorizzato alla ricerca autonoma",
  AUTOMATIC_RESEARCH_PROCEDIMENTO_NOT_ALLOWED: "fascicolo non autorizzato alla ricerca autonoma",
  AUTOMATIC_RESEARCH_POLICY_INVALID: "configurazione della ricerca autonoma incompleta",
};

const PROVIDER_LABELS: Record<string, string> = { MOONLIT: "Moonlit", SIMPLICITER: "Simpliciter" };

export function LegalWorkbenchSection({
  procedimenti,
  selectedProcedimentoId,
  snapshot,
  assignedActorId,
  confirmReferenceDateAction,
  recoverMissionsAction,
  startLegalAnalysisAction,
}: Props) {
  const confirmedByQuestion = new Map(
    (snapshot?.referenceDateConfirmations ?? []).map((confirmation) => [confirmation.questionSemanticKey, confirmation]),
  );
  return (
    <section className="mt-6" aria-labelledby="legal-workbench-title">
      <Card>
        <CardHeader>
          <CardTitle id="legal-workbench-title">Analisi giuridica e ricerche</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-slate-600">
            Pannello di controllo manuale: scegli il fascicolo e premi «Avvia analisi giuridica». NOETRA esegue
            l&apos;analisi AI dei documenti, le ricerche normative e giurisprudenziali sulle fonti autorizzate e
            aggiorna il rapporto versionato. Con AUTOMAZIONE OFF nulla parte da solo.
          </p>

          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Fascicolo
              <select
                name="procedimentoId"
                defaultValue={selectedProcedimentoId ?? ""}
                className="h-10 min-w-80 rounded-md border border-slate-300 px-3 text-sm"
                required
              >
                <option value="" disabled>Seleziona un fascicolo</option>
                {procedimenti.map((procedimento) => (
                  <option key={procedimento.id} value={procedimento.id}>{procedimento.label}</option>
                ))}
              </select>
            </label>
            <Button type="submit">Mostra stato</Button>
          </form>

          {selectedProcedimentoId && !snapshot ? (
            <p className="text-sm font-medium text-red-700">Fascicolo non trovato o non associato a un ente.</p>
          ) : null}

          {snapshot ? (
            <>
              <form action={startLegalAnalysisAction} className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <input type="hidden" name="procedimentoId" value={snapshot.procedimentoId} />
                <p className="text-sm font-semibold text-slate-900">Avvia analisi giuridica completa</p>
                <p className="text-xs text-slate-700">
                  Analisi AI (solo se i documenti sono cambiati), poi ricerche giuridiche sul worker autorizzato e
                  nuova versione del rapporto. Elaborazioni già eseguite non vengono ripetute; si applicano i limiti di spesa.
                </p>
                <p className="text-xs text-slate-700">
                  Ricerca su richiesta:{" "}
                  {snapshot.research.autonomousChannel.authorized
                    ? <strong className="text-green-700">abilitata per questo fascicolo</strong>
                    : <strong className="text-amber-700">non disponibile ({REQUIREMENT_LABELS[snapshot.research.autonomousChannel.requirementCode ?? ""] ?? snapshot.research.autonomousChannel.requirementCode})</strong>}
                  {" · "}Fonti con accesso OAuth:{" "}
                  {snapshot.research.providerCredentials.map((credential) => (
                    <span key={credential.provider} className="mr-2">
                      {PROVIDER_LABELS[credential.provider] ?? credential.provider}{" "}
                      {credential.stored && credential.hasRefreshToken && !credential.lastRefreshErrorCode
                        ? "collegato"
                        : credential.stored ? `da ricollegare (${credential.lastRefreshErrorCode ?? "token non rinnovabile"})` : "non collegato"}
                    </span>
                  ))}
                  {" · "}LegalDataHunter: chiave API sul worker
                </p>
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" name="confirmation" value="START_LEGAL_ANALYSIS" required />
                  Confermo l&apos;avvio manuale delle elaborazioni AI e delle ricerche per questo fascicolo
                </label>
                <Button type="submit">Avvia analisi giuridica</Button>
              </form>
              <div className="flex flex-wrap gap-3 text-sm">
                <Link className="font-medium text-blue-700 underline" href={`/procedimenti/${snapshot.procedimentoId}?section=reports`}>
                  Apri i rapporti del fascicolo
                </Link>
                <Link className="font-medium text-blue-700 underline" href={`/procedimenti/${snapshot.procedimentoId}?section=research`}>
                  Apri le ricerche del fascicolo
                </Link>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">1. Analisi AI</h3>
                {snapshot.analysisJobs.length === 0 ? (
                  <p className="text-sm text-slate-600">Nessuna analisi richiesta per questo fascicolo.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Richiesta</TableHead><TableHead>Stato</TableHead><TableHead>Motivo</TableHead><TableHead>Conclusa</TableHead><TableHead>Errore</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {snapshot.analysisJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell>{formatDateIT(job.createdAt)}</TableCell>
                          <TableCell><StatusBadge status={job.status} /></TableCell>
                          <TableCell className="font-mono text-xs">{job.purpose}</TableCell>
                          <TableCell>{job.completedAt ? formatDateIT(job.completedAt) : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{job.failureCode ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="font-semibold text-slate-900">2. Revisioni della conoscenza</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Revisione</TableHead><TableHead>Stato</TableHead><TableHead>Creata</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {snapshot.revisions.map((revision) => (
                        <TableRow key={revision.id}>
                          <TableCell className="font-mono text-xs">{revision.id}</TableCell>
                          <TableCell><StatusBadge status={revision.status} /></TableCell>
                          <TableCell>{formatDateIT(revision.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-slate-900">3. Rapporti versionati</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Rapporto</TableHead><TableHead>Stato</TableHead><TableHead>Generato</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {snapshot.reports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell className="font-mono text-xs">
                            {report.id}
                            {report.supersededBySnapshotId ? (
                              <span className="block text-slate-500">sostituito da {report.supersededBySnapshotId}</span>
                            ) : null}
                          </TableCell>
                          <TableCell><StatusBadge status={report.status} /></TableCell>
                          <TableCell>{formatDateIT(report.generatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900">4. Data di riferimento giuridico</h3>
                {snapshot.referenceDateReviews.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    Nessuna domanda di ricerca in attesa di conferma della data.
                    {snapshot.referenceDateConfirmations.length
                      ? ` Conferme registrate: ${snapshot.referenceDateConfirmations.length}.`
                      : ""}
                  </p>
                ) : snapshot.referenceDateReviews.map((review) => {
                  const previous = confirmedByQuestion.get(review.questionSemanticKey);
                  return (
                    <form key={review.questionSemanticKey} action={confirmReferenceDateAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <input type="hidden" name="procedimentoId" value={snapshot.procedimentoId} />
                      <input type="hidden" name="questionSemanticKey" value={review.questionSemanticKey} />
                      <p className="text-sm font-medium text-slate-900">{review.question}</p>
                      <p className="text-xs text-slate-700">
                        I documenti non stabiliscono con certezza la data rispetto alla quale individuare la disciplina
                        applicabile. Indica tu la data corretta: la conferma viene registrata a tuo nome e resta tracciata
                        nella missione di ricerca.
                      </p>
                      {review.documentaryHints.length ? (
                        <ul className="list-disc pl-5 text-xs text-slate-700">
                          {review.documentaryHints.map((hint) => (
                            <li key={hint.semanticKey}>
                              Data presente nei documenti ({hint.kind}): <strong>{hint.date}</strong>
                              {hint.originalText ? ` — «${hint.originalText}»` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {previous ? (
                        <p className="text-xs text-slate-600">Ultima conferma registrata: {previous.confirmedDate}</p>
                      ) : null}
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="grid gap-1 text-sm font-medium text-slate-700">
                          Data di riferimento
                          <input type="date" name="confirmedDate" required className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
                        </label>
                        <label className="grid min-w-80 flex-1 gap-1 text-sm font-medium text-slate-700">
                          Motivazione
                          <input name="rationale" required minLength={5} maxLength={500} className="h-10 rounded-md border border-slate-300 px-3 text-sm" placeholder="Es. data dell'atto impugnato indicata nel documento" />
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-800">
                        <input type="checkbox" name="confirmation" value="CONFIRM_LEGAL_REFERENCE_DATE" required />
                        Confermo che la data indicata è quella di riferimento giuridico per questa domanda
                      </label>
                      <Button type="submit">Conferma data e prepara la ricerca</Button>
                    </form>
                  );
                })}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">5. Ricerche giuridiche</h3>
                  <form action={recoverMissionsAction}>
                    <input type="hidden" name="procedimentoId" value={snapshot.procedimentoId} />
                    <input type="hidden" name="assignedActorId" value={assignedActorId} />
                    <Button type="submit" variant="outline">Ripianifica ricerche dalla revisione corrente</Button>
                  </form>
                </div>
                <p className="text-xs text-slate-600">
                  Le missioni sul canale automatico sono eseguite dal worker NOETRA con le fonti giuridiche autorizzate
                  (Moonlit, LegalDataHunter, Simpliciter se collegato). Il connettore Selvara resta disponibile per le
                  ricerche avviate da ChatGPT.
                </p>
                {snapshot.research.jobs.length ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Esecuzione</TableHead><TableHead>Stato</TableHead><TableHead>Missione</TableHead><TableHead>Conclusa</TableHead><TableHead>Errore</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {snapshot.research.jobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell>{formatDateIT(job.createdAt)}</TableCell>
                          <TableCell><StatusBadge status={job.status} /></TableCell>
                          <TableCell className="font-mono text-xs">{job.missionId ?? "—"}</TableCell>
                          <TableCell>{job.completedAt ? formatDateIT(job.completedAt) : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{job.failureCode ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
                {snapshot.missions.length === 0 ? (
                  <p className="text-sm text-slate-600">Nessuna missione di ricerca per questo fascicolo.</p>
                ) : snapshot.missions.map((mission) => (
                  <article key={mission.id} className="space-y-2 rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={mission.status} />
                      <Badge variant={mission.lifecycleStatus === "CURRENT" ? "info" : "muted"}>{mission.lifecycleStatus}</Badge>
                      <span className="font-mono text-xs text-slate-500">{mission.id}</span>
                    </div>
                    <p className="text-sm text-slate-900">{mission.question}</p>
                    <p className="text-xs text-slate-600">
                      Data di riferimento {mission.referenceDate}
                      {mission.referenceDateBasis ? ` (${mission.referenceDateBasis === "USER_CONFIRMED" ? "confermata dall'amministratore" : mission.referenceDateBasis})` : ""}
                      {" · "}Canale {CHANNEL_LABELS[mission.executionChannel] ?? mission.executionChannel}
                      {" · "}Assegnata a {mission.assignedActorEmail ?? "nessuno"}
                      {" · "}Tentativi {mission.attempts.length}
                    </p>
                    {mission.documentaryGaps.length > 0 ? (
                      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" data-testid="mission-documentary-gaps">
                        <p className="font-semibold">
                          Lacuna documentale — non è un malfunzionamento tecnico
                        </p>
                        <p className="mt-1">
                          {mission.status === "DEFERRED"
                            ? "La ricerca è stata eseguita ma la missione resta rinviata finché il fascicolo non contiene i documenti indicati. Caricarli e riavviare l'analisi giuridica."
                            : "Il fascicolo segnala fatti non ancora documentati: la ricerca li riporterà come lacune."}
                        </p>
                        <ul className="mt-1 list-disc pl-5">
                          {mission.documentaryGaps.map((gap) => (
                            <li key={gap.gapId}>
                              {gap.description ?? `Lacuna ${gap.gapId.slice(0, 12)}…`}
                              {gap.resolvedInCurrentRevision ? " (non più presente nella revisione corrente: riavviare l'analisi)" : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {mission.bundles.map((bundle) => (
                      <div key={bundle.id} className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                        <p className="font-medium text-slate-800">
                          Risultato {bundle.completionState} · {bundle.sources.length} fonti · {bundle.evidenceGapCount} lacune · {bundle.totalCalls} chiamate · {formatDateIT(bundle.createdAt)}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {bundle.sources.map((source, index) => (
                            <li key={`${bundle.id}-${index}`}>
                              <strong>{source.title}</strong>
                              {source.identifier ? ` · ${source.identifier}` : ""}
                              {source.courtOrBody ? ` · ${source.courtOrBody}` : ""}
                              {source.documentDate ? ` · ${source.documentDate}` : ""}
                              {source.providerId ? ` · via ${source.providerId}` : ""}
                              {source.sourceUrl ? (
                                <> · <a className="text-blue-700 underline" href={source.sourceUrl} target="_blank" rel="noreferrer">fonte</a></>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {mission.status === "PENDING" && mission.lifecycleStatus === "CURRENT"
                      && mission.executionChannel === "CHATGPT_CONNECTOR" ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-slate-700">Istruzioni per ChatGPT (Selvara)</summary>
                        <textarea
                          readOnly
                          className="mt-2 h-40 w-full rounded border border-slate-300 p-2 font-mono text-xs"
                          defaultValue={buildSelvaraMissionInstructions(mission.id)}
                        />
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
