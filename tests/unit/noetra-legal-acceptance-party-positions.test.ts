import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  fascicoloStructuredKnowledgeSchema,
  projectStructuredKnowledge,
  type KnowledgeEvidenceCandidate,
} from "@/server/fascicolo-knowledge";
import { buildStructuredFascicoloReport } from "@/server/fascicolo-report";
import type {
  StructuredKnowledgeReadItem,
  StructuredKnowledgeReadModel,
} from "@/server/queries/fascicolo-knowledge";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "fascicolo-legal-acceptance");
const expected = JSON.parse(readFileSync(path.join(fixtures, "expected-outcome.json"), "utf8")) as {
  requiredCoverage: { defenses: boolean };
  documents: { file: string; basisRef: string; role: string }[];
};
const defenseText = readFileSync(path.join(fixtures, "03-controdeduzioni.txt"), "utf8");
const basisRef = expected.documents.find((document) => document.role === "DEFENSES")?.basisRef;
const defenses = [
  "Il concessionario sostiene che il primo container sia necessario alla gestione temporanea della manutenzione.",
  "Quanto al secondo container, afferma che i materiali commerciali sarebbero accessori all'attivita nautica.",
] as const;
const subjectLocalId = "concessionario-test-legal-001";
const subjectId = "subject-concessionario-test-legal-001";

function fixtureKnowledge(reference: string) {
  return {
    version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1" as const,
    subjects: [{
      localId: subjectLocalId,
      canonicalName: "Concessionario TEST-LEGAL-001",
      subjectType: "ORGANIZATION" as const,
      strongIdentifiers: [],
      aliases: [],
    }],
    items: defenses.map((statement, index) => ({
      localId: "defense-" + (index + 1),
      kind: "PARTY_POSITION" as const,
      confidence: 90,
      basisRefs: [reference],
      payload: {
        subjectLocalId,
        positionType: "DEFENSE" as const,
        normalizedStatement: statement,
        context: "Controdeduzioni del 18 ottobre 2026",
        relatedItemLocalIds: [],
      },
    })),
    legalIssues: [],
    researchQuestions: [],
  };
}

function evidence(reference: string): KnowledgeEvidenceCandidate {
  return {
    provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION",
    documentoId: "doc-controdeduzioni-v5",
    documentFileVersionId: "version-controdeduzioni-v5",
    documentExtractionAttemptId: "attempt-controdeduzioni-v5",
    pageNumber: 1,
    textSha256: "a".repeat(64),
    quoteSha256: null,
    basisRef: reference,
  };
}

function reportKnowledge(positions: readonly StructuredKnowledgeReadItem[]): StructuredKnowledgeReadModel {
  return {
    revision: {
      id: "revision-synthetic-positions",
      corpusFingerprint: "b".repeat(64),
      contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      createdAt: new Date("2026-10-20T10:00:00Z"),
      completedAt: new Date("2026-10-20T10:00:01Z"),
      warnings: [],
    },
    subjects: [{ id: subjectId, canonicalName: "Concessionario TEST-LEGAL-001", subjectType: "ORGANIZATION", aliases: [] }],
    partyRoles: [],
    partyPositions: positions,
    facts: [],
    events: [],
    legalActs: [],
    measures: [],
    contradictions: [],
    gaps: [],
    deadlineCandidates: [],
    legalIssues: [],
    researchQuestions: [],
    timeline: [],
  };
}

describe("TEST-LEGAL-001: deterministic party defenses without OpenAI", () => {
  it("retains BOTH substantive defenses, party attribution, page provenance, and report visibility", () => {
    expect(expected.requiredCoverage.defenses).toBe(true);
    expect(basisRef).toBe("DOCUMENT_3.PAGE_1");
    for (const statement of defenses) expect(defenseText).toContain(statement);

    const knowledge = fascicoloStructuredKnowledgeSchema.parse(fixtureKnowledge(basisRef!));
    const projection = projectStructuredKnowledge({
      knowledge,
      subjectIdsByLocalId: new Map([[subjectLocalId, subjectId]]),
      evidenceByBasisRef: new Map([[basisRef!, evidence(basisRef!)]]),
    });
    expect(projection.warnings).toEqual([]);
    expect(projection.candidates).toHaveLength(2);
    expect(projection.candidates.every((candidate) => candidate.kind === "PARTY_POSITION")).toBe(true);
    expect(projection.candidates.some((candidate) => candidate.kind === "FACT")).toBe(false);
    expect(new Set(projection.candidates.map((candidate) => candidate.semanticKey)).size).toBe(2);

    const positions: StructuredKnowledgeReadItem[] = projection.candidates.map((candidate, index) => ({
      id: "position-" + (index + 1),
      kind: "PARTY_POSITION",
      semanticKey: candidate.semanticKey,
      contentFingerprint: candidate.contentFingerprint,
      normalizedText: candidate.normalizedText,
      payload: candidate.structuredPayload,
      confidence: candidate.confidence,
      status: "AI_PROPOSED",
      reviewVersion: 0,
      evidence: candidate.evidence.map((source) => ({
        provenanceType: source.provenanceType,
        basisRef: source.basisRef,
        documentoId: source.documentoId,
        documentFileVersionId: source.documentFileVersionId,
        documentExtractionAttemptId: source.documentExtractionAttemptId,
        extractionAttemptId: source.extractionAttemptId,
        pageNumber: source.pageNumber,
        textSha256: source.textSha256,
      })),
    }));

    expect(positions.map((position) => position.normalizedText).sort()).toEqual([...defenses].sort());
    for (const position of positions) {
      expect(position.payload).toMatchObject({ positionType: "DEFENSE", subjectIds: [subjectId] });
      expect(position.evidence).toEqual([
        expect.objectContaining({
          basisRef,
          documentoId: "doc-controdeduzioni-v5",
          documentFileVersionId: "version-controdeduzioni-v5",
          documentExtractionAttemptId: "attempt-controdeduzioni-v5",
          pageNumber: 1,
        }),
      ]);
    }

    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-synthetic-v5",
      procedimentoId: "procedimento-synthetic-v5",
      knowledge: reportKnowledge(positions),
      missions: [],
    });
    const reported = report.payload.documentedFramework.partyPositions ?? [];
    expect(reported.map((position) => position.normalizedText).sort()).toEqual([...defenses].sort());
    expect(reported.every((position) => position.status === "AI_PROPOSED")).toBe(true);
    expect(reported.every((position) => position.evidence[0]?.basisRef === basisRef)).toBe(true);
    expect(report.payload.documentedFramework.facts).toEqual([]);
  });

  it("rejects an unknown party and never invents evidence for an unavailable page", () => {
    const invalidParty = fixtureKnowledge(basisRef!);
    invalidParty.items[0].payload.subjectLocalId = "unknown-concessionaire";
    expect(fascicoloStructuredKnowledgeSchema.safeParse(invalidParty).success).toBe(false);

    const nonexistentPage = "DOCUMENT_99.PAGE_1";
    const projection = projectStructuredKnowledge({
      knowledge: fascicoloStructuredKnowledgeSchema.parse(fixtureKnowledge(nonexistentPage)),
      subjectIdsByLocalId: new Map([[subjectLocalId, subjectId]]),
      evidenceByBasisRef: new Map([[basisRef!, evidence(basisRef!)]]),
    });
    expect(projection.candidates).toHaveLength(0);
    expect(projection.warnings).toContain("INVALID_EVIDENCE:defense-1");
    expect(projection.warnings).toContain("INVALID_EVIDENCE:defense-2");
  });
});
