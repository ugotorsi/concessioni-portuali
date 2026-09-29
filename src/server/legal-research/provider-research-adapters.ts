import { createHash } from "node:crypto";

import {
  createAuthorityCandidate,
  type AuthorityCandidate,
  type ResearchCapability,
  type ResearchGap,
  type ResearchMission,
  type ResearchOperationType,
  type ResearchSourceFamily,
  type ResearchToolRole,
} from "./bridge";
import {
  validateProviderToolInput,
  validateProviderToolOutput,
  type CatalogProvider,
} from "./provider-capability-mapping";

export type ProviderToolRequest = Readonly<{
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}>;

export type ProviderToolCaller = (request: ProviderToolRequest) => Promise<unknown>;

export type NormalizedProviderEvidence = Readonly<{
  resultCount: number;
  resultIdentifiersUsed: readonly string[];
  authorityCandidates: readonly AuthorityCandidate[];
  evidenceGaps: readonly ResearchGap[];
  incomplete: boolean;
}>;

export type ResearchProviderAdapter = Readonly<{
  provider: CatalogProvider;
  capability: ResearchCapability;
  toolName: string;
  role: ResearchToolRole;
  operationType: ResearchOperationType;
  prepare(mission: ResearchMission, discovered?: readonly AuthorityCandidate[]): ProviderToolRequest;
  prepareRequests?(mission: ResearchMission): readonly ProviderToolRequest[];
  callTool(request: ProviderToolRequest): Promise<unknown>;
  normalize(
    response: unknown,
    context: Readonly<{ mission: ResearchMission; executionRecordId: string; request?: ProviderToolRequest }>,
  ): NormalizedProviderEvidence;
}>;

export class ProviderResearchAdapterError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = "ProviderResearchAdapterError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function sourceFamily(...values: readonly unknown[]): ResearchSourceFamily {
  const joined = values.filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
    if (joined.includes("NORMATIVA-UE")) return "EU_LEGISLATION";
    if (joined.includes("NORMATIVA-ITALIANA") || joined.includes("CODICE CIVILE")) {
      return "ITALIAN_LEGISLATION";
    }
  if (joined.includes("CASSAZIONE")) return "CASSAZIONE";
  if (joined.includes("CORTE COST")) return "CORTE_COSTITUZIONALE";
  if (joined.includes("CONSIGLIO DI STATO") || /\bTAR\b/.test(joined)) return "GIUSTIZIA_AMMINISTRATIVA";
  if (joined.includes("ECLI:EU:") || joined.includes("COURT OF JUSTICE")) return "CJEU";
  if (joined.includes("CELEX") || joined.includes("EUROPEAN UNION")) return "EU_LEGISLATION";
  if (joined.includes("ECHR") || joined.includes("CEDU")) return "ECHR";
  return "OTHER";
}

function gap(
  mission: ResearchMission,
  executionRecordId: string,
  discriminator: string,
  kind: ResearchGap["kind"] = "OFFICIAL_IDENTITY_NOT_VERIFIED",
): ResearchGap {
  return {
    gapId: stableId("research-gap", [mission.missionId, executionRecordId, discriminator]),
    kind,
  };
}

function moonlitPayload(response: unknown): Record<string, unknown> {
  const outer = record(response);
  if (!outer || outer.isError === true || !Array.isArray(outer.content)) {
    throw new ProviderResearchAdapterError("MOONLIT_RESPONSE_UNCERTAIN");
  }
  const item = outer.content
    .map(record)
    .find((candidate) => candidate?.type === "text" && typeof candidate.text === "string");
  if (!item) throw new ProviderResearchAdapterError("MOONLIT_RESPONSE_UNCERTAIN");
  try {
    const payload = record(JSON.parse(item.text as string));
    if (!payload) throw new Error();
    return payload;
  } catch {
    throw new ProviderResearchAdapterError("MOONLIT_RESPONSE_UNCERTAIN");
  }
}

