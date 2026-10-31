"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type VerificationStatus =
  | "DA_VERIFICARE_SU_FONTE_ORIGINALE"
  | "INDICATIVO_DA_VERIFICARE"
  | "RISPOSTA_VUOTA_NON_PROBATORIA";

type TechnicalSourceRecord = Readonly<{
  id: string;
  missionId: string;
  questionSnapshot: string;
  toolName: string;
  requestPayload: unknown;
  responsePayload: unknown;
  serviceVersion: string;
  verificationStatus: VerificationStatus;
  retrievedAt: string;
}>;

type Mission = Readonly<{ id: string; question: string }>;

type PanelState = Readonly<{
  channelEnabled: boolean;
  canRequest: boolean;
  missions: readonly Mission[];
  records: readonly TechnicalSourceRecord[];
  hasMore: boolean;
}>;

type ToolName = "search" | "fetch" | "lista_livelli_wms" | "interroga_punto_wms" | "matrice_verifiche_manufatto";

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  DA_VERIFICARE_SU_FONTE_ORIGINALE: "Da verificare sulla fonte originale",
  INDICATIVO_DA_VERIFICARE: "Risposta cartografica indicativa, da verificare",
  RISPOSTA_VUOTA_NON_PROBATORIA: "Risposta vuota: non prova l’assenza di vincoli",
};

const TOOL_LABELS: Record<ToolName, string> = {
  search: "Ricerca nel catalogo ufficiale",
  fetch: "Scheda di una fonte del catalogo",
  lista_livelli_wms: "Elenco livelli cartografici (WMS)",
  interroga_punto_wms: "Interrogazione cartografica di un punto (WMS)",
  matrice_verifiche_manufatto: "Matrice preliminare delle verifiche sul manufatto",
};

const MANUFATTO_TYPES = ["biglietteria", "chiosco", "pontile", "struttura_galleggiante", "opera_fissa", "altro"] as const;
const WMS_SOURCES = ["campania-tematica", "campania-ctr2020"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
  return typeof value === "string" && value in VERIFICATION_LABELS;
}

function parseRecord(value: unknown): TechnicalSourceRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.missionId !== "string"
    || typeof value.questionSnapshot !== "string"
    || typeof value.toolName !== "string"
    || typeof value.serviceVersion !== "string"
    || typeof value.retrievedAt !== "string"
    || !isVerificationStatus(value.verificationStatus)
  ) return null;
  return {
    id: value.id,
    missionId: value.missionId,
    questionSnapshot: value.questionSnapshot,
    toolName: value.toolName,
    requestPayload: value.requestPayload,
    responsePayload: value.responsePayload,
    serviceVersion: value.serviceVersion,
    verificationStatus: value.verificationStatus,
    retrievedAt: value.retrievedAt,
  };
}

function parseMission(value: unknown): Mission | null {
  return isRecord(value) && typeof value.id === "string" && typeof value.question === "string"
    ? { id: value.id, question: value.question }
    : null;
}

