import { z } from "zod";

import {
  OfficialLegalReferenceProviderError,
  type OfficialLegalReference,
  type OfficialLegalReferenceCaseLawHit,
  type OfficialLegalReferenceLookupResult,
  type OfficialLegalReferenceProvider,
} from "./providers";

export const OPENGA_PROVIDER = "OPENGA_V1" as const;
export const OPENGA_LOOKUP_VERSION = "OPENGA_LOOKUP_V1" as const;
export const OPENGA_BASE_URL = "https://openga.giustizia-amministrativa.it" as const;
export const OPENGA_MAX_RESULTS = 100;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_METADATA_TTL_MS = 15 * 60_000;

type OpenGaFetch = (input: string, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

type CourtDefinition = Readonly<{
  officialName: string;
  datasetSlug: string;
  aliases: readonly string[];
}>;

const courtDefinitions: readonly CourtDefinition[] = [
  { officialName: "Consiglio di Stato", datasetSlug: "sentenze-consiglio-di-stato", aliases: ["CONSIGLIO DI STATO", "CDS"] },
  { officialName: "CGA Sicilia", datasetSlug: "sentenze-cga-sicilia", aliases: ["CGA", "CGA SICILIA", "CONSIGLIO DI GIUSTIZIA AMMINISTRATIVA", "CONSIGLIO DI GIUSTIZIA AMMINISTRATIVA PER LA REGIONE SICILIANA"] },
  { officialName: "TAR Abruzzo L'Aquila", datasetSlug: "sentenze-tar-abruzzo-laquila", aliases: ["TAR ABRUZZO L AQUILA"] },
  { officialName: "TAR Abruzzo Pescara", datasetSlug: "sentenze-tar-abruzzo-pescara", aliases: ["TAR ABRUZZO PESCARA"] },
  { officialName: "TAR Basilicata Potenza", datasetSlug: "sentenze-tar-basilicata-potenza", aliases: ["TAR BASILICATA", "TAR BASILICATA POTENZA"] },
  { officialName: "TAR Calabria Catanzaro", datasetSlug: "sentenze-tar-calabria-catanzaro", aliases: ["TAR CALABRIA CATANZARO"] },
  { officialName: "TAR Calabria Reggio Calabria", datasetSlug: "sentenze-tar-calabria-reggio-calabria", aliases: ["TAR CALABRIA REGGIO CALABRIA"] },
  { officialName: "TAR Campania Napoli", datasetSlug: "sentenze-tar-campania-napoli", aliases: ["TAR CAMPANIA NAPOLI"] },
  { officialName: "TAR Campania Salerno", datasetSlug: "sentenze-tar-campania-salerno", aliases: ["TAR CAMPANIA SALERNO"] },
  { officialName: "TAR Emilia-Romagna Bologna", datasetSlug: "sentenze-tar-emilia-romagna-bologna", aliases: ["TAR EMILIA ROMAGNA BOLOGNA"] },
  { officialName: "TAR Emilia-Romagna Parma", datasetSlug: "sentenze-tar-emilia-romagna-parma", aliases: ["TAR EMILIA ROMAGNA PARMA"] },
  { officialName: "TAR Friuli-Venezia Giulia Trieste", datasetSlug: "sentenze-tar-friuli-venezia-giulia-trieste", aliases: ["TAR FRIULI VENEZIA GIULIA", "TAR FRIULI VENEZIA GIULIA TRIESTE"] },
  { officialName: "TAR Lazio Latina", datasetSlug: "sentenze-tar-lazio-latina", aliases: ["TAR LAZIO LATINA"] },
  { officialName: "TAR Lazio Roma", datasetSlug: "sentenze-tar-lazio-roma", aliases: ["TAR LAZIO ROMA"] },
  { officialName: "TAR Liguria Genova", datasetSlug: "sentenze-tar-liguria-genova", aliases: ["TAR LIGURIA", "TAR LIGURIA GENOVA"] },
  { officialName: "TAR Lombardia Brescia", datasetSlug: "sentenze-tar-lombardia-brescia", aliases: ["TAR LOMBARDIA BRESCIA"] },
  { officialName: "TAR Lombardia Milano", datasetSlug: "sentenze-tar-lombardia-milano", aliases: ["TAR LOMBARDIA MILANO"] },
  { officialName: "TAR Marche Ancona", datasetSlug: "sentenze-tar-marche-ancona", aliases: ["TAR MARCHE", "TAR MARCHE ANCONA"] },
  { officialName: "TAR Molise Campobasso", datasetSlug: "sentenze-tar-molise-campobasso", aliases: ["TAR MOLISE", "TAR MOLISE CAMPOBASSO"] },
  { officialName: "TAR Piemonte Torino", datasetSlug: "sentenze-tar-piemonte-torino", aliases: ["TAR PIEMONTE", "TAR PIEMONTE TORINO"] },
  { officialName: "TAR Puglia Bari", datasetSlug: "sentenze-tar-puglia-bari", aliases: ["TAR PUGLIA BARI"] },
  { officialName: "TAR Puglia Lecce", datasetSlug: "sentenze-tar-puglia-lecce", aliases: ["TAR PUGLIA LECCE"] },
  { officialName: "TAR Sardegna Cagliari", datasetSlug: "sentenze-tar-sardegna-cagliari", aliases: ["TAR SARDEGNA", "TAR SARDEGNA CAGLIARI"] },
  { officialName: "TAR Sicilia Catania", datasetSlug: "sentenze-tar-sicilia-catania", aliases: ["TAR SICILIA CATANIA"] },
  { officialName: "TAR Sicilia Palermo", datasetSlug: "sentenze-tar-sicilia-palermo", aliases: ["TAR SICILIA PALERMO"] },
  { officialName: "TAR Toscana Firenze", datasetSlug: "sentenze-tar-toscana-firenze", aliases: ["TAR TOSCANA", "TAR TOSCANA FIRENZE"] },
  { officialName: "TAR Umbria Perugia", datasetSlug: "sentenze-tar-umbria-perugia", aliases: ["TAR UMBRIA", "TAR UMBRIA PERUGIA"] },
  { officialName: "TAR Valle d'Aosta Aosta", datasetSlug: "sentenze-tar-valle-d-aosta-aosta", aliases: ["TAR VALLE D AOSTA", "TAR VALLE D AOSTA AOSTA"] },
  { officialName: "TAR Veneto Venezia", datasetSlug: "sentenze-tar-veneto-venezia", aliases: ["TAR VENETO", "TAR VENETO VENEZIA"] },
  { officialName: "TRGA Bolzano", datasetSlug: "sentenze-trga-bolzano", aliases: ["TRGA BOLZANO", "TRIBUNALE REGIONALE DI GIUSTIZIA AMMINISTRATIVA BOLZANO"] },
  { officialName: "TRGA Trento", datasetSlug: "sentenze-trga-trento", aliases: ["TRGA TRENTO", "TRIBUNALE REGIONALE DI GIUSTIZIA AMMINISTRATIVA TRENTO"] },
] as const;

export const OPENGA_DATASET_MAPPING = Object.freeze(Object.fromEntries(
  courtDefinitions.map(({ officialName, datasetSlug }) => [officialName, datasetSlug]),
));

type DatasetResolution = Readonly<{
  officialName: string;
  datasetSlug: string;
}>;

type Resource = Readonly<{
  id: string;
  name: string;
  description: string;
  format: string;
  url: string | null;
  datastoreActive: boolean;
}>;

type CachedDataset = Readonly<{
  expiresAt: number;
  resources: readonly Resource[];
}>;

const packageSchema = z.object({
  success: z.literal(true),
  result: z.object({
    name: z.string().trim().min(1).max(300),
    resources: z.array(z.object({
      id: z.string().trim().min(1).max(300),
      name: z.string().max(500).nullish(),
      description: z.string().max(2_000).nullish(),
      format: z.string().max(50).nullish(),
      url: z.string().max(2_000).nullish(),
      datastore_active: z.boolean().optional(),
    }).passthrough()).max(500),
  }).passthrough(),
}).passthrough();

export class OpenGaProviderError extends OfficialLegalReferenceProviderError {
  constructor(code: string, retryable: boolean) {
    super(OPENGA_PROVIDER, code, retryable);
    this.name = "OpenGaProviderError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function compact(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function normalizedCourtAlias(value: string): string {
  return compact(value)
    .replace(/^TRIBUNALE AMMINISTRATIVO REGIONALE\s+/, "TAR ")
    .replace(/^TRIBUNALE REGIONALE DI GIUSTIZIA AMMINISTRATIVA\s+/, "TRGA ")
    .replace(/^(TAR) (?:PER IL|PER LA|DEL|DELLA)\s+/, "$1 ")
    .replace(/\s+SEDE DI\s+/g, " ")
    .trim();
}

const courtByAlias = new Map(courtDefinitions.flatMap((definition) =>
  definition.aliases.map((alias) => [normalizedCourtAlias(alias), definition] as const)));

export function resolveOpenGaCourt(authorityHint: string | null): DatasetResolution | null {
  if (!authorityHint) return null;
  const definition = courtByAlias.get(normalizedCourtAlias(authorityHint));
  return definition
    ? { officialName: definition.officialName, datasetSlug: definition.datasetSlug }
    : null;
}

function normalizeDecisionNumber(value: string, year: number): string | null {
  const compactNumber = value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const prefixed = /^(\d{4})(\d{5})$/.exec(compactNumber);
  const candidate = prefixed && Number(prefixed[1]) === year ? prefixed[2] : compactNumber;
  const normalized = candidate.replace(/^0+(?=\d)/, "");
  return /^[0-9]+[A-Z]?$/.test(normalized) ? normalized : null;
}

export function buildOpenGaCompositeNumber(decisionNumber: string, year: number): string | null {
  const normalized = normalizeDecisionNumber(decisionNumber, year);
  if (!normalized || !/^\d+$/.test(normalized) || normalized.length > 5 || year < 2017 || year > 9999) return null;
  return `${year}${normalized.padStart(5, "0")}`;
}

function normalizedDecisionType(value: string | null): string | null {
  const normalized = value ? compact(value).replace(/\s+/g, "") : "";
  if (normalized.startsWith("SENTENZ")) return "SENTENZA";
  if (normalized.startsWith("ORDINANZ")) return "ORDINANZA";
  if (normalized.startsWith("DECRET")) return "DECRETO";
  if (normalized.startsWith("PARER")) return "PARERE";
  return null;
}

function normalizedSection(value: string): string {
  return compact(value).replace(/^SEZ(?:IONE)?\s*/, "").replace(/\s+/g, "");
}

function field(record: JsonObject, names: readonly string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  const allowed = new Set(names.map((name) => compact(name).replace(/\s+/g, "")));
  for (const [name, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && allowed.has(compact(name).replace(/\s+/g, ""))) {
      return value;
    }
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  const text = boundedString(value, 50);
  if (!text) return null;
  const italian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const normalized = italian ? `${italian[3]}-${italian[2]}-${italian[1]}T00:00:00.000Z` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowYear(record: JsonObject, publicationDate: Date | null, decisionDate: Date | null): number | null {
  const explicit = Number(field(record, ["anno", "Anno", "decision_year", "anno_provvedimento"]));
  if (Number.isInteger(explicit) && explicit >= 1000 && explicit <= 9999) return explicit;
  return decisionDate?.getUTCFullYear() ?? publicationDate?.getUTCFullYear() ?? null;
}

function rowCourt(record: JsonObject): string | null {
  const court = boundedString(field(record, ["organo", "Organo", "court", "autorita"]), 200);
  const seat = boundedString(field(record, ["sede", "Sede", "seat"]), 100);
  if (!court) return null;
  if (!seat || compact(court).includes(compact(seat))) return court;
  return `${court} ${seat}`;
}

function mapRow(
  value: unknown,
  reference: OfficialLegalReference,
  dataset: DatasetResolution,
  resourceId: string,
): OfficialLegalReferenceCaseLawHit | null {
  if (!isObject(value) || !reference.actNumber || reference.year === null) return null;
  const providerNumber = boundedString(field(value, [
    "numero", "Numero", "numero_provvedimento", "numeroProvvedimento", "decision_number", "nrg",
  ]), 100);
  const decisionType = normalizedDecisionType(boundedString(field(value, [
    "tipo", "Tipo", "tipo_provvedimento", "tipoProvvedimento", "decision_type",
  ]), 100));
  const court = rowCourt(value);
  const courtResolution = resolveOpenGaCourt(court);
  const publicationDate = parseDate(field(value, [
    "data_pubblicazione", "dataPubblicazione", "Data pubblicazione", "publication_date",
  ]));
  const decisionDate = parseDate(field(value, [
    "data_decisione", "dataDecisione", "Data decisione", "decision_date",
  ]));
  const year = rowYear(value, publicationDate, decisionDate);
  const number = providerNumber ? normalizeDecisionNumber(providerNumber, reference.year) : null;
  const expectedType = reference.actType ? normalizedDecisionType(reference.actType) : null;
  const section = boundedString(field(value, ["sezione", "Sezione", "section"]), 100);
  if (
    !providerNumber
    || !number
    || !decisionType
    || !court
    || courtResolution?.datasetSlug !== dataset.datasetSlug
    || number !== normalizeDecisionNumber(reference.actNumber, reference.year)
    || year !== reference.year
    || (reference.actType !== null && decisionType !== expectedType)
    || (reference.chamberSection !== null
      && (!section || normalizedSection(section) !== normalizedSection(reference.chamberSection)))
  ) return null;

  const providerRecordId = boundedString(field(value, ["_id", "id", "ID", "identificativo"]), 200)
    ?? `${resourceId}:${buildOpenGaCompositeNumber(number, year)}`;
  return {
    documentKind: "CASE_LAW",
    providerRecordId,
    providerSourceId: `${dataset.datasetSlug}:${resourceId}`,
    authority: dataset.officialName,
    court,
    decisionNumber: number,
    decisionYear: year,
    decidedAt: decisionDate,
    chamberSection: section,
    decisionType,
    ecli: null,
    publicationDate,
    subject: boundedString(field(value, ["oggetto", "Oggetto", "subject", "object"]), 500),
    outcome: boundedString(field(value, ["esito", "Esito", "outcome"]), 500),
    title: boundedString(field(value, ["titolo", "Titolo", "title"]), 500),
    sourceUrl: null,
  };
}

function selectResource(resources: readonly Resource[], year: number): Resource | null {
  const yearPattern = new RegExp(`(^|\\D)${year}(\\D|$)`);
  const candidates = resources.filter((resource) => {
    const searchable = `${resource.name} ${resource.description} ${resource.url ?? ""}`;
    return yearPattern.test(searchable) && (resource.datastoreActive || resource.format === "JSON");
  });
  const preferred = candidates.filter((resource) => resource.datastoreActive);
  const selected = preferred.length > 0 ? preferred : candidates;
  if (selected.length > 1) throw new OpenGaProviderError("AMBIGUOUS_RESOURCE", false);
  return selected[0] ?? null;
}

async function readBoundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new OpenGaProviderError("RESPONSE_TOO_LARGE", false);
  }
  if (!response.body) throw new OpenGaProviderError("INVALID_RESPONSE", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new OpenGaProviderError("RESPONSE_TOO_LARGE", false);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof OpenGaProviderError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new OpenGaProviderError("INVALID_RESPONSE", false);
  } finally {
    reader.releaseLock();
  }
}

function httpError(status: number): OpenGaProviderError {
  if (status === 429) return new OpenGaProviderError("RATE_LIMITED", true);
  if (status >= 500) return new OpenGaProviderError("UPSTREAM_UNAVAILABLE", true);
  if (status === 404) return new OpenGaProviderError("RESOURCE_NOT_FOUND", false);
  return new OpenGaProviderError("REQUEST_REJECTED", false);
}

function recordsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) throw new OpenGaProviderError("INVALID_RESPONSE", false);
  if (Array.isArray(payload.records)) return payload.records;
  if (isObject(payload.result) && Array.isArray(payload.result.records)) return payload.result.records;
  throw new OpenGaProviderError("INVALID_RESPONSE", false);
}