function moonlitCandidate(
  value: unknown,
  executionRecordId: string,
  retrievalMethod: ResearchOperationType,
): AuthorityCandidate | null {
  const item = record(value);
  if (!item) return null;
  const identifier = text(item.identifier);
  const secondaryIdentifier = text(item.secondaryIdentifier);
  if (!identifier && !secondaryIdentifier) return null;
  const documentTypes = Array.isArray(item.documentTypes) ? item.documentTypes.map(record) : [];
  const sources = Array.isArray(item.sources) ? item.sources.map(record) : [];
  const documentType = documentTypes.map((entry) => text(entry?.name)).find(Boolean);
  const providerId = sources.map((entry) => text(entry?.id)).find(Boolean) ?? text(item.portal) ?? "MOONLIT";
  const officialIdentifier = secondaryIdentifier ?? identifier;
  const family = sourceFamily(
    item.court,
    item.portal,
    officialIdentifier,
    ...sources.flatMap((entry) => [entry?.id, entry?.name]),
  );
  return createAuthorityCandidate({
    kind: "AUTHORITY_CANDIDATE",
    executionRecordId,
    toolId: "MOONLIT",
    providerId,
    ...(text(item.court) ? { courtOrBody: text(item.court) } : {}),
    ...(documentType ? { documentType } : {}),
    ...(finiteInteger(item.year) ? { year: finiteInteger(item.year) } : {}),
    ...(text(item.title) ? { title: text(item.title) } : {}),
    ...(text(item.sourceUrl) ? { sourceUrl: text(item.sourceUrl) } : {}),
    ...(identifier ? { providerDocumentId: identifier } : {}),
    ...(officialIdentifier ? { officialIdentifier } : {}),
    ...(officialIdentifier?.startsWith("ECLI:") ? { ecli: officialIdentifier } : {}),
    supportDirection: "UNKNOWN",
    sourceFamily: family,
    retrievalMethod,
    fullTextAvailable: false,
    verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
  });
}

function normalizeMoonlitSearch(
  response: unknown,
  context: Readonly<{ mission: ResearchMission; executionRecordId: string }>,
  retrievalMethod: "SEMANTIC_SEARCH" | "KEYWORD_SEARCH",
): NormalizedProviderEvidence {
  const payload = moonlitPayload(response);
  const result = record(payload.result);
  if (payload.success !== true || !result || !Array.isArray(result.results)) {
    throw new ProviderResearchAdapterError("MOONLIT_RESPONSE_UNCERTAIN");
  }
  const candidates: AuthorityCandidate[] = [];
  const gaps: ResearchGap[] = [];
  for (const [index, item] of result.results.entries()) {
    const candidate = moonlitCandidate(item, context.executionRecordId, retrievalMethod);
    if (candidate) candidates.push(candidate);
    else gaps.push(gap(context.mission, context.executionRecordId, `moonlit:${index}`));
  }
  if (result.results.length === 0) {
    gaps.push(gap(context.mission, context.executionRecordId, "moonlit:empty", "MISSING_DOCUMENT"));
  }
  return {
    resultCount: result.results.length,
    resultIdentifiersUsed: candidates.flatMap((candidate) => [
      candidate.providerDocumentId ?? candidate.officialIdentifier ?? candidate.candidateId,
    ]),
    authorityCandidates: candidates,
    evidenceGaps: gaps,
    incomplete: gaps.length > 0,
  };
}

function normalizeMoonlitExact(
  response: unknown,
  context: Readonly<{ mission: ResearchMission; executionRecordId: string }>,
): NormalizedProviderEvidence {
  const candidate = moonlitCandidate(
    moonlitPayload(response),
    context.executionRecordId,
    "EXACT_RETRIEVAL",
  );
  if (!candidate) {
    return {
      resultCount: 1,
      resultIdentifiersUsed: [],
      authorityCandidates: [],
      evidenceGaps: [gap(context.mission, context.executionRecordId, "moonlit:exact")],
      incomplete: true,
    };
  }
  return {
    resultCount: 1,
    resultIdentifiersUsed: [candidate.providerDocumentId ?? candidate.officialIdentifier ?? candidate.candidateId],
    authorityCandidates: [candidate],
    evidenceGaps: [],
    incomplete: false,
  };
}

