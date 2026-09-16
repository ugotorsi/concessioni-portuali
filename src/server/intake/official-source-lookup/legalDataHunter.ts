import {
  OfficialLegalReferenceProviderError,
  type OfficialLegalReference,
  type OfficialLegalReferenceCaseLawHit,
  type OfficialLegalReferenceLookupResult,
  type OfficialLegalReferenceProvider,
} from "./providers";
import { buildOfficialHitIdentityV1 } from "../official-hit-reconciliation/identity";

export const LEGAL_DATA_HUNTER_PROVIDER = "LEGAL_DATA_HUNTER_V1" as const;
export const LEGAL_DATA_HUNTER_LOOKUP_VERSION = "LEGAL_DATA_HUNTER_LOOKUP_V1" as const;
export const LEGAL_DATA_HUNTER_BASE_URL = "https://legaldatahunter.com" as const;
export const MAX_LEGAL_DATA_HUNTER_RESULTS = 10;

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256_000;
const DEFAULT_DISCOVERY_TTL_MS = 15 * 60_000;

type LegalDataHunterFetch = (input: string, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

type SourceInfo = {
  sourceId: string;
  courtName: string | null;
};

type DiscoveryCache = {
  expiresAt: number;
  sources: SourceInfo[];
};

type ParsedCaseLawRecord = {
  hit: OfficialLegalReferenceCaseLawHit;
  authorityFamily: string;
  authorityLocality: string | null;
  branch: string | null;
  courtFamily: string | null;
  courtLocality: string | null;
  normalizedDecisionNumber: string;
  normalizedSection: string | null;
  normalizedDecisionType: string | null;
  normalizedEcli: string | null;
  identityConflict: boolean;
};

export class LegalDataHunterProviderError extends OfficialLegalReferenceProviderError {
  constructor(code: string, retryable: boolean) {
    super(LEGAL_DATA_HUNTER_PROVIDER, code, retryable);
    this.name = "LegalDataHunterProviderError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : null;
}

function compactIdentity(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedNumber(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/^N(?:UMERO)?/i, "").replace(/[^\p{L}\p{N}]+/gu, "").replace(/^0+(?=\d)/, "");
}

function authorityFamily(value: string): string | null {
  const compact = compactIdentity(value);
  if (compact.includes("CASSAZIONE") || compact.includes("CORTESUPREMADICASSAZIONE")) return "CASSAZIONE";
  if (compact.includes("CONSIGLIODISTATO")) return "CONSIGLIO DI STATO";
  if (compact.includes("CORTECOSTITUZIONALE")) return "CORTE COSTITUZIONALE";
  if (compact.startsWith("TAR") || compact.includes("TRIBUNALEAMMINISTRATIVOREGIONALE")) return "TAR";
  return null;
}

function authorityCompatible(expected: string, candidate: string): boolean {
  if (authorityFamily(expected) !== authorityFamily(candidate)) return false;
  const expectedCompact = compactIdentity(expected);
  const candidateCompact = compactIdentity(candidate);
  if (expectedCompact.includes("CIVILE")) return candidateCompact.includes("CIVILE");
  if (expectedCompact.includes("PENALE")) return candidateCompact.includes("PENALE");
  if (authorityFamily(expected) === "TAR") {
    const expectedLocality = territorialAuthorityLocality(expected);
    return expectedLocality === null || candidateCompact === expectedCompact;
  }
  return true;
}

function normalizedSection(value: string): string {
  return compactIdentity(value).replace(/^SEZ(?:IONE)?/, "");
}

function authorityBranch(value: string): string | null {
  const compact = compactIdentity(value);
  if (compact.includes("CIVILE")) return "CIVILE";
  if (compact.includes("PENALE")) return "PENALE";
  return null;
}

function comparableAuthorityFamily(value: string): string {
  return authorityFamily(value) ?? compactIdentity(value);
}

function territorialAuthorityLocality(value: string): string | null {
  if (authorityFamily(value) !== "TAR") return null;
  const locality = compactIdentity(value)
    .replace(/^(?:TAR|TRIBUNALEAMMINISTRATIVOREGIONALE)/, "")
    .replace(/^(?:PERIL|PERLA|PERLO|DELLA|DEL)/, "")
    .replace("SEDEDI", "");
  return locality || null;
}

function isSupportedReference(reference: OfficialLegalReference): boolean {
  return reference.kind === "CASE_LAW"
    && reference.authorityHint !== null
    && authorityFamily(reference.authorityHint) !== null
    && reference.actNumber !== null
    && reference.year !== null;
}

function citation(reference: OfficialLegalReference): string {
  return [reference.authorityHint, reference.chamberSection ? `sez. ${reference.chamberSection}` : null,
    `n. ${reference.actNumber}/${reference.year}`].filter(Boolean).join(", ");
}

function parseDate(value: unknown): Date | null {
  const text = boundedString(value, 40);
  if (!text || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseUrl(value: unknown): string | null {
  const text = boundedString(value, 2_000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseProviderRecord(value: unknown): ParsedCaseLawRecord | null {
  if (!isObject(value)) return null;
  const source = boundedString(value.source, 200);
  const sourceId = boundedString(value.source_id, 200);
  const court = boundedString(value.court, 200);
  const authority = boundedString(value.authority, 200) ?? court;
  const decisionNumber = boundedString(value.decision_number, 100) ?? boundedString(value.case_number, 100);
  const chamber = boundedString(value.chamber, 100);
  const decidedAt = parseDate(value.date);
  const explicitYear = typeof value.year === "number" && Number.isInteger(value.year) ? value.year : null;
  const decisionYear = decidedAt?.getUTCFullYear() ?? explicitYear;
  if (!source || !sourceId || !authority || !decisionNumber || decisionYear === null) return null;
  const decisionType = boundedString(value.decision_type, 100);
  const ecli = boundedString(value.ecli, 200);
  const normalizedIdentity = buildOfficialHitIdentityV1({
    documentKind: "CASE_LAW",
    denominazioneAtto: null,
    numeroProvvedimento: null,
    annoProvvedimento: null,
    authority,
    court,
    decisionNumber,
    decisionYear,
    chamberSection: chamber,
    decisionType,
    ecli,
  });
  const normalizedCaseLaw = normalizedIdentity.normalizedIdentity.kind === "CASE_LAW"
    ? normalizedIdentity.normalizedIdentity
    : null;
  return {
    hit: {
      documentKind: "CASE_LAW",
      providerRecordId: sourceId,
      providerSourceId: source,
      authority,
      court,
      decisionNumber,
      decisionYear,
      decidedAt,
      chamberSection: chamber,
      decisionType,
      ecli,
      publicationDate: parseDate(value.publication_date),
      subject: boundedString(value.subject, 500) ?? boundedString(value.object, 500),
      outcome: boundedString(value.outcome, 500),
      title: boundedString(value.title, 500),
      sourceUrl: parseUrl(value.url),
    },
    authorityFamily: comparableAuthorityFamily(authority),
    authorityLocality: territorialAuthorityLocality(authority),
    branch: normalizedCaseLaw?.courtBranch ?? authorityBranch(authority),
    courtFamily: court ? normalizedCaseLaw?.courtFamily ?? comparableAuthorityFamily(court) : null,
    courtLocality: court ? normalizedCaseLaw?.courtLocality ?? territorialAuthorityLocality(court) : null,
    normalizedDecisionNumber: normalizedNumber(decisionNumber),
    normalizedSection: chamber ? normalizedSection(chamber) : null,
    normalizedDecisionType: decisionType
      ? compactIdentity(decisionType)
      : null,
    normalizedEcli: normalizedCaseLaw?.ecli ?? null,
    identityConflict: normalizedIdentity.identityConflict,
  };
}

function hasMultipleComparableValues(values: Array<string | number | null>): boolean {
  return new Set(values.filter((value) => value !== null)).size > 1;
}

function reconcileProviderRecords(values: unknown[], allowedSources: Set<string>): ParsedCaseLawRecord[] {
  const groups = new Map<string, ParsedCaseLawRecord[]>();
  for (const value of values) {
    const record = parseProviderRecord(value);
    if (!record || !allowedSources.has(record.hit.providerSourceId)) continue;
    const key = `${record.hit.providerSourceId}\n${record.hit.providerRecordId}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.values()].map((records) => {
    const conflicting = records.some((record) => record.identityConflict)
      || hasMultipleComparableValues(records.map((record) => record.authorityFamily))
      || hasMultipleComparableValues(records.map((record) => record.authorityLocality))
      || hasMultipleComparableValues(records.map((record) => record.branch))
      || hasMultipleComparableValues(records.map((record) => record.courtFamily))
      || hasMultipleComparableValues(records.map((record) => record.courtLocality))
      || hasMultipleComparableValues(records.map((record) => record.normalizedDecisionNumber))
      || hasMultipleComparableValues(records.map((record) => record.hit.decisionYear))
      || hasMultipleComparableValues(records.map((record) => record.normalizedSection))
      || hasMultipleComparableValues(records.map((record) => record.normalizedDecisionType))
      || hasMultipleComparableValues(records.map((record) => record.normalizedEcli));
    if (conflicting) {
      throw new LegalDataHunterProviderError("PROVIDER_IDENTITY_CONFLICT", false);
    }
    return [...records].sort((left, right) =>
      JSON.stringify(left.hit).localeCompare(JSON.stringify(right.hit), "en"))[0];
  });
}

function matchesReference(record: ParsedCaseLawRecord, reference: OfficialLegalReference): boolean {
  if (!reference.authorityHint || !reference.actNumber || reference.year === null) return false;
  if (
    !authorityCompatible(reference.authorityHint, record.hit.authority)
    && (!record.hit.court || !authorityCompatible(reference.authorityHint, record.hit.court))
  ) return false;
  if (record.normalizedDecisionNumber !== normalizedNumber(reference.actNumber)) return false;
  if (record.hit.decisionYear !== reference.year) return false;
  return reference.chamberSection === null
    || (record.normalizedSection !== null
      && record.normalizedSection === normalizedSection(reference.chamberSection));
}

function classify(
  values: unknown[],
  reference: OfficialLegalReference,
  allowedSources: Set<string>,
): OfficialLegalReferenceLookupResult {
  const hits = reconcileProviderRecords(values, allowedSources)
    .filter((record) => matchesReference(record, reference))
    .map((record) => record.hit);
  if (hits.length === 0) return { status: "NOT_FOUND", resultCount: 0, hits: [] };
  if (hits.length === 1) return { status: "FOUND_UNIQUE", resultCount: 1, hits: [hits[0]] };
  return { status: "AMBIGUOUS", resultCount: hits.length, hits };
}

async function readBoundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new LegalDataHunterProviderError("RESPONSE_TOO_LARGE", false);
  }
  if (!response.body) throw new LegalDataHunterProviderError("INVALID_RESPONSE", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new LegalDataHunterProviderError("RESPONSE_TOO_LARGE", false);
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof LegalDataHunterProviderError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new LegalDataHunterProviderError("INVALID_RESPONSE", false);
  } finally {
    reader.releaseLock();
  }
}

function httpError(status: number): LegalDataHunterProviderError {
  if (status === 401 || status === 403) return new LegalDataHunterProviderError("AUTHENTICATION_FAILED", false);
  if (status === 429) return new LegalDataHunterProviderError("RATE_LIMITED", true);
  if (status >= 500) return new LegalDataHunterProviderError("UPSTREAM_UNAVAILABLE", true);
  return new LegalDataHunterProviderError("REQUEST_REJECTED", false);
}

export function createLegalDataHunterProvider(config: {
  apiKey?: string | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
  discoveryTtlMs?: number;
  now?: () => number;
  transport?: LegalDataHunterFetch;
} = {}): OfficialLegalReferenceProvider {
  const apiKey = config.apiKey === undefined ? process.env.LEGAL_DATA_HUNTER_API_KEY ?? null : config.apiKey;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const discoveryTtlMs = config.discoveryTtlMs ?? DEFAULT_DISCOVERY_TTL_MS;
  const now = config.now ?? Date.now;
  const transport = config.transport ?? fetch;
  let discoveryCache: DiscoveryCache | null = null;

  async function request(path: string, body?: JsonObject): Promise<unknown> {
    if (!apiKey) throw new LegalDataHunterProviderError("DISABLED", false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(`${LEGAL_DATA_HUNTER_BASE_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw httpError(response.status);
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        throw new LegalDataHunterProviderError("INVALID_RESPONSE", false);
      }
      return await readBoundedJson(response, maxResponseBytes, controller.signal);
    } catch (error) {
      if (error instanceof LegalDataHunterProviderError) throw error;
      if ((error instanceof DOMException && error.name === "AbortError") || controller.signal.aborted) {
        throw new LegalDataHunterProviderError("TIMEOUT", true);
      }
      throw new LegalDataHunterProviderError("NETWORK_ERROR", true);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function discover(reference: OfficialLegalReference): Promise<SourceInfo[]> {
    let sources = discoveryCache?.expiresAt && discoveryCache.expiresAt > now()
      ? discoveryCache.sources
      : null;
    if (!sources) {
      const payload = await request("/v1/discover/countries/IT/sources");
      if (!isObject(payload) || !Array.isArray(payload.sources)) {
        throw new LegalDataHunterProviderError("INVALID_RESPONSE", false);
      }
      sources = payload.sources.flatMap((value): SourceInfo[] => {
        if (!isObject(value) || !Array.isArray(value.data_types) || !value.data_types.includes("case_law")) return [];
        const sourceId = boundedString(value.source_id, 200);
        const courtName = boundedString(value.court_name, 200);
        return sourceId ? [{ sourceId, courtName }] : [];
      });
      discoveryCache = { expiresAt: now() + discoveryTtlMs, sources };
    }
    const family = authorityFamily(reference.authorityHint!);
    return sources.filter((source) => source.courtName === null || authorityFamily(source.courtName) === family);
  }

  async function lookup(reference: OfficialLegalReference): Promise<OfficialLegalReferenceLookupResult> {
    if (!isSupportedReference(reference)) {
      throw new LegalDataHunterProviderError("UNSUPPORTED_REFERENCE", false);
    }
    const sources = await discover(reference);
    if (sources.length === 0) throw new LegalDataHunterProviderError("UNSUPPORTED_AUTHORITY", false);
    const resolved = await request("/v1/resolve", {
      reference: citation(reference),
      hint_country: "IT",
      hint_type: "case_law",
    });
    if (!isObject(resolved) || !Array.isArray(resolved.documents) || typeof resolved.match_type !== "string") {
      throw new LegalDataHunterProviderError("INVALID_RESPONSE", false);
    }
    if (resolved.match_type === "timeout" || resolved.match_type === "error") {
      throw new LegalDataHunterProviderError("RESOLUTION_FAILED", true);
    }
    if (resolved.documents.length > MAX_LEGAL_DATA_HUNTER_RESULTS) {
      throw new LegalDataHunterProviderError("RESULT_LIMIT_EXCEEDED", false);
    }
    const allowedSources = new Set(sources.map(({ sourceId }) => sourceId));
    const resolvedResult = classify(resolved.documents, reference, allowedSources);
    if (resolvedResult.status !== "NOT_FOUND") return resolvedResult;

    const searched = await request("/v1/search", {
      q: citation(reference),
      namespace: "case_law",
      country: ["IT"],
      source: sources.map(({ sourceId }) => sourceId),
      date_start: `${reference.year}-01-01`,
      date_end: `${reference.year}-12-31`,
      top_k: MAX_LEGAL_DATA_HUNTER_RESULTS,
      alpha: 0,
      result_detail: "snippet",
    });
    if (!isObject(searched) || !Array.isArray(searched.hits) || searched.hits.length > MAX_LEGAL_DATA_HUNTER_RESULTS) {
      throw new LegalDataHunterProviderError("INVALID_RESPONSE", false);
    }
    return classify(searched.hits, reference, allowedSources);
  }

  return {
    providerKey: LEGAL_DATA_HUNTER_PROVIDER,
    lookupVersion: LEGAL_DATA_HUNTER_LOOKUP_VERSION,
    supports: (reference) => Boolean(apiKey) && isSupportedReference(reference),
    lookup,
  };
}
