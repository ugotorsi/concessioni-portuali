import { describe, expect, it, vi } from "vitest";

import type { ResearchCapability } from "@/server/legal-research/bridge";
import {
  ADVERSE_AUTHORITY_DISCOVERY_CONTROL,
  OBSERVED_PROVIDER_TOOL_SCHEMAS,
  PROVIDER_CAPABILITY_MAPPING,
  validateProviderToolInput,
  validateProviderToolOutput,
} from "@/server/legal-research/provider-capability-mapping";

const capabilities = [
  "SEMANTIC_DISCOVERY",
  "KEYWORD_DISCOVERY",
  "EXACT_RETRIEVAL",
  "FULL_TEXT_RETRIEVAL",
  "CITATION_NETWORK",
  "CROSS_JURISDICTION_DISCOVERY",
  "ADVERSE_AUTHORITY_DISCOVERY",
] as const satisfies readonly ResearchCapability[];

describe("provider capability mapping", () => {
  it("covers every ResearchMission capability and leaves adverse discovery unconfirmed", () => {
    for (const provider of ["MOONLIT", "SIMPLICITER"] as const) {
      expect(Object.keys(PROVIDER_CAPABILITY_MAPPING[provider])).toEqual(capabilities);
      expect(PROVIDER_CAPABILITY_MAPPING[provider].ADVERSE_AUTHORITY_DISCOVERY).toEqual({
        status: "NOT_CONFIRMED",
        toolNames: [],
      });
    }
  });

  it("maps only capabilities demonstrated by the observed Moonlit catalog", () => {
    expect(PROVIDER_CAPABILITY_MAPPING.MOONLIT).toEqual({
      SEMANTIC_DISCOVERY: { status: "RESPONSE_VERIFIED", toolNames: ["search_legal_documents"] },
      KEYWORD_DISCOVERY: { status: "RESPONSE_VERIFIED", toolNames: ["search_legal_documents_by_keyword"] },
      EXACT_RETRIEVAL: { status: "RESPONSE_VERIFIED", toolNames: ["get_document"] },
      FULL_TEXT_RETRIEVAL: { status: "CATALOG_ONLY", toolNames: ["get_document_elements"] },
      CITATION_NETWORK: { status: "CATALOG_ONLY", toolNames: ["search_document_citations"] },
      CROSS_JURISDICTION_DISCOVERY: { status: "CATALOG_ONLY", toolNames: ["search_legal_documents"] },
      ADVERSE_AUTHORITY_DISCOVERY: { status: "NOT_CONFIRMED", toolNames: [] },
    });
  });

  it("maps only capabilities demonstrated by the observed Simpliciter catalog", () => {
    expect(PROVIDER_CAPABILITY_MAPPING.SIMPLICITER).toEqual({
      SEMANTIC_DISCOVERY: { status: "RESPONSE_VERIFIED", toolNames: ["legal_research"] },
      KEYWORD_DISCOVERY: { status: "NOT_CONFIRMED", toolNames: [] },
      EXACT_RETRIEVAL: { status: "RESPONSE_VERIFIED", toolNames: ["list_available_sources", "fetch_legal_source"] },
      FULL_TEXT_RETRIEVAL: { status: "NOT_CONFIRMED", toolNames: [] },
      CITATION_NETWORK: { status: "NOT_CONFIRMED", toolNames: [] },
      CROSS_JURISDICTION_DISCOVERY: {
        status: "RESPONSE_VERIFIED",
        toolNames: ["list_available_sources", "legal_research"],
      },
      ADVERSE_AUTHORITY_DISCOVERY: { status: "NOT_CONFIRMED", toolNames: [] },
    });
  });

  it("does not promote a normal search result to verified adverse authority", () => {
    expect(ADVERSE_AUTHORITY_DISCOVERY_CONTROL).toEqual({
      status: "NOT_CONFIRMED",
      normalSearchMaySuggestAdverseAuthority: true,
      normalSearchCanVerifyAdverseAuthority: false,
      automaticVerificationForbidden: true,
      requiresObservedCitationRelation: true,
      requiresReliableTreatmentAssessment: true,
      humanReviewSteps: [
        "VERIFY_OFFICIAL_FULL_TEXT",
        "IDENTIFY_RELEVANT_LEGAL_PROPOSITION",
        "ASSESS_SUPPORT_DIRECTION_IN_CONTEXT",
        "RECORD_REASONED_TREATMENT_WITH_PROVENANCE",
      ],
    });
  });

  it.each([
    ["MOONLIT", "SEMANTIC_DISCOVERY", "search_legal_documents", { query: "port concessions", semantic_weight: 0.7 }],
    ["MOONLIT", "KEYWORD_DISCOVERY", "search_legal_documents_by_keyword", { query: "concessione demaniale" }],
    ["MOONLIT", "EXACT_RETRIEVAL", "get_document", { document_identifier: "32019L0001" }],
    ["MOONLIT", "FULL_TEXT_RETRIEVAL", "get_document_elements", { document_identifier: "32016R0679", include_html: true }],
    ["MOONLIT", "CITATION_NETWORK", "search_document_citations", { reference_identifier: "ECLI:EU:C:2024:1" }],
    ["MOONLIT", "CROSS_JURISDICTION_DISCOVERY", "search_legal_documents", { query: "port concessions", jurisdictions: ["Italy", "EU"] }],
    ["SIMPLICITER", "SEMANTIC_DISCOVERY", "legal_research", { query: "port concessions" }],
    ["SIMPLICITER", "EXACT_RETRIEVAL", "list_available_sources", {}],
    ["SIMPLICITER", "EXACT_RETRIEVAL", "fetch_legal_source", { sources: [{ source_key: "cassazione", number: "1234", year: "2024" }] }],
    ["SIMPLICITER", "CROSS_JURISDICTION_DISCOVERY", "legal_research", { query: "port concessions", source_keys: ["italy", "eu"] }],
  ] as const)("accepts catalog-schema input for %s %s via %s", (provider, capability, toolName, input) => {
    expect(validateProviderToolInput(provider, capability, toolName, input)).toEqual({ valid: true });
  });

  it.each([
    ["MOONLIT", "SEMANTIC_DISCOVERY", "search_legal_documents", {}],
    ["MOONLIT", "SEMANTIC_DISCOVERY", "search_legal_documents", { query: "valid", extra: true }],
    ["MOONLIT", "FULL_TEXT_RETRIEVAL", "get_document_elements", { document_identifier: "doc", include_html: "yes" }],
    ["MOONLIT", "CITATION_NETWORK", "search_document_citations", { reference_identifier: "doc", from_date: "2025-01-01" }],
    ["SIMPLICITER", "EXACT_RETRIEVAL", "fetch_legal_source", { sources: [{ source_key: "cassazione" }] }],
    ["SIMPLICITER", "SEMANTIC_DISCOVERY", "legal_research", { query: "valid", top_n: 31 }],
  ] as const)("rejects input outside the observed schema for %s %s via %s", (provider, capability, toolName, input) => {
    expect(validateProviderToolInput(provider, capability, toolName, input)).toEqual({
      valid: false,
      code: "INPUT_SCHEMA_INVALID",
    });
  });

  it("enforces observed source-specific fields for Simpliciter exact retrieval", () => {
    expect(validateProviderToolInput(
      "SIMPLICITER",
      "EXACT_RETRIEVAL",
      "fetch_legal_source",
      { sources: [{ source_key: "it.legislation.normativa-italiana", number: "400", year: "1993" }] },
    )).toEqual({ valid: false, code: "INPUT_SCHEMA_INVALID" });
    expect(validateProviderToolInput(
      "SIMPLICITER",
      "EXACT_RETRIEVAL",
      "fetch_legal_source",
      { sources: [{ source_key: "it.legislation.normativa-italiana", number: "400", law: "public-law" }] },
    )).toEqual({ valid: true });
  });

  it("rejects unconfirmed capabilities and tools outside their mapping", () => {
    expect(validateProviderToolInput(
      "MOONLIT",
      "ADVERSE_AUTHORITY_DISCOVERY",
      "search_legal_documents",
      { query: "adverse authority" },
    )).toEqual({ valid: false, code: "CAPABILITY_NOT_CONFIRMED" });
    expect(validateProviderToolInput(
      "SIMPLICITER",
      "SEMANTIC_DISCOVERY",
      "fetch_legal_source",
      { sources: [] },
    )).toEqual({ valid: false, code: "TOOL_NOT_MAPPED" });
  });

  it("does not infer provider output shapes beyond the observed catalog", () => {
    expect(Object.values(OBSERVED_PROVIDER_TOOL_SCHEMAS.MOONLIT)
      .every((tool) => tool.outputSchema === null)).toBe(true);
    for (const toolName of ["fetch_legal_source", "legal_research"] as const) {
      expect(OBSERVED_PROVIDER_TOOL_SCHEMAS.SIMPLICITER[toolName].outputSchema).toMatchObject({
        properties: {
          payload: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
          },
        },
      });
    }
  });

  it("keeps the observed Moonlit sample unvalidated because the catalog has no output schema", () => {
    const observedStructure = {
      success: true,
      error: null,
      result: {
        count: 1,
        count_kind: "observed",
        returned_count: 1,
        skip: 0,
        top: 1,
        facets: null,
        results: [{
          identifier: "document-id",
          secondaryIdentifier: "secondary-id",
          court: "court",
          year: 2024,
          documentTypes: [{ id: "type-id", name: "type-name", shortName: "short", parentId: null }],
          sources: [{ id: "source-id", name: "source-name", shortName: "short", parentId: null }],
          semanticHighlights: [{ chunkIdentifier: "chunk-id", score: 0.5 }],
        }],
      },
    };

    expect(validateProviderToolOutput("MOONLIT", "search_legal_documents", observedStructure)).toEqual({
      status: "NOT_VALIDATED",
      reason: "OUTPUT_SCHEMA_NOT_PROVIDED",
    });
  });

  it("validates the observed dynamic Simpliciter categories without constraining their item shapes", () => {
    const observedStructure = {
      catalog_version: "observed-version",
      query: "concessione demaniale marittima",
      source_keys: ["observed-source"],
      payload: {
        normativa: [{ type: "law", titolo: "omitted", alias: "reference", contenuto: "omitted" }],
        giurisprudenza: [{ type: "case", titolo: "omitted", citazione: "reference" }],
        prassi: [{ type: "practice", Documento: "reference" }],
      },
    };

    expect(validateProviderToolOutput("SIMPLICITER", "legal_research", observedStructure))
      .toEqual({ status: "VALID" });
    expect(validateProviderToolOutput("SIMPLICITER", "legal_research", {
      ...observedStructure,
      payload: { future_category: [{ providerDefined: true }] },
    })).toEqual({ status: "VALID" });
    expect(validateProviderToolOutput("SIMPLICITER", "legal_research", {
      query: observedStructure.query,
      source_keys: observedStructure.source_keys,
      payload: observedStructure.payload,
    })).toEqual({ status: "INVALID", code: "OUTPUT_SCHEMA_INVALID" });
  });

  it("has no network or executor integration side effects", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(validateProviderToolInput(
      "MOONLIT",
      "KEYWORD_DISCOVERY",
      "search_legal_documents_by_keyword",
      { query: "port concessions" },
    )).toEqual({ valid: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});