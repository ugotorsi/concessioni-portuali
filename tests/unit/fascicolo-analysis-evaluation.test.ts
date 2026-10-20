import { describe, expect, it, vi } from "vitest";

import type { CurrentTenantContext } from "@/lib/tenant-auth";
import {
  normalizeAsyncJobAdmission,
  normalizeAsyncJobResultMetadata,
} from "@/server/async-jobs/domain";
import { applicationAsyncJobOperationBlocklist } from "@/server/async-jobs/applicationWorker";
import {
  buildFascicoloAnalysisEvaluationAdmission,
  admitFascicoloAnalysisEvaluation,
  authorizeFascicoloAnalysisEvaluation,
  compareTestLegal001Output,
  createFascicoloAnalysisEvaluationHandler,
  fascicoloAnalysisEvaluationCostRequest,
  FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
} from "@/server/ai/fascicoloAnalysisEvaluation";
import type {
  FascicoloAnalysisEvaluationArtifactInput,
  FascicoloAnalysisEvaluationPermit,
} from "@/server/ai/fascicoloAnalysisEvaluationRepository";
import type { FascicoloDocumentAnalysisInput } from "@/server/ai/fascicoloDocumentAnalysis";
import type { ProviderAnalysisPayloadV1 } from "@/server/ai/fascicoloAnalysis";
import type { FascicoloDocumentCorpus } from "@/server/queries/fascicolo-document-corpus";

const tenantId = "tenant-evaluation";
const procedimentoId = "procedure-evaluation";
const corpusFingerprint = "a".repeat(64);
const authorizationRef = "approval:test-legal-001:20261020";

function corpus(): FascicoloDocumentCorpus {
  const documents = Array.from({ length: 8 }, (_, index) => ({
    reference: `DOCUMENT_${index + 1}`,
    documentoId: `document-${index + 1}`,
    name: `Documento ${index + 1}`,
    documentFileVersionId: `version-${index + 1}`,
    extractionAttemptId: `attempt-${index + 1}`,
    sourceSha256: String(index + 1).repeat(64).slice(0, 64),
    status: "AVAILABLE" as const,
    failureCode: null,
    pageCount: 1,
    characterCount: 100,
  }));
  const excerpts = documents.map((document, index) => ({
    reference: `DOCUMENT_${index + 1}.PAGE_1`,
    documentoId: document.documentoId,
    extractionAttemptId: document.extractionAttemptId!,
    documentVersionId: document.documentFileVersionId!,
    artifactSha256: document.sourceSha256!,
    pageNumber: 1,
    text: index === 2
      ? "Titolo: Controdeduzioni del concessionario TEST-LEGAL-001. "
        + "Il primo container serve per la manutenzione. "
        + "I materiali commerciali del secondo container sono accessori all'attivita nautica. "
        + "Marker: NOETRA-LEGAL-ACCEPTANCE-DEFENSES"
      : index === 3
        ? "Titolo: Relazione tecnica contraddittoria TEST-LEGAL-001. "
          + "Il rilievo tecnico contraddice la qualificazione del primo container. "
          + "Marker: NOETRA-LEGAL-ACCEPTANCE-TECHNICAL"
      : `Contenuto sintetico documento ${index + 1}.`,
    textSha256: String.fromCharCode(97 + index).repeat(64),
    extractionMethod: "DIRECT_TEXT",
    ocrConfidence: null,
  }));
  return {
    tenantId,
    procedimentoId,
    corpusFingerprint,
    availability: "READY",
    documentCount: 8,
    availableDocumentCount: 8,
    textPageCount: 8,
    documents,
    excerpts,
  };
}