function simpliciterIdentity(item: Record<string, unknown>): string | undefined {
  return text(item.citazione)
    ?? text(item.alias)
    ?? text(item.Documento)
    ?? text(item.identifier)
    ?? text(item.document_identifier)
    ?? text(item.ecli)
    ?? text(item.celex)
    ?? text(item.id);
}

type SimpliciterLegislationReference = Readonly<{ article: string; law: string }>;

function normalizedArticle(value: string): string {
  return value.trim().toLowerCase().replace(/[‐‑‒–—]/g, "-");
}

function simpliciterLegislationReference(
  identifier: string,
  title?: string,
): SimpliciterLegislationReference | undefined {
  const article = identifier.match(/^art(?:icolo)?\.?\s*([0-9]+(?:[/.-][0-9]+)*(?:-[a-z]+)?)/i)?.[1];
  if (!article) return undefined;
  const identity = `${identifier} ${title ?? ""}`;
  if (/\bcodice civile\b/i.test(identity)) {
    return { article: normalizedArticle(article), law: "codice civile" };
  }
  if (/\blegge(?:\s+n\.)?\s*84(?:\s*\/\s*1994|\s+del\s+28\s+gennaio\s+1994)\b/i.test(identity)) {
    return { article: normalizedArticle(article), law: "legge 84/1994" };
  }
  return undefined;
}

function requestedSimpliciterLegislationReference(
  request?: ProviderToolRequest,
): SimpliciterLegislationReference | undefined {
  if (!request || !Array.isArray(request.arguments.sources) || request.arguments.sources.length !== 1) {
    return undefined;
  }
  const source = record(request.arguments.sources[0]);
  const article = text(source?.number);
  const law = text(source?.law)?.toLowerCase().replace(/\s+/g, " ");
  if (source?.source_key !== "it.legislation.normativa-italiana" || !article || !law) return undefined;
  if (law === "codice civile") return { article: normalizedArticle(article), law };
  if (/^legge\s+(?:n\.\s*)?84\s*\/\s*1994$/i.test(law)) {
    return { article: normalizedArticle(article), law: "legge 84/1994" };
  }
  return undefined;
}