export function createOpenGaProvider(config: {
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  metadataTtlMs?: number;
  now?: () => number;
  transport?: OpenGaFetch;
} = {}): OfficialLegalReferenceProvider {
  const baseUrl = config.baseUrl ?? OPENGA_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const metadataTtlMs = config.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS;
  const now = config.now ?? Date.now;
  const transport = config.transport ?? fetch;
  const metadataCache = new Map<string, CachedDataset>();

  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1
    || !Number.isSafeInteger(metadataTtlMs) || metadataTtlMs < 0
  ) throw new OpenGaProviderError("INVALID_CONFIGURATION", false);

  async function request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new OpenGaProviderError("INVALID_RESOURCE_URL", false);
      }
      if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith("giustizia-amministrativa.it")) {
        throw new OpenGaProviderError("INVALID_RESOURCE_URL", false);
      }
      const response = await transport(parsedUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw httpError(response.status);
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        throw new OpenGaProviderError("INVALID_RESPONSE", false);
      }
      return await readBoundedJson(response, maxResponseBytes, controller.signal);
    } catch (error) {
      if (error instanceof OpenGaProviderError) throw error;
      if ((error instanceof DOMException && error.name === "AbortError") || controller.signal.aborted) {
        throw new OpenGaProviderError("TIMEOUT", true);
      }
      throw new OpenGaProviderError("NETWORK_ERROR", true);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resources(datasetSlug: string): Promise<readonly Resource[]> {
    const cached = metadataCache.get(datasetSlug);
    if (cached && cached.expiresAt > now()) return cached.resources;
    const payload = await request(`${baseUrl}/api/3/action/package_show?id=${encodeURIComponent(datasetSlug)}`);
    const parsed = packageSchema.safeParse(payload);
    if (!parsed.success || parsed.data.result.name !== datasetSlug) {
      throw new OpenGaProviderError("INVALID_RESPONSE", false);
    }
    const mapped = parsed.data.result.resources.map((resource): Resource => ({
      id: resource.id,
      name: resource.name ?? "",
      description: resource.description ?? "",
      format: (resource.format ?? "").trim().toUpperCase(),
      url: resource.url ?? null,
      datastoreActive: resource.datastore_active === true,
    }));
    metadataCache.set(datasetSlug, { expiresAt: now() + metadataTtlMs, resources: mapped });
    return mapped;
  }

  function supports(reference: OfficialLegalReference): boolean {
    return reference.kind === "CASE_LAW"
      && resolveOpenGaCourt(reference.authorityHint) !== null
      && reference.actNumber !== null
      && reference.year !== null
      && buildOpenGaCompositeNumber(reference.actNumber, reference.year) !== null
      && (reference.actType === null || normalizedDecisionType(reference.actType) !== null);
  }

  async function lookup(reference: OfficialLegalReference): Promise<OfficialLegalReferenceLookupResult> {
    if (!supports(reference)) throw new OpenGaProviderError("UNSUPPORTED_REFERENCE", false);
    const dataset = resolveOpenGaCourt(reference.authorityHint)!;
    const resource = selectResource(await resources(dataset.datasetSlug), reference.year!);
    if (!resource) return { status: "NOT_FOUND", resultCount: 0, hits: [] };
    const compositeNumber = buildOpenGaCompositeNumber(reference.actNumber!, reference.year!)!;
    const dataUrl = resource.datastoreActive
      ? `${baseUrl}/api/3/action/datastore_search?resource_id=${encodeURIComponent(resource.id)}&q=${encodeURIComponent(compositeNumber)}&limit=${OPENGA_MAX_RESULTS + 1}`
      : resource.url;
    if (!dataUrl) throw new OpenGaProviderError("INVALID_RESOURCE_URL", false);
    const records = recordsFromPayload(await request(dataUrl));
    if (records.length > OPENGA_MAX_RESULTS) throw new OpenGaProviderError("RESULT_LIMIT_EXCEEDED", false);
    const hits = records.flatMap((record): OfficialLegalReferenceCaseLawHit[] => {
      const hit = mapRow(record, reference, dataset, resource.id);
      return hit ? [hit] : [];
    });
    if (hits.length === 0) return { status: "NOT_FOUND", resultCount: 0, hits: [] };
    if (hits.length === 1) return { status: "FOUND_UNIQUE", resultCount: 1, hits: [hits[0]] };
    return { status: "AMBIGUOUS", resultCount: hits.length, hits };
  }

  return { providerKey: OPENGA_PROVIDER, lookupVersion: OPENGA_LOOKUP_VERSION, supports, lookup };
}