function output(): ProviderAnalysisPayloadV1 {
  const defenseRef = "DOCUMENT_3.PAGE_1";
  return {
    summary: { text: "Sintesi documentata", basisRefs: [defenseRef] },
    timeline: [],
    recordedState: [],
    signals: [],
    investigativeQuestions: [],
    suggestedActivities: [],
    legalResearchQuestions: [],
    structuredKnowledge: {
      version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      subjects: [{
        localId: "concessionario",
        canonicalName: "Concessionario TEST-LEGAL-001",
        subjectType: "ORGANIZATION",
        strongIdentifiers: [],
        aliases: [],
      }],
      items: [{
        localId: "defense-first",
        kind: "PARTY_POSITION",
        confidence: 90,
        basisRefs: [defenseRef],
        payload: {
          subjectLocalId: "concessionario",
          positionType: "DEFENSE",
          normalizedStatement: "Il primo container e necessario per la manutenzione temporanea.",
          context: "Controdeduzioni",
          relatedItemLocalIds: [],
        },
      }, {
        localId: "defense-second",
        kind: "PARTY_POSITION",
        confidence: 90,
        basisRefs: [defenseRef],
        payload: {
          subjectLocalId: "concessionario",
          positionType: "DEFENSE",
          normalizedStatement: "I materiali commerciali del secondo container sono accessori all'attivita nautica.",
          context: "Controdeduzioni",
          relatedItemLocalIds: [],
        },
      }],
      legalIssues: [{
        localId: "issue-first",
        title: "Uso del primo container",
        normalizedIssue: "Qualificazione dell'uso del primo container",
        areaOfLaw: "demanio",
        priority: "HIGH",
        rationale: "La difesa richiede verifica",
        originatingItemLocalIds: ["defense-first"],
        confidence: 80,
        referenceDateBasis: null,
      }, {
        localId: "issue-second",
        title: "Materiali nel secondo container",
        normalizedIssue: "Accessorieta dei materiali commerciali",
        areaOfLaw: "demanio",
        priority: "HIGH",
        rationale: "La difesa richiede verifica",
        originatingItemLocalIds: ["defense-second"],
        confidence: 80,
        referenceDateBasis: null,
      }],
      researchQuestions: [],
    },
  };
}

function evaluationPermit(
  evaluationId = "evaluation-test-legal-001-01",
): FascicoloAnalysisEvaluationPermit {
  return {
    permitRef: `${authorizationRef}:${evaluationId}`,
    evaluationId,
    tenantId,
    procedimentoId,
    corpusFingerprint,
    operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    testCaseId: "TEST-LEGAL-001",
    maxCostAmount: 0.5,
    authorizedByUserId: "admin-1",
    expiresAt: new Date("2099-10-20T18:00:00Z"),
    consumedByJobId: null,
    consumedAt: null,
    revokedAt: null,
  };
}

function admission(evaluationId = "evaluation-test-legal-001-01") {
  return buildFascicoloAnalysisEvaluationAdmission({
    permit: evaluationPermit(evaluationId),
    actorId: "authorized-evaluation-runner",
    actorEmail: null,
    actorRole: "SYSTEM",
  });
}

