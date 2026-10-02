import Link from "next/link";
import { BookOpen, CheckCircle2, CircleHelp, Scale } from "lucide-react";

export type ResearchSupportDirection = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";
export type ResearchSourceUsability = "USABLE" | "TO_VERIFY" | "NOT_USABLE";

export interface FascicoloResearchSource {
  id: string;
  questionId?: string | null;
  authority?: string | null;
  sourceType?: string | null;
  identifier?: string | null;
  date?: string | null;
  title?: string | null;
  origin?: string | null;
  href?: string | null;
  verificationStatus?: string | null;
  note?: string | null;
  direction?: ResearchSupportDirection | null;
  usability?: ResearchSourceUsability | null;
}

export interface FascicoloResearchQuestionVersion {
  id: string;
  date?: string | null;
  status?: string | null;
  change?: string | null;
}

export interface FascicoloResearchQuestion {
  id: string;
  text: string;
  theme?: string | null;
  status?: string | null;
  referenceDate?: string | null;
  coverage?: string | null;
  coveredAspects?: readonly string[];
  gaps?: readonly string[];
  needsFurtherResearch?: boolean;
  versions?: readonly FascicoloResearchQuestionVersion[];
}

export interface FascicoloResearchModel {
  questions: readonly FascicoloResearchQuestion[];
  sources: readonly FascicoloResearchSource[];
}

export function researchDirectionLabel(value: ResearchSupportDirection): string {
  switch (value) {
    case "SUPPORTS": return "Favorevole";
    case "OPPOSES": return "Contraria";
    case "NEUTRAL": return "Neutrale";
    case "INCONCLUSIVE": return "Non conclusiva";
    case "UNASSESSED": return "Da valutare";
  }
}

export function researchUsabilityLabel(value: ResearchSourceUsability): string {
  switch (value) {
    case "USABLE": return "Utilizzabile";
    case "TO_VERIFY": return "Da verificare";
    case "NOT_USABLE": return "Non utilizzabile allo stato";
  }
}

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function SourceCard({ source }: { source: FascicoloResearchSource }) {
  const title = text(source.title) ?? text(source.identifier) ?? "Fonte collegata";

  return (
    <article className="min-w-0 rounded-md border border-slate-200 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {source.href ? (
            <Link href={source.href} prefetch={false} className="font-semibold text-slate-950 underline underline-offset-4 [overflow-wrap:anywhere]">{title}</Link>
          ) : (
            <h5 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{title}</h5>
          )}
          {text(source.authority) ? <p className="mt-1 text-sm text-slate-600">{source.authority}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {source.direction ? <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{researchDirectionLabel(source.direction)}</span> : null}
          {source.usability ? <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800">{researchUsabilityLabel(source.usability)}</span> : null}
        </div>
      </div>
      <dl className="mt-3 grid min-w-0 gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
        {text(source.sourceType) ? <div><dt className="text-slate-500">Tipo</dt><dd className="mt-0.5 text-slate-800">{source.sourceType}</dd></div> : null}
        {text(source.identifier) && source.identifier !== title ? <div><dt className="text-slate-500">Identificativo</dt><dd className="mt-0.5 text-slate-800 [overflow-wrap:anywhere]">{source.identifier}</dd></div> : null}
        {text(source.date) ? <div><dt className="text-slate-500">Data</dt><dd className="mt-0.5 text-slate-800">{source.date}</dd></div> : null}
        {text(source.origin) ? <div><dt className="text-slate-500">Provenienza</dt><dd className="mt-0.5 text-slate-800">{source.origin}</dd></div> : null}
      </dl>
      {text(source.verificationStatus) ? <p className="mt-3 text-xs text-slate-600">{source.verificationStatus}</p> : null}
      {text(source.note) ? <p className="mt-2 text-sm text-slate-700">{source.note}</p> : null}
    </article>
  );
}