function simpliciterActDate(identifier: string): string | undefined {
  const match = identifier.match(/\bdel\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/i);
  if (!match) return undefined;
  const month = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
    .indexOf(match[2].toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeSimpliciter(
  response: unknown,
  context: Readonly<{ mission: ResearchMission; executionRecordId: string; request?: ProviderToolRequest }>,
  toolName: "legal_research" | "fetch_legal_source",
  operationType: "SEMANTIC_SEARCH" | "EXACT_RETRIEVAL" | "CROSS_JURISDICTION_SEARCH",
): NormalizedProviderEvidence {
  const outer = record(response);
  const structuredContent = record(outer?.structuredContent);
  if (outer?.isError === true || !structuredContent) {
    throw new ProviderResearchAdapterError("SIMPLICITER_RESPONSE_UNCERTAIN");
  }
  if (validateProviderToolOutput("SIMPLICITER", toolName, structuredContent).status !== "VALID") {
    throw new ProviderResearchAdapterError("SIMPLICITER_RESPONSE_UNCERTAIN");
  }
  const payload = record(structuredContent.payload)!;
  const sourceKeys = Array.isArray(structuredContent.source_keys)
    ? structuredContent.source_keys.map(text).filter((value): value is string => Boolean(value))
    : [];
  const requestedKeys = context.request?.arguments.source_keys
    ?? (Array.isArray(context.request?.arguments.sources)
      ? context.request.arguments.sources.map((source) => record(source)?.source_key) : undefined);
  if (context.request && toolName === "legal_research"
    && structuredContent.query !== context.request.arguments.query) {
    throw new ProviderResearchAdapterError("SIMPLICITER_RESPONSE_UNCERTAIN");
  }
  const sourceConfirmed = sourceKeys.length === 1
    && (structuredContent.source_keys as unknown[]).length === 1
    && (!Array.isArray(requestedKeys)
      || (requestedKeys.length === 1 && requestedKeys[0] === sourceKeys[0]));
  const candidates: AuthorityCandidate[] = [];
  const gaps: ResearchGap[] = [];
  const requestedReference = toolName === "fetch_legal_source"
    ? requestedSimpliciterLegislationReference(context.request)
    : undefined;
  let exactReferenceFound = false;
  let resultCount = 0;
  for (const [category, values] of Object.entries(payload)) {
    if (!Array.isArray(values)) continue;
    for (const [index, value] of values.entries()) {
      resultCount += 1;
      const item = record(value);
      const officialIdentifier = item ? simpliciterIdentity(item) : undefined;
      if (!item || !officialIdentifier) {
        gaps.push(gap(context.mission, context.executionRecordId, `simpliciter:${category}:${index}`));
        continue;
      }
      const providerId = sourceConfirmed ? sourceKeys[0] : "SIMPLICITER";
      const legislationReference = toolName === "fetch_legal_source"
        ? simpliciterLegislationReference(officialIdentifier, text(item.titolo))
        : undefined;
      const exactReferenceMatch = requestedReference && legislationReference
        ? requestedReference.article === legislationReference.article
          && requestedReference.law === legislationReference.law
        : undefined;
      exactReferenceFound ||= exactReferenceMatch === true;
      candidates.push(createAuthorityCandidate({
        kind: "AUTHORITY_CANDIDATE",
        executionRecordId: context.executionRecordId,
        toolId: "SIMPLICITER",
        providerId,
        documentType: text(item.type) ?? category,
        officialIdentifier,
        ...(text(item.titolo) ? { title: text(item.titolo) } : {}),
        ...(text(item.url) ? { sourceUrl: text(item.url) } : {}),
        ...(text(item.contenuto) ? { providerReceivedText: text(item.contenuto) } : {}),
        ...(simpliciterActDate(officialIdentifier)
          ? { providerDates: { actDate: simpliciterActDate(officialIdentifier) } } : {}),
        ...(exactReferenceMatch !== undefined ? { exactReferenceMatch } : {}),
        ...(officialIdentifier.startsWith("ECLI:") ? { ecli: officialIdentifier } : {}),
        supportDirection: "UNKNOWN",
        sourceFamily: sourceConfirmed ? simpliciterFamily(providerId) : "OTHER",
        retrievalMethod: operationType,
        fullTextAvailable: false,
        verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
      }));
      if (!sourceConfirmed) {
        gaps.push(gap(context.mission, context.executionRecordId, `simpliciter:${category}:${index}:source`));
      }
      if (toolName === "fetch_legal_source" && !legislationReference) {
        gaps.push(gap(context.mission, context.executionRecordId, `simpliciter:${category}:${index}:identity`));
      }
    }
  }
  if (resultCount === 0) {
    gaps.push(gap(context.mission, context.executionRecordId, "simpliciter:empty", "MISSING_DOCUMENT"));
  } else if (toolName === "fetch_legal_source" && (!requestedReference || !exactReferenceFound)) {
    gaps.push(gap(context.mission, context.executionRecordId, "simpliciter:exact-reference"));
  }
  return {
    resultCount,
    resultIdentifiersUsed: candidates.map((candidate) => candidate.officialIdentifier ?? candidate.candidateId),
    authorityCandidates: candidates,
    evidenceGaps: gaps,
    incomplete: gaps.length > 0,
  };
}

function prepare(
  provider: CatalogProvider,
  capability: ResearchCapability,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): ProviderToolRequest {
  const validation = validateProviderToolInput(provider, capability, toolName, input);
  if (!validation.valid) throw new ProviderResearchAdapterError(validation.code);
  return { name: toolName, arguments: input };
}

export function createMoonlitResearchAdapter(callTool: ProviderToolCaller): ResearchProviderAdapter {
  return {
    provider: "MOONLIT",
    capability: "SEMANTIC_DISCOVERY",
    toolName: "search_legal_documents",
    role: "CITATION_AUTHORITY_INTELLIGENCE",
    operationType: "SEMANTIC_SEARCH",
    prepare: (mission) => prepare("MOONLIT", "SEMANTIC_DISCOVERY", "search_legal_documents", {
      query: mission.researchQuestion,
      num_results: 10,
      output_format: "json",
    }),
    callTool,
    normalize: (response, context) => normalizeMoonlitSearch(response, context, "SEMANTIC_SEARCH"),
  };
}

export function createMoonlitKeywordResearchAdapter(callTool: ProviderToolCaller): ResearchProviderAdapter {
  return {
    provider: "MOONLIT",
    capability: "KEYWORD_DISCOVERY",
    toolName: "search_legal_documents_by_keyword",
    role: "BROAD_DISCOVERY",
    operationType: "KEYWORD_SEARCH",
    prepare: (mission) => prepare("MOONLIT", "KEYWORD_DISCOVERY", "search_legal_documents_by_keyword", {
      query: mission.researchQuestion,
      num_results: 10,
      output_format: "json",
    }),
    callTool,
    normalize: (response, context) => normalizeMoonlitSearch(response, context, "KEYWORD_SEARCH"),
  };
}

export function createMoonlitExactRetrievalAdapter(callTool: ProviderToolCaller): ResearchProviderAdapter {
  return {
    provider: "MOONLIT",
    capability: "EXACT_RETRIEVAL",
    toolName: "get_document",
    role: "CITATION_AUTHORITY_INTELLIGENCE",
    operationType: "EXACT_RETRIEVAL",
    prepare: (_mission, discovered = []) => {
      const identifier = discovered.filter((candidate) => candidate.toolId === "MOONLIT")
        .map((candidate) => candidate.providerDocumentId?.trim())
        .find((value): value is string => Boolean(value));
      if (!identifier) throw new ProviderResearchAdapterError("PROVIDER_EXACT_IDENTIFIER_REQUIRED");
      return prepare("MOONLIT", "EXACT_RETRIEVAL", "get_document", {
        document_identifier: identifier,
      });
    },
    callTool,
    normalize: normalizeMoonlitExact,
  };
}

export function createSimpliciterResearchAdapter(callTool: ProviderToolCaller): ResearchProviderAdapter {
  return {
    provider: "SIMPLICITER",
    capability: "SEMANTIC_DISCOVERY",
    toolName: "legal_research",
    role: "LEGAL_RESEARCH_STRATEGIST",
    operationType: "SEMANTIC_SEARCH",
    prepare: (mission) => {
      const sourceKey = mission.preferredSourceFamilies
        .map((family) => simpliciterSourceKeys[family as keyof typeof simpliciterSourceKeys])
        .find((value) => value !== undefined);
      return prepare("SIMPLICITER", "SEMANTIC_DISCOVERY", "legal_research", {
        query: mission.researchQuestion,
        top_n: 10,
        ...(sourceKey ? { source_keys: [sourceKey] } : {}),
      });
    },
    callTool,
    normalize: (response, context) => normalizeSimpliciter(
      response,
      context,
      "legal_research",
      "SEMANTIC_SEARCH",
    ),
  };
}

export function createSimpliciterExactRetrievalAdapter(
  callTool: ProviderToolCaller,
): ResearchProviderAdapter {
  return {
    provider: "SIMPLICITER",
    capability: "EXACT_RETRIEVAL",
    toolName: "fetch_legal_source",
    role: "CITATION_AUTHORITY_INTELLIGENCE",
    operationType: "EXACT_RETRIEVAL",
    prepare: (_mission, discovered = []) => {
      const match = discovered.filter((candidate) => candidate.toolId === "SIMPLICITER"
        && candidate.providerId === "it.legislation.normativa-italiana")
        .map((candidate) => candidate.officialIdentifier
          ? simpliciterLegislationReference(candidate.officialIdentifier.trim(), candidate.title)
          : undefined)
        .find((candidate): candidate is SimpliciterLegislationReference => Boolean(candidate));
      if (!match) throw new ProviderResearchAdapterError("PROVIDER_EXACT_REFERENCE_REQUIRED");
      return prepare("SIMPLICITER", "EXACT_RETRIEVAL", "fetch_legal_source", {
        top_n: 10,
        sources: [{
          source_key: "it.legislation.normativa-italiana",
          number: match.article,
          law: match.law,
        }],
      });
    },
    callTool,
    normalize: (response, context) => normalizeSimpliciter(
      response,
      context,
      "fetch_legal_source",
      "EXACT_RETRIEVAL",
    ),
  };
}

const simpliciterSourceKeys = {
  ITALIAN_LEGISLATION: "it.legislation.normativa-italiana",
  EU_LEGISLATION: "it.legislation.normativa-ue",
  CASSAZIONE: "it.case_law.cassazione",
  CORTE_COSTITUZIONALE: "it.case_law.corte-costituzionale",
  GIURISPRUDENZA_DI_MERITO: "it.case_law.giurisprudenza-di-merito",
  GIUSTIZIA_AMMINISTRATIVA: "it.case_law.giustizia-amministrativa",
  CJEU: "it.case_law.corte-di-giustizia-ue",
  CNF: "it.case_law.consiglio-nazionale-forense",
  ECHR: "it.case_law.echr",
} as const satisfies Partial<Record<ResearchSourceFamily, string>>;

function simpliciterFamily(sourceKey: string): ResearchSourceFamily {
  return (Object.entries(simpliciterSourceKeys).find(([, value]) => value === sourceKey)?.[0]
    ?? "OTHER") as ResearchSourceFamily;
}

export function providerRequestSourceFamilies(
  request: ProviderToolRequest,
  mission: ResearchMission,
): readonly ResearchSourceFamily[] {
  return Array.isArray(request.arguments.source_keys)
    ? request.arguments.source_keys.map((sourceKey) => simpliciterFamily(String(sourceKey)))
    : mission.preferredSourceFamilies;
}

export function createSimpliciterCrossJurisdictionResearchAdapter(
  callTool: ProviderToolCaller,
): ResearchProviderAdapter {
  return {
    provider: "SIMPLICITER",
    capability: "CROSS_JURISDICTION_DISCOVERY",
    toolName: "legal_research",
    role: "LEGAL_RESEARCH_STRATEGIST",
    operationType: "CROSS_JURISDICTION_SEARCH",
    prepareRequests(mission) {
      const combined = this.prepare(mission);
      return (combined.arguments.source_keys as readonly string[]).map((sourceKey) => prepare(
        "SIMPLICITER", "CROSS_JURISDICTION_DISCOVERY", "legal_research",
        { ...combined.arguments, source_keys: [sourceKey] },
      ));
    },
    prepare: (mission) => {
      const sourceKeys = [...new Set(mission.preferredSourceFamilies
        .map((family) => simpliciterSourceKeys[family as keyof typeof simpliciterSourceKeys])
        .filter((value) => value !== undefined))];
      if (sourceKeys.length < 2) {
        throw new ProviderResearchAdapterError("PROVIDER_CROSS_JURISDICTION_SOURCES_REQUIRED");
      }
      return prepare("SIMPLICITER", "CROSS_JURISDICTION_DISCOVERY", "legal_research", {
        query: mission.researchQuestion,
        top_n: 10,
        source_keys: sourceKeys,
      });
    },
    callTool,
    normalize: (response, context) => normalizeSimpliciter(
      response,
      context,
      "legal_research",
      "CROSS_JURISDICTION_SEARCH",
    ),
  };
}