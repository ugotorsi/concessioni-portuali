import { z } from "zod";

import {
  OfficialLegalReferenceProviderError,
  type OfficialLegalReference,
  type OfficialLegalReferenceProvider,
} from "./providers";

export const NORMATTIVA_PROVIDER = "NORMATTIVA_OPENDATA_V1" as const;
export const NORMATTIVA_LOOKUP_VERSION = "NORMATTIVA_LOOKUP_V1" as const;
export const NORMATTIVA_BASE_URL = "https://api.normattiva.it/t/normattiva.api" as const;
export const NORMATTIVA_ADVANCED_SEARCH_ENDPOINT =
  `${NORMATTIVA_BASE_URL}/bff-opendata/v1/api/v1/ricerca/avanzata` as const;
export const MAX_NORMATTIVA_RESULTS = 25;
export const NORMATTIVA_TIMEOUT_MS = 10_000;
export const NORMATTIVA_MAX_RESPONSE_BYTES = 512 * 1024;

const denominationByActType = {
  LEGGE: "LEGGE",
  DECRETO_LEGGE: "DECRETO-LEGGE",
  DECRETO_LEGISLATIVO: "DECRETO LEGISLATIVO",
  DECRETO_PRESIDENTE_REPUBBLICA: "DECRETO DEL PRESIDENTE DELLA REPUBBLICA",
} as const;

export type SupportedNormattivaActType = keyof typeof denominationByActType;

export interface NormattivaStructuredReference {
  kind: string;
  actType: string | null;
  actNumber: string | null;
  year: number | null;
}

export interface NormattivaQuery {
  denominazioneAtto: string;
  annoProvvedimento: number;
  numeroProvvedimento: string;
  orderType: "DATA_DESC";
  paginazione: {
    paginaCorrente: 1;
    numeroElementiPerPagina: number;
  };
}

export interface NormattivaHit {
  providerRecordId: string;
  denominazioneAtto: string;
  numeroProvvedimento: string;
  annoProvvedimento: number;
  dataEmanazione: Date | null;
  descrizioneAtto: string | null;
  titoloAtto: string | null;
  numeroGU: string | null;
  dataGU: Date | null;
}

export type NormattivaLookupResult =
  | { status: "NOT_FOUND"; resultCount: 0; hits: [] }
  | { status: "FOUND_UNIQUE"; resultCount: 1; hits: [NormattivaHit] }
  | { status: "AMBIGUOUS"; resultCount: number; hits: NormattivaHit[] };

export class NormattivaProviderError extends Error {
  constructor(
    readonly code: "TIMEOUT" | "UNAVAILABLE" | "RATE_LIMITED" | "INVALID_REQUEST" | "INVALID_RESPONSE" | "RESPONSE_TOO_LARGE" | "RESULT_LIMIT_EXCEEDED",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "NormattivaProviderError";
  }
}

const boundedText = z.string().trim().min(1).max(500);
const rawHitSchema = z.object({
  codiceRedazionale: z.string().trim().min(1).max(200).optional(),
  numeroAtto: z.union([z.string(), z.number()]).optional(),
  numeroProvvedimento: z.union([z.string(), z.number()]).optional(),
  annoProvvedimento: z.union([z.number().int(), z.string()]),
  denominazioneAtto: boundedText,
  dataEmanazione: z.string().max(50).nullish(),
  descrizioneAtto: boundedText.nullish(),
  titoloAtto: boundedText.nullish(),
  numeroGU: z.union([z.string(), z.number()]).nullish(),
  dataGU: z.string().max(50).nullish(),
}).passthrough();

type NormattivaFetch = typeof fetch;

function normalized(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedNumber(value: string): string {
  return value.trim().replace(/^0+(?=\d)/, "");
}

export function buildNormattivaQuery(reference: NormattivaStructuredReference): NormattivaQuery | null {
  if (reference.kind !== "LEGISLATION" || !reference.actType || !reference.actNumber || reference.year === null) {
    return null;
  }
  const denominazioneAtto = denominationByActType[reference.actType as SupportedNormattivaActType];
  if (!denominazioneAtto || !/^\d+[A-Za-z]?$/.test(reference.actNumber) || reference.year < 1000 || reference.year > 9999) {
    return null;
  }
  return {
    denominazioneAtto,
    annoProvvedimento: reference.year,
    numeroProvvedimento: normalizedNumber(reference.actNumber),
    orderType: "DATA_DESC",
    paginazione: { paginaCorrente: 1, numeroElementiPerPagina: MAX_NORMATTIVA_RESULTS + 1 },
  };
}

async function readBoundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new NormattivaProviderError("INVALID_RESPONSE", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new NormattivaProviderError("RESPONSE_TOO_LARGE", false);
      }
      chunks.push(value);
      if (signal.aborted) throw new NormattivaProviderError("TIMEOUT", true);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new NormattivaProviderError("INVALID_RESPONSE", false);
  }
}

