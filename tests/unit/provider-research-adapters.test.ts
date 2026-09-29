import { describe, expect, it, vi } from "vitest";

import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
  type ResearchMissionInput,
} from "@/server/legal-research/bridge";
import {
  createMoonlitExactRetrievalAdapter,
  createMoonlitKeywordResearchAdapter,
  createMoonlitResearchAdapter,
  createSimpliciterCrossJurisdictionResearchAdapter,
  createSimpliciterExactRetrievalAdapter,
  createSimpliciterResearchAdapter,
} from "@/server/legal-research/provider-research-adapters";

function missionInput(overrides: Partial<ResearchMissionInput> = {}): ResearchMissionInput {
  return {
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-a" },
    legalIssueIds: ["issue-a"],
    legalPropositionIds: ["proposition-a"],
    referenceDate: "2026-09-26T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "concessione demaniale marittima",
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["CASSAZIONE", "ITALIAN_LEGISLATION"],
    missingSourceFamilies: [],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: false,
      legalResearchSuggestions: false,
      evidenceGaps: true,
      fullTextRequired: false,
    },
    budget: {
      maxTotalResearchCalls: 2,
      maxMoonlitCalls: 1,
      maxSimpliciterCalls: 1,
      maxLegalDataHunterCalls: 0,
    },
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: ["SEMANTIC_DISCOVERY"],
      preferredToolIds: ["MOONLIT", "SIMPLICITER"],
    },
    ...overrides,
  };
}

const mission = createResearchMission(missionInput());
const context = { mission, executionRecordId: "execution-record-a" };