function Sources({ sources }: { sources: readonly FascicoloResearchSource[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-slate-600">Il quesito è presente, ma non risultano ancora fonti acquisite.</p>;
  }

  return <div className="grid min-w-0 gap-3 lg:grid-cols-2">{sources.map((source) => <SourceCard key={source.id} source={source} />)}</div>;
}

export function FascicoloResearch({ model }: { model: FascicoloResearchModel }) {
  const questionIds = new Set(model.questions.map((question) => question.id));
  const unlinkedSources = model.sources.filter((source) => !source.questionId || !questionIds.has(source.questionId));
  const usableCount = model.sources.filter((source) => source.usability === "USABLE").length;
  const toDeepenCount = model.questions.filter((question) => question.needsFurtherResearch === true).length;
  const hasUsabilityData = model.sources.some((source) => source.usability);
  const hasIndicators = model.questions.length > 0 || hasUsabilityData;
  const hasStructuredResearch = model.questions.length > 0;

  return (
    <section aria-labelledby="research-title" className="min-w-0 space-y-6" data-testid="fascicolo-research">
      <header className="border-b border-slate-200 pb-4">
        <h2 id="research-title" className="text-xl font-semibold text-slate-950">Ricerca</h2>
        <p className="mt-1 text-sm text-slate-600">Quesiti giuridici, fonti e stato degli approfondimenti.</p>
        {hasIndicators ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="inline text-slate-500">Quesiti </dt><dd className="inline font-semibold text-slate-950">{model.questions.length}</dd></div>
            {hasUsabilityData ? <div><dt className="inline text-slate-500">Fonti utilizzabili </dt><dd className="inline font-semibold text-slate-950">{usableCount}</dd></div> : null}
            <div><dt className="inline text-slate-500">Da approfondire </dt><dd className="inline font-semibold text-slate-950">{toDeepenCount}</dd></div>
          </dl>
        ) : null}
      </header>

      {!hasStructuredResearch ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">Non risultano ancora approfondimenti giuridici strutturati per questo fascicolo.</p>
        </div>
      ) : (
        <section aria-labelledby="research-questions-title">
          <div className="flex items-center gap-2">
            <CircleHelp className="h-4 w-4 text-[#0b7285]" aria-hidden="true" />
            <h3 id="research-questions-title" className="text-base font-semibold text-slate-950">Quesiti di ricerca</h3>
          </div>
          <div className="mt-3 space-y-4">
            {model.questions.map((question) => {
              const sources = model.sources.filter((source) => source.questionId === question.id);
              return (
                <article key={question.id} className="min-w-0 rounded-md border border-slate-200 p-4">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <h4 className="min-w-0 font-semibold leading-6 text-slate-950 [overflow-wrap:anywhere]">{question.text}</h4>
                    {text(question.status) ? <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{question.status}</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                    {text(question.theme) ? <span><span className="font-medium text-slate-700">Tema:</span> {question.theme}</span> : null}
                    {text(question.referenceDate) ? <span><span className="font-medium text-slate-700">Riferimento temporale:</span> {question.referenceDate}</span> : null}
                  </div>

                  {text(question.coverage) || question.coveredAspects?.length || question.gaps?.length ? (
                    <section aria-label="Copertura della ricerca" className="mt-4 rounded-md bg-slate-50 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                        <h5 className="text-sm font-semibold text-slate-900">Copertura della ricerca</h5>
                      </div>
                      {text(question.coverage) ? <p className="mt-2 text-sm text-slate-700">{question.coverage}</p> : null}
                      {question.coveredAspects && question.coveredAspects.length > 0 ? <p className="mt-2 text-xs text-slate-600"><span className="font-medium text-slate-700">Aspetti coperti:</span> {question.coveredAspects.join(" · ")}</p> : null}
                      {question.gaps && question.gaps.length > 0 ? <p className="mt-1 text-xs text-slate-600"><span className="font-medium text-slate-700">Aspetti da approfondire:</span> {question.gaps.join(" · ")}</p> : null}
                    </section>
                  ) : null}

                  <section aria-label="Fonti rilevanti" className="mt-5 border-t border-slate-200 pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Scale className="h-4 w-4 text-slate-600" aria-hidden="true" />
                      <h5 className="text-sm font-semibold text-slate-900">Fonti rilevanti</h5>
                    </div>
                    <Sources sources={sources} />
                  </section>

                  {question.versions && question.versions.length > 0 ? (
                    <details className="mt-4 border-t border-slate-200 pt-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-800">Versioni precedenti</summary>
                      <ul className="mt-2 space-y-2">
                        {question.versions.map((version) => (
                          <li key={version.id} className="flex flex-wrap gap-x-3 text-xs text-slate-600">
                            {text(version.date) ? <span>{version.date}</span> : null}
                            {text(version.status) ? <span>{version.status}</span> : null}
                            {text(version.change) ? <span>{version.change}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {unlinkedSources.length > 0 ? (
        <section aria-labelledby="research-sources-title" className="border-t border-slate-200 pt-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#0b7285]" aria-hidden="true" />
            <h3 id="research-sources-title" className="text-base font-semibold text-slate-950">Fonti rilevanti</h3>
          </div>
          <div className="mt-3"><Sources sources={unlinkedSources} /></div>
        </section>
      ) : null}
    </section>
  );
}