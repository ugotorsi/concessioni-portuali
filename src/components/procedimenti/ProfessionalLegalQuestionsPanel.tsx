import Link from "next/link";

import { SubmitButtonPending } from "@/components/forms/SubmitButtonPending";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  approveProfessionalLegalQuestionVersionAction,
  archiveProfessionalLegalQuestionAction,
  createProfessionalLegalQuestionAction,
  reviseProfessionalLegalQuestionAction,
  startProfessionalLegalResearchAction,
} from "@/server/actions/professional-legal-questions";
import type { ResearchMissionDisplay } from "@/server/legal-research/research-mission-display-state";

const PAID_RESEARCH_CONFIRMATION = "AUTORIZZO_RICERCA_ENTRO_IL_BUDGET_CONFIGURATO";

interface MissionSummary {
  id: string;
  status: string;
  lifecycleStatus: string;
  questionResults: readonly { id: string }[];
  display: ResearchMissionDisplay;
}

interface QuestionVersion {
  id: string;
  version: number;
  questionText: string;
  theme: string | null;
  rationale: string | null;
  referenceDate: Date;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED" | "ARCHIVED";
  approvedAt: Date | null;
  createdAt: Date;
  researchMission: MissionSummary | null;
}

interface ProfessionalQuestion {
  id: string;
  archivedAt: Date | null;
  versions: readonly QuestionVersion[];
}

function dateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function statusLabel(status: QuestionVersion["status"]): string {
  switch (status) {
    case "DRAFT": return "Bozza";
    case "APPROVED": return "Approvato";
    case "SUPERSEDED": return "Superato";
    case "ARCHIVED": return "Archiviato";
  }
}

function missionBadgeClass(display: ResearchMissionDisplay): string {
  switch (display.state) {
    case "BLOCKED":
    case "FAILED":
      return "bg-red-100 text-red-900";
    case "VALIDATED":
      return "bg-emerald-100 text-emerald-900";
    case "COMPLETED_SOURCES_TO_VERIFY":
    case "COMPLETED_NO_RESULTS":
      return "bg-amber-100 text-amber-950";
    default:
      return "bg-sky-100 text-sky-900";
  }
}