describe("provider research adapters", () => {
  it("plans single-source calls and preserves ambiguous provenance without title inference", () => {
    const adapter = createSimpliciterCrossJurisdictionResearchAdapter(vi.fn());
    const requests = adapter.prepareRequests!(mission);
    expect(requests.map((request) => request.arguments.source_keys)).toEqual([
      ["it.case_law.cassazione"], ["it.legislation.normativa-italiana"],
    ]);
    const response = { structuredContent: {
      catalog_version: "synthetic-contract-fixture", query: mission.researchQuestion,
      source_keys: ["it.legislation.normativa-italiana"],
      payload: { normativa: [{ alias: "Legge 84/1994", titolo: "Cassazione: concessioni portuali" }] },
    } };
    const attributable = adapter.normalize(response, { ...context, request: requests[1] });
    expect(attributable).toMatchObject({ incomplete: false, evidenceGaps: [] });
    expect(attributable.authorityCandidates[0]).toMatchObject({
      providerId: "it.legislation.normativa-italiana", sourceFamily: "ITALIAN_LEGISLATION",
    });
    const ambiguous = adapter.normalize(response, { ...context, request: requests[0] });
    expect(ambiguous.incomplete).toBe(true);
    expect(ambiguous.evidenceGaps).toHaveLength(1);
    expect(ambiguous.authorityCandidates[0]).toMatchObject({ providerId: "SIMPLICITER", sourceFamily: "OTHER" });
  });

  it("prepares schema-valid, bounded semantic search inputs", () => {
    const moonlit = createMoonlitResearchAdapter(vi.fn());
    const simpliciter = createSimpliciterResearchAdapter(vi.fn());

    expect(moonlit.prepare(mission)).toEqual({
      name: "search_legal_documents",
      arguments: { query: mission.researchQuestion, num_results: 10, output_format: "json" },
    });
    expect(simpliciter.prepare(mission)).toEqual({
      name: "legal_research",
      arguments: { query: mission.researchQuestion, top_n: 10, source_keys: ["it.case_law.cassazione"] },
    });
  });

  it("prepares response-verified keyword, exact, and cross-jurisdiction inputs", () => {
    const exactMission = createResearchMission(missionInput({
      knownAuthorities: [{ authorityReferenceId: "authority-a", officialIdentifier: "MNLT:IT:PUBLIC:1" }],
    }));

    expect(createMoonlitKeywordResearchAdapter(vi.fn()).prepare(mission)).toEqual({
      name: "search_legal_documents_by_keyword",
      arguments: { query: mission.researchQuestion, num_results: 10, output_format: "json" },
    });
    const discovered = createMoonlitResearchAdapter(vi.fn()).normalize({ content: [{ type: "text", text: JSON.stringify({ success: true, result: { results: [{ identifier: "MNLT:IT:PUBLIC:1" }] } }) }] }, context);
    expect(() => createMoonlitExactRetrievalAdapter(vi.fn()).prepare(exactMission)).toThrow();
    expect(createMoonlitExactRetrievalAdapter(vi.fn()).prepare(exactMission, discovered.authorityCandidates)).toEqual({
      name: "get_document",
      arguments: { document_identifier: "MNLT:IT:PUBLIC:1" },
    });
    expect(createSimpliciterCrossJurisdictionResearchAdapter(vi.fn()).prepare(mission)).toEqual({
      name: "legal_research",
      arguments: {
        query: mission.researchQuestion,
        top_n: 10,
        source_keys: ["it.case_law.cassazione", "it.legislation.normativa-italiana"],
      },
    });
  });

  it("rejects exact retrieval without a Moonlit identifier before any call", () => {
    const callTool = vi.fn();
    expect(() => createMoonlitExactRetrievalAdapter(callTool).prepare(mission))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_EXACT_IDENTIFIER_REQUIRED" }));
    expect(callTool).not.toHaveBeenCalled();
  });

  it("prepares a complete Simpliciter exact reference from an explicit civil-code citation", () => {
    const exactMission = createResearchMission(missionInput({
      knownAuthorities: [{ authorityReferenceId: "authority-a", citation: "art. 2043 codice civile" }],
    }));
    const discovered = createSimpliciterResearchAdapter(vi.fn()).normalize({ structuredContent: {
      catalog_version: "test", query: mission.researchQuestion, source_keys: ["it.legislation.normativa-italiana"],
      payload: { normativa: [{ alias: "art. 2043 codice civile" }] },
    } }, context);
    expect(() => createSimpliciterExactRetrievalAdapter(vi.fn()).prepare(exactMission)).toThrow();
    expect(createSimpliciterExactRetrievalAdapter(vi.fn()).prepare(exactMission, discovered.authorityCandidates)).toEqual({
      name: "fetch_legal_source",
      arguments: {
        top_n: 10,
        sources: [{
          source_key: "it.legislation.normativa-italiana",
          number: "2043",
          law: "codice civile",
        }],
      },
    });
  });

  it("rejects Simpliciter exact references that cannot be derived before any call", () => {
    const callTool = vi.fn();
    expect(() => createSimpliciterExactRetrievalAdapter(callTool).prepare(mission))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_EXACT_REFERENCE_REQUIRED" }));
    expect(callTool).not.toHaveBeenCalled();
  });

  it("prepares the observed law 84/1994 reference without transferring its identity to Moonlit", () => {
    const callTool = vi.fn();
    const candidates = createSimpliciterResearchAdapter(callTool).normalize({ structuredContent: {
      catalog_version: "synthetic-contract-fixture", query: mission.researchQuestion,
      source_keys: ["it.legislation.normativa-italiana"],
      payload: { normativa: [{
        alias: "art. 18 legge n. 84 del 28 gennaio 1994",
        titolo: "Art. 18 Riordino della legislazione in materia portuale.",
      }] },
    } }, context).authorityCandidates;
    expect(createSimpliciterExactRetrievalAdapter(callTool).prepare(mission, candidates)).toEqual({
      name: "fetch_legal_source",
      arguments: {
        top_n: 10,
        sources: [{
          source_key: "it.legislation.normativa-italiana",
          number: "18",
          law: "legge 84/1994",
        }],
      },
    });
    expect(() => createMoonlitExactRetrievalAdapter(callTool).prepare(mission, candidates))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_EXACT_IDENTIFIER_REQUIRED" }));
    expect(callTool).not.toHaveBeenCalled();
  });

  it.each([[], [""], ["it.case_law.cassazione", "it.legislation.normativa-italiana"], ["it.legislation.normativa-italiana"]].map((sourceKeys) => ({ sourceKeys })))(
    "keeps source gaps for missing, mixed or mismatched provenance: $sourceKeys", ({ sourceKeys }) => {
      const adapter = createSimpliciterCrossJurisdictionResearchAdapter(vi.fn());
      const request = adapter.prepareRequests!(mission)[0];
      const result = adapter.normalize({ structuredContent: {
        catalog_version: "synthetic-contract-fixture", query: mission.researchQuestion, source_keys: sourceKeys,
        payload: { risultati: [{ alias: "ECLI:EU:C:2024:1", titolo: "Cassazione: concessioni portuali", source_key: "it.case_law.cassazione" }] },
      } }, { ...context, request });
      expect(result).toMatchObject({ incomplete: true });
      expect(result.evidenceGaps).toHaveLength(1);
      expect(result.authorityCandidates[0]).toMatchObject({ providerId: "SIMPLICITER", sourceFamily: "OTHER" });
    },
  );

  it("rejects a response bound to a different query as uncertain", () => {
    const adapter = createSimpliciterResearchAdapter(vi.fn());
    expect(() => adapter.normalize({ structuredContent: {
      catalog_version: "synthetic-contract-fixture", query: "unrelated query", source_keys: ["it.case_law.cassazione"],
      payload: { risultati: [{ alias: "Cass. 1/2024" }] },
    } }, { ...context, request: adapter.prepare(mission) })).toThrowError(expect.objectContaining({ code: "SIMPLICITER_RESPONSE_UNCERTAIN" }));
  });

  it("normalizes only identified Moonlit results and records gaps for ambiguous items", () => {
    const adapter = createMoonlitResearchAdapter(vi.fn());
    const normalized = adapter.normalize({
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          error: null,
          result: {
            count: 2,
            returned_count: 2,
            results: [
              {
                identifier: "moonlit-document-1",
                secondaryIdentifier: "ECLI:IT:CASS:2024:1234",
                court: "Corte di Cassazione",
                year: 2024,
                title: "Synthetic authority",
                sourceUrl: "https://example.test/authority",
                documentTypes: [{ id: "case", name: "Sentenza" }],
                sources: [{ id: "cassazione", name: "Corte di Cassazione" }],
                semanticHighlights: [{ chunkIdentifier: "chunk-1", chunkText: "must not be copied" }],
              },
              { title: "Ambiguous result without identifier", semanticHighlights: [] },
            ],
          },
        }),
      }],
    }, context);

    expect(normalized.resultCount).toBe(2);
    expect(normalized.resultIdentifiersUsed).toEqual(["moonlit-document-1"]);
    expect(normalized.authorityCandidates).toEqual([
      expect.objectContaining({
        toolId: "MOONLIT",
        providerId: "cassazione",
        providerDocumentId: "moonlit-document-1",
        officialIdentifier: "ECLI:IT:CASS:2024:1234",
        ecli: "ECLI:IT:CASS:2024:1234",
        sourceFamily: "CASSAZIONE",
        supportDirection: "UNKNOWN",
        fullTextAvailable: false,
      }),
    ]);
    expect(normalized.authorityCandidates[0]).not.toHaveProperty("relevantPassage");
    expect(normalized.authorityCandidates[0]).not.toHaveProperty("summary");
    expect(normalized.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
    ]);
    expect(normalized.incomplete).toBe(true);
  });

  it("treats an unrecognized Moonlit response as uncertain instead of guessing", () => {
    const adapter = createMoonlitResearchAdapter(vi.fn());
    expect(() => adapter.normalize({ content: [{ type: "text", text: "not-json" }] }, context))
      .toThrowError(expect.objectContaining({ code: "MOONLIT_RESPONSE_UNCERTAIN" }));
  });

  it("normalizes observed Moonlit keyword and exact shapes without copying provider text", () => {
    const keyword = createMoonlitKeywordResearchAdapter(vi.fn()).normalize({
      content: [{ type: "text", text: JSON.stringify({
        success: true,
        result: { results: [{ identifier: "MNLT:IT:PUBLIC:1", highlights: ["omitted"] }] },
      }) }],
    }, context);
    const exact = createMoonlitExactRetrievalAdapter(vi.fn()).normalize({
      content: [{ type: "text", text: JSON.stringify({
        identifier: "MNLT:IT:PUBLIC:1",
        secondaryIdentifier: "PUBLIC-1",
        markdown: "must not be copied",
        source: "public-source",
        sourceUrl: "https://example.test/public-1",
      }) }],
    }, context);

    expect(keyword.authorityCandidates[0]).toMatchObject({
      providerDocumentId: "MNLT:IT:PUBLIC:1",
      retrievalMethod: "KEYWORD_SEARCH",
      fullTextAvailable: false,
    });
    expect(exact.authorityCandidates[0]).toMatchObject({
      providerDocumentId: "MNLT:IT:PUBLIC:1",
      officialIdentifier: "PUBLIC-1",
      retrievalMethod: "EXACT_RETRIEVAL",
      fullTextAvailable: false,
    });
    expect(exact.authorityCandidates[0]).not.toHaveProperty("relevantPassage");
    expect(exact.authorityCandidates[0]).not.toHaveProperty("summary");
  });

  it("normalizes identified Simpliciter items across dynamic categories", () => {
    const adapter = createSimpliciterResearchAdapter(vi.fn());
    const normalized = adapter.normalize({
      isError: false,
      structuredContent: {
        catalog_version: "observed-version",
        query: mission.researchQuestion,
        source_keys: ["observed-source"],
        payload: {
          normativa: [{ type: "law", titolo: "Synthetic law", alias: "Law 1/2024", contenuto: "omitted" }],
          giurisprudenza: [{ type: "case", titolo: "Synthetic case", citazione: "Cass. 2/2024", sintesi: "omitted" }],
          prassi: [{ type: "practice", Documento: "Circular 3/2024", "Questo è un estratto rilevante del documento": ["omitted"] }],
          future_category: [{ type: "unknown", providerDefined: true }],
        },
      },
    }, context);

    expect(normalized.resultCount).toBe(4);
    expect(normalized.resultIdentifiersUsed).toEqual(["Law 1/2024", "Cass. 2/2024", "Circular 3/2024"]);
    expect(normalized.authorityCandidates).toHaveLength(3);
    expect(normalized.authorityCandidates.every((candidate) => (
      candidate.toolId === "SIMPLICITER"
      && candidate.providerId === "observed-source"
      && candidate.supportDirection === "UNKNOWN"
      && candidate.fullTextAvailable === false
      && !("relevantPassage" in candidate)
      && !("summary" in candidate)
    ))).toBe(true);
    expect(normalized.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
    ]);
  });

  it("records an empty result as a missing-document gap", () => {
    const adapter = createSimpliciterResearchAdapter(vi.fn());
    const normalized = adapter.normalize({
      structuredContent: {
        catalog_version: "observed-version",
        query: mission.researchQuestion,
        source_keys: [],
        payload: {},
      },
    }, context);

    expect(normalized).toMatchObject({ resultCount: 0, authorityCandidates: [], incomplete: true });
    expect(normalized.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "MISSING_DOCUMENT" }),
    ]);
  });

  it("normalizes cross-jurisdiction results and records ambiguous source provenance", () => {
    const normalized = createSimpliciterCrossJurisdictionResearchAdapter(vi.fn()).normalize({
      isError: false,
      structuredContent: {
        catalog_version: "observed-version",
        query: mission.researchQuestion,
        source_keys: ["it.case_law.corte-di-giustizia-ue", "it.case_law.echr"],
        payload: {
          giurisprudenza: [{ citazione: "ECLI:EU:C:2024:1", sintesi: "must not be copied" }],
        },
      },
    }, context);

    expect(normalized.authorityCandidates[0]).toMatchObject({
      providerId: "SIMPLICITER",
      officialIdentifier: "ECLI:EU:C:2024:1",
      retrievalMethod: "CROSS_JURISDICTION_SEARCH",
    });
    expect(normalized.authorityCandidates[0]).not.toHaveProperty("summary");
    expect(normalized.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
    ]);
    expect(normalized.incomplete).toBe(true);
  });

  it("normalizes Simpliciter exact output with single-source provenance but not full text", () => {
    const adapter = createSimpliciterExactRetrievalAdapter(vi.fn());
    const request = {
      name: "fetch_legal_source",
      arguments: {
        top_n: 10,
        sources: [{ source_key: "it.legislation.normativa-italiana", number: "2043", law: "codice civile" }],
      },
    } as const;
    const normalized = adapter.normalize({
      isError: false,
      structuredContent: {
        catalog_version: "observed-version",
        source_keys: ["it.legislation.normativa-italiana"],
        payload: {
          normativa: [{
            type: "norma",
            alias: "Art. 2043 codice civile",
            titolo: "Public provision",
            url: "https://example.test/public-provision",
            contenuto: "must not be copied",
          }],
        },
      },
    }, { ...context, request });

    expect(normalized).toMatchObject({ resultCount: 1, incomplete: false, evidenceGaps: [] });
    expect(normalized.authorityCandidates[0]).toMatchObject({
      providerId: "it.legislation.normativa-italiana",
      officialIdentifier: "Art. 2043 codice civile",
      sourceFamily: "ITALIAN_LEGISLATION",
      retrievalMethod: "EXACT_RETRIEVAL",
      exactReferenceMatch: true,
      providerReceivedText: "must not be copied",
      fullTextAvailable: false,
    });
    expect(normalized.authorityCandidates[0]).not.toHaveProperty("relevantPassage");
    expect(normalized.authorityCandidates[0]).not.toHaveProperty("summary");
  });

  it("keeps article 18-bis as an additional result instead of matching article 18", () => {
    const adapter = createSimpliciterExactRetrievalAdapter(vi.fn());
    const request = {
      name: "fetch_legal_source",
      arguments: {
        top_n: 10,
        sources: [{ source_key: "it.legislation.normativa-italiana", number: "18", law: "legge 84/1994" }],
      },
    } as const;
    const normalized = adapter.normalize({
      isError: false,
      structuredContent: {
        catalog_version: "607c23ddcbf6229e",
        source_keys: ["it.legislation.normativa-italiana"],
        payload: { normativa: [{
          type: "norma",
          url: "https://simpliciter.ai/app/normativa/it/legge/1994/84/18/",
          titolo: "Art. 18 Riordino della legislazione in materia portuale.",
          contenuto: "Art. 18\n(Concessione di aree e banchine).",
          alias: "art. 18 legge n. 84 del 28 gennaio 1994",
        }, {
          type: "norma",
          url: "https://simpliciter.ai/app/normativa/it/legge/1994/84/18-bis/",
          titolo: "Art. 18-bis Riordino della legislazione in materia portuale.",
          contenuto: "Art. 18-bis\nAutonomia finanziaria.",
          alias: "art. 18-bis legge n. 84 del 28 gennaio 1994",
        }] },
      },
    }, { ...context, request });

    expect(normalized).toMatchObject({ resultCount: 2, incomplete: false, evidenceGaps: [] });
    expect(normalized.authorityCandidates).toEqual([
      expect.objectContaining({
        officialIdentifier: "art. 18 legge n. 84 del 28 gennaio 1994",
        exactReferenceMatch: true,
        providerReceivedText: "Art. 18\n(Concessione di aree e banchine).",
        providerDates: { actDate: "1994-01-28" },
        fullTextAvailable: false,
        verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
      }),
      expect.objectContaining({
        officialIdentifier: "art. 18-bis legge n. 84 del 28 gennaio 1994",
        exactReferenceMatch: false,
      }),
    ]);
  });

  it("records a gap when an exact result identity cannot be determined", () => {
    const adapter = createSimpliciterExactRetrievalAdapter(vi.fn());
    const normalized = adapter.normalize({
      structuredContent: {
        catalog_version: "607c23ddcbf6229e",
        source_keys: ["it.legislation.normativa-italiana"],
        payload: { normativa: [{ alias: "art. 18 fonte non identificata", contenuto: "testo ricevuto" }] },
      },
    }, { ...context, request: {
      name: "fetch_legal_source",
      arguments: { sources: [{ source_key: "it.legislation.normativa-italiana", number: "18", law: "legge 84/1994" }] },
    } });

    expect(normalized.incomplete).toBe(true);
    expect(normalized.authorityCandidates[0]).toMatchObject({
      officialIdentifier: "art. 18 fonte non identificata",
      providerReceivedText: "testo ricevuto",
      fullTextAvailable: false,
    });
    expect(normalized.authorityCandidates[0]).not.toHaveProperty("exactReferenceMatch");
    expect(normalized.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
    ]);
  });

  it("does not call a provider while preparing or normalizing", () => {
    const callTool = vi.fn();
    const adapter = createMoonlitResearchAdapter(callTool);
    adapter.prepare(mission);
    adapter.normalize({
      content: [{ type: "text", text: JSON.stringify({ success: true, result: { results: [] } }) }],
    }, context);
    expect(callTool).not.toHaveBeenCalled();
  });
});