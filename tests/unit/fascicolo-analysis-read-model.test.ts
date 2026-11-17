import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const loadCurrentStructuredKnowledgeMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/queries/fascicolo-knowledge", () => ({
  loadCurrentStructuredKnowledge: loadCurrentStructuredKnowledgeMock,
}));

import { getFascicoloAnalysisReadModel } from "@/server/queries/fascicolo-analysis";

const evidence = [{
  provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION" as const,
  basisRef: "DOCUMENT_1.PAGE_1",
  documentoId: "document-1",
  documentFileVersionId: "file-1",
  extractionAttemptId: null,
  documentExtractionAttemptId: "attempt-1",
  pageNumber: 1,
  textSha256: "a".repeat(64),
}];

function item(id: string, kind: string, normalizedText: string, payload: object = {}) {
  return {
    id,
    kind,
    semanticKey: `${kind}:${id}`,
    contentFingerprint: "b".repeat(64),
    normalizedText,
    payload,
    confidence: 90,
    status: "PROPOSED",
    reviewVersion: 0,
    evidence,
  };
}

describe("getFascicoloAnalysisReadModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "ADMIN",
      isAdmin: true,
      defaultTenantId: "tenant-1",
      accessibleTenantIds: ["tenant-1"],
    });
    prismaMock.procedimento.findUnique.mockResolvedValue({ enteId: "tenant-1" });
    loadCurrentStructuredKnowledgeMock.mockResolvedValue({
      revision: {
        id: "revision-1",
        corpusFingerprint: "c".repeat(64),
        contractVersion: "V1",
        createdAt: new Date("2026-10-17T10:30:00Z"),
        completedAt: new Date("2026-10-17T10:30:05Z"),
        warnings: [],
      },
      subjects: [{
        id: "subject-1",
        canonicalName: "Società sintetica",
        subjectType: "ORGANIZATION",
        aliases: [],
      }],
      partyRoles: [],
      facts: [item("fact-1", "FACT", "Il documento contiene un fatto.")],
      events: [item("event-1", "EVENT", "Istanza presentata.")],
      legalActs: [],
      measures: [],
      contradictions: [],
      gaps: [item("gap-1", "GAP", "Manca un allegato.")],
      deadlineCandidates: [],
      legalIssues: [{
        ...item("issue-1", "LEGAL_ISSUE", "Disciplina applicabile.", {
          title: "Disciplina applicabile",
          priority: "HIGH",
        }),
        originatingItemIds: ["fact-1"],
      }],
      researchQuestions: [{
        ...item("question-1", "RESEARCH_QUESTION", "Quale norma si applica?", {
          canonicalQuestion: "Quale norma si applica?",
          priority: "HIGH",
        }),
        legalIssueId: "issue-1",
      }],
      timeline: [item("event-1", "EVENT", "Istanza presentata.")],
    });
  });

  it("reuses CURRENT knowledge for questions, facts, subjects, timeline, gaps, and provenance", async () => {
    const result = await getFascicoloAnalysisReadModel("procedure-1");

    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      { mode: "read", allowWhenEnteMissing: false },
    );
    expect(loadCurrentStructuredKnowledgeMock).toHaveBeenCalledWith(
      "tenant-1",
      "procedure-1",
    );
    expect(result?.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Disciplina applicabile" }),
      expect.objectContaining({ title: "Quale norma si applica?" }),
    ]));
    expect(result?.relevantItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Società sintetica" }),
      expect.objectContaining({ title: "Il documento contiene un fatto." }),
      expect.objectContaining({ title: "Istanza presentata." }),
    ]));
    expect(result?.gaps).toEqual([
      expect.objectContaining({ title: "Manca un allegato." }),
    ]);
    expect(result?.evidence).toEqual([
      expect.objectContaining({
        title: "Documento document-1",
        detail: "Pagina 1",
      }),
    ]);
  });

  it("returns no model when tenant access is denied", async () => {
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("FORBIDDEN");
    });

    await expect(getFascicoloAnalysisReadModel("procedure-1")).resolves.toBeNull();
    expect(loadCurrentStructuredKnowledgeMock).not.toHaveBeenCalled();
  });
});