function WorkflowSteps({
  documentCount,
  questions,
  reportCount,
  procedimentoId,
}: {
  documentCount: number;
  questions: readonly ProfessionalQuestion[];
  reportCount: number;
  procedimentoId: string;
}) {
  const versions = questions.flatMap((question) => question.versions);
  const approved = versions.some((version) => version.status === "APPROVED");
  const missions = versions.flatMap((version) => version.researchMission ? [version.researchMission] : []);
  const sourceCount = missions.reduce((total, mission) => total + mission.questionResults.length, 0);
  const steps = [
    { label: "Documenti", complete: documentCount > 0, href: "documents" },
    { label: "Analisi", complete: documentCount > 0, href: "analysis" },
    { label: "Quesiti", complete: questions.length > 0, href: "research" },
    { label: "Autorizzazione", complete: approved && missions.length > 0, href: "research" },
    { label: "Fonti", complete: sourceCount > 0, href: "research" },
    { label: "Revisione", complete: sourceCount > 0, href: "research" },
    { label: "Rapporto", complete: reportCount > 0, href: "reports" },
  ];
  return (
    <nav aria-label="Percorso professionale" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
      {steps.map((step, index) => (
        <Link
          key={step.label}
          href={`/procedimenti/${procedimentoId}?section=${step.href}`}
          className={`rounded-md border px-3 py-2 text-sm ${
            step.complete
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <span className="block text-xs font-semibold">{index + 1}</span>
          {step.label}
          <span className="mt-1 block text-xs">{step.complete ? "Disponibile" : "Da completare"}</span>
        </Link>
      ))}
    </nav>
  );
}

const RESEARCH_REFUSAL_LABELS: Record<string, string> = {
  AUTOMATIC_RESEARCH_POLICY_DISABLED:
    "La ricerca autonoma non è abilitata in questo ambiente: servono il comando AI attivo, l'automazione generale e almeno un motore AI idoneo.",
  AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED: "L'ente non è autorizzato alla ricerca autonoma.",
  AUTOMATIC_RESEARCH_PROCEDIMENTO_NOT_ALLOWED: "Il fascicolo non è autorizzato alla ricerca autonoma.",
  AUTOMATIC_RESEARCH_CAPABILITY_NOT_ALLOWED: "Una capacità richiesta dalla missione non è autorizzata.",
  AUTOMATIC_RESEARCH_BUDGET_NOT_ALLOWED: "Il budget della missione supera il limite autorizzato.",
  AUTOMATIC_RESEARCH_POLICY_INVALID: "La configurazione della ricerca autonoma è incompleta.",
  PROFESSIONAL_RESEARCH_NOT_AUTHORIZED: "La ricerca non è stata autorizzata dai controlli correnti.",
};

export function ProfessionalLegalQuestionsPanel({
  procedimentoId,
  questions,
  canManage,
  defaultReferenceDate,
  documentCount,
  reportCount,
  refusalNotice,
}: {
  procedimentoId: string;
  questions: readonly ProfessionalQuestion[];
  canManage: boolean;
  defaultReferenceDate: string;
  documentCount: number;
  reportCount: number;
  refusalNotice?: string | null;
}) {
  return (
    <div className="space-y-5">
      {refusalNotice ? (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Ricerca non avviata</p>
          <p>{RESEARCH_REFUSAL_LABELS[refusalNotice] ?? `Richiesta rifiutata dal controllo di autorizzazione (${refusalNotice}).`}</p>
          <p className="mt-1 text-xs">Il rifiuto è registrato nel registro di audit. La missione resta rinviata finché le condizioni non sono soddisfatte.</p>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Percorso professionale del fascicolo</CardTitle>
          <CardDescription>Documenti, quesiti, ricerca autorizzata, revisione delle fonti e rapporto versionato restano distinti e tracciabili.</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowSteps
            documentCount={documentCount}
            questions={questions}
            reportCount={reportCount}
            procedimentoId={procedimentoId}
          />
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Nuovo quesito dell&apos;avvocato</CardTitle>
            <CardDescription>Il quesito nasce in bozza. L&apos;approvazione e l&apos;eventuale ricerca sono passaggi separati.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createProfessionalLegalQuestionAction} className="grid gap-4">
              <input type="hidden" name="procedimentoId" value={procedimentoId} />
              <label className="grid gap-1.5 text-sm font-medium">
                Tema
                <Input name="theme" maxLength={256} placeholder="Es. proroga, decadenza, concorrenza" />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Quesito giuridico
                <Textarea name="questionText" required minLength={12} maxLength={4000} rows={4} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Contesto e ragione del quesito
                <Textarea name="rationale" maxLength={4000} rows={3} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium sm:max-w-xs">
                Data di riferimento
                <Input name="referenceDate" type="date" required defaultValue={defaultReferenceDate} />
              </label>
              <div>
                <SubmitButtonPending pendingLabel="Salvataggio in corso...">Salva la bozza</SubmitButtonPending>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {questions.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Non risultano ancora quesiti professionali. I quesiti proposti automaticamente restano visibili più sotto.
        </p>
      ) : (
        <div className="space-y-4">
          {questions.map((question) => {
            const current = question.versions[0];
            if (!current) return null;
            const approved = question.versions.find((version) => version.status === "APPROVED");
            const mission = approved?.researchMission ?? null;
            return (
              <Card key={question.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{current.theme || "Quesito professionale"}</CardTitle>
                      <CardDescription>
                        Versione {current.version} · {statusLabel(current.status)}
                        {question.archivedAt ? " · Quesito archiviato" : ""}
                      </CardDescription>
                    </div>
                    {mission ? (
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${missionBadgeClass(mission.display)}`}>
                        {mission.display.label}
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{current.questionText}</p>
                  {current.rationale ? <p className="text-sm text-slate-600">{current.rationale}</p> : null}
                  <p className="text-xs text-slate-500">Data di riferimento: {dateInputValue(current.referenceDate)}</p>
                  {mission ? (
                    <p className="text-sm text-slate-700" data-testid="research-mission-state">
                      Stato della ricerca: {mission.display.label}. {mission.display.detail}
                    </p>
                  ) : null}

                  {canManage && !question.archivedAt ? (
                    <details className="rounded-md border border-slate-200 p-3">
                      <summary className="cursor-pointer text-sm font-semibold">Crea una nuova versione</summary>
                      <form action={reviseProfessionalLegalQuestionAction} className="mt-4 grid gap-3">
                        <input type="hidden" name="procedimentoId" value={procedimentoId} />
                        <input type="hidden" name="questionId" value={question.id} />
                        <Input name="theme" maxLength={256} defaultValue={current.theme ?? ""} aria-label="Tema" />
                        <Textarea name="questionText" required minLength={12} maxLength={4000} rows={4} defaultValue={current.questionText} aria-label="Quesito giuridico" />
                        <Textarea name="rationale" maxLength={4000} rows={3} defaultValue={current.rationale ?? ""} aria-label="Contesto e ragione" />
                        <Input name="referenceDate" type="date" required defaultValue={dateInputValue(current.referenceDate)} aria-label="Data di riferimento" />
                        <div><SubmitButtonPending pendingLabel="Creazione versione...">Salva nuova versione</SubmitButtonPending></div>
                      </form>
                    </details>
                  ) : null}

                  {canManage && current.status === "DRAFT" && !question.archivedAt ? (
                    <form action={approveProfessionalLegalQuestionVersionAction}>
                      <input type="hidden" name="procedimentoId" value={procedimentoId} />
                      <input type="hidden" name="versionId" value={current.id} />
                      <SubmitButtonPending pendingLabel="Approvazione in corso...">Approva versione {current.version}</SubmitButtonPending>
                    </form>
                  ) : null}

                  {canManage && approved && !mission && !question.archivedAt ? (
                    <form action={startProfessionalLegalResearchAction} className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
                      <input type="hidden" name="procedimentoId" value={procedimentoId} />
                      <input type="hidden" name="versionId" value={approved.id} />
                      <p className="text-sm font-semibold text-amber-950">Autorizzazione puntuale della ricerca</p>
                      <p className="text-sm text-amber-900">
                        Sarà avviata soltanto la missione collegata a questa versione. Limite massimo: 6 chiamate, non oltre 2 per Moonlit, 2 per Simpliciter e 2 per Legal Data Hunter. Possono applicarsi costi entro il budget configurato.
                      </p>
                      <label className="flex items-start gap-2 text-sm text-amber-950">
                        <input
                          type="checkbox"
                          name="paidResearchConfirmation"
                          value={PAID_RESEARCH_CONFIRMATION}
                          required
                          className="mt-1"
                        />
                        Confermo consapevolmente l&apos;eventuale utilizzo di chiamate a pagamento entro questi limiti.
                      </label>
                      <SubmitButtonPending pendingLabel="Ammissione della ricerca...">Autorizza e avvia questa ricerca</SubmitButtonPending>
                    </form>
                  ) : null}

                  {mission?.questionResults.length ? (
                    <div className="flex flex-wrap gap-3">
                      <Link href={`/legal-research/assisted-verification?missionId=${mission.id}`} className="text-sm font-semibold text-[#075985] underline underline-offset-4">
                        Revisiona professionalmente le fonti
                      </Link>
                      <Link href={`/procedimenti/${procedimentoId}?section=reports`} className="text-sm font-semibold text-[#075985] underline underline-offset-4">
                        Apri il rapporto versionato
                      </Link>
                    </div>
                  ) : null}

                  <details>
                    <summary className="cursor-pointer text-sm font-semibold">Storico delle versioni ({question.versions.length})</summary>
                    <ol className="mt-2 space-y-2 text-sm text-slate-600">
                      {question.versions.map((version) => (
                        <li key={version.id}>
                          v{version.version} · {statusLabel(version.status)} · {version.createdAt.toLocaleDateString("it-IT")}
                        </li>
                      ))}
                    </ol>
                  </details>

                  {canManage && !question.archivedAt ? (
                    <form action={archiveProfessionalLegalQuestionAction}>
                      <input type="hidden" name="procedimentoId" value={procedimentoId} />
                      <input type="hidden" name="questionId" value={question.id} />
                      <Button type="submit" variant="outline" size="sm">Archivia quesito</Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
