import { randomUUID } from "node:crypto";
import Link from "next/link";

import { startLegalAnalysisPipeline } from "@/app/admin/runtime/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  getExistingCorpusAnalysisReadiness,
  type ExistingCorpusAnalysisReadinessCode,
} from "@/server/ai/fascicoloExistingCorpusAnalysis";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import { getAiProviderControlSnapshot } from "@/server/ai/providerControl";
import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import {
  getEffectiveAiScopePolicy,
  getResearchChannelAvailability,
} from "@/server/ai/scopePolicy";
import { getAutomationControlState } from "@/server/automation/automationControl";

const BLOCK_REASON_LABELS: Record<string, string> = {
  AI_GLOBALLY_DISABLED: "Il comando generale AI è disattivato.",
  AI_TENANT_DISABLED: "L'ente non autorizza elaborazioni AI.",
  AI_PROCEDIMENTO_DISABLED: "Il fascicolo non autorizza elaborazioni AI.",
  NO_PROVIDER_ALLOWED: "Nessun provider idoneo è autorizzato per questo fascicolo.",
  MANUAL_RESEARCH_DISABLED: "La ricerca su richiesta non è autorizzata per questo fascicolo.",
  NO_RESEARCH_CHANNEL_ALLOWED: "Nessun canale di ricerca verificabile è disponibile.",
  ANALYSIS_ACTIVATION_DISABLED: "L'ambiente non è autorizzato per l'analisi di dati reali o la configurazione AI è incompleta.",
  CORPUS_NOT_READY: "I documenti non sono ancora tutti estratti e disponibili come corpus verificabile.",
  ECONOMIC_PREFLIGHT_FAILED: "Il budget disponibile non copre il costo massimo stimato dell'analisi.",
  AI_PROVIDER_NOT_APPROVED: "Il provider o il modello selezionato non è approvato per dati reali.",
  AI_PROVIDER_MANUAL_DISABLED: "Il provider approvato non è abilitato per avvii manuali.",
};

function reasonLabel(reason: string): string {
  return BLOCK_REASON_LABELS[reason] ?? reason.replaceAll("_", " ").toLocaleLowerCase("it");
}

function Status({
  available,
  availableLabel = "Disponibile",
  blockedLabel = "Bloccata",
}: {
  available: boolean;
  availableLabel?: string;
  blockedLabel?: string;
}) {
  return (
    <Badge variant={available ? "success" : "warning"}>
      {available ? availableLabel : blockedLabel}
    </Badge>
  );
}

