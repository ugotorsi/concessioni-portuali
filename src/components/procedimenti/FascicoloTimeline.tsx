"use client";

import { useState } from "react";

import { Select } from "@/components/ui/Select";

export interface FascicoloTimelineEvent {
  id: string;
  dedupeKey?: string;
  date: string;
  dateTime: string;
  timestamp: number;
  title: string;
  type: "Documento" | "Comunicazione" | "Sopralluogo" | "Criticità" | "Scadenza" | "Pagamento" | "Concessione" | "Provvedimento" | "Fascicolo" | "Altro";
  description: string;
  subjects?: string | null;
  source?: string | null;
  alert?: "Scaduto" | "Non conforme" | "Mancante" | "Da verificare" | null;
  href?: string | null;
  actionLabel?: string | null;
}

interface FascicoloTimelineProps {
  events: FascicoloTimelineEvent[];
  nextDeadline?: string | null;
}

type SortOrder = "recent" | "oldest";

export function FascicoloTimeline({ events, nextDeadline }: FascicoloTimelineProps) {
  const [selectedType, setSelectedType] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const eventsByKey = new Map<string, FascicoloTimelineEvent>();
  events.forEach((event) => {
    const key = event.dedupeKey ?? event.id;
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, event);
    }
  });
  const uniqueEvents = Array.from(eventsByKey.values());
  const availableTypes = Array.from(new Set(uniqueEvents.map((event) => event.type)));
  const sortedEvents = [...uniqueEvents].sort((left, right) => {
    const difference = left.timestamp - right.timestamp;
    return sortOrder === "oldest" ? difference : -difference;
  });
  const visibleEvents = sortedEvents.filter((event) => selectedType === "all" || event.type === selectedType);
  const latestEvent = [...uniqueEvents].sort((left, right) => right.timestamp - left.timestamp)[0];

  return (
    <section className="space-y-4" aria-labelledby="fascicolo-timeline-heading">
      <div className="border-b border-slate-200 pb-4">
        <h2 id="fascicolo-timeline-heading" className="text-lg font-semibold text-slate-950">Cronologia</h2>
        <p className="mt-1 text-sm text-slate-600">Eventi, atti e passaggi rilevanti del fascicolo ordinati nel tempo.</p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
          <div><dt className="inline font-medium text-slate-800">Eventi: </dt><dd className="inline">{uniqueEvents.length}</dd></div>
          {latestEvent ? <div><dt className="inline font-medium text-slate-800">Ultimo evento: </dt><dd className="inline">{latestEvent.date}</dd></div> : null}
          {nextDeadline ? <div><dt className="inline font-medium text-slate-800">Prossima scadenza: </dt><dd className="inline">{nextDeadline}</dd></div> : null}
        </dl>
      </div>

      {uniqueEvents.length > 1 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {availableTypes.length > 1 ? (
            <label className="text-sm font-medium text-slate-700 sm:w-56">
              Tipo evento
              <Select value={selectedType} onChange={(event) => setSelectedType(event.target.value)} className="mt-1">
                <option value="all">Tutti gli eventi</option>
                {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </Select>
            </label>
          ) : null}
          <label className="text-sm font-medium text-slate-700 sm:w-48">
            Ordina
            <Select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)} className="mt-1">
              <option value="recent">Più recenti</option>
              <option value="oldest">Più vecchi</option>
            </Select>
          </label>
        </div>
      ) : null}

      {visibleEvents.length > 0 ? (
        <ol className="relative space-y-0 border-l border-slate-300 pl-4" aria-label="Eventi cronologici">
          {visibleEvents.map((event) => (
            <li key={event.id} className="relative py-2.5 before:absolute before:-left-[20.5px] before:top-5 before:h-2 before:w-2 before:rounded-full before:bg-[#0b7285]">
              <article className="grid min-w-0 gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4" aria-labelledby={`timeline-event-${event.id}`}>
                <time dateTime={event.dateTime} className="text-sm font-semibold tabular-nums text-slate-900">{event.date}</time>
                <div className="min-w-0">
                  <h3 id={`timeline-event-${event.id}`} className="text-sm font-semibold text-slate-950">{event.title}</h3>
                  <p className="mt-0.5 text-sm leading-5 text-slate-700">{event.description}</p>
                  {event.subjects ? <p className="mt-1 text-xs text-slate-600"><span className="font-medium text-slate-800">Soggetti:</span> {event.subjects}</p> : null}
                  {event.source ? <p className="mt-1 text-xs text-slate-600"><span className="font-medium text-slate-800">Fonte:</span> {event.source}</p> : null}
                  {event.alert ? <p className="mt-1 text-xs font-semibold text-amber-800">Attenzione: {event.alert}</p> : null}
                </div>
                <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{event.type}</span>
                  {event.href && event.actionLabel ? (
                    <a href={event.href} className="text-xs font-semibold text-[#173d4f] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
                      {event.actionLabel}
                    </a>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : uniqueEvents.length === 0 ? (
        <p className="py-4 text-sm text-slate-600">Nessun evento cronologico ancora disponibile.</p>
      ) : (
        <p className="py-4 text-sm text-slate-600">Nessun evento corrisponde al filtro selezionato.</p>
      )}
    </section>
  );
}
