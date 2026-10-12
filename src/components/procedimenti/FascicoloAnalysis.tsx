import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, HelpCircle, Search } from "lucide-react";

export interface FascicoloAnalysisQuestion {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  area?: string | null;
  relevance?: string | null;
  evidence?: readonly string[];
  href?: string | null;
}

export interface FascicoloAnalysisEvidence {
  id: string;
  title: string;
  detail?: string | null;
  href?: string | null;
}

export interface FascicoloAnalysisContradiction {
  id: string;
  description: string;
  involved?: readonly string[];
  status?: string | null;
}

export interface FascicoloAnalysisGap {
  id: string;
  title: string;
  relevance?: string | null;
  requestedItem?: string | null;
  status?: string | null;
}

export interface FascicoloAnalysisRelevantItem {
  id: string;
  title: string;
  description?: string | null;
  detail?: string | null;
  href?: string | null;
}

export interface FascicoloAnalysisCorpus {
  availability: "READY" | "PARTIAL" | "NOT_READY";
  documentCount: number;
  availableDocumentCount: number;
  textPageCount: number;
  documentsToVerify: readonly {
    id: string;
    name: string;
    status: "NOT_EXTRACTED" | "OCR_REQUIRED" | "EXTRACTION_FAILED" | "NO_CURRENT_VERSION";
  }[];
}

export interface FascicoloAnalysisModel {
  questions: readonly FascicoloAnalysisQuestion[];
  evidence: readonly FascicoloAnalysisEvidence[];
  contradictions: readonly FascicoloAnalysisContradiction[];
  gaps: readonly FascicoloAnalysisGap[];
  relevantItems: readonly FascicoloAnalysisRelevantItem[];
  analysisStatus?: string | null;
  corpus?: FascicoloAnalysisCorpus | null;
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  const text = optionalText(value);
  if (!text) return null;

  return <span className="text-xs text-slate-600"><span className="font-medium text-slate-700">{label}:</span> {text}</span>;
}

