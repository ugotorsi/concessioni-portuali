import { Button } from "@/components/ui/Button";
import { analyzeFascicoloDocumentStructuredKnowledgeAction } from "@/server/actions/fascicolo-document-structured-knowledge";
import {
  isFascicoloDocumentStructuredKnowledgeAvailable,
  readFascicoloDocumentStructuredKnowledgeEnvironment,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";
import type { FascicoloAnalysisCorpus } from "@/components/procedimenti/FascicoloAnalysis";

export function FascicoloDocumentStructuredKnowledgeTrigger({
  procedimentoId,
  corpus,
  canRun,
}: {
  procedimentoId: string;
  corpus: FascicoloAnalysisCorpus | null;
  canRun: boolean;
}) {
  if (
    !canRun
    || !corpus
    || corpus.availableDocumentCount === 0
    || !isFascicoloDocumentStructuredKnowledgeAvailable({
      env: readFascicoloDocumentStructuredKnowledgeEnvironment(),
      procedimentoId,
    })
  ) {
    return null;
  }

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-950">Analisi strutturata assistita</p>
          <p className="mt-1 text-sm text-amber-900">
            Saranno analizzati soltanto {corpus.availableDocumentCount} documenti su {corpus.documentCount}.
            {corpus.availability === "PARTIAL" ? " Il risultato resterà esplicitamente parziale." : ""}
          </p>
        </div>
        <form action={analyzeFascicoloDocumentStructuredKnowledgeAction}>
          <input type="hidden" name="procedimentoId" value={procedimentoId} />
          <Button type="submit" size="sm">Aggiorna conoscenza strutturata</Button>
        </form>
      </div>
    </section>
  );
}