describe("fascicolo analysis evaluation-only mode", () => {
  it("has isolated idempotency, one attempt, explicit authorization, and a 0.50 EUR cap", () => {
    const first = normalizeAsyncJobAdmission(admission());
    const reused = normalizeAsyncJobAdmission(admission());
    const distinct = normalizeAsyncJobAdmission(admission("evaluation-test-legal-001-02"));

    expect(first.operation).toBe(FASCICOLO_ANALYSIS_EVALUATION_OPERATION);
    expect(first.idempotencyKey).toBe(reused.idempotencyKey);
    expect(distinct.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(first.maxAttempts).toBe(1);
    expect(first.policyDecisionRef).toBe(evaluationPermit().permitRef);
    expect(first.admission.admissionType).toBe("AUTHORIZED_SYSTEM");
    expect(first.inputReference).toMatchObject({
      metadata: {
        costLimitCode: "EUR_0_50",
        expectedDocumentCount: 8,
      },
    });

    expect(applicationAsyncJobOperationBlocklist(true))
      .toContain(FASCICOLO_ANALYSIS_EVALUATION_OPERATION);
    expect(applicationAsyncJobOperationBlocklist(false))
      .toContain(FASCICOLO_ANALYSIS_EVALUATION_OPERATION);
    expect(fascicoloAnalysisEvaluationCostRequest({
      tenantId,
      procedimentoId,
      jobId: "job-evaluation",
      evaluationId: "evaluation-test-legal-001-01",
      maxCostAmount: 0.5,
    })).toMatchObject({
      estimatedAmount: 0.5,
      jobId: "job-evaluation",
      operationType: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    });
    expect(() => fascicoloAnalysisEvaluationCostRequest({
      tenantId,
      procedimentoId,
      jobId: "job-evaluation",
      evaluationId: "evaluation-test-legal-001-01",
      maxCostAmount: 0.51,
    })).toThrow("EVALUATION_COST_LIMIT_INVALID");
  });

  it("issues a persisted permit only for an authenticated tenant ADMIN and binds it to one evaluation", async () => {
    const actor = { id: "admin-1", email: "admin@example.test", role: "ADMIN" as const };
    const tenantContext: CurrentTenantContext = {
      userId: actor.id,
      role: actor.role,
      isAdmin: true,
      tenantMemberships: [],
      defaultTenantId: null,
      accessibleTenantIds: [],
    };
    const persistPermit = vi.fn(async (input) => ({
      outcome: "CREATED" as const,
      permit: {
        ...evaluationPermit(input.evaluationId),
        permitRef: input.permitRef,
        expiresAt: input.expiresAt,
      },
    }));
    const result = await authorizeFascicoloAnalysisEvaluation({
      evaluationId: "evaluation-test-legal-001-01",
      tenantId,
      procedimentoId,
      corpusFingerprint,
      expiresAt: new Date("2026-10-20T17:30:00Z"),
    }, {
      getCurrentUser: vi.fn(async () => actor),
      getCurrentTenantContext: vi.fn(async () => tenantContext),
      loadCorpus: vi.fn(async () => corpus()),
      persistPermit,
      now: () => new Date("2026-10-20T17:00:00Z"),
    });
    expect(result.outcome).toBe("CREATED");
    expect(persistPermit).toHaveBeenCalledWith(expect.objectContaining({
      evaluationId: "evaluation-test-legal-001-01",
      tenantId,
      procedimentoId,
      corpusFingerprint,
      maxCostAmount: 0.5,
      authorizedByUserId: actor.id,
    }));
    await expect(authorizeFascicoloAnalysisEvaluation({
      evaluationId: "evaluation-test-legal-001-02",
      tenantId,
      procedimentoId,
      corpusFingerprint,
      expiresAt: new Date("2026-10-20T17:30:00Z"),
    }, {
      getCurrentUser: vi.fn(async () => ({ ...actor, role: "GIURIDICO" as const })),
      getCurrentTenantContext: vi.fn(async () => tenantContext),
      loadCorpus: vi.fn(async () => corpus()),
      persistPermit,
      now: () => new Date("2026-10-20T17:00:00Z"),
    })).rejects.toThrow("EVALUATION_ADMIN_REQUIRED");
  });

  it("consumes a persisted permit once and rejects reuse for another evaluationId", async () => {
    const storedPermit = evaluationPermit();
    const admit = vi.fn(async () => ({
      outcome: "CREATED" as const,
      job: { id: "job-evaluation" },
    })) as never;
    const consumePermit = vi.fn(async () => ({
      ...storedPermit,
      consumedByJobId: "job-evaluation",
      consumedAt: new Date(),
    }));
    await expect(admitFascicoloAnalysisEvaluation({
      permitRef: storedPermit.permitRef,
      evaluationId: storedPermit.evaluationId,
      actorId: "evaluation-runner",
      actorEmail: null,
      actorRole: "SYSTEM",
    }, {
      loadPermit: vi.fn(async () => storedPermit),
      admit,
      consumePermit,
    })).resolves.toMatchObject({ job: { id: "job-evaluation" } });
    expect(consumePermit).toHaveBeenCalledWith({
      permitRef: storedPermit.permitRef,
      evaluationId: storedPermit.evaluationId,
      jobId: "job-evaluation",
    });

    await expect(admitFascicoloAnalysisEvaluation({
      permitRef: storedPermit.permitRef,
      evaluationId: "evaluation-test-legal-001-02",
      actorId: "evaluation-runner",
      actorEmail: null,
      actorRole: "SYSTEM",
    }, {
      loadPermit: vi.fn(async () => storedPermit),
      admit,
      consumePermit,
    })).rejects.toThrow("EVALUATION_PERMIT_INVALID");
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it("sends all eight real corpus documents and persists only the evaluation artifact", async () => {
    const actualCorpus = corpus();
    const analyze = vi.fn(async (_input: FascicoloDocumentAnalysisInput & {
      jobId: string;
      evaluationId: string;
      maxCostAmount: number;
    }) => output());
    const persistArtifact = vi.fn(async (_input: FascicoloAnalysisEvaluationArtifactInput) => ({
      outcome: "CREATED" as const,
      evaluationId: "evaluation-test-legal-001-01",
    }));
    const handler = createFascicoloAnalysisEvaluationHandler({
      loadAuthority: vi.fn(async () => ({
        tenantId,
        procedimentoId,
        actorId: "authorized-evaluation-runner",
        actorEmail: null,
        actorRole: "SYSTEM",
        authorizationRef,
        corpus: actualCorpus,
      })),
      analyze,
      persistArtifact,
    });

    const result = await handler.execute(
      normalizeAsyncJobAdmission(admission()).inputReference as never,
      {
        jobId: "job-evaluation",
        correlationId: "correlation:evaluation",
        attempt: 1,
        isCancellationRequested: vi.fn(async () => false),
        heartbeat: vi.fn(async () => undefined),
      },
    );

    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-evaluation",
      maxCostAmount: 0.5,
      corpusFingerprint,
      documents: expect.arrayContaining([
        expect.objectContaining({ documentVersionId: "version-1" }),
        expect.objectContaining({ documentVersionId: "version-8" }),
      ]),
      excerpts: expect.arrayContaining([
        expect.objectContaining({ reference: "DOCUMENT_3.PAGE_1" }),
      ]),
      externalToolsAllowed: false,
    }));
    const analyzedInput = analyze.mock.calls[0]?.[0];
    expect(analyzedInput?.documents).toHaveLength(8);
    expect(analyzedInput?.excerpts).toHaveLength(8);
    expect(analyzedInput).not.toHaveProperty("expectedOutcome");
    expect(analyzedInput).not.toHaveProperty("knowledgeRevisionId");
    expect(persistArtifact).toHaveBeenCalledOnce();
    const artifact = persistArtifact.mock.calls[0]?.[0];
    expect(artifact).toBeDefined();
    expect(artifact).toMatchObject({
      tenantId,
      procedimentoId,
      corpusFingerprint,
      maxCostAmount: 0.5,
      comparison: {
        passed: true,
        defenseItemLocalIds: ["defense-first", "defense-second"],
        sourceBasisRefs: ["DOCUMENT_3.PAGE_1"],
      },
    });
    expect(artifact.provenance).toHaveLength(8);
    expect(result).toMatchObject({
      referenceType: "FASCICOLO_ANALYSIS_EVALUATION",
      metadata: { comparisonCode: "PASSED", documentCount: 8, pageCount: 8 },
    });
    expect(() => normalizeAsyncJobResultMetadata(result)).not.toThrow();
  });

  it("fails closed for unauthorized or cross-tenant execution", async () => {
    const handler = createFascicoloAnalysisEvaluationHandler({
      loadAuthority: vi.fn(async () => null),
      analyze: vi.fn(),
      persistArtifact: vi.fn(),
    });
    await expect(handler.execute(
      normalizeAsyncJobAdmission(admission()).inputReference as never,
      {
        jobId: "job-other-tenant",
        correlationId: "correlation:other",
        attempt: 1,
        isCancellationRequested: vi.fn(async () => false),
        heartbeat: vi.fn(async () => undefined),
      },
    )).rejects.toThrow("EVALUATION_AUTHORITY_MISMATCH");
  });

  it("evaluates provenance, attribution, epistemic separation, and legal-issue coverage", () => {
    expect(compareTestLegal001Output(output(), corpus())).toEqual({
      passed: true,
      defenseItemLocalIds: ["defense-first", "defense-second"],
      sourceBasisRefs: ["DOCUMENT_3.PAGE_1"],
      checks: {
        twoDistinctPartyPositions: true,
        attributedToConcessionaire: true,
        citedToDefensePage: true,
        separatedFromFactsAndTechnicalFindings: true,
        consideredByLegalIssues: true,
      },
    });
  });

  it("does not count keyword matches cited to the technical report or duplicated as established facts", () => {
    const technicalCitation = structuredClone(output());
    const firstPosition = technicalCitation.structuredKnowledge?.items
      .find((item) => item.localId === "defense-first");
    if (!firstPosition || firstPosition.kind !== "PARTY_POSITION") throw new Error("INVALID_TEST_FIXTURE");
    firstPosition.basisRefs = ["DOCUMENT_4.PAGE_1"];
    const technicalResult = compareTestLegal001Output(technicalCitation, corpus());
    expect(technicalResult.passed).toBe(false);
    expect(technicalResult.checks.citedToDefensePage).toBe(false);

    const factDuplication = structuredClone(output());
    factDuplication.structuredKnowledge?.items.push({
      localId: "fact-defense-first",
      kind: "FACT",
      confidence: 90,
      basisRefs: ["DOCUMENT_3.PAGE_1"],
      payload: {
        normalizedStatement: "Il primo container e necessario per la manutenzione temporanea.",
        subjectLocalIds: ["concessionario"],
        object: null,
        qualifier: null,
      },
    });
    const factResult = compareTestLegal001Output(factDuplication, corpus());
    expect(factResult.passed).toBe(false);
    expect(factResult.checks.separatedFromFactsAndTechnicalFindings).toBe(false);
  });
});
