import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  buildFascicoloAutomaticAnalysisAdmission,
  createFascicoloAutomaticAnalysisHandler,
  executeDeferredKnowledgeResearchWave,
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
  type AutomaticFascicoloReport,
  type FascicoloAutomaticAnalysisDependencies,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import {
  createAuthorityCandidate,
  type ResearchEvidenceBundle,
  type ResearchMission,
} from "@/server/legal-research/bridge";
import type { ResearchProviderAdapter } from "@/server/legal-research/provider-research-adapters";
import type { TrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";
import { createTrustedMissionExecutor } from "@/server/legal-research/trusted-mission-executor";
import {
  fascicoloStructuredKnowledgeSchema,
  projectStructuredKnowledge,
  type KnowledgeEvidenceCandidate,
  type KnowledgeResearchMissionPlan,
  type KnowledgeReconciliationResult,
} from "@/server/fascicolo-knowledge";

const reference = {
  referenceType: "FASCICOLO_DOCUMENT_VERSION",
  referenceId: "attempt-1",
  referenceVersion: "V1",
  metadata: {
    procedimentoId: "procedimento-1",
    neutralIntakeId: "intake-1",
    extractionAttemptId: "attempt-1",
  },
} as const;

const authority = {
  tenantId: "tenant-1",
  procedimentoId: "procedimento-1",
  neutralIntakeId: "intake-1",
  extractionAttemptId: "attempt-1",
  artifactSha256: "a".repeat(64),
  corpusFingerprint: "c".repeat(64),
  actorId: "user-1",
  documents: [{
    neutralIntakeId: "intake-1",
    documentVersionId: "attempt-1",
    artifactSha256: "a".repeat(64),
    pages: [{
      pageNumber: 1,
      normalizedText: "Il provvedimento indica la scadenza al 31 dicembre 2026 e richiama l'articolo 18.",
      textSha256: "b".repeat(64),
      extractionMethod: "DIRECT_TEXT",
      ocrConfidence: null,
    }],
  }],
} as const;

const analysis = {
  summary: { text: "Il documento contiene una scadenza e un riferimento normativo.", basisRefs: ["DOCUMENT_1.PAGE_1"] },
  timeline: [{ recordedAt: "2026-12-31T00:00:00.000Z", text: "Scadenza indicata nel documento.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  recordedState: [{ text: "È richiamato l'articolo 18.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  signals: [{ type: "VERIFY", text: "Verificare la versione vigente della norma.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  investigativeQuestions: [{ text: "Manca la data di notifica?", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  suggestedActivities: [{ text: "Acquisire la ricevuta di notifica.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  legalResearchQuestions: [{ text: "Quale disciplina si applica alla scadenza indicata ai sensi dell'articolo 18?", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
} as const;

const structuredKnowledge = {
  version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
  subjects: [],
  items: [{
    localId: "fact-1",
    kind: "FACT",
    confidence: 90,
    basisRefs: ["DOCUMENT_1.PAGE_1"],
    payload: {
      normalizedStatement: "Il provvedimento indica la scadenza al 31 dicembre 2026.",
      subjectLocalIds: [],
      object: null,
      qualifier: null,
    },
  }],
} as const;

const lotto3Knowledge = {
  ...structuredKnowledge,
  items: [
    ...structuredKnowledge.items,
    {
      localId: "event-1",
      kind: "EVENT",
      confidence: 90,
      basisRefs: ["DOCUMENT_1.PAGE_1"],
      payload: {
        title: "Istanza",
        normalizedStatement: "Istanza presentata",
        date: { precision: "EXACT", from: "2026-09-01", to: null, originalText: null, confidence: 100 },
        subjectLocalIds: [],
        relatedItemLocalIds: [],
      },
    },
  ],
  legalIssues: [{
    localId: "issue-1",
    title: "Disciplina della scadenza",
    normalizedIssue: "disciplina applicabile alla scadenza",
    areaOfLaw: "demanio",
    priority: "HIGH",
    rationale: "Il fatto documentato richiede qualificazione",
    originatingItemLocalIds: ["fact-1", "event-1"],
    confidence: 90,
    referenceDateBasis: null,
  }],
  researchQuestions: [{
    localId: "question-1",
    legalIssueLocalId: "issue-1",
    canonicalQuestion: "Quale disciplina si applica alla scadenza?",
    priority: "HIGH",
    referenceDate: "2026-09-01",
    referenceDateBasis: { type: "EVENT_DATE", itemLocalId: "event-1", rationale: "Data esatta dell'istanza" },
    requestedCapabilities: ["SEMANTIC_DISCOVERY"],
    mode: "PRIMARY",
  }],
} as const;

function currentReconciliation(knowledge: unknown): KnowledgeReconciliationResult {
  const documentEvidence: KnowledgeEvidenceCandidate = {
    provenanceType: "DOCUMENT_EXTRACTION",
    documentoId: "document-1",
    documentFileVersionId: "file-version-1",
    extractionAttemptId: "attempt-1",
    pageNumber: 1,
    textSha256: "b".repeat(64),
    quoteSha256: null,
    basisRef: "DOCUMENT_1.PAGE_1",
  };
  const projection = projectStructuredKnowledge({
    knowledge: fascicoloStructuredKnowledgeSchema.parse(knowledge),
    subjectIdsByLocalId: new Map(),
    evidenceByBasisRef: new Map([[documentEvidence.basisRef, documentEvidence]]),
  });
  const idByKey = new Map(projection.candidates.map((candidate, index) => [candidate.semanticKey, `item-${index}`]));
  return {
    revision: {
      id: "revision-current",
      tenantId: "tenant-1",
      procedimentoId: "procedimento-1",
      corpusFingerprint: "c".repeat(64),
      contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      status: "CURRENT",
      warnings: [],
      createdAt: new Date("2026-09-29T00:00:00Z"),
      completedAt: new Date("2026-09-29T00:00:01Z"),
      supersededAt: null,
      items: projection.candidates.map((candidate, index) => ({
        id: `item-${index}`,
        tenantId: "tenant-1",
        procedimentoId: "procedimento-1",
        revisionId: "revision-current",
        ...candidate,
        evidence: candidate.evidence.map((item, evidenceIndex) => ({
          id: `evidence-${index}-${evidenceIndex}`,
          tenantId: "tenant-1",
          procedimentoId: "procedimento-1",
          itemId: `item-${index}`,
          createdAt: new Date("2026-09-29T00:00:00Z"),
          ...item,
        })),
        status: "AI_PROPOSED",
        reviewVersion: 0,
        createdAt: new Date("2026-09-29T00:00:00Z"),
        supersededAt: null,
      })),
      relations: projection.relations.map((relation, index) => ({
        id: `relation-${index}`,
        tenantId: "tenant-1",
        procedimentoId: "procedimento-1",
        revisionId: "revision-current",
        sourceItemId: idByKey.get(relation.sourceSemanticKey)!,
        targetItemId: idByKey.get(relation.targetSemanticKey)!,
        relationType: relation.relationType,
        confidence: null,
        createdAt: new Date("2026-09-29T00:00:00Z"),
      })),
    },
    classifications: [],
  };
}

function context() {
  return {
    jobId: "job-1",
    correlationId: "correlation-1",
    attempt: 1,
    isCancellationRequested: vi.fn(async () => false),
    heartbeat: vi.fn(async () => undefined),
  };
}

function dependencies(overrides: Partial<FascicoloAutomaticAnalysisDependencies> = {}) {
  const reports = new Map<string, AutomaticFascicoloReport>();
  return {
    loadAuthority: vi.fn(async () => authority),
    findExistingReport: vi.fn(async () => null),
    analyze: vi.fn(async () => analysis),
    persistReport: vi.fn(async (report: AutomaticFascicoloReport) => {
      const outcome = reports.has(report.reportId) ? "REUSED" as const : "CREATED" as const;
      reports.set(report.reportId, report);
      return { outcome, reportId: report.reportId };
    }),
    persistMission: vi.fn(async () => ({ outcome: "CREATED" as const })),
    scheduleMission: vi.fn(async () => ({
      outcome: "ADMITTED" as const,
      requirementCode: null,
      jobId: "research-job-1",
    })),
    listPriorReportIds: vi.fn(async () => []),
    ...overrides,
  } satisfies FascicoloAutomaticAnalysisDependencies;
}

describe("automatic fascicolo analysis job", () => {
  it("is registered in the real application worker", () => {
    expect(applicationAsyncJobRegistry.resolve(FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION)).not.toBeNull();
  });

  it("builds deterministic tenant-scoped admission for the extracted document version", () => {
    const input = {
      tenantId: "tenant-1",
      procedimentoId: "procedimento-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "attempt-1",
      correlationId: "correlation-1",
      policyDecisionRef: null,
      admissionType: "AUTHENTICATED_USER" as const,
      initiatingUserId: "user-1",
      actorId: "receipt-actor",
      actorEmail: "user@example.test",
      actorRole: "GIURIDICO",
    };
    const first = normalizeAsyncJobAdmission(buildFascicoloAutomaticAnalysisAdmission(input));
    const second = normalizeAsyncJobAdmission(buildFascicoloAutomaticAnalysisAdmission(input));
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.admission.tenantId).toBe("tenant-1");
    expect(first.inputReference.metadata.extractionAttemptId).toBe("attempt-1");
  });

  it("derives a question from document text, persists a report, and creates a pending mission without manual input", async () => {
    const deps = dependencies();
    const result = await createFascicoloAutomaticAnalysisHandler(deps)
      .execute(reference, context());
    expect(deps.analyze).toHaveBeenCalledWith(expect.objectContaining({
      documentsAreUntrustedData: true,
      externalToolsAllowed: false,
      documentVersionId: "attempt-1",
      excerpts: [expect.objectContaining({
        reference: "DOCUMENT_1.PAGE_1",
        documentVersionId: "attempt-1",
        textSha256: "b".repeat(64),
      })],
    }));
    const report = vi.mocked(deps.persistReport).mock.calls[0][0];
    expect(report.analysis.timeline[0].basisRefs).toEqual(["DOCUMENT_1.PAGE_1"]);
    expect(report.missions).toHaveLength(1);
    expect(report.missions[0]).toMatchObject({
      status: "PENDING",
      caseReference: { caseId: "procedimento-1" },
      researchQuestion: analysis.legalResearchQuestions[0].text,
      budget: { maxTotalResearchCalls: 6, maxMoonlitCalls: 2, maxSimpliciterCalls: 2, maxLegalDataHunterCalls: 2 },
    });
    expect(deps.persistMission).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ metadata: { missionCount: 1, supersededCount: 0 } });
  });

  it("persists optional structured knowledge with canonical document provenance without creating extra missions", async () => {
    const persistKnowledge = vi.fn<NonNullable<FascicoloAutomaticAnalysisDependencies["persistKnowledge"]>>(
      async () => currentReconciliation(structuredKnowledge),
    );
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({
          ...document,
          documentoId: "document-1",
          documentFileVersionId: "file-version-1",
        })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge })),
      persistKnowledge,
      reconcileKnowledgeMissions: vi.fn(async ({ plans }) => {
        expect(plans).toEqual([]);
        return [];
      }),
    });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(persistKnowledge).toHaveBeenCalledOnce();
    const input = persistKnowledge.mock.calls[0][0];
    expect(input).toMatchObject({
      tenantId: "tenant-1",
      procedimentoId: "procedimento-1",
      corpusFingerprint: "c".repeat(64),
      knowledge: structuredKnowledge,
    });
    expect(input.evidenceByBasisRef.get("DOCUMENT_1.PAGE_1")).toMatchObject({
      documentoId: "document-1",
      documentFileVersionId: "file-version-1",
      extractionAttemptId: "attempt-1",
      textSha256: "b".repeat(64),
    });
    expect(deps.persistMission).not.toHaveBeenCalled();
    expect(result).toMatchObject({ metadata: { missionCount: 0 } });
  });

  it("creates structured missions only after CURRENT promotion and uses explicit reference-date basis", async () => {
    const order: string[] = [];
    const reconciliation = currentReconciliation(lotto3Knowledge);
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({ ...document, documentoId: "document-1", documentFileVersionId: "file-version-1" })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge: lotto3Knowledge })),
      persistKnowledge: vi.fn(async () => { order.push("CURRENT"); return reconciliation; }),
      reconcileKnowledgeMissions: vi.fn(async ({ plans }) => {
        order.push("MISSIONS");
        expect(plans).toHaveLength(1);
        expect(plans[0]).toMatchObject({ execution: "ADMITTED", referenceDate: "2026-09-01" });
        expect(plans[0].mission?.referenceDate).toBe("2026-09-01T00:00:00.000Z");
        return [{ missionId: plans[0].mission!.missionId, missionFingerprint: plans[0].missionFingerprint, questionSemanticKey: plans[0].questionSemanticKey, outcome: "CREATED" as const, lifecycleStatus: "CURRENT" as const, operationalStatus: "PENDING" as const }];
      }),
      persistReport: vi.fn(async (report) => { order.push("REPORT"); return { outcome: "CREATED" as const, reportId: report.reportId }; }),
      scheduleMission: vi.fn(async () => { order.push("SCHEDULE"); return { outcome: "ADMITTED" as const, requirementCode: null, jobId: "research-job" }; }),
    });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(order).toEqual(["CURRENT", "MISSIONS", "REPORT", "SCHEDULE"]);
    expect(deps.persistMission).not.toHaveBeenCalled();
    expect(result).toMatchObject({ metadata: { missionCount: 1, researchJobCount: 1 } });
  });

  it("keeps an uncertain structured question blocked without epoch fallback or scheduling", async () => {
    const uncertain = {
      ...lotto3Knowledge,
      researchQuestions: [{
        ...lotto3Knowledge.researchQuestions[0],
        referenceDate: null,
        referenceDateBasis: { type: "UNKNOWN" as const, itemLocalId: null, rationale: "Data non determinabile" },
      }],
    };
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({ ...document, documentoId: "document-1", documentFileVersionId: "file-version-1" })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge: uncertain })),
      persistKnowledge: vi.fn(async () => currentReconciliation(uncertain)),
      reconcileKnowledgeMissions: vi.fn(async ({ plans }) => {
        expect(plans[0]).toMatchObject({ execution: "BLOCKED_FOR_REVIEW", mission: null });
        return [];
      }),
    });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(deps.persistMission).not.toHaveBeenCalled();
    expect(deps.scheduleMission).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(deps.persistReport).mock.calls[0][0])).not.toContain("1970-01-01");
    expect(result).toMatchObject({ metadata: { missionCount: 0, researchJobCount: 0 } });
  });

  it("links and idempotently reschedules a reused structured mission that is still pending", async () => {
    const reconciliation = currentReconciliation(lotto3Knowledge);
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({ ...document, documentoId: "document-1", documentFileVersionId: "file-version-1" })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge: lotto3Knowledge })),
      persistKnowledge: vi.fn(async () => reconciliation),
      reconcileKnowledgeMissions: vi.fn(async ({ plans }) => [{
        missionId: plans[0].mission!.missionId,
        missionFingerprint: plans[0].missionFingerprint,
        questionSemanticKey: plans[0].questionSemanticKey,
        outcome: "REUSED" as const,
        lifecycleStatus: "CURRENT" as const,
        operationalStatus: "PENDING" as const,
      }]),
    });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(vi.mocked(deps.persistReport).mock.calls[0][0].missions).toHaveLength(1);
    expect(deps.scheduleMission).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ metadata: { missionCount: 1, researchJobCount: 1 } });
  });

  it("links a reused completed structured mission without scheduling it again", async () => {
    const reconciliation = currentReconciliation(lotto3Knowledge);
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({ ...document, documentoId: "document-1", documentFileVersionId: "file-version-1" })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge: lotto3Knowledge })),
      persistKnowledge: vi.fn(async () => reconciliation),
      reconcileKnowledgeMissions: vi.fn(async ({ plans }) => [{
        missionId: plans[0].mission!.missionId,
        missionFingerprint: plans[0].missionFingerprint,
        questionSemanticKey: plans[0].questionSemanticKey,
        outcome: "REUSED" as const,
        lifecycleStatus: "CURRENT" as const,
        operationalStatus: "COMPLETED" as const,
      }]),
    });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(vi.mocked(deps.persistReport).mock.calls[0][0].missions).toHaveLength(1);
    expect(deps.scheduleMission).not.toHaveBeenCalled();
    expect(result).toMatchObject({ metadata: { missionCount: 1, researchJobCount: 0 } });
  });

  it("schedules five of seven structured questions in wave one and the two admitted by wave two", async () => {
    const sevenQuestions = {
      ...lotto3Knowledge,
      researchQuestions: Array.from({ length: 7 }, (_, index) => ({
        ...lotto3Knowledge.researchQuestions[0],
        localId: `question-${index + 1}`,
        canonicalQuestion: `Quale disciplina si applica alla scadenza? ${index + 1}`,
      })),
    };
    const reconciliation = currentReconciliation(sevenQuestions);
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({ ...document, documentoId: "document-1", documentFileVersionId: "file-version-1" })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge: sevenQuestions })),
      persistKnowledge: vi.fn(async () => reconciliation),
      reconcileKnowledgeMissions: vi.fn(async ({ plans }) => plans.map((plan: KnowledgeResearchMissionPlan) => ({
        missionId: plan.mission!.missionId,
        missionFingerprint: plan.missionFingerprint,
        questionSemanticKey: plan.questionSemanticKey,
        outcome: "CREATED" as const,
        lifecycleStatus: "CURRENT" as const,
        operationalStatus: plan.execution === "DEFERRED_BY_POLICY" ? "DEFERRED" as const : "PENDING" as const,
      }))),
    });
    const firstWave = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(deps.scheduleMission).toHaveBeenCalledTimes(5);
    expect(vi.mocked(deps.persistReport).mock.calls[0][0].missions).toHaveLength(7);
    expect(firstWave).toMatchObject({ metadata: { missionCount: 7, researchJobCount: 5 } });

    const deferred = vi.mocked(deps.persistReport).mock.calls[0][0].missions.slice(5);
    const schedule = vi.fn(async () => ({ outcome: "ADMITTED" as const, requirementCode: null, jobId: "wave-2-job" }));
    const secondWave = await executeDeferredKnowledgeResearchWave({
      tenantId: "tenant-1", procedimentoId: "procedimento-1", actorId: "user-1", correlationId: "wave-2",
    }, { admit: vi.fn(async () => deferred.map((mission) => ({ mission }))), schedule });
    expect(secondWave).toHaveLength(2);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it("does not create or enqueue structured missions for rejected issues or questions", async () => {
    for (const rejectedKind of ["LEGAL_ISSUE", "RESEARCH_QUESTION"] as const) {
      const current = currentReconciliation(lotto3Knowledge);
      const reconciliation: KnowledgeReconciliationResult = {
        ...current,
        revision: {
          ...current.revision,
          items: current.revision.items.map((item) => (
            item.kind === rejectedKind ? { ...item, status: "REJECTED" as const } : item
          )),
        },
      };
      const deps = dependencies({
        loadAuthority: vi.fn(async () => ({
          ...authority,
          documents: authority.documents.map((document) => ({ ...document, documentoId: "document-1", documentFileVersionId: "file-version-1" })),
        })),
        analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge: lotto3Knowledge })),
        persistKnowledge: vi.fn(async () => reconciliation),
        reconcileKnowledgeMissions: vi.fn(async ({ plans }) => {
          expect(plans[0].mission).toBeNull();
          return [];
        }),
      });
      const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
      expect(deps.persistMission).not.toHaveBeenCalled();
      expect(deps.scheduleMission).not.toHaveBeenCalled();
      expect(result).toMatchObject({ metadata: { missionCount: 0, researchJobCount: 0 } });
    }
  });

  it("does not create a legacy mission with an epoch date when no documented reference date exists", async () => {
    const deps = dependencies({ analyze: vi.fn(async () => ({ ...analysis, timeline: [] })) });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(deps.persistMission).not.toHaveBeenCalled();
    expect(deps.scheduleMission).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(deps.persistReport).mock.calls[0][0])).not.toContain("1970-01-01");
    expect(result).toMatchObject({ metadata: { missionCount: 0, researchJobCount: 0 } });
  });

  it("keeps legacy provider output backward compatible without invoking structured persistence", async () => {
    const persistKnowledge = vi.fn();
    const deps = dependencies({ persistKnowledge });
    await expect(createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context()))
      .resolves.toMatchObject({ metadata: { missionCount: 1 } });
    expect(persistKnowledge).not.toHaveBeenCalled();
  });

  it("fails closed before report and mission writes when structured provenance or persistence is invalid", async () => {
    const missingProvenance = dependencies({
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge })),
      persistKnowledge: vi.fn(),
    });
    await expect(createFascicoloAutomaticAnalysisHandler(missingProvenance).execute(reference, context()))
      .rejects.toMatchObject({ code: "DOCUMENT_GROUNDING_INVALID", retryable: false });
    expect(missingProvenance.persistReport).not.toHaveBeenCalled();
    expect(missingProvenance.persistMission).not.toHaveBeenCalled();

    const failedPersistence = dependencies({
      loadAuthority: vi.fn(async () => ({
        ...authority,
        documents: authority.documents.map((document) => ({
          ...document,
          documentoId: "document-1",
          documentFileVersionId: "file-version-1",
        })),
      })),
      analyze: vi.fn(async () => ({ ...analysis, structuredKnowledge })),
      persistKnowledge: vi.fn(async () => { throw new Error("reconciliation failed"); }),
    });
    await expect(createFascicoloAutomaticAnalysisHandler(failedPersistence).execute(reference, context()))
      .rejects.toMatchObject({ code: "STRUCTURED_KNOWLEDGE_PERSISTENCE_FAILED", retryable: false });
    expect(failedPersistence.persistReport).not.toHaveBeenCalled();
    expect(failedPersistence.persistMission).not.toHaveBeenCalled();
  });

  it("reuses the same report and mission identities when execution is repeated", async () => {
    const deps = dependencies();
    const handler = createFascicoloAutomaticAnalysisHandler(deps);
    const first = await handler.execute(reference, context()) as { referenceId: string };
    const second = await handler.execute(reference, context()) as { referenceId: string };
    expect(second.referenceId).toBe(first.referenceId);
    await expect(vi.mocked(deps.persistReport).mock.results[1].value).resolves.toMatchObject({ outcome: "REUSED" });
    const firstMission = vi.mocked(deps.persistMission).mock.calls[0][0].mission;
    const secondMission = vi.mocked(deps.persistMission).mock.calls[1][0].mission;
    expect(secondMission.missionId).toBe(firstMission.missionId);
  });

  it("reuses a persistent report after restart without repeating AI or mission writes", async () => {
    const deps = dependencies({
      findExistingReport: vi.fn(async () => ({
        reportId: "fascicolo-report:persisted",
        documentVersionId: "attempt-1",
        corpusFingerprint: "c".repeat(64),
        missionCount: 1,
        supersededCount: 0,
      })),
    });
    const result = await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(result).toMatchObject({
      referenceId: "fascicolo-report:persisted",
      metadata: { persistenceCode: "REUSED", missionCount: 1 },
    });
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(deps.persistMission).not.toHaveBeenCalled();
    expect(deps.persistReport).not.toHaveBeenCalled();
  });

  it("marks reports from earlier document versions as superseded", async () => {
    const deps = dependencies({ listPriorReportIds: vi.fn(async () => ["fascicolo-report:older"]) });
    await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    expect(deps.persistReport).toHaveBeenCalledWith(expect.objectContaining({
      documentVersionId: "attempt-1",
      supersedesReportIds: ["fascicolo-report:older"],
    }));
  });

  it("fails closed on tenant or version authority mismatch", async () => {
    const deps = dependencies({ loadAuthority: vi.fn(async () => null) });
    await expect(createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context()))
      .rejects.toEqual(new AsyncJobExecutionError("AUTHORIZATION", "FASCICOLO_ANALYSIS_AUTHORITY_MISMATCH", false));
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("reports an unreadable document without claiming analysis success", async () => {
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({ ...authority, documents: [{ ...authority.documents[0], pages: [] }] })),
    });
    await expect(createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context()))
      .rejects.toEqual(new AsyncJobExecutionError("DOCUMENT", "DOCUMENT_UNREADABLE", false));
    expect(deps.persistReport).not.toHaveBeenCalled();
  });

  it("preserves an unavailable-provider failure without a report or mission", async () => {
    const deps = dependencies({
      analyze: vi.fn(async () => { throw new AsyncJobExecutionError("PROVIDER", "AI_PROVIDER_UNAVAILABLE", true); }),
    });
    await expect(createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context()))
      .rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", retryable: true });
    expect(deps.persistReport).not.toHaveBeenCalled();
    expect(deps.persistMission).not.toHaveBeenCalled();
  });

  it("rejects uncertain or ungrounded output instead of reporting false success", async () => {
    const deps = dependencies({
      analyze: vi.fn(async () => ({
        ...analysis,
        summary: { ...analysis.summary, basisRefs: ["DOCUMENT_2.PAGE_99"] },
      })),
    });
    await expect(createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context()))
      .rejects.toMatchObject({ code: "DOCUMENT_GROUNDING_INVALID", retryable: false });
    expect(deps.persistReport).not.toHaveBeenCalled();
  });

  it("continues through pre-claim, lease, budget, submit, and completion with a mocked research provider", async () => {
    const deps = dependencies({
      analyze: vi.fn(async () => ({ ...analysis, investigativeQuestions: [] })),
    });
    await createFascicoloAutomaticAnalysisHandler(deps).execute(reference, context());
    const mission = vi.mocked(deps.persistMission).mock.calls[0][0].mission;
    let submittedBundle: ResearchEvidenceBundle | null = null;
    const client = {
      readMission: vi.fn(async () => ({
        mission,
        operational: {
          status: "PENDING" as const,
          stateVersion: 0,
          claimExpiresAt: null,
          activeExecutionId: null,
          completedAt: null,
          deferredAt: null,
        },
        fascicoloContext: {},
      })),
      claimMission: vi.fn(async () => ({
        outcome: "CLAIMED" as const,
        missionId: mission.missionId,
        fascicoloScopeId: "procedimento-1",
        executionId: "execution-synthetic",
        leaseExpiresAt: "2026-12-31T12:15:00.000Z",
        claimToken: "c".repeat(64),
      })),
      submitEvidenceBundle: vi.fn(async ({ bundle }: { bundle: ResearchEvidenceBundle }) => {
        submittedBundle = bundle;
        return {
          outcome: "CREATED" as const,
          bundleId: "bundle-synthetic",
          missionId: mission.missionId,
          fascicoloScopeId: "procedimento-1",
          executionId: bundle.executionId,
          completionState: bundle.completionState,
        };
      }),
      completeMission: vi.fn(async () => ({
        outcome: "COMPLETED" as const,
        missionId: mission.missionId,
        fascicoloScopeId: "procedimento-1",
        status: "COMPLETED" as const,
        stateVersion: 3,
      })),
      deferMission: vi.fn(),
    } as unknown as TrustedResearchHttpClient;
    const adapter: ResearchProviderAdapter = {
      provider: "MOONLIT",
      capability: "SEMANTIC_DISCOVERY",
      toolName: "synthetic_semantic_search",
      role: "BROAD_DISCOVERY",
      operationType: "SEMANTIC_SEARCH",
      prepare: (current: ResearchMission) => ({
        name: "synthetic_semantic_search",
        arguments: { query: current.researchQuestion },
      }),
      callTool: vi.fn(async () => ({ resultId: "synthetic-result-1" })),
      normalize: (_response, current) => ({
        resultCount: 1,
        resultIdentifiersUsed: ["synthetic-result-1"],
        authorityCandidates: [createAuthorityCandidate({
          kind: "AUTHORITY_CANDIDATE",
          executionRecordId: current.executionRecordId,
          toolId: "synthetic_semantic_search",
          providerId: "MOONLIT",
          courtOrBody: "Consiglio di Stato",
          documentType: "SENTENZA",
          number: "101",
          year: 2026,
          documentDate: "2026-06-10T00:00:00.000Z",
          title: "Decisione sintetica per collaudo offline",
          sourceUrl: "https://official.example.test/decision-101",
          providerDocumentId: "synthetic-result-1",
          supportDirection: "UNKNOWN",
          sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
          retrievalMethod: "SEMANTIC_SEARCH",
          fullTextAvailable: false,
          verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
        })],
        evidenceGaps: [],
        incomplete: false,
      }),
    };
    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [adapter],
      now: () => new Date("2026-12-31T12:00:00.000Z"),
      executionId: () => "execution-synthetic",
    }).execute(mission.missionId);

    expect(result.status).toBe("COMPLETED");
    expect(client.readMission).toHaveBeenCalledBefore(vi.mocked(client.claimMission));
    expect(client.claimMission).toHaveBeenCalledWith(expect.objectContaining({ leaseDurationMs: 900_000 }));
    expect(adapter.callTool).toHaveBeenCalledOnce();
    expect(client.submitEvidenceBundle).toHaveBeenCalledOnce();
    expect(client.completeMission).toHaveBeenCalledOnce();
    expect(submittedBundle).toMatchObject({
      completionState: "COMPLETE",
      researchToolExecutions: [expect.objectContaining({ callsConsumed: 1 })],
      authorityCandidates: [expect.objectContaining({
        documentDate: "2026-06-10T00:00:00.000Z",
        verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
        supportDirection: "UNKNOWN",
      })],
    });
    expect(JSON.stringify(mission)).not.toContain(authority.documents[0].pages[0].normalizedText);
    expect(JSON.stringify(submittedBundle)).not.toContain(authority.documents[0].pages[0].normalizedText);
  });
});