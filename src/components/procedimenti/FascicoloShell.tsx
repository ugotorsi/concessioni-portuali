import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";

export const FASCICOLO_SECTIONS = [
  ["overview", "Panoramica"],
  ["documents", "Documenti"],
  ["timeline", "Cronologia"],
  ["subjects", "Soggetti"],
  ["concession", "Concessione"],
  ["analysis", "Analisi"],
  ["research", "Ricerca"],
  ["deadlines", "Scadenze"],
  ["issues", "Criticità"],
  ["reports", "Rapporto"],
  ["proposals", "Proposte"],
] as const;

export type FascicoloSection = (typeof FASCICOLO_SECTIONS)[number][0] | "istruttoria" | "decisione";

export function resolveFascicoloSection(value: string | string[] | undefined): FascicoloSection {
  const section = Array.isArray(value) ? value[0] : value;
  return [...FASCICOLO_SECTIONS.map(([key]) => key), "istruttoria", "decisione"].includes(section as FascicoloSection)
    ? section as FascicoloSection
    : "overview";
}

export interface FascicoloOverviewModel {
  title: string;
  status: string;
  type?: string | null;
  reference?: string | null;
  administration?: string | null;
  subject?: string | null;
  lastUpdated: string;
  phase?: string | null;
  checklist?: {
    completed: number;
    total: number;
  };
  attention: ReadonlyArray<{ label: string; section: FascicoloSection }>;
  documents: ReadonlyArray<{
    id: string;
    name: string;
    type: string;
    date: string;
    isFileAvailable: boolean;
    href: string;
  }>;
  documentCount: number;
  openIssueCount: number;
  criticalPaymentCount: number;
  deadlines: ReadonlyArray<{
    id: string;
    date: string;
    label: string;
    status: string;
  }>;
  concession: {
    number?: string | null;
    authority?: string | null;
    object?: string | null;
    startDate?: string | null;
    expiryDate?: string | null;
    location?: string | null;
    incomplete: boolean;
  };
  subjects: ReadonlyArray<{
    name: string;
    role: string;
  }>;
  nextStep?: {
    label: string;
    section: FascicoloSection;
  };
}

interface FascicoloShellProps {
  model: FascicoloOverviewModel;
  basePath: string;
  activeSection: FascicoloSection;
  availableSections?: readonly FascicoloSection[];
  notice?: ReactNode;
  children: ReactNode;
}

function sectionHref(basePath: string, section: FascicoloSection): string {
  return section === "overview" ? basePath : `${basePath}?section=${section}`;
}

function SectionLink({
  basePath,
  section,
  children,
}: {
  basePath: string;
  section: FascicoloSection;
  children: ReactNode;
}) {
  return (
    <Link
      href={sectionHref(basePath, section)}
      className="text-sm font-semibold text-[#173d4f] underline decoration-slate-300 underline-offset-4 hover:decoration-[#173d4f]"
    >
      {children}
    </Link>
  );
}

function FascicoloNav({ basePath, activeSection, availableSections }: Pick<FascicoloShellProps, "basePath" | "activeSection" | "availableSections">) {
  return (
    <nav
      aria-label="Navigazione del fascicolo"
      className="sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-slate-200 bg-white/95 px-4 backdrop-blur sm:mx-0 sm:rounded-md sm:border"
    >
      <div className="flex min-w-max items-center gap-1 py-1.5">
        {FASCICOLO_SECTIONS.map(([section, label]) => {
          const available = !availableSections || availableSections.includes(section);
          return available ? (
            <Link key={section} href={sectionHref(basePath, section)} aria-current={activeSection === section ? "page" : undefined} className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 aria-[current=page]:bg-slate-100 aria-[current=page]:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
              {label}
            </Link>
          ) : (
            <span key={section} aria-disabled="true" className="inline-flex min-h-9 items-center px-3 text-sm text-slate-400">
              {label}
            </span>
          );
        })}
      </div>
    </nav>
  );
}

export function FascicoloOverview({ model, basePath }: { model: FascicoloOverviewModel; basePath: string }) {
  const documents = model.documents.slice(0, 3);
  const attention = model.attention.slice(0, 5);
  const deadlines = model.deadlines.slice(0, 5);
  const concessionDetails = [
    ["Numero / titolo", model.concession.number],
    ["Ente concedente", model.concession.authority],
    ["Oggetto", model.concession.object],
    ["Decorrenza", model.concession.startDate],
    ["Scadenza", model.concession.expiryDate],
    ["Località", model.concession.location],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <section id="panoramica" aria-labelledby="panoramica-title" className="scroll-mt-16 space-y-5">
      <h2 id="panoramica-title" className="sr-only">Panoramica</h2>

      <section aria-label="Identità del fascicolo" className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{model.status}</Badge>
          {model.type ? <span className="text-sm text-slate-700">{model.type}</span> : null}
          {model.reference ? <span className="text-sm font-semibold text-slate-950">{model.reference}</span> : null}
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {model.administration ? <div><dt className="text-xs font-medium text-slate-500">Ente / amministrazione</dt><dd className="mt-1 text-slate-950">{model.administration}</dd></div> : null}
          {model.subject ? <div><dt className="text-xs font-medium text-slate-500">Soggetto principale</dt><dd className="mt-1 text-slate-950">{model.subject}</dd></div> : null}
          <div><dt className="text-xs font-medium text-slate-500">Ultima modifica</dt><dd className="mt-1 text-slate-950">{model.lastUpdated}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="stato-fascicolo-title" className="rounded-md border border-slate-200 bg-white p-5">
        <h3 id="stato-fascicolo-title" className="text-base font-semibold text-slate-950">Stato del fascicolo</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-xs font-medium text-slate-500">Stato</dt><dd className="mt-1 text-sm font-semibold text-slate-950">{model.status}</dd></div>
          {model.phase ? <div><dt className="text-xs font-medium text-slate-500">Fase</dt><dd className="mt-1 text-sm text-slate-950">{model.phase}</dd></div> : null}
          {model.checklist ? <div><dt className="text-xs font-medium text-slate-500">Checklist</dt><dd className="mt-1 text-sm text-slate-950">{model.checklist.completed} di {model.checklist.total} attività completate</dd></div> : null}
          <div><dt className="text-xs font-medium text-slate-500">Documenti</dt><dd className="mt-1 text-sm text-slate-950">{model.documentCount}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Criticità aperte</dt><dd className="mt-1 text-sm text-slate-950">{model.openIssueCount}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Pagamenti da verificare</dt><dd className="mt-1 text-sm text-slate-950">{model.criticalPaymentCount}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="attenzione-title" className="rounded-md border border-amber-200 bg-amber-50 p-5">
        <h3 id="attenzione-title" className="text-base font-semibold text-amber-950">Richiede attenzione</h3>
        {attention.length > 0 ? (
          <ul className="mt-3 grid gap-2 text-sm text-amber-950 md:grid-cols-2">
            {attention.map((item) => (
              <li key={`${item.label}-${item.section}`}>
                <Link href={sectionHref(basePath, item.section)} className="font-medium underline underline-offset-4">{item.label}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-amber-900">Nessuna priorità immediata rilevata.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="scadenze-sintesi-title" className="rounded-md border border-slate-200 bg-white p-5">
          <h3 id="scadenze-sintesi-title" className="text-base font-semibold text-slate-950">Prossime scadenze</h3>
          {deadlines.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-200">
              {deadlines.map((deadline) => (
                <li key={deadline.id} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                  <span><span className="block text-sm font-medium text-slate-950">{deadline.label}</span><span className="text-xs text-slate-500">{deadline.status}</span></span>
                  <time className="shrink-0 text-sm font-medium text-slate-700">{deadline.date}</time>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">Nessuna scadenza imminente.</p>}
          <div className="mt-3"><SectionLink basePath={basePath} section="deadlines">Vedi scadenze</SectionLink></div>
        </section>

        <section aria-labelledby="concessione-sintesi-title" className="rounded-md border border-slate-200 bg-white p-5">
          <h3 id="concessione-sintesi-title" className="text-base font-semibold text-slate-950">Concessione / titolo</h3>
          {concessionDetails.length > 0 ? (
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {concessionDetails.map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-950">{value}</dd></div>)}
            </dl>
          ) : <p className="mt-3 text-sm text-slate-500">Dati concessione da completare.</p>}
          {model.concession.incomplete ? <p className="mt-3 text-sm text-amber-800">Dati da completare</p> : null}
          <div className="mt-3"><SectionLink basePath={basePath} section="concession">{model.concession.incomplete ? "Completa concessione" : "Vedi concessione"}</SectionLink></div>
        </section>

        <section aria-labelledby="soggetti-sintesi-title" className="rounded-md border border-slate-200 bg-white p-5">
          <h3 id="soggetti-sintesi-title" className="text-base font-semibold text-slate-950">Soggetti principali</h3>
          {model.subjects.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {model.subjects.slice(0, 3).map((subject) => <li key={`${subject.name}-${subject.role}`}><span className="block text-sm font-medium text-slate-950">{subject.name}</span><span className="text-xs text-slate-500">{subject.role}</span></li>)}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">Nessun soggetto disponibile.</p>}
          <div className="mt-3"><SectionLink basePath={basePath} section="subjects">Vedi soggetti</SectionLink></div>
        </section>

        <section aria-labelledby="documenti-sintesi-title" className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 id="documenti-sintesi-title" className="text-base font-semibold text-slate-950">Documenti</h3>
            <span className="text-sm text-slate-500">{model.documentCount}</span>
          </div>
          {documents.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-200">
              {documents.map((document) => (
                <li key={document.id} className="flex min-w-0 items-center gap-3 py-2 first:pt-0">
                  <FileText className="h-4 w-4 shrink-0 text-[#173d4f]" aria-hidden="true" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-950">{document.name}</span><span className="text-xs text-slate-500">{document.type} · {document.date}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">Nessun documento disponibile.</p>}
          <div className="mt-3"><SectionLink basePath={basePath} section="documents">Apri documenti</SectionLink></div>
        </section>
      </div>

      {model.nextStep ? (
        <section aria-labelledby="prossimo-passo-title" className="rounded-md border border-cyan-200 bg-cyan-50 p-5">
          <h3 id="prossimo-passo-title" className="text-base font-semibold text-slate-950">Prossimo passo</h3>
          <p className="mt-2 text-sm text-slate-700">{model.nextStep.label}</p>
          <div className="mt-3"><SectionLink basePath={basePath} section={model.nextStep.section}>Vai alla sezione</SectionLink></div>
        </section>
      ) : null}
    </section>
  );
}

export function FascicoloShell({ model, basePath, activeSection, availableSections, notice, children }: FascicoloShellProps) {
  return (
    <AppShell title={model.title} subtitle="Workspace del fascicolo">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/procedimenti" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Torna ai fascicoli
          </Link>
        </div>
        {notice}
        <FascicoloNav basePath={basePath} activeSection={activeSection} availableSections={availableSections} />
        {activeSection === "overview" ? <FascicoloOverview model={model} basePath={basePath} /> : null}
        {activeSection === "overview" ? (
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Altre funzioni</summary>
            <div className="mt-2 flex flex-wrap gap-4 border-t border-slate-200 pt-2 text-sm">
              <Link href={sectionHref(basePath, "istruttoria")} className="font-medium text-[#173d4f] underline underline-offset-4">Istruttoria</Link>
              <Link href={sectionHref(basePath, "decisione")} className="font-medium text-[#173d4f] underline underline-offset-4">Decisione</Link>
            </div>
          </details>
        ) : null}
        {activeSection === "overview" ? null : children}
      </div>
    </AppShell>
  );
}