export async function FascicoloAiWorkspace({
  tenantId,
  procedimentoId,
  role,
}: {
  tenantId: string | null;
  procedimentoId: string;
  role: string;
}) {
  if (!tenantId) {
    return (
      <Card>
        <CardHeader><CardTitle>AI del fascicolo</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-amber-900">
            Funzioni AI bloccate: il fascicolo non è ancora associato a un ente. Completa il collegamento
            amministrativo prima di autorizzare elaborazioni o ricerche.
          </p>
        </CardContent>
      </Card>
    );
  }

  const [globalControl, automationControl, providerControl, channels, analysisReadiness] = await Promise.all([
    getGlobalAiControlState(),
    getAutomationControlState(),
    getAiProviderControlSnapshot(),
    getResearchChannelAvailability(),
    getExistingCorpusAnalysisReadiness({ tenantId, procedimentoId }),
  ]);
  const readiness = await getAiProviderReadiness({
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    control: providerControl,
  });
  const policy = await getEffectiveAiScopePolicy({
    tenantId,
    procedimentoId,
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    allowedProviders: readiness
      .filter((provider) => provider.manualEnabled && provider.manualEligible)
      .map((provider) => provider.provider),
    allowedResearchChannels: channels
      .filter((channel) => channel.available)
      .map((channel) => channel.channel),
  });

  const availableResearchChannels = channels.filter((channel) => (
    channel.available
    && policy.researchChannels.includes(channel.channel)
  ));
  const canManageQuestions = role === "ADMIN" || role === "GIURIDICO";
  const canRunAnalysis = role === "ADMIN" && analysisReadiness.ready;
  const canRunResearch = policy.manualResearchEnabled && availableResearchChannels.length > 0;
  const blockers = [
    ...policy.blockedReasons.map(reasonLabel),
    ...(!analysisReadiness.ready
      ? [reasonLabel(analysisReadiness.code satisfies ExistingCorpusAnalysisReadinessCode)]
      : []),
    ...(role !== "ADMIN" ? ["L'avvio dell'analisi richiede un amministratore con MFA."] : []),
  ];

  return (
    <section aria-labelledby="fascicolo-ai-title" className="space-y-4">
      <header className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="fascicolo-ai-title" className="text-xl font-semibold text-slate-950">AI del fascicolo</h2>
            <p className="mt-1 text-sm text-slate-600">
              Analisi, domande e ricerca giuridica con fonti, versioni, revisione professionale e audit.
            </p>
          </div>
          <Status
            available={canRunAnalysis}
            availableLabel="Analisi AI autorizzata"
            blockedLabel="Analisi AI bloccata"
          />
        </div>
        {blockers.length > 0 ? (
          <div role="note" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Perché alcune azioni sono bloccate</p>
            <ul className="mt-1 list-disc pl-5">
              {[...new Set(blockers)].map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
            <p className="mt-2">
              Rimedio: verifica comando generale, provider, worker, budget e policy in{" "}
              <Link href="/admin/runtime" className="font-semibold underline">Stato dei servizi</Link>.
              La policy del fascicolo può soltanto restringere le autorizzazioni globali.
            </p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>Aggiorna fascicolo</CardTitle>
              <Status available={canRunAnalysis} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              Rilegge il corpus corrente e aggiorna analisi, questioni giuridiche, proposte e rapporto
              versionato senza cancellare revisioni o decisioni precedenti.
            </p>
            {canRunAnalysis ? (
              <form action={startLegalAnalysisPipeline} className="space-y-2">
                <input type="hidden" name="procedimentoId" value={procedimentoId} />
                <input type="hidden" name="executionId" value={randomUUID()} />
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" name="confirmation" value="START_LEGAL_ANALYSIS" required />
                  Confermo l&apos;avvio manuale soggetto a preflight, audit e limiti di spesa.
                </label>
                <Button type="submit">Aggiorna fascicolo</Button>
              </form>
            ) : (
              <p className="font-medium text-amber-900">Il comando resta disabilitato finché tutti i controlli richiesti non risultano superati.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>Interroga AI</CardTitle>
              <Status
                available={canManageQuestions && canRunResearch}
                availableLabel="Ricerca manuale autorizzata"
                blockedLabel={canManageQuestions ? "Solo preparazione" : "Bloccata"}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              Formula una domanda libera, salvala e sottoponila a revisione professionale. Dopo
              l&apos;approvazione puoi autorizzare la ricerca entro il budget configurato; fonti e
              aggiornamenti restano persistenti e versionati nel fascicolo.
            </p>
            <Link
              href={`/procedimenti/${procedimentoId}?section=research#interroga-ai`}
              className="inline-flex min-h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white"
            >
              {canRunResearch ? "Apri interrogazione guidata" : "Prepara il quesito"}
            </Link>
            {!canRunResearch ? (
              <p className="text-xs text-amber-900">
                Puoi salvare il quesito, ma approvazione ed esecuzione restano separate e la ricerca
                è bloccata finché policy e canali non sono autorizzati.
              </p>
            ) : null}
            {canRunResearch && !canRunAnalysis ? (
              <p className="text-xs text-slate-600">
                La ricerca manuale autorizzata è distinta dall&apos;analisi del corpus: non indica
                che il provider AI del fascicolo sia eseguibile.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>Ricerca e aggiornamento giuridico</CardTitle>
              <Status available={canRunResearch} availableLabel="Ricerca manuale autorizzata" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              Confronta fonti normative e giurisprudenziali aggiornate con le questioni aperte.
              I risultati restano proposte da verificare e approvare.
            </p>
            <Link
              href={`/procedimenti/${procedimentoId}?section=research#ricerca-giuridica`}
              className="inline-flex min-h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-900"
            >
              {canRunResearch ? "Avvia dal quesito approvato" : "Consulta stato e fonti"}
            </Link>
            <p className="text-xs text-slate-500">
              Canali autorizzati: {availableResearchChannels.length > 0
                ? availableResearchChannels.map((channel) => channel.channel).join(", ")
                : "nessuno"}.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
