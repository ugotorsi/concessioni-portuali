import Link from "next/link";
import { CalendarDays, ExternalLink } from "lucide-react";

export interface FascicoloConcessionField {
  label: string;
  value: string | number | null | undefined;
}

export interface FascicoloConcessionModel {
  number?: string | null;
  state?: string | null;
  concessionaire?: string | null;
  grantingAuthority?: string | null;
  competentAuthority?: string | null;
  releaseDate?: string | null;
  expiryDate?: string | null;
  expiryStatus?: string | null;
  openHref?: string | null;
  title: readonly FascicoloConcessionField[];
  property: readonly FascicoloConcessionField[];
  activity: readonly FascicoloConcessionField[];
  fee: readonly FascicoloConcessionField[];
  normativeReferences?: readonly string[];
  indicators?: {
    openIssues?: number;
    openDeadlines?: number;
    expiredDeadlines?: number;
    criticalPayments?: number;
    activeProceedings?: number;
    documents?: number;
  };
}

function hasValue(value: FascicoloConcessionField["value"]): value is string | number {
  return typeof value === "number" || (typeof value === "string" && value.trim().length > 0);
}

function FieldGroup({ title, fields }: { title: string; fields: readonly FascicoloConcessionField[] }) {
  const visibleFields = fields.filter((field) => hasValue(field.value));
  if (visibleFields.length === 0) return null;

  return (
    <section aria-labelledby={`concession-${title.toLocaleLowerCase("it").replace(/[^a-z0-9]+/g, "-")}`} className="min-w-0 border-t border-slate-200 pt-4">
      <h3 id={`concession-${title.toLocaleLowerCase("it").replace(/[^a-z0-9]+/g, "-")}`} className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleFields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
            <dd className="mt-1 text-sm text-slate-900 [overflow-wrap:anywhere]">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function FascicoloConcession({ model }: { model: FascicoloConcessionModel }) {
  const normativeReferences = [...new Set((model.normativeReferences ?? []).map((item) => item.trim()).filter(Boolean))];
  const summary = [
    { label: "Numero atto", value: model.number },
    { label: "Stato", value: model.state },
    { label: "Concessionario", value: model.concessionaire },
    { label: "Ente concedente", value: model.grantingAuthority },
    { label: "Autorità competente", value: model.competentAuthority },
    { label: "Data rilascio", value: model.releaseDate },
  ].filter((field) => hasValue(field.value));
  const indicatorEntries = [
    ["Criticità aperte", model.indicators?.openIssues],
    ["Scadenze aperte", model.indicators?.openDeadlines],
    ["Scadenze scadute", model.indicators?.expiredDeadlines],
    ["Pagamenti critici", model.indicators?.criticalPayments],
    ["Procedimenti in corso", model.indicators?.activeProceedings],
    ["Documenti caricati", model.indicators?.documents],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");
  const hasStructuredData = summary.length > 0
    || Boolean(model.expiryDate)
    || [model.title, model.property, model.activity, model.fee].some((fields) => fields.some((field) => hasValue(field.value)))
    || normativeReferences.length > 0;

  return (
    <section aria-labelledby="concession-title" className="min-w-0 space-y-5" data-testid="fascicolo-concession">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 id="concession-title" className="text-xl font-semibold text-slate-950">Concessione</h2>
          <p className="mt-1 text-sm text-slate-600">Titolo concessorio e dati essenziali collegati al fascicolo.</p>
        </div>
        {model.openHref ? (
          <Link href={model.openHref} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
            Apri concessione
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      {!hasStructuredData ? (
        <p className="text-sm text-slate-600">Dati concessori non ancora strutturati.</p>
      ) : (
        <>
          {summary.length > 0 ? (
            <dl className="grid min-w-0 gap-x-6 gap-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {model.expiryDate ? (
            <section aria-labelledby="concession-expiry-title" className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <CalendarDays className="h-5 w-5 shrink-0 text-amber-800" aria-hidden="true" />
              <div className="min-w-0">
                <h3 id="concession-expiry-title" className="text-xs font-semibold uppercase text-amber-800">Scadenza</h3>
                <p className="text-base font-semibold text-amber-950">{model.expiryDate}</p>
              </div>
              {model.expiryStatus ? <span className="text-sm font-medium text-amber-900">{model.expiryStatus}</span> : null}
            </section>
          ) : null}

          <FieldGroup title="Titolo" fields={model.title} />
          <FieldGroup title="Bene / area" fields={model.property} />
          <FieldGroup title="Attività" fields={model.activity} />
          <FieldGroup title="Canone" fields={model.fee} />

          {normativeReferences.length > 0 ? (
            <section aria-labelledby="concession-rules-title" className="border-t border-slate-200 pt-4">
              <h3 id="concession-rules-title" className="text-sm font-semibold text-slate-950">Quadro normativo</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {normativeReferences.map((reference) => <li key={reference} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{reference}</li>)}
              </ul>
            </section>
          ) : null}

          {indicatorEntries.length > 0 ? (
            <section aria-label="Indicatori collegati" className="border-t border-slate-200 pt-4">
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {indicatorEntries.map(([label, value]) => <div key={label}><dt className="inline text-slate-500">{label} </dt><dd className="inline font-semibold text-slate-950">{value}</dd></div>)}
              </dl>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}