export function FascicoloAnalysis({ model }: { model: FascicoloAnalysisModel }) {
  const hasStructuredAnalysis = model.questions.length > 0
    || model.contradictions.length > 0
    || model.gaps.length > 0
    || model.relevantItems.length > 0
    || Boolean(optionalText(model.analysisStatus));

  return (
    <section aria-labelledby="analysis-title" className="min-w-0 space-y-6" data-testid="fascicolo-analysis">
      <header className="border-b border-slate-200 pb-4">
        <h2 id="analysis-title" className="text-xl font-semibold text-slate-950">Analisi</h2>
        <p className="mt-1 text-sm text-slate-600">Questioni, evidenze e punti da approfondire nel fascicolo.</p>
        {hasStructuredAnalysis ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="inline text-slate-500">Questioni aperte </dt><dd className="inline font-semibold text-slate-950">{model.questions.length}</dd></div>
            <div><dt className="inline text-slate-500">Contraddizioni </dt><dd className="inline font-semibold text-slate-950">{model.contradictions.length}</dd></div>
            <div><dt className="inline text-slate-500">Lacune </dt><dd className="inline font-semibold text-slate-950">{model.gaps.length}</dd></div>
          </dl>
        ) : null}
      </header>

      {model.corpus ? (
        <section aria-labelledby="document-corpus-title" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#0b7285]" aria-hidden="true" />
            <h3 id="document-corpus-title" className="font-semibold text-slate-950">Corpus documentale</h3>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Documenti acquisiti</dt><dd className="font-semibold text-slate-950">{model.corpus.documentCount}</dd></div>
            <div><dt className="text-slate-500">Testi disponibili</dt><dd className="font-semibold text-slate-950">{model.corpus.availableDocumentCount} documenti · {model.corpus.textPageCount} pagine</dd></div>
            <div><dt className="text-slate-500">Disponibilità del corpus</dt><dd className="font-semibold text-slate-950">{model.corpus.availability === "READY" ? "Corpus disponibile" : model.corpus.availability === "PARTIAL" ? "Corpus parziale" : "Non disponibile"}</dd></div>
          </dl>
          {model.corpus.documentsToVerify.length > 0 ? (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-sm font-medium text-slate-800">Documenti da verificare</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {model.corpus.documentsToVerify.map((document) => (
                  <li key={document.id}>{document.name}: {document.status === "OCR_REQUIRED" ? "OCR necessario" : document.status === "EXTRACTION_FAILED" ? "Estrazione non riuscita" : document.status === "NO_CURRENT_VERSION" ? "Versione corrente assente" : "Testo non ancora estratto"}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-600">Il corpus contiene evidenze documentali e riferimenti di pagina; non rappresenta ancora fatti o valutazioni giuridiche ricostruiti.</p>
        </section>
      ) : null}

      {!hasStructuredAnalysis ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">L’analisi strutturata del fascicolo non è ancora disponibile.</p>
          <p className="mt-1 text-sm text-slate-600">I documenti e i dati presenti nel fascicolo restano consultabili nelle rispettive sezioni.</p>
        </div>
      ) : (
        <>
          {optionalText(model.analysisStatus) ? (
            <section aria-labelledby="analysis-status-title" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <h3 id="analysis-status-title" className="text-xs font-semibold uppercase text-slate-600">Stato dell’analisi</h3>
              <p className="mt-1 text-sm text-slate-900">{model.analysisStatus}</p>
            </section>
          ) : null}

          {model.questions.length > 0 ? (
            <section aria-labelledby="analysis-questions-title">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-[#0b7285]" aria-hidden="true" />
                <h3 id="analysis-questions-title" className="text-base font-semibold text-slate-950">Questioni principali</h3>
              </div>
              <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
                {model.questions.map((question) => (
                  <article key={question.id} className="min-w-0 rounded-md border border-slate-200 p-4">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <h4 className="min-w-0 font-semibold text-slate-950 [overflow-wrap:anywhere]">{question.title}</h4>
                      {optionalText(question.status) ? <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{question.status}</span> : null}
                    </div>
                    {optionalText(question.description) ? <p className="mt-2 text-sm leading-6 text-slate-700">{question.description}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      <Meta label="Tema" value={question.area} />
                      <Meta label="Rilevanza" value={question.relevance} />
                    </div>
                    {question.evidence && question.evidence.length > 0 ? (
                      <p className="mt-3 text-xs text-slate-600"><span className="font-medium text-slate-700">Elementi collegati:</span> {question.evidence.join(" · ")}</p>
                    ) : null}
                    {question.href ? <Link href={question.href} prefetch={false} className="mt-3 inline-flex text-sm font-medium text-[#0b7285] underline underline-offset-4">Apri dettaglio</Link> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {model.evidence.length > 0 ? (
            <section aria-labelledby="analysis-evidence-title" className="border-t border-slate-200 pt-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <h3 id="analysis-evidence-title" className="text-base font-semibold text-slate-950">Elementi disponibili</h3>
              </div>
              <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                {model.evidence.map((item) => (
                  <li key={item.id} className="flex min-w-0 gap-3 rounded-md bg-slate-50 px-3 py-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    <div className="min-w-0">
                      {item.href ? <Link href={item.href} prefetch={false} className="font-medium text-slate-900 underline underline-offset-4 [overflow-wrap:anywhere]">{item.title}</Link> : <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{item.title}</p>}
                      {optionalText(item.detail) ? <p className="mt-1 text-xs text-slate-600">{item.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="analysis-contradictions-title" className="border-t border-slate-200 pt-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <h3 id="analysis-contradictions-title" className="text-base font-semibold text-slate-950">Contraddizioni</h3>
            </div>
            {model.contradictions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Nessuna contraddizione rilevata nei dati strutturati.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {model.contradictions.map((item) => (
                  <article key={item.id} className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm text-amber-950">{item.description}</p>
                    {item.involved && item.involved.length > 0 ? <p className="mt-2 text-xs text-amber-900">Elementi coinvolti: {item.involved.join(" · ")}</p> : null}
                    {optionalText(item.status) ? <p className="mt-1 text-xs font-medium text-amber-900">{item.status}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          {model.gaps.length > 0 ? (
            <section aria-labelledby="analysis-gaps-title" className="border-t border-slate-200 pt-5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-rose-700" aria-hidden="true" />
                <h3 id="analysis-gaps-title" className="text-base font-semibold text-slate-950">Informazioni mancanti</h3>
              </div>
              <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
                {model.gaps.map((gap) => (
                  <article key={gap.id} className="min-w-0 rounded-md border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{gap.title}</h4>
                      {optionalText(gap.status) ? <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{gap.status}</span> : null}
                    </div>
                    {optionalText(gap.relevance) ? <p className="mt-2 text-sm leading-6 text-slate-700">{gap.relevance}</p> : null}
                    <Meta label="Dato o documento richiesto" value={gap.requestedItem} />
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {model.relevantItems.length > 0 ? (
            <section aria-labelledby="analysis-relevant-title" className="border-t border-slate-200 pt-5">
              <h3 id="analysis-relevant-title" className="text-base font-semibold text-slate-950">Elementi rilevanti</h3>
              <ul className="mt-3 space-y-2">
                {model.relevantItems.slice(0, 5).map((item) => (
                  <li key={item.id} className="min-w-0 rounded-md bg-slate-50 px-3 py-3">
                    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                      {item.href ? <Link href={item.href} prefetch={false} className="font-medium text-slate-900 underline underline-offset-4 [overflow-wrap:anywhere]">{item.title}</Link> : <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{item.title}</p>}
                      {optionalText(item.detail) ? <span className="text-xs text-slate-500">{item.detail}</span> : null}
                    </div>
                    {optionalText(item.description) ? <p className="mt-1 text-sm text-slate-700">{item.description}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}