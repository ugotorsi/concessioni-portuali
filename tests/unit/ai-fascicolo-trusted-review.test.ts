import { describe, expect, it } from "vitest";

import type { AiFascicoloOutboundAnalysisV1 } from "@/server/ai/fascicoloAnalysis";
import {
  buildAiFascicoloTrustedReviewV1,
  type AiFascicoloAuthoritativeEvidenceInputV1,
} from "@/server/ai/fascicoloTrustedReview";

function trustedResultFixture(): AiFascicoloOutboundAnalysisV1 {
  return {
    analysisSchemaVersion: "ai-fascicolo-analysis/v1",
    snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
    outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    sourceSnapshotContentHash: "a".repeat(64),
    outboundProjectionHash: "b".repeat(64),
    outboundProjectionHashAlgorithm: "sha256",
    generatedAt: "2026-08-18T00:00:00.000Z",
    analysis: {
      summary: {
        text: "Il documento DOC_1 risulta registrato.",
        basisRefs: ["DOC_1.dataDocumento", "TITOLO_A.dataScadenza"],
      },
      timeline: [{
        recordedAt: "2026-01-01T00:00:00.000Z",
        text: "Avvio associato a PROCEDIMENTO_A.",
        basisRefs: ["PROCEDIMENTO_A.dataAvvio"],
      }],
      recordedState: [{ text: "Checklist registrata.", basisRefs: ["checklist.complete"] }],
      signals: [],
      investigativeQuestions: [{ text: "Verificare il fascicolo.", basisRefs: [] }],
      suggestedActivities: [],
      legalResearchQuestions: [],
    },
    resolvedBasisRefs: [
      {
        statementPath: "summary",
        providerRef: "DOC_1.dataDocumento",
        referenceType: "ENTITY",
        alias: "DOC_1",
        kind: "DOCUMENT",
        canonicalId: "document-1",
        validatedFieldPath: "dataDocumento",
      },
      {
        statementPath: "summary",
        providerRef: "TITOLO_A.dataScadenza",
        referenceType: "ENTITY",
        alias: "TITOLO_A",
        kind: "CONCESSIONE",
        canonicalId: "concessione-1",
        validatedFieldPath: "dataScadenza",
      },
      {
        statementPath: "timeline[0]",
        providerRef: "PROCEDIMENTO_A.dataAvvio",
        referenceType: "ENTITY",
        alias: "PROCEDIMENTO_A",
        kind: "PROCEDIMENTO",
        canonicalId: "procedimento-1",
        validatedFieldPath: "dataAvvio",
      },
      {
        statementPath: "recordedState[0]",
        providerRef: "checklist.complete",
        referenceType: "NON_ENTITY",
        alias: null,
        kind: null,
        canonicalId: null,
        validatedFieldPath: "checklist.complete",
      },
    ],
    limitations: [] as unknown as AiFascicoloOutboundAnalysisV1["limitations"],
  };
}

function authoritativeEvidenceFixture(): AiFascicoloAuthoritativeEvidenceInputV1 {
  return {
    nonEntityContextId: "procedimento-1",
    entities: [
      {
        kind: "DOCUMENT",
        canonicalId: "document-1",
        validatedFieldPath: "dataDocumento",
        local: {
          displayLabel: "Documento protocollo 42",
          fieldLabel: "Data documento",
          value: { iso: "2026-01-02T00:00:00.000Z" },
        },
      },
      {
        kind: "CONCESSIONE",
        canonicalId: "concessione-1",
        validatedFieldPath: "dataScadenza",
        local: {
          displayLabel: "Concessione 7/2020",
          fieldLabel: "Data scadenza",
          value: "2030-01-01T00:00:00.000Z",
        },
      },
      {
        kind: "PROCEDIMENTO",
        canonicalId: "procedimento-1",
        validatedFieldPath: "dataAvvio",
        local: {
          displayLabel: "Procedimento interno",
          fieldLabel: "Data avvio",
          value: "2026-01-01T00:00:00.000Z",
        },
      },
    ],
    nonEntities: [{
      contextId: "procedimento-1",
      validatedFieldPath: "checklist.complete",
      local: {
        displayLabel: "Checklist contraddittorio",
        fieldLabel: "Completata",
        value: false,
      },
    }],
  };
}

function assertCompleteGraphFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    assertCompleteGraphFrozen(child, seen);
  }
}

describe("AI-01C2B4A trusted local rehydration", () => {
  it("resolves entity evidence only by the exact kind, canonical ID, and field path", () => {
    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: authoritativeEvidenceFixture(),
    });

    expect(result.statements[0].evidence[0]).toMatchObject({
      providerRef: "DOC_1.dataDocumento",
      resolutionStatus: "RESOLVED",
      local: {
        provenance: "LOCAL_AUTHORITATIVE_DATA",
        displayLabel: "Documento protocollo 42",
        fieldLabel: "Data documento",
        value: { iso: "2026-01-02T00:00:00.000Z" },
      },
    });
  });

  it.each([
    ["canonical ID", { canonicalId: "document-other" }],
    ["kind", { kind: "CONCESSIONE" as const }],
    ["field path", { validatedFieldPath: "createdAt" }],
  ])("does not resolve an entity with the wrong %s", (_name, replacement) => {
    const authoritativeEvidence = authoritativeEvidenceFixture();
    authoritativeEvidence.entities = [{
      ...authoritativeEvidence.entities[0],
      ...replacement,
    }] as typeof authoritativeEvidence.entities;

    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence,
    });

    expect(result.statements[0].evidence[0]).toMatchObject({
      alias: "DOC_1",
      resolutionStatus: "MISSING_LOCAL_EVIDENCE",
      local: null,
    });
  });

  it("cannot resolve by alias and does not rewrite provider-authored content", () => {
    const trustedResult = trustedResultFixture();
    const originalText = trustedResult.analysis.summary.text;
    const originalBasisRefs = [...trustedResult.analysis.summary.basisRefs];
    const authoritativeEvidence = authoritativeEvidenceFixture();
    authoritativeEvidence.entities = [{
      ...authoritativeEvidence.entities[0],
      canonicalId: "DOC_1",
    }];

    const result = buildAiFascicoloTrustedReviewV1({ trustedResult, authoritativeEvidence });
    const summary = result.statements[0];

    expect(summary.evidence[0].resolutionStatus).toBe("MISSING_LOCAL_EVIDENCE");
    expect(summary.providerStatement).toEqual({
      provenance: "AI_ORIGINAL",
      content: {
        text: originalText,
        basisRefs: originalBasisRefs,
      },
    });
    expect(summary.providerStatement.content.text).not.toContain("document-1");
    expect(summary.providerStatement.content.text).not.toContain("Documento protocollo 42");
  });

  it("isolates and freezes the complete projection without mutating either trusted input", () => {
    const trustedResult = trustedResultFixture();
    const authoritativeEvidence = authoritativeEvidenceFixture();
    const trustedBefore = JSON.stringify(trustedResult);
    const authoritativeBefore = JSON.stringify(authoritativeEvidence);

    const result = buildAiFascicoloTrustedReviewV1({ trustedResult, authoritativeEvidence });

    expect(JSON.stringify(trustedResult)).toBe(trustedBefore);
    expect(JSON.stringify(authoritativeEvidence)).toBe(authoritativeBefore);
    assertCompleteGraphFrozen(result);

    trustedResult.analysis.summary.text = "mutated input";
    trustedResult.analysis.summary.basisRefs.push("DOC_99");
    (trustedResult.resolvedBasisRefs[0] as { providerRef: string }).providerRef = "DOC_99";
    authoritativeEvidence.entities[0].local.value = "mutated local input";

    expect(result.providerAnalysis.content.summary.text).toBe(
      "Il documento DOC_1 risulta registrato.",
    );
    expect(result.providerAnalysis.content.summary.basisRefs).toEqual([
      "DOC_1.dataDocumento",
      "TITOLO_A.dataScadenza",
    ]);
    expect(result.statements[0].evidence[0].providerRef).toBe("DOC_1.dataDocumento");
    expect(result.statements[0].evidence[0].local?.value).toEqual({
      iso: "2026-01-02T00:00:00.000Z",
    });
    expect(() => {
      (result.statements[0] as unknown as { statementPath: string }).statementPath = "changed";
    }).toThrow(TypeError);
  });

  it("keeps local evidence in a provenance-marked sidecar only", () => {
    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: authoritativeEvidenceFixture(),
    });
    const serializedProvider = JSON.stringify(result.providerAnalysis);

    expect(serializedProvider).not.toContain("Documento protocollo 42");
    expect(serializedProvider).not.toContain("LOCAL_AUTHORITATIVE_DATA");
    expect(result.providerAnalysis.provenance).toBe("AI_ORIGINAL");
    expect(result.statements[0].evidence[0].local?.provenance)
      .toBe("LOCAL_AUTHORITATIVE_DATA");
  });

  it("marks zero basisRefs without fabricating evidence", () => {
    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: authoritativeEvidenceFixture(),
    });
    const question = result.statements.find(
      (item) => item.statementPath === "investigativeQuestions[0]",
    );

    expect(question).toMatchObject({ resolutionStatus: "NO_BASIS_REFS", evidence: [] });
  });

  it("returns missing evidence without retry or fabrication", () => {
    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: {
        nonEntityContextId: "procedimento-1",
        entities: [],
        nonEntities: [],
      },
    });

    expect(result.statements[0].resolutionStatus).toBe("MISSING_LOCAL_EVIDENCE");
    expect(result.statements[0].evidence[0]).toMatchObject({
      resolutionStatus: "MISSING_LOCAL_EVIDENCE",
      local: null,
    });
  });

  it("resolves NON_ENTITY evidence only by exact context and allowlisted path", () => {
    const exact = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: authoritativeEvidenceFixture(),
    });
    const exactStatement = exact.statements.find(
      (item) => item.statementPath === "recordedState[0]",
    );
    expect(exactStatement?.evidence[0]).toMatchObject({
      resolutionStatus: "RESOLVED",
      local: { displayLabel: "Checklist contraddittorio", value: false },
    });

    const unapproved = authoritativeEvidenceFixture();
    unapproved.nonEntities = [{
      ...unapproved.nonEntities[0],
      contextId: "other-context",
      validatedFieldPath: "checklist.percentage",
    }];
    const missing = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: unapproved,
    });
    const missingStatement = missing.statements.find(
      (item) => item.statementPath === "recordedState[0]",
    );
    expect(missingStatement?.evidence[0]).toMatchObject({
      resolutionStatus: "MISSING_LOCAL_EVIDENCE",
      local: null,
    });
  });

  it("preserves statement and evidence order and exposes no decision classification", () => {
    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence: authoritativeEvidenceFixture(),
    });

    expect(result.statements.map((item) => item.statementPath)).toEqual([
      "summary",
      "timeline[0]",
      "recordedState[0]",
      "investigativeQuestions[0]",
    ]);
    expect(result.statements[0].evidence.map((item) => item.providerRef)).toEqual([
      "DOC_1.dataDocumento",
      "TITOLO_A.dataScadenza",
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "CONSISTENT",
      "DATA_MISMATCH",
      "APPROVE",
      "REJECT",
      "REVOKE",
      "RENEW",
      "COMPANY_REVIEW",
      "COMPANY_AMENDMENT",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not select duplicate exact local evidence", () => {
    const authoritativeEvidence = authoritativeEvidenceFixture();
    authoritativeEvidence.entities = [
      authoritativeEvidence.entities[0],
      authoritativeEvidence.entities[0],
    ];

    const result = buildAiFascicoloTrustedReviewV1({
      trustedResult: trustedResultFixture(),
      authoritativeEvidence,
    });

    expect(result.statements[0].evidence[0]).toMatchObject({
      resolutionStatus: "REQUIRES_HUMAN_REVIEW",
      local: null,
    });
  });
});