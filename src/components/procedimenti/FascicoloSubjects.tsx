import type { ReactNode } from "react";
import { Building2, Landmark, Mail, Phone, UserRound } from "lucide-react";

export type FascicoloSubjectRole =
  | "Assistito"
  | "Concessionario"
  | "Ente concedente"
  | "Autorità competente"
  | "Responsabile procedimento"
  | "Controparte"
  | "Tecnico"
  | "Operatore"
  | "Altro";

export interface FascicoloSubject {
  name: string;
  roles: readonly FascicoloSubjectRole[];
  category: "principal" | "other";
  type?: string | null;
  contact?: string | null;
  phone?: string | null;
  organization?: string | null;
  note?: string | null;
  href?: string | null;
}

export interface FascicoloResponsibilityAssignment {
  id: string;
  name: string;
  email?: string | null;
  organization?: string | null;
  assignedAt?: string | null;
  endedAt?: string | null;
  note?: string | null;
}

interface FascicoloSubjectsProps {
  subjects: readonly FascicoloSubject[];
  responsible?: Omit<FascicoloResponsibilityAssignment, "id" | "endedAt"> | null;
  responsibilityHistory?: readonly FascicoloResponsibilityAssignment[];
  reassignAction?: ReactNode;
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("it");
}

export function deduplicateFascicoloSubjects(subjects: readonly FascicoloSubject[]): FascicoloSubject[] {
  const subjectsByName = new Map<string, FascicoloSubject>();

  for (const subject of subjects) {
    const name = subject.name.trim();
    if (!name) continue;

    const key = normalizedName(name);
    const existing = subjectsByName.get(key);
    if (!existing) {
      subjectsByName.set(key, { ...subject, name, roles: [...new Set(subject.roles)] });
      continue;
    }

    subjectsByName.set(key, {
      ...existing,
      roles: [...new Set([...existing.roles, ...subject.roles])],
      category: existing.category === "principal" || subject.category === "principal" ? "principal" : "other",
      type: existing.type || subject.type,
      contact: existing.contact || subject.contact,
      phone: existing.phone || subject.phone,
      organization: existing.organization || subject.organization,
      note: existing.note || subject.note,
      href: existing.href || subject.href,
    });
  }

  return [...subjectsByName.values()];
}

function SubjectIcon({ roles }: { roles: readonly FascicoloSubjectRole[] }) {
  if (roles.includes("Ente concedente") || roles.includes("Autorità competente")) {
    return <Landmark className="h-4 w-4" aria-hidden="true" />;
  }
  if (roles.includes("Assistito") || roles.includes("Responsabile procedimento")) {
    return <UserRound className="h-4 w-4" aria-hidden="true" />;
  }
  return <Building2 className="h-4 w-4" aria-hidden="true" />;
}

function SubjectCard({ subject }: { subject: FascicoloSubject }) {
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[#173d4f]">
          <SubjectIcon roles={subject.roles} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">{subject.name}</h4>
          <p className="mt-0.5 text-sm font-medium text-[#0b6574]">{subject.roles.join(" · ")}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {subject.type ? <span>{subject.type}</span> : null}
            {subject.organization ? <span>{subject.organization}</span> : null}
            {subject.contact ? (
              <a href={`mailto:${subject.contact}`} aria-label={`Invia email a ${subject.name}`} className="inline-flex min-w-0 items-center gap-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="[overflow-wrap:anywhere]">{subject.contact}</span>
              </a>
            ) : null}
            {subject.phone ? (
              <a href={`tel:${subject.phone}`} aria-label={`Chiama ${subject.name}`} className="inline-flex items-center gap-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                {subject.phone}
              </a>
            ) : null}
          </div>
          {subject.note ? <p className="mt-2 text-xs leading-5 text-slate-600">{subject.note}</p> : null}
        </div>
      </div>
    </>
  );

  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      {subject.href ? (
        <a href={subject.href} className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
          {content}
        </a>
      ) : content}
    </article>
  );
}