function responseHits(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") throw new NormattivaProviderError("INVALID_RESPONSE", false);
  const record = payload as Record<string, unknown>;
  for (const key of ["risultati", "listaAtti", "content", "items"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  throw new NormattivaProviderError("INVALID_RESPONSE", false);
}

function optionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reconcileHits(query: NormattivaQuery, payload: unknown): NormattivaLookupResult {
  const rawHits = responseHits(payload);
  if (rawHits.length > MAX_NORMATTIVA_RESULTS) {
    throw new NormattivaProviderError("RESULT_LIMIT_EXCEEDED", false);
  }
  const parsedHits = rawHits.flatMap((raw): NormattivaHit[] => {
    const parsed = rawHitSchema.safeParse(raw);
    if (!parsed.success) return [];
    const number = String(parsed.data.numeroProvvedimento ?? parsed.data.numeroAtto ?? "");
    const year = Number(parsed.data.annoProvvedimento);
    const providerRecordId = parsed.data.codiceRedazionale
      ?? `${normalized(parsed.data.denominazioneAtto)}:${normalizedNumber(number)}:${year}`;
    return [{
      providerRecordId,
      denominazioneAtto: parsed.data.denominazioneAtto,
      numeroProvvedimento: normalizedNumber(number),
      annoProvvedimento: year,
      dataEmanazione: optionalDate(parsed.data.dataEmanazione),
      descrizioneAtto: parsed.data.descrizioneAtto ?? null,
      titoloAtto: parsed.data.titoloAtto ?? null,
      numeroGU: parsed.data.numeroGU === null || parsed.data.numeroGU === undefined ? null : String(parsed.data.numeroGU),
      dataGU: optionalDate(parsed.data.dataGU),
    }];
  });
  const hitsByRecordId = new Map<string, NormattivaHit>();
  for (const hit of parsedHits) {
    const existing = hitsByRecordId.get(hit.providerRecordId);
    if (!existing) {
      hitsByRecordId.set(hit.providerRecordId, hit);
      continue;
    }
    if (
      normalized(existing.denominazioneAtto) !== normalized(hit.denominazioneAtto)
      || normalizedNumber(existing.numeroProvvedimento) !== normalizedNumber(hit.numeroProvvedimento)
      || existing.annoProvvedimento !== hit.annoProvvedimento
    ) {
      throw new NormattivaProviderError("INVALID_RESPONSE", false);
    }
  }
  const hits = [...hitsByRecordId.values()].filter((hit) =>
    normalized(hit.denominazioneAtto) === normalized(query.denominazioneAtto)
    && normalizedNumber(hit.numeroProvvedimento) === normalizedNumber(query.numeroProvvedimento)
    && hit.annoProvvedimento === query.annoProvvedimento);
  if (hits.length === 0) return { status: "NOT_FOUND", resultCount: 0, hits: [] };
  if (hits.length === 1) return { status: "FOUND_UNIQUE", resultCount: 1, hits: [hits[0]] };
  return { status: "AMBIGUOUS", resultCount: hits.length, hits };
}

function mapHttpError(status: number): NormattivaProviderError {
  if (status === 429) return new NormattivaProviderError("RATE_LIMITED", true);
  if (status >= 500) return new NormattivaProviderError("UNAVAILABLE", true);
  return new NormattivaProviderError("INVALID_REQUEST", false);
}

export function createNormattivaProvider(config: {
  timeoutMs?: number;
  maxResponseBytes?: number;
  transport?: NormattivaFetch;
} = {}) {
  const timeoutMs = config.timeoutMs ?? NORMATTIVA_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? NORMATTIVA_MAX_RESPONSE_BYTES;
  const transport = config.transport ?? globalThis.fetch.bind(globalThis);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new NormattivaProviderError("INVALID_REQUEST", false);
  }
  return {
    async lookup(query: NormattivaQuery): Promise<NormattivaLookupResult> {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await transport(NORMATTIVA_ADVANCED_SEARCH_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(query),
            signal: controller.signal,
            redirect: "error",
          });
        } catch (error) {
          if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
            throw new NormattivaProviderError("TIMEOUT", true);
          }
          throw new NormattivaProviderError("UNAVAILABLE", true);
        }
        if (!response.ok) throw mapHttpError(response.status);
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new NormattivaProviderError("INVALID_RESPONSE", false);
        }
        return reconcileHits(query, await readBoundedJson(response, maxResponseBytes, controller.signal));
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createNormattivaOfficialProvider(config: {
  timeoutMs?: number;
  maxResponseBytes?: number;
  transport?: NormattivaFetch;
} = {}): OfficialLegalReferenceProvider {
  const provider = createNormattivaProvider(config);
  return {
    providerKey: NORMATTIVA_PROVIDER,
    lookupVersion: NORMATTIVA_LOOKUP_VERSION,
    supports: (reference) => buildNormattivaQuery(reference) !== null,
    async lookup(reference: OfficialLegalReference) {
      const query = buildNormattivaQuery(reference);
      if (!query) {
        throw new OfficialLegalReferenceProviderError(
          NORMATTIVA_PROVIDER,
          "UNSUPPORTED_REFERENCE",
          false,
        );
      }
      try {
        const result = await provider.lookup(query);
        const mapHit = (hit: NormattivaHit) => ({
          providerRecordId: hit.providerRecordId,
          sourceType: hit.denominazioneAtto,
          actNumber: hit.numeroProvvedimento,
          actYear: hit.annoProvvedimento,
          issuedAt: hit.dataEmanazione,
          description: hit.descrizioneAtto,
          title: hit.titoloAtto,
          publicationNumber: hit.numeroGU,
          publishedAt: hit.dataGU,
        });
        if (result.status === "NOT_FOUND") return result;
        if (result.status === "FOUND_UNIQUE") {
          return { ...result, hits: [mapHit(result.hits[0])] };
        }
        return { ...result, hits: result.hits.map(mapHit) };
      } catch (error) {
        if (error instanceof NormattivaProviderError) {
          throw new OfficialLegalReferenceProviderError(NORMATTIVA_PROVIDER, error.code, error.retryable);
        }
        throw error;
      }
    },
  };
}