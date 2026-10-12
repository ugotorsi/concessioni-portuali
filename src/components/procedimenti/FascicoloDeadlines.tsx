import Link from "next/link";
import { AlertTriangle, CalendarDays, CircleCheck, Clock3 } from "lucide-react";

export type FascicoloDeadlineStatus = "APERTA" | "GESTITA" | "SCADUTA" | "ARCHIVIATA";
export type FascicoloDeadlineAttention = "EXPIRED" | "UPCOMING" | "NEXT" | "OTHER";

export interface FascicoloDeadlineLink {
  label: string;
  href: string;
}

export interface FascicoloDeadline {
  id: string;
  date: string;
  title?: string | null;
  description?: string | null;
  type?: string | null;
  status: FascicoloDeadlineStatus;
  attention?: FascicoloDeadlineAttention | null;
  normativeReference?: string | null;
  responsible?: string | null;
  notice?: string | null;
  origin?: string | null;
  links?: readonly FascicoloDeadlineLink[];
}

export interface FascicoloDeadlineCandidate {
  id: string;
  date?: string | null;
  title?: string | null;
  description?: string | null;
  type?: string | null;
  origin?: string | null;
  links?: readonly FascicoloDeadlineLink[];
}

export interface FascicoloDeadlinesModel {
  deadlines: readonly FascicoloDeadline[];
  candidates?: readonly FascicoloDeadlineCandidate[];
}

export function fascicoloDeadlineStatusLabel(status: FascicoloDeadlineStatus): string {
  switch (status) {
    case "APERTA": return "Aperta";
    case "GESTITA": return "Gestita";
    case "SCADUTA": return "Scaduta";
    case "ARCHIVIATA": return "Archiviata";
  }
}

function present(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

const statusTone: Record<FascicoloDeadlineStatus, string> = {
  APERTA: "border-sky-200 bg-sky-50 text-sky-800",
  GESTITA: "border-emerald-200 bg-emerald-50 text-emerald-800",
  SCADUTA: "border-rose-200 bg-rose-50 text-rose-800",
  ARCHIVIATA: "border-slate-200 bg-slate-100 text-slate-700",
};

function SafeLinks({ links }: { links: readonly FascicoloDeadlineLink[] | undefined }) {
  if (!links?.length) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-3">
      {links.map((link) => (
        <Link key={`${link.href}-${link.label}`} href={link.href} prefetch={false} className="text-sm font-medium text-[#075985] underline underline-offset-4">
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function DeadlineCard({ deadline }: { deadline: FascicoloDeadline }) {
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <time className="block text-2xl font-semibold leading-none text-slate-950">{deadline.date}</time>
          {present(deadline.title) ? <h4 className="mt-3 font-semibold text-slate-950 [overflow-wrap:anywhere]">{deadline.title}</h4> : null}
          {present(deadline.description) ? <p className="mt-1 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">{deadline.description}</p> : null}
        </div>
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusTone[deadline.status]}`}>
          {fascicoloDeadlineStatusLabel(deadline.status)}
        </span>
      </div>

      <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {present(deadline.type) ? <div><dt className="text-xs text-slate-500">Tipologia</dt><dd className="mt-0.5 text-slate-800">{deadline.type}</dd></div> : null}
        {present(deadline.normativeReference) ? <div><dt className="text-xs text-slate-500">Riferimento normativo</dt><dd className="mt-0.5 text-slate-800">{deadline.normativeReference}</dd></div> : null}
        {present(deadline.responsible) ? <div><dt className="text-xs text-slate-500">Responsabile</dt><dd className="mt-0.5 text-slate-800">{deadline.responsible}</dd></div> : null}
        {present(deadline.notice) ? <div><dt className="text-xs text-slate-500">Preavviso</dt><dd className="mt-0.5 text-slate-800">{deadline.notice}</dd></div> : null}
        {present(deadline.origin) ? <div><dt className="text-xs text-slate-500">Origine del termine</dt><dd className="mt-0.5 text-slate-800">{deadline.origin}</dd></div> : null}
      </dl>

      <SafeLinks links={deadline.links} />
    </article>
  );
}

function CandidateCard({ candidate }: { candidate: FascicoloDeadlineCandidate }) {
  return (
    <article className="min-w-0 rounded-md border border-amber-200 bg-amber-50/60 p-4">
      {present(candidate.date) ? <time className="block text-xl font-semibold text-slate-950">{candidate.date}</time> : null}
      {present(candidate.title) ? <h4 className="mt-2 font-semibold text-slate-950 [overflow-wrap:anywhere]">{candidate.title}</h4> : null}
      {present(candidate.description) ? <p className="mt-1 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">{candidate.description}</p> : null}
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {present(candidate.type) ? <div><dt className="text-xs text-slate-500">Tipologia proposta</dt><dd className="mt-0.5 text-slate-800">{candidate.type}</dd></div> : null}
        {present(candidate.origin) ? <div><dt className="text-xs text-slate-500">Origine</dt><dd className="mt-0.5 text-slate-800">{candidate.origin}</dd></div> : null}
      </dl>
      <SafeLinks links={candidate.links} />
    </article>
  );
}

const groups: readonly Readonly<{
  key: FascicoloDeadlineAttention;
  title: string;
  icon: typeof AlertTriangle;
  iconClassName: string;
}>[] = [
  { key: "EXPIRED", title: "Scadute", icon: AlertTriangle, iconClassName: "text-rose-700" },
  { key: "UPCOMING", title: "Imminenti", icon: Clock3, iconClassName: "text-amber-700" },
  { key: "NEXT", title: "Prossime", icon: CalendarDays, iconClassName: "text-sky-700" },
  { key: "OTHER", title: "Altre", icon: CircleCheck, iconClassName: "text-slate-600" },
];

function deadlineGroup(deadline: FascicoloDeadline): FascicoloDeadlineAttention {
  if (deadline.attention) return deadline.attention;
  return deadline.status === "SCADUTA" ? "EXPIRED" : "OTHER";
}

export function FascicoloDeadlines({ model }: { model: FascicoloDeadlinesModel }) {
  const candidates = model.candidates ?? [];
  const expiredCount = model.deadlines.filter((deadline) => deadline.status === "SCADUTA").length;
  const openCount = model.deadlines.filter((deadline) => deadline.status === "APERTA").length;
  const hasUpcomingClassification = model.deadlines.some((deadline) => deadline.attention === "UPCOMING");
  const upcomingCount = model.deadlines.filter((deadline) => deadline.attention === "UPCOMING").length;

  return (
    <section aria-labelledby="deadlines-title" className="min-w-0 space-y-6" data-testid="fascicolo-deadlines">
      <header className="border-b border-slate-200 pb-4">
        <h2 id="deadlines-title" className="text-xl font-semibold text-slate-950">Scadenze</h2>
        <p className="mt-1 text-sm text-slate-600">Termini e date rilevanti del fascicolo.</p>
        {model.deadlines.length > 0 ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="inline text-slate-500">Scadute </dt><dd className="inline font-semibold text-slate-950">{expiredCount}</dd></div>
            {hasUpcomingClassification ? <div><dt className="inline text-slate-500">Imminenti </dt><dd className="inline font-semibold text-slate-950">{upcomingCount}</dd></div> : null}
            <div><dt className="inline text-slate-500">Aperte </dt><dd className="inline font-semibold text-slate-950">{openCount}</dd></div>
          </dl>
        ) : null}
      </header>

      {model.deadlines.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">Non risultano scadenze strutturate per questo fascicolo.</p>
        </div>
      ) : groups.map((group) => {
        const deadlines = model.deadlines.filter((deadline) => deadlineGroup(deadline) === group.key);
        if (deadlines.length === 0) return null;
        const Icon = group.icon;
        return (
          <section key={group.key} aria-labelledby={`deadline-group-${group.key.toLowerCase()}`}>
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${group.iconClassName}`} aria-hidden="true" />
              <h3 id={`deadline-group-${group.key.toLowerCase()}`} className="text-base font-semibold text-slate-950">{group.title}</h3>
            </div>
            <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
              {deadlines.map((deadline) => <DeadlineCard key={deadline.id} deadline={deadline} />)}
            </div>
          </section>
        );
      })}

      {candidates.length > 0 ? (
        <section aria-labelledby="deadline-candidates-title" className="border-t border-slate-200 pt-5">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <h3 id="deadline-candidates-title" className="text-base font-semibold text-slate-950">Termini da verificare</h3>
          </div>
          <p className="mt-1 text-sm text-slate-600">Data o qualificazione ancora da confermare.</p>
          <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
            {candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} />)}
          </div>
        </section>
      ) : null}
    </section>
  );
}