import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";

const NAV_ITEMS = [
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

type FascicoloSection = (typeof NAV_ITEMS)[number][0];

export interface FascicoloOverviewModel {
  title: string;
  status: string;
  type?: string | null;
  concession?: string | null;
  subject?: string | null;
  priorityDeadline?: string | null;
  summary: ReadonlyArray<{
    label: string;
    value: string | null | undefined;
    sectionId?: "soggetti" | "concessione";
  }>;
  attention: ReadonlyArray<{ label: string; href?: `#${string}` }>;
  documents: ReadonlyArray<{
    id: string;
    name: string;
    type: string;
    date: string;
    href: string;
  }>;
  documentCount: number;
  timeline?: ReadonlyArray<{ id: string; label: string; date: string }>;
  openIssues?: ReadonlyArray<{ id: string; label: string; detail?: string; href?: `#${string}` }>;
  nextDeadline?: string | null;
  openIssueCount?: number;
  highestIssue?: string | null;
}

interface FascicoloShellProps {
  model: FascicoloOverviewModel;
  sectionTargets: Partial<Record<FascicoloSection, `#${string}`>>;
  secondaryLinks?: ReadonlyArray<{ label: string; href: `#${string}` }>;
  notice?: ReactNode;
  children: ReactNode;
}

function FascicoloNav({ targets }: { targets: FascicoloShellProps["sectionTargets"] }) {
  return (
    <nav
      aria-label="Navigazione del fascicolo"
      className="sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-slate-200 bg-white/95 px-4 backdrop-blur sm:mx-0 sm:rounded-md sm:border"
    >
      <div className="flex min-w-max items-center gap-1 py-1.5">
        {NAV_ITEMS.map(([section, label]) => {
          const href = targets[section];
          return href ? (
            <Link key={section} href={href} className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
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

function FascicoloOverview({ model }: { model: FascicoloOverviewModel }) {
  const summary = model.summary.filter((item) => item.value);
  const documents = model.documents.slice(0, 3);
  const attention = model.attention.slice(0, 5);
  const issues = model.openIssues?.slice(0, 3) ?? [];

  return (
    <section id="panoramica" aria-labelledby="panoramica-title" className="scroll-mt-16 space-y-4">
      <h2 id="panoramica-title" className="sr-only">Panoramica</h2>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 pb-4 text-sm text-slate-700">
        <Badge>{model.status}</Badge>
        {model.type ? <span>{model.type}</span> : null}
        {model.concession ? <span className="font-medium text-slate-900">{model.concession}</span> : null}
        {model.subject ? <span>{model.subject}</span> : null}
        {model.priorityDeadline ? <span>Scadenza: {model.priorityDeadline}</span> : null}
      </div>

      <section aria-labelledby="attenzione-title" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <h3 id="attenzione-title" className="text-sm font-semibold text-amber-950">Richiede attenzione</h3>
        {attention.length > 0 ? (
          <ul className="mt-2 grid gap-1.5 text-sm text-amber-950 md:grid-cols-2">
            {attention.map((item) => (
              <li key={`${item.label}-${item.href ?? "none"}`}>
                {item.href ? <Link href={item.href} className="underline underline-offset-4">{item.label}</Link> : item.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-amber-900">Nessuna priorità immediata rilevata.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="sintesi-title" className="rounded-md border border-slate-200 p-4">
          <h3 id="sintesi-title" className="text-base font-semibold text-slate-950">Sintesi del fascicolo</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {summary.map((item) => (
              <div key={item.label} id={item.sectionId} className="min-w-0 scroll-mt-16">
                <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900 [overflow-wrap:anywhere]">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="documenti-sintesi-title" className="rounded-md border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id="documenti-sintesi-title" className="text-base font-semibold text-slate-950">Documenti</h3>
            <span className="text-sm text-slate-500">{model.documentCount}</span>
          </div>
          {documents.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-200">
              {documents.map((document) => (
                <li key={document.id} className="flex min-w-0 items-center gap-3 py-2 first:pt-0">
                  <FileText className="h-4 w-4 shrink-0 text-[#173d4f]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <a href={document.href} className="block truncate text-sm font-medium text-slate-950 underline-offset-4 hover:underline">{document.name}</a>
                    <p className="text-xs text-slate-500">{document.type} · {document.date}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">Nessun documento presente.</p>}
          <Link href="#documenti" className="mt-3 inline-flex text-sm font-semibold text-[#173d4f] underline underline-offset-4">Vedi tutti i documenti</Link>
        </section>

        {model.timeline ? (
          <section id="cronologia" aria-labelledby="cronologia-title" className="scroll-mt-16 rounded-md border border-slate-200 p-4">
            <h3 id="cronologia-title" className="text-base font-semibold text-slate-950">Cronologia recente</h3>
            {model.timeline.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {model.timeline.slice(0, 5).map((item) => <li key={item.id}><span className="font-medium text-slate-950">{item.date}</span> · {item.label}</li>)}
              </ul>
            ) : <p className="mt-2 text-sm text-slate-500">Cronologia non ancora disponibile.</p>}
          </section>
        ) : null}

        {(issues.length > 0 || model.nextDeadline || typeof model.openIssueCount === "number") ? (
          <section aria-labelledby="questioni-title" className="rounded-md border border-slate-200 p-4">
            <h3 id="questioni-title" className="text-base font-semibold text-slate-950">Questioni aperte</h3>
            {issues.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {issues.map((item) => <li key={item.id}>{item.href ? <Link href={item.href} className="font-medium text-slate-950 underline underline-offset-4">{item.label}</Link> : <span className="font-medium text-slate-950">{item.label}</span>}{item.detail ? `: ${item.detail}` : ""}</li>)}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
              {model.nextDeadline ? <span>Prossima scadenza: <strong>{model.nextDeadline}</strong></span> : null}
              {typeof model.openIssueCount === "number" ? <span>Criticità aperte: <strong>{model.openIssueCount}</strong></span> : null}
              {model.highestIssue ? <span>Più grave: <strong>{model.highestIssue}</strong></span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold text-[#173d4f]">
              {model.nextDeadline ? <Link href="#scadenze" className="underline underline-offset-4">Vedi scadenze</Link> : null}
              {typeof model.openIssueCount === "number" ? <Link href="#criticita" className="underline underline-offset-4">Vedi criticità</Link> : null}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function FascicoloShell({ model, sectionTargets, secondaryLinks = [], notice, children }: FascicoloShellProps) {
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
        <FascicoloNav targets={sectionTargets} />
        <FascicoloOverview model={model} />
        {secondaryLinks.length > 0 ? (
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Altre funzioni</summary>
            <div className="mt-2 flex flex-wrap gap-4 border-t border-slate-200 pt-2 text-sm">
              {secondaryLinks.map((link) => <Link key={link.href} href={link.href} className="font-medium text-[#173d4f] underline underline-offset-4">{link.label}</Link>)}
            </div>
          </details>
        ) : null}
        {children}
      </div>
    </AppShell>
  );
}