export function parseTechnicalSourcesPanelState(payload: unknown): PanelState | null {
  if (!isRecord(payload) || !Array.isArray(payload.records) || !Array.isArray(payload.missions)) return null;
  const records = payload.records.map(parseRecord);
  const missions = payload.missions.map(parseMission);
  if (records.some((record) => record === null) || missions.some((mission) => mission === null)) return null;
  return {
    channelEnabled: payload.channelEnabled === true,
    canRequest: payload.canRequest === true,
    missions: missions.filter((mission): mission is Mission => mission !== null),
    records: records.filter((record): record is TechnicalSourceRecord => record !== null),
    hasMore: payload.hasMore === true,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("it-IT");
}

function toolLabel(tool: string): string {
  return tool in TOOL_LABELS ? TOOL_LABELS[tool as ToolName] : tool;
}

export function buildTechnicalSourcesCall(tool: ToolName, form: FormData): Record<string, unknown> | null {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  switch (tool) {
    case "search":
      return text("query") ? { tool, arguments: { query: text("query") } } : null;
    case "fetch":
      return text("sourceId") ? { tool, arguments: { id: text("sourceId") } } : null;
    case "lista_livelli_wms":
      return {
        tool,
        arguments: text("filtro")
          ? { source_id: text("wmsSource"), filtro: text("filtro") }
          : { source_id: text("wmsSource") },
      };
    case "interroga_punto_wms": {
      const latitudine = Number(text("latitudine"));
      const longitudine = Number(text("longitudine"));
      if (!text("layer") || !Number.isFinite(latitudine) || !Number.isFinite(longitudine)) return null;
      return { tool, arguments: { source_id: text("wmsSource"), layer: text("layer"), latitudine, longitudine } };
    }
    case "matrice_verifiche_manufatto":
      return text("comune") ? { tool, arguments: { tipo: text("tipo"), comune: text("comune") } } : null;
  }
}

const REQUEST_ERRORS: Record<number, string> = {
  400: "Parametri della richiesta non validi.",
  403: "Operazione non consentita per questo fascicolo.",
  404: "Missione di ricerca non trovata nel fascicolo.",
  409: "La missione selezionata non contiene un quesito utilizzabile.",
  502: "Il servizio delle fonti tecniche non ha restituito una risposta valida. Nessun risultato è stato archiviato.",
  503: "Il canale delle fonti tecniche non è configurato. Nessuna richiesta è stata inviata.",
};

export function TechnicalSourcesResearchPanel({
  procedimentoId,
  variant = "research",
}: {
  procedimentoId: string;
  variant?: "research" | "analysis";
}) {
  const [state, setState] = useState<PanelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolName>("search");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const endpoint = `/api/procedimenti/${encodeURIComponent(procedimentoId)}/technical-research`;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) {
        setError("La cronologia delle fonti tecniche non è disponibile.");
        return;
      }
      const parsed = parseTechnicalSourcesPanelState(await response.json());
      if (!parsed) {
        setError("La risposta della cronologia non è valida.");
        return;
      }
      setError(null);
      setState(parsed);
    } catch {
      if (!signal?.aborted) setError("La cronologia delle fonti tecniche non è raggiungibile.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const call = buildTechnicalSourcesCall(tool, form);
    const missionId = String(form.get("missionId") ?? "");
    if (!call || !missionId) {
      setSubmitMessage("Compila tutti i campi richiesti.");
      return;
    }
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, call }),
      });
      if (response.status === 201) {
        setSubmitMessage("Risultato archiviato nel fascicolo come materiale non probatorio da verificare.");
        await load();
      } else {
        setSubmitMessage(REQUEST_ERRORS[response.status] ?? "Richiesta non completata.");
      }
    } catch {
      setSubmitMessage("Richiesta non completata: servizio non raggiungibile.");
    } finally {
      setSubmitting(false);
    }
  }

  const records = state?.records ?? [];
  const isAnalysis = variant === "analysis";
  const visibleRecords = isAnalysis ? records.slice(0, 5) : records;
  const counts = records.reduce<Record<VerificationStatus, number>>((acc, record) => {
    acc[record.verificationStatus] += 1;
    return acc;
  }, { DA_VERIFICARE_SU_FONTE_ORIGINALE: 0, INDICATIVO_DA_VERIFICARE: 0, RISPOSTA_VUOTA_NON_PROBATORIA: 0 });
  const titleId = `technical-sources-title-${variant}`;

  return (
    <section aria-labelledby={titleId} className="space-y-4 border-t border-slate-200 pt-5">
      <header>
        <h3 id={titleId} className="text-base font-semibold text-slate-950">
          {isAnalysis ? "Riscontri tecnici e urbanistici (non probatori)" : "Fonti tecniche e urbanistiche"}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Catalogo ufficiale, checklist preliminari e cartografia conoscitiva. I risultati non certificano conformità,
          presenza o assenza di vincoli e non sostituiscono gli atti degli enti competenti.
        </p>
      </header>

      {state && !state.channelEnabled ? (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Canale delle fonti tecniche disabilitato: l’identità machine-to-machine del backend non è configurata.
          Nessuna richiesta al servizio viene inviata; è consultabile solo lo storico archiviato.
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-600">Caricamento della cronologia…</p> : null}
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}

      {isAnalysis && records.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Stato di verifica dei riscontri tecnici">
          {(Object.keys(counts) as VerificationStatus[]).map((status) => (
            <li key={status} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              {VERIFICATION_LABELS[status]}: {counts[status]}
            </li>
          ))}
        </ul>
      ) : null}

      {!isAnalysis && state?.channelEnabled && state.canRequest ? (
        state.missions.length === 0 ? (
          <p className="text-sm text-slate-600">Nessuna missione di ricerca corrente a cui associare un’interrogazione tecnica.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 p-4 text-sm">
            <label className="block">
              <span className="font-medium text-slate-800">Missione di ricerca</span>
              <select name="missionId" required className="mt-1 block w-full rounded border border-slate-300 p-2">
                {state.missions.map((mission) => (
                  <option key={mission.id} value={mission.id}>{mission.question}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-medium text-slate-800">Strumento</span>
              <select
                name="tool"
                value={tool}
                onChange={(event) => setTool(event.target.value as ToolName)}
                className="mt-1 block w-full rounded border border-slate-300 p-2"
              >
                {(Object.keys(TOOL_LABELS) as ToolName[]).map((name) => (
                  <option key={name} value={name}>{TOOL_LABELS[name]}</option>
                ))}
              </select>
            </label>
            {tool === "search" ? (
              <input name="query" required maxLength={200} placeholder="Termini di ricerca" className="block w-full rounded border border-slate-300 p-2" />
            ) : null}
            {tool === "fetch" ? (
              <input name="sourceId" required maxLength={128} placeholder="Identificativo della fonte" className="block w-full rounded border border-slate-300 p-2" />
            ) : null}
            {tool === "lista_livelli_wms" || tool === "interroga_punto_wms" ? (
              <select name="wmsSource" className="block w-full rounded border border-slate-300 p-2">
                {WMS_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            ) : null}
            {tool === "lista_livelli_wms" ? (
              <input name="filtro" maxLength={80} placeholder="Filtro facoltativo" className="block w-full rounded border border-slate-300 p-2" />
            ) : null}
            {tool === "interroga_punto_wms" ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <input name="layer" required maxLength={256} placeholder="Livello" className="rounded border border-slate-300 p-2" />
                <input name="latitudine" required type="number" step="any" min={-90} max={90} placeholder="Latitudine" className="rounded border border-slate-300 p-2" />
                <input name="longitudine" required type="number" step="any" min={-180} max={180} placeholder="Longitudine" className="rounded border border-slate-300 p-2" />
              </div>
            ) : null}
            {tool === "matrice_verifiche_manufatto" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <select name="tipo" className="rounded border border-slate-300 p-2">
                  {MANUFATTO_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <input name="comune" required minLength={2} maxLength={120} placeholder="Comune" className="rounded border border-slate-300 p-2" />
              </div>
            ) : null}
            <button type="submit" disabled={submitting} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60">
              {submitting ? "Interrogazione in corso…" : "Interroga e archivia"}
            </button>
            {submitMessage ? <p role="status" className="text-slate-700">{submitMessage}</p> : null}
          </form>
        )
      ) : null}

      {!loading && !error && records.length === 0 ? (
        <p className="text-sm text-slate-600">Nessuna interrogazione tecnica archiviata per questo fascicolo.</p>
      ) : null}

      {visibleRecords.length > 0 ? (
        <div className="space-y-3">
          {visibleRecords.map((record) => (
            <article key={record.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <h4 className="font-semibold text-slate-950">{toolLabel(record.toolName)}</h4>
                <time dateTime={record.retrievedAt} className="text-slate-600">{formatDate(record.retrievedAt)}</time>
              </div>
              <p className="mt-1 text-xs font-medium text-amber-900">{VERIFICATION_LABELS[record.verificationStatus]}</p>
              <p className="mt-2 text-sm text-slate-700">{record.questionSnapshot}</p>
              <p className="mt-1 text-xs text-slate-500">
                Missione {record.missionId} · versione servizio {record.serviceVersion}
              </p>
              {!isAnalysis ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">Richiesta e risposta archiviate</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
                    {JSON.stringify({
                      request: record.requestPayload,
                      response: record.responsePayload,
                    }, null, 2)}
                  </pre>
                </details>
              ) : null}
            </article>
          ))}
          {isAnalysis && records.length > visibleRecords.length ? (
            <p className="text-sm text-slate-600">
              <a className="underline" href={`/procedimenti/${encodeURIComponent(procedimentoId)}?section=research`}>
                Consulta lo storico completo nella sezione Ricerca
              </a>
            </p>
          ) : null}
          {!isAnalysis && state?.hasMore ? (
            <p className="text-sm text-slate-600">La cronologia è limitata alle 50 interrogazioni più recenti.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
