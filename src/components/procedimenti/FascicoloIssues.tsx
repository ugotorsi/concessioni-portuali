import Link from "next/link";
import { AlertCircle, AlertTriangle, CircleDot, Info } from "lucide-react";

export type FascicoloIssueSeverity = "BASSA" | "MEDIA" | "ALTA" | "URGENTE";
export type FascicoloIssueStatus = "APERTA" | "IN_GESTIONE" | "RISOLTA" | "ARCHIVIATA";

export interface FascicoloIssueLink {
  label: string;
  href: string;
}

export interface FascicoloIssue {
  id: string;
  type: string;
  description?: string | null;
  severity: FascicoloIssueSeverity;
  status: FascicoloIssueStatus;
  detectedAt?: string | null;
  normativeReference?: string | null;
  origin?: string | null;
  links?: readonly FascicoloIssueLink[];
}

export interface FascicoloIssuesModel {
  issues: readonly FascicoloIssue[];
}

export function fascicoloIssueSeverityLabel(severity: FascicoloIssueSeverity): string {
  switch (severity) {
    case "BASSA": return "Bassa";
    case "MEDIA": return "Media";
    case "ALTA": return "Alta";
    case "URGENTE": return "Urgente";
  }
}

export function fascicoloIssueStatusLabel(status: FascicoloIssueStatus): string {
  switch (status) {
    case "APERTA": return "Aperta";
    case "IN_GESTIONE": return "In gestione";
    case "RISOLTA": return "Risolta";
    case "ARCHIVIATA": return "Archiviata";
  }
}

function present(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

const severityTone: Record<FascicoloIssueSeverity, string> = {
  BASSA: "border-slate-200 bg-slate-100 text-slate-700",
  MEDIA: "border-amber-200 bg-amber-50 text-amber-800",
  ALTA: "border-orange-200 bg-orange-50 text-orange-800",
  URGENTE: "border-rose-200 bg-rose-50 text-rose-800",
};

const statusTone: Record<FascicoloIssueStatus, string> = {
  APERTA: "border-sky-200 bg-sky-50 text-sky-800",
  IN_GESTIONE: "border-amber-200 bg-amber-50 text-amber-800",
  RISOLTA: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ARCHIVIATA: "border-slate-200 bg-slate-100 text-slate-700",
};

function IssueCard({ issue }: { issue: FascicoloIssue }) {
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{issue.type}</h4>
          {present(issue.detectedAt) ? <p className="mt-1 text-xs text-slate-500">Rilevata il {issue.detectedAt}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${severityTone[issue.severity]}`}>
            {fascicoloIssueSeverityLabel(issue.severity)}
          </span>
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusTone[issue.status]}`}>
            {fascicoloIssueStatusLabel(issue.status)}
          </span>
        </div>
      </div>

      {present(issue.description) ? <p className="mt-4 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">{issue.description}</p> : null}

      <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {present(issue.normativeReference) ? (
          <div>
            <dt className="sr-only">Riferimento normativo</dt>
            <dd className="text-slate-700"><span className="font-medium text-slate-900">Riferimento:</span> {issue.normativeReference}</dd>
          </div>
        ) : null}
        {present(issue.origin) ? <div><dt className="text-xs text-slate-500">Origine</dt><dd className="mt-0.5 text-slate-800">{issue.origin}</dd></div> : null}
      </dl>

      {issue.links?.length ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-3">
          {issue.links.map((link) => (
            <Link key={`${link.href}-${link.label}`} href={link.href} prefetch={false} className="text-sm font-medium text-[#075985] underline underline-offset-4">
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}

const groups: readonly Readonly<{
  severity: FascicoloIssueSeverity;
  title: string;
  icon: typeof AlertCircle;
  iconClassName: string;
}>[] = [
  { severity: "URGENTE", title: "Urgenti", icon: AlertCircle, iconClassName: "text-rose-700" },
  { severity: "ALTA", title: "Alte", icon: AlertTriangle, iconClassName: "text-orange-700" },
  { severity: "MEDIA", title: "Medie", icon: CircleDot, iconClassName: "text-amber-700" },
  { severity: "BASSA", title: "Basse", icon: Info, iconClassName: "text-slate-600" },
];

export function FascicoloIssues({ model }: { model: FascicoloIssuesModel }) {
  const openCount = model.issues.filter((issue) => issue.status === "APERTA" || issue.status === "IN_GESTIONE").length;
  const highCount = model.issues.filter((issue) => issue.severity === "ALTA" || issue.severity === "URGENTE").length;
  const closedCount = model.issues.filter((issue) => issue.status === "RISOLTA" || issue.status === "ARCHIVIATA").length;

  return (
    <section aria-labelledby="issues-title" className="min-w-0 space-y-6" data-testid="fascicolo-issues">
      <header className="border-b border-slate-200 pb-4">
        <h2 id="issues-title" className="text-xl font-semibold text-slate-950">Criticità</h2>
        <p className="mt-1 text-sm text-slate-600">Problemi, anomalie e profili da presidiare nel fascicolo.</p>
        {model.issues.length > 0 ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="inline text-slate-500">Aperte </dt><dd className="inline font-semibold text-slate-950">{openCount}</dd></div>
            <div><dt className="inline text-slate-500">Alte / urgenti </dt><dd className="inline font-semibold text-slate-950">{highCount}</dd></div>
            <div><dt className="inline text-slate-500">Chiuse </dt><dd className="inline font-semibold text-slate-950">{closedCount}</dd></div>
          </dl>
        ) : null}
      </header>

      {model.issues.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">Non risultano criticità strutturate per questo fascicolo.</p>
        </div>
      ) : groups.map((group) => {
        const issues = model.issues.filter((issue) => issue.severity === group.severity);
        if (issues.length === 0) return null;
        const Icon = group.icon;
        return (
          <section key={group.severity} aria-labelledby={`issue-group-${group.severity.toLowerCase()}`}>
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${group.iconClassName}`} aria-hidden="true" />
              <h3 id={`issue-group-${group.severity.toLowerCase()}`} className="text-base font-semibold text-slate-950">{group.title}</h3>
            </div>
            <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
              {issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
            </div>
          </section>
        );
      })}
    </section>
  );
}