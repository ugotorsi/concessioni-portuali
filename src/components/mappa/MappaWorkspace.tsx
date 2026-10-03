"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, FolderOpen, LocateFixed, MapPin, Search } from "lucide-react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";

import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import type { MappaConcessioneItem, MappaWorkspaceData } from "@/server/queries/mappa";

interface MappaWorkspaceProps {
  data: MappaWorkspaceData;
}

function statusVariant(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "ATTIVA") return "success";
  if (status === "IN_PROROGA" || status === "SOSPESA") return "warning";
  if (["SCADUTA", "REVOCATA", "DECADUTA"].includes(status)) return "danger";
  return "default";
}

function ResultItem({ item }: { item: MappaConcessioneItem }) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2 pr-8">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-slate-950">Concessione {item.numeroAtto}</h3>
          <p className="mt-1 break-words text-sm text-slate-700">{item.concessionario}</p>
        </div>
        <Badge variant={statusVariant(item.stato)}>{formatEnumLabel(item.stato)}</Badge>
      </div>
      {item.ubicazione ? <p className="mt-2 flex gap-1.5 text-xs text-slate-600"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{item.ubicazione}</p> : null}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        <span>{item.criticitaAperteCount} criticità aperte</span>
        <span>{item.scadenzeRilevantiCount} scadenze rilevanti</span>
        <span>{item.fascicoliCount} fascicoli</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        {item.fascicoloId ? (
          <Link href={`/procedimenti/${item.fascicoloId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-950 underline decoration-slate-300 underline-offset-4">
            Apri fascicolo <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : <span className="text-xs text-slate-500">Nessun fascicolo collegato</span>}
        <Link href={`/concessioni/${item.id}`} className="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4">Apri concessione</Link>
      </div>
    </article>
  );
}

export function MappaWorkspace({ data }: MappaWorkspaceProps) {
  const [search, setSearch] = useState("");
  const [concessionarioId, setConcessionarioId] = useState("");
  const [stato, setStato] = useState("");
  const [criticita, setCriticita] = useState("");
  const [fascicolo, setFascicolo] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase("it"));
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markersRef = useRef(new Map<string, CircleMarker>());

  const filteredItems = data.markers.filter((item) => {
    const matchesSearch = !deferredSearch || [item.numeroAtto, item.concessionario, item.ubicazione]
      .filter(Boolean)
      .some((value) => value?.toLocaleLowerCase("it").includes(deferredSearch));
    return matchesSearch
      && (!concessionarioId || item.concessionarioId === concessionarioId)
      && (!stato || item.stato === stato)
      && (!criticita || (criticita === "SI" ? item.criticitaAperteCount > 0 : item.criticitaAperteCount === 0))
      && (!fascicolo || (fascicolo === "SI" ? item.fascicoliCount > 0 : item.fascicoliCount === 0));
  });

  useEffect(() => {
    let disposed = false;

    async function initializeMap() {
      if (!mapContainerRef.current || mapRef.current) return;
      const leaflet = await import("leaflet");
      if (disposed || !mapContainerRef.current) return;
      leafletRef.current = leaflet;
      mapRef.current = leaflet.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false,
        minZoom: 2,
        maxZoom: 18,
      });
      mapRef.current.zoomControl.setPosition("topright");
      setMapReady(true);
    }

    void initializeMap();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map || !mapReady) return;

    map.eachLayer((layer) => layer.remove());
    markersRef.current.clear();
    const points = filteredItems.map((item) => leaflet.latLng(item.lat, item.lng));

    if (points.length > 0) {
      const bounds = leaflet.latLngBounds(points);
      const paddedBounds = bounds.pad(points.length === 1 ? 0.002 : 0.18);
      leaflet.rectangle(paddedBounds, {
        color: "#7b91a3",
        weight: 1,
        opacity: 0.5,
        fillColor: "#e8f1f4",
        fillOpacity: 0.3,
        interactive: false,
      }).addTo(map);

      for (const item of filteredItems) {
        const marker = leaflet.circleMarker([item.lat, item.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: "#0f6c79",
          fillOpacity: 1,
        }).addTo(map);

        const popup = document.createElement("div");
        popup.className = "min-w-56 space-y-2 text-sm text-slate-800";
        const title = document.createElement("strong");
        title.className = "block text-sm text-slate-950";
        title.textContent = `Concessione ${item.numeroAtto}`;
        popup.append(title);

        const facts = [
          item.concessionario,
          item.ubicazione,
          `Stato: ${formatEnumLabel(item.stato)}`,
          `Scadenza: ${formatDateIT(item.dataScadenza)}`,
          `Criticità aperte: ${item.criticitaAperteCount}`,
          item.scadenzeRilevantiCount > 0 ? `Scadenze rilevanti: ${item.scadenzeRilevantiCount}` : null,
          item.fascicoliCount > 0 ? `Fascicoli collegati: ${item.fascicoliCount}` : null,
        ].filter(Boolean);
        for (const value of facts) {
          const line = document.createElement("p");
          line.className = "m-0 leading-5";
          line.textContent = value;
          popup.append(line);
        }

        const actions = document.createElement("div");
        actions.className = "flex flex-wrap gap-3 border-t border-slate-200 pt-2";
        if (item.fascicoloId) {
          const primary = document.createElement("a");
          primary.href = `/procedimenti/${item.fascicoloId}`;
          primary.textContent = "Apri fascicolo";
          primary.className = "font-semibold text-slate-950 underline";
          actions.append(primary);
        }
        const secondary = document.createElement("a");
        secondary.href = `/concessioni/${item.id}`;
        secondary.textContent = "Apri concessione";
        secondary.className = "text-slate-600 underline";
        actions.append(secondary);
        popup.append(actions);

        marker.bindPopup(popup, { maxWidth: 300, closeButton: true });
        marker.bindTooltip(`Concessione ${item.numeroAtto}`, { direction: "top", offset: [0, -8] });
        const element = marker.getElement();
        element?.setAttribute("role", "button");
        element?.setAttribute("tabindex", "0");
        element?.setAttribute("aria-label", `Apri dettagli concessione ${item.numeroAtto}`);
        element?.addEventListener("keydown", (event) => {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") marker.openPopup();
        });
        markersRef.current.set(item.id, marker);
      }

      if (points.length === 1) map.setView(points[0], 15, { animate: false });
      else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: false });
    }

    window.setTimeout(() => map.invalidateSize(), 0);
  }, [filteredItems, mapReady]);

  function focusMarker(item: MappaConcessioneItem) {
    const map = mapRef.current;
    const marker = markersRef.current.get(item.id);
    if (!map || !marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: false });
    marker.openPopup();
  }

  const results = (
    <div className="grid gap-2">
      {filteredItems.map((item) => (
        <div key={item.id} className="relative">
          <button
            type="button"
            onClick={() => focusMarker(item)}
            aria-label={`Localizza concessione ${item.numeroAtto} sulla mappa`}
            className="absolute right-2 top-2 z-10 rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-cyan-700"
            title="Localizza sulla mappa"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          </button>
          <ResultItem item={item} />
        </div>
      ))}
      {filteredItems.length === 0 ? <p className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-600">Nessuna concessione corrisponde ai filtri.</p> : null}
    </div>
  );

  return (
    <section className="mt-5" aria-labelledby="mappa-operativa">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="mappa-operativa" className="text-base font-semibold text-slate-950">Concessioni sul territorio</h2>
          <p className="mt-1 text-sm text-slate-600">Sono rappresentate esclusivamente coordinate GIS registrate.</p>
        </div>
        <p className="text-sm font-medium text-slate-700">{filteredItems.length} di {data.markers.length} concessioni visibili</p>
      </div>

      <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Filtri mappa">
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Ricerca</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden="true" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Numero, titolare, ubicazione" className="pl-9" /></span></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Concessionario</span><Select value={concessionarioId} onChange={(event) => setConcessionarioId(event.target.value)}><option value="">Tutti</option>{data.concessionari.map((item) => <option key={item.id} value={item.id}>{item.denominazione}</option>)}</Select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Stato</span><Select value={stato} onChange={(event) => setStato(event.target.value)}><option value="">Tutti</option>{data.stati.map((item) => <option key={item} value={item}>{formatEnumLabel(item)}</option>)}</Select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Criticità aperte</span><Select value={criticita} onChange={(event) => setCriticita(event.target.value)}><option value="">Tutte</option><option value="SI">Presenti</option><option value="NO">Assenti</option></Select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Fascicolo</span><Select value={fascicolo} onChange={(event) => setFascicolo(event.target.value)}><option value="">Tutti</option><option value="SI">Collegato</option><option value="NO">Non collegato</option></Select></label>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative min-w-0 overflow-hidden rounded-md border border-slate-300 bg-[#dbe8ec]">
          <div ref={mapContainerRef} data-testid="mappa-leaflet" className="h-[440px] w-full sm:h-[540px] xl:h-[640px] [&_.leaflet-control-zoom_a]:text-slate-900 [&_.leaflet-popup-content-wrapper]:rounded-md" aria-label="Mappa delle concessioni geolocalizzate" />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-md border border-white/80 bg-white/90 px-2.5 py-1.5 text-xs text-slate-700 shadow-sm">
            Coordinate GIS registrate · nessun servizio cartografico esterno
          </div>
          {filteredItems.length === 0 ? <div className="absolute inset-0 z-[600] flex items-center justify-center bg-white/85 px-5 text-center text-sm font-medium text-slate-700">Nessuna concessione corrisponde ai filtri.</div> : null}
        </div>

        <aside className="hidden max-h-[640px] overflow-y-auto xl:block" aria-label="Concessioni visibili sulla mappa">
          {results}
        </aside>

        <details className="rounded-md border border-slate-200 bg-white p-3 xl:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><Building2 className="h-4 w-4" aria-hidden="true" />Concessioni visibili</span>
            <Badge>{filteredItems.length}</Badge>
          </summary>
          <div className="mt-3 max-h-[480px] overflow-y-auto">{results}</div>
        </details>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600" aria-label="Legenda dati">
        <span className="inline-flex items-center gap-1"><FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />Fascicolo collegato</span>
        <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Criticità persistite</span>
        <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />Scadenza concessoria</span>
      </div>
    </section>
  );
}