export function FascicoloSubjects({ subjects, responsible, responsibilityHistory = [], reassignAction }: FascicoloSubjectsProps) {
  const deduplicated = deduplicateFascicoloSubjects(subjects);
  const principalSubjects = deduplicated.filter((subject) => subject.category === "principal");
  const otherSubjects = deduplicated.filter((subject) => subject.category === "other");
  const responsibleIsAlreadyCounted = responsible
    ? deduplicated.some((subject) => normalizedName(subject.name) === normalizedName(responsible.name))
    : false;
  const subjectCount = deduplicated.length + (responsible && !responsibleIsAlreadyCounted ? 1 : 0);
  const primaryAdministration = principalSubjects.find((subject) => subject.roles.includes("Ente concedente"))
    ?? principalSubjects.find((subject) => subject.roles.includes("Autorità competente"));
  const showResponsibility = Boolean(responsible || responsibilityHistory.length > 0 || reassignAction);

  return (
    <section aria-labelledby="subjects-title" className="space-y-5" data-testid="fascicolo-subjects">
      <header className="border-b border-slate-200 pb-4">
        <h2 id="subjects-title" className="text-xl font-semibold text-slate-950">Soggetti</h2>
        <p className="mt-1 text-sm text-slate-600">Persone, società e amministrazioni coinvolte nel fascicolo.</p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><dt className="inline text-slate-500">Soggetti </dt><dd className="inline font-semibold text-slate-950">{subjectCount}</dd></div>
          {responsible ? <div><dt className="inline text-slate-500">Responsabile attuale </dt><dd className="inline font-semibold text-slate-950">{responsible.name}</dd></div> : null}
          {primaryAdministration ? <div><dt className="inline text-slate-500">Amministrazione principale </dt><dd className="inline font-semibold text-slate-950">{primaryAdministration.name}</dd></div> : null}
        </dl>
      </header>

      <section aria-labelledby="principal-subjects-title">
        <h3 id="principal-subjects-title" className="text-sm font-semibold uppercase text-slate-500">Soggetti principali</h3>
        {principalSubjects.length > 0 ? (
          <div className="mt-2 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {principalSubjects.map((subject) => <SubjectCard key={normalizedName(subject.name)} subject={subject} />)}
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">Nessun soggetto principale registrato.</p>}
      </section>

      {showResponsibility ? (
        <section aria-labelledby="responsible-title" className="border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="responsible-title" className="text-base font-semibold text-slate-950">Responsabile del procedimento</h3>
          </div>
          {responsible ? (
            <div className="mt-2 max-w-2xl">
              <SubjectCard subject={{ name: responsible.name, roles: ["Responsabile procedimento"], category: "principal", type: "Persona", contact: responsible.email, organization: responsible.organization, note: responsible.assignedAt ? `Assegnato il ${responsible.assignedAt}` : null }} />
            </div>
          ) : null}
          {reassignAction ? <div className="mt-3">{reassignAction}</div> : null}

          <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">Storico responsabilità</summary>
            {responsibilityHistory.length > 0 ? (
              <ol className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                {responsibilityHistory.map((assignment) => (
                  <li key={assignment.id} className="grid gap-1 py-2 text-sm text-slate-700 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <p className="font-medium text-slate-950">{assignment.assignedAt}{assignment.endedAt ? ` - ${assignment.endedAt}` : " - In corso"}</p>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">{assignment.name}</p>
                      {assignment.organization ? <p>{assignment.organization}</p> : null}
                      {assignment.email ? <a href={`mailto:${assignment.email}`} aria-label={`Invia email a ${assignment.name}`} className="[overflow-wrap:anywhere] underline underline-offset-4">{assignment.email}</a> : null}
                      {assignment.note ? <p className="mt-1 text-xs text-slate-600">{assignment.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-sm text-slate-500">Nessuna assegnazione storica registrata.</p>}
          </details>
        </section>
      ) : null}

      <section aria-labelledby="other-subjects-title" className="border-t border-slate-200 pt-4">
        <h3 id="other-subjects-title" className="text-base font-semibold text-slate-950">Altri soggetti</h3>
        {otherSubjects.length > 0 ? (
          <div className="mt-2 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {otherSubjects.map((subject) => <SubjectCard key={normalizedName(subject.name)} subject={subject} />)}
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">Nessun altro soggetto registrato.</p>}
      </section>
    </section>
  );
}