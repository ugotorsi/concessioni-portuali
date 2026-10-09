import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: vi.fn(async () => ({ tenantId: "synthetic" })),
  requireTenantAccess: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { FascicoloAutomaticWorkflowPanel } from "@/components/procedimenti/FascicoloAutomaticWorkflowPanel";
import {
  createDefaultFascicoloAutomaticAnalysisDependencies,
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import {
  AutomaticFascicoloReportRepositoryError,
  persistAutomaticFascicoloReport,
  type AutomaticFascicoloReportPersistenceInput,
} from "@/server/ai/fascicoloAutomaticReportRepository";
import type { ProviderAnalysisPayloadV1 } from "@/server/ai/fascicoloAnalysis";
import type { ResearchMission } from "@/server/legal-research/bridge";
import { createAuthorityCandidate } from "@/server/legal-research/bridge";
import type { ResearchProviderAdapter } from "@/server/legal-research/provider-research-adapters";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";
import { createApplicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { AsyncJobExecutionError, drainOneAsyncJob } from "@/server/async-jobs/worker";
import { createNeutralIntake } from "@/server/intake/createNeutralIntake";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";
import { createPdf } from "./helpers/extraction-fixtures";

const databaseUrl = process.env.AUTOMATIC_FASCICOLO_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

const validAnalysis = {
  summary: { text: "Il provvedimento indica una scadenza.", basisRefs: ["DOCUMENT_1.PAGE_1"] },
  timeline: [{ recordedAt: "2026-12-31T00:00:00.000Z", text: "Scadenza documentata.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  recordedState: [{ text: "È richiamato l'articolo 18.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  signals: [{ type: "VERIFY", text: "Verificare vigenza e applicabilità.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  investigativeQuestions: [{ text: "Manca la prova della notifica.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  suggestedActivities: [{ text: "Acquisire la ricevuta di notifica.", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
  legalResearchQuestions: [{ text: "Quale disciplina si applica alla scadenza ai sensi dell'articolo 18?", basisRefs: ["DOCUMENT_1.PAGE_1"] }],
} as const;

run("automatic fascicolo persistence on temporary PostgreSQL", () => {
  const suffix = randomUUID();
  const tenantId = `tenant-${suffix}`;
  const procedimentoId = `procedure-${suffix}`;
  const actorId = `system-${suffix}`;
  let analysisCalls = 0;
  let transientAnalysisCalls = 0;
  const analysisInputs: { excerpts: readonly { reference?: string; text: string }[]; documents?: readonly unknown[] }[] = [];
  const providerCall = vi.fn(async () => ({ resultId: "synthetic-authority-1" }));
  const pdfByText = new Map<string, Buffer>();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    process.env.DOCUMENT_STORAGE_ROOT = `.tmp/automatic-fascicolo-storage-${suffix}`;
    process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED = "true";
    process.env.AUTOMATIC_RESEARCH_TENANT_ALLOWLIST = tenantId;
    process.env.AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST = procedimentoId;
    process.env.AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES = "SEMANTIC_DISCOVERY";
    process.env.AUTOMATIC_RESEARCH_MAX_CALLS = "6";
    process.env.AUTOMATIC_RESEARCH_WORKER_ACTOR_ID = `research-worker-${suffix}`;
    process.env.AUTOMATIC_RESEARCH_LEASE_MS = "60000";
    process.env.AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS = "5000";
    const concessionario = await prisma.concessionario.create({
      data: { id: `operator-${suffix}`, denominazione: "Operatore sintetico" },
    });
    await prisma.ente.create({
      data: { id: tenantId, nome: "Ente sintetico", codice: `SYN-${suffix}` },
    });
    await prisma.concessione.create({
      data: {
        id: `concession-${suffix}`,
        numeroAtto: `SYN-${suffix}`,
        dataRilascio: new Date("2025-01-01T00:00:00.000Z"),
        dataScadenza: new Date("2027-12-31T00:00:00.000Z"),
        normaRiferimento: "ART_18_L_84_1994",
        tipologiaBene: "AREA_SCOPERTA",
        attivita: "SERVIZI_PORTUALI",
        stato: "ATTIVA",
        concessionarioId: concessionario.id,
        enteId: tenantId,
      },
    });
    await prisma.procedimento.create({
      data: {
        id: procedimentoId,
        enteId: tenantId,
        concessioneId: `concession-${suffix}`,
        tipologia: "CHIARIMENTI",
        stato: "IN_CORSO",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function upload(text: string, operationId: string, targetProcedimentoId = procedimentoId) {
    let pdf = pdfByText.get(text);
    if (!pdf) {
      pdf = await createPdf([{ type: "text", text }]);
      pdfByText.set(text, pdf);
    }
    return createNeutralIntake({
      body: pdf,
      mimeType: "application/pdf",
      originalName: `${operationId}.pdf`,
      ingressChannel: "SYNTHETIC_INTEGRATION_TEST",
      originReference: null,
      enteId: tenantId,
      receivedByUserId: null,
      receivedByActorId: actorId,
      receivedByRole: "AUTHORIZED_TEST_WORKER",
      destination: {
        procedimentoId: targetProcedimentoId,
        authoritySource: "SYNTHETIC_TEST",
      },
      idempotencyAnchor: { type: "OPERATION_ID", value: operationId },
    });
  }

  const analyzer = vi.fn(async (input: {
    excerpts: readonly { reference: string; text: string }[];
    documents: readonly unknown[];
  }) => {
    analysisCalls += 1;
    analysisInputs.push(input);
    const text = input.excerpts.map((excerpt) => excerpt.text).join("\n");
    if (text.includes("ERRORE TRANSITORIO")) {
      transientAnalysisCalls += 1;
      if (transientAnalysisCalls === 1) {
        throw new AsyncJobExecutionError("PROVIDER", "AI_PROVIDER_UNAVAILABLE", true);
      }
      return validAnalysis;
    }
    return text.includes("RISPOSTA INCERTA")
      ? { summary: "not-structured" }
      : validAnalysis;
  });

  const providerAdapter: ResearchProviderAdapter = {
    provider: "MOONLIT",
    capability: "SEMANTIC_DISCOVERY",
    toolName: "synthetic_semantic_search",
    role: "BROAD_DISCOVERY",
    operationType: "SEMANTIC_SEARCH",
    prepare: (mission) => ({ name: "synthetic_semantic_search", arguments: { query: mission.researchQuestion } }),
    callTool: providerCall,
    normalize: (_response, context) => ({
      resultCount: 1,
      resultIdentifiersUsed: ["synthetic-authority-1"],
      authorityCandidates: [createAuthorityCandidate({
        kind: "AUTHORITY_CANDIDATE",
        executionRecordId: context.executionRecordId,
        toolId: "MOONLIT",
        providerId: "MOONLIT",
        courtOrBody: "Consiglio di Stato",
        documentType: "SENTENZA",
        number: "101",
        year: 2026,
        documentDate: "2026-06-10T00:00:00.000Z",
        title: "Decisione sintetica offline",
        sourceUrl: "https://official.example.test/decision-101",
        providerDocumentId: "synthetic-authority-1",
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

  const registry = createApplicationAsyncJobRegistry({
    automaticAnalysisDependencies: {
      ...createDefaultFascicoloAutomaticAnalysisDependencies(),
      analyze: analyzer,
    },
    automaticResearchDependencies: {
      createProviderAdapters: vi.fn(async () => [providerAdapter]),
    },
  });

  async function drainUntilAutomaticTerminal(intakeId: string) {
    for (let index = 0; index < 20; index += 1) {
      const jobs = await prisma.asyncJob.findMany({
        where: { operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION },
        orderBy: { createdAt: "desc" },
      });
      const target = jobs.find((job) => {
        const input = job.inputReference as { metadata?: { neutralIntakeId?: string } };
        return input.metadata?.neutralIntakeId === intakeId;
      });
      if (target && ["SUCCEEDED", "TERMINAL_FAILED", "CANCELLED"].includes(target.status)) return target;
      await drainOneAsyncJob({
        workerId: `worker-${suffix}`,
        leaseDurationMs: 60_000,
        retryDelayMs: 0,
        operationAllowlist: [
          "NEUTRAL_INTAKE_EXTRACTION_V1",
          FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
          RESEARCH_MISSION_EXECUTION_OPERATION,
        ],
        procedimentoAllowlist: [procedimentoId],
        registry,
      });
    }
    throw new Error("AUTOMATIC_JOB_DID_NOT_REACH_TERMINAL_STATE");
  }

  async function drainUntilResearchTerminal(missionId: string) {
    for (let index = 0; index < 20; index += 1) {
      const target = await prisma.asyncJob.findFirst({
        where: {
          operation: RESEARCH_MISSION_EXECUTION_OPERATION,
          inputReference: { path: ["referenceId"], equals: missionId },
        },
      });
      if (target && ["SUCCEEDED", "TERMINAL_FAILED", "CANCELLED"].includes(target.status)) return target;
      await drainOneAsyncJob({
        workerId: `worker-${suffix}`,
        leaseDurationMs: 60_000,
        retryDelayMs: 0,
        operationAllowlist: [
          "NEUTRAL_INTAKE_EXTRACTION_V1",
          FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
          RESEARCH_MISSION_EXECUTION_OPERATION,
        ],
        procedimentoAllowlist: [procedimentoId],
        registry,
      });
    }
    throw new Error("RESEARCH_JOB_DID_NOT_REACH_TERMINAL_STATE");
  }

  it("runs upload, extraction, worker analysis, repository, mission generation, restart read, and dossier view", async () => {
    const first = await upload(
      "Il provvedimento richiama l'articolo 18 e indica scadenza 31 dicembre 2026.",
      `upload-a-${suffix}`,
    );
    expect(first.outcome).toBe("CREATED");
    const firstIntakeId = first.intake?.id;
    if (!firstIntakeId) throw new Error("INTAKE_REQUIRED");
    const terminal = await drainUntilAutomaticTerminal(firstIntakeId);
    expect(terminal.status).toBe("SUCCEEDED");

    const report = await prisma.automaticFascicoloReport.findFirstOrThrow({
      where: { tenantId, procedimentoId, neutralIntakeId: firstIntakeId },
      include: { missionLinks: true, corpusDocuments: { orderBy: { ordinal: "asc" } } },
    });
    expect(report).toMatchObject({
      status: "ANALYSIS_COMPLETE",
      verificationStatus: "DISCOVERY_PENDING",
      documentVersionId: expect.any(String),
    });
    expect(report.missionLinks).toHaveLength(1);
    expect(JSON.stringify(report.provenancePayload)).not.toContain("Il provvedimento");
    expect(JSON.stringify(report.analysisPayload)).toContain("DOCUMENT_1.PAGE_1");

    const linkedMission = await prisma.researchMissionRecord.findUniqueOrThrow({
      where: { id: report.missionLinks[0].missionId },
    });
    await Promise.all([
      drainOneAsyncJob({
        workerId: `research-worker-a-${suffix}`,
        leaseDurationMs: 60_000,
        retryDelayMs: 0,
        operationAllowlist: [RESEARCH_MISSION_EXECUTION_OPERATION],
        procedimentoAllowlist: [procedimentoId],
        registry,
      }),
      drainOneAsyncJob({
        workerId: `research-worker-b-${suffix}`,
        leaseDurationMs: 60_000,
        retryDelayMs: 0,
        operationAllowlist: [RESEARCH_MISSION_EXECUTION_OPERATION],
        procedimentoAllowlist: [procedimentoId],
        registry,
      }),
    ]);
    const researchTerminal = await drainUntilResearchTerminal(linkedMission.id);
    expect(researchTerminal).toMatchObject({ status: "SUCCEEDED", attemptCount: 1 });
    expect(providerCall).toHaveBeenCalledOnce();
    expect(await prisma.asyncJob.count({
      where: { operation: RESEARCH_MISSION_EXECUTION_OPERATION, tenantId },
    })).toBe(1);
    expect(await prisma.researchEvidenceBundleRecord.count({
      where: { missionId: linkedMission.id },
    })).toBe(1);
    const repeatedInput: AutomaticFascicoloReportPersistenceInput = {
      reportId: report.id,
      tenantId,
      procedimentoId,
      neutralIntakeId: firstIntakeId,
      documentVersionId: report.documentVersionId,
      artifactSha256: report.artifactSha256,
      corpusFingerprint: report.corpusFingerprint,
      documents: report.corpusDocuments.map((document) => ({
        documentVersionId: document.documentVersionId,
        artifactSha256: document.artifactSha256,
      })),
      actorId: report.createdByActorId,
      analysis: report.analysisPayload as unknown as ProviderAnalysisPayloadV1,
      provenance: report.provenancePayload as unknown as AutomaticFascicoloReportPersistenceInput["provenance"],
      missions: [{
        ...(linkedMission.payload as unknown as ResearchMission),
        missionId: linkedMission.id,
      }],
    };
    const repeated = await Promise.all([
      persistAutomaticFascicoloReport(repeatedInput),
      persistAutomaticFascicoloReport(repeatedInput),
    ]);
    expect(repeated.map((item) => item.outcome)).toEqual(["REUSED", "REUSED"]);

    const duplicateOperation = await upload(
      "Il provvedimento richiama l'articolo 18 e indica scadenza 31 dicembre 2026.",
      `upload-a-${suffix}`,
    );
    expect(duplicateOperation.outcome).toBe("REUSED");
    const duplicateDocument = await upload(
      "Il provvedimento richiama l'articolo 18 e indica scadenza 31 dicembre 2026.",
      `upload-duplicate-${suffix}`,
    );
    expect(duplicateDocument.outcome).toBe("DUPLICATE_DOCUMENT_IN_FASCICOLO");

    const model = await getFascicoloAutomaticWorkflowReadModel(procedimentoId);
    const html = renderToStaticMarkup(React.createElement(FascicoloAutomaticWorkflowPanel, { model }));
    expect(html).toContain("Questioni e quesiti formulati");
    expect(html).toContain("Quale disciplina si applica");
    expect(html).toContain("Fatti e date documentati");
    expect(html).toContain("Provenienza: DOCUMENT_1.PAGE_1");
    expect(html).toContain("Conclusioni professionali: non formulate");
    expect(html).toContain("Ricerca di decisioni e orientamenti contrari");
    expect(html).toContain("verifica professionale");
    expect(html).toContain("Decisione sintetica offline");
    expect(html).toContain("2026-06-10T00:00:00.000Z");
    expect(html).toContain("Executor: SUCCEEDED");
    expect(html).toContain("La discovery preliminare non completa la verifica del fascicolo");

    const callsBeforeRestartRead = analysisCalls;
    const persistedAgain = await prisma.automaticFascicoloReport.findUniqueOrThrow({
      where: { id: report.id },
      include: { missionLinks: true },
    });
    expect(persistedAgain.missionLinks).toHaveLength(1);
    expect(analysisCalls).toBe(callsBeforeRestartRead);
  });

  it("leaves jobs for a procedimento outside the worker canary scope untouched", async () => {
    const outsideProcedimentoId = `procedure-outside-${suffix}`;
    await prisma.procedimento.create({
      data: {
        id: outsideProcedimentoId,
        enteId: tenantId,
        concessioneId: `concession-${suffix}`,
        tipologia: "CHIARIMENTI",
        stato: "IN_CORSO",
      },
    });
    const outside = await upload(
      "Documento sintetico fuori dal perimetro canary.",
      `upload-outside-${suffix}`,
      outsideProcedimentoId,
    );
    if (!outside.intake?.id || !outside.extractionJob?.id) throw new Error("OUTSIDE_JOB_REQUIRED");

    await expect(drainOneAsyncJob({
      workerId: `canary-worker-${suffix}`,
      leaseDurationMs: 60_000,
      retryDelayMs: 0,
      operationAllowlist: [
        "NEUTRAL_INTAKE_EXTRACTION_V1",
        FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
        RESEARCH_MISSION_EXECUTION_OPERATION,
      ],
      procedimentoAllowlist: [procedimentoId],
      registry,
    })).resolves.toEqual({ outcome: "IDLE" });

    await expect(prisma.asyncJob.findUniqueOrThrow({ where: { id: outside.extractionJob.id } }))
      .resolves.toMatchObject({ status: "QUEUED", attemptCount: 0 });
    await expect(prisma.neutralIntakeExtractionAttempt.count({
      where: { neutralIntakeId: outside.intake.id },
    })).resolves.toBe(0);
  });

  it("supersedes an earlier document version and rejects a wrong tenant", async () => {
    const second = await upload(
      "Versione aggiornata: articolo 18, scadenza 31 dicembre 2027 e nuova comunicazione.",
      `upload-b-${suffix}`,
    );
    const secondIntakeId = second.intake?.id;
    if (!secondIntakeId) throw new Error("UPDATED_INTAKE_REQUIRED");
    expect((await drainUntilAutomaticTerminal(secondIntakeId)).status).toBe("SUCCEEDED");
    const reports = await prisma.automaticFascicoloReport.findMany({
      where: { tenantId, procedimentoId },
      orderBy: { createdAt: "asc" },
    });
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ status: "SUPERSEDED", supersededByReportId: reports[1].id });
    expect(reports[1]).toMatchObject({ status: "ANALYSIS_COMPLETE", supersededByReportId: null });
    const latestCorpusDocuments = await prisma.automaticFascicoloReportDocument.findMany({
      where: { reportId: reports[1].id },
      orderBy: { ordinal: "asc" },
    });
    expect(latestCorpusDocuments).toHaveLength(2);
    expect(analysisInputs.at(-1)?.documents).toHaveLength(2);
    expect(analysisInputs.at(-1)?.excerpts.map((excerpt) => excerpt.reference))
      .toEqual(expect.arrayContaining(["DOCUMENT_1.PAGE_1", "DOCUMENT_2.PAGE_1"]));

    const mission = await prisma.researchMissionRecord.findFirstOrThrow({
      where: { tenantId, caseId: procedimentoId },
    });
    await expect(persistAutomaticFascicoloReport({
      reportId: `fascicolo-report:${"f".repeat(64)}`,
      tenantId: `wrong-${tenantId}`,
      procedimentoId,
      neutralIntakeId: secondIntakeId,
      documentVersionId: reports[1].documentVersionId,
      artifactSha256: reports[1].artifactSha256,
      corpusFingerprint: reports[1].corpusFingerprint,
      documents: [{
        documentVersionId: reports[1].documentVersionId,
        artifactSha256: reports[1].artifactSha256,
      }],
      actorId,
      analysis: validAnalysis as unknown as ProviderAnalysisPayloadV1,
      provenance: [{
        reference: "DOCUMENT_1.PAGE_1",
        documentVersionId: reports[1].documentVersionId,
        artifactSha256: reports[1].artifactSha256,
        pageNumber: 1,
        textSha256: "a".repeat(64),
        extractionMethod: "DIRECT_TEXT",
        ocrConfidence: null,
      }],
      missions: [mission.payload as never],
    })).rejects.toBeInstanceOf(AutomaticFascicoloReportRepositoryError);
  });

  it("stores an uncertain AI response as terminal failure without report or mission", async () => {
    const uncertain = await upload(
      "RISPOSTA INCERTA: documento sintetico che non deve produrre un falso rapporto.",
      `upload-uncertain-${suffix}`,
    );
    const uncertainIntakeId = uncertain.intake?.id;
    if (!uncertainIntakeId) throw new Error("UNCERTAIN_INTAKE_REQUIRED");
    const terminal = await drainUntilAutomaticTerminal(uncertainIntakeId);
    expect(terminal).toMatchObject({
      status: "TERMINAL_FAILED",
      failureCode: "INVALID_PROVIDER_OUTPUT",
      attemptCount: 1,
    });
    expect(await prisma.automaticFascicoloReport.count({
      where: { neutralIntakeId: uncertainIntakeId },
    })).toBe(0);
  });

  it("retries a transient AI failure through the real queue before persisting", async () => {
    const transient = await upload(
      "ERRORE TRANSITORIO: articolo 18 e scadenza documentata al 31 dicembre 2028.",
      `upload-transient-${suffix}`,
    );
    const transientIntakeId = transient.intake?.id;
    if (!transientIntakeId) throw new Error("TRANSIENT_INTAKE_REQUIRED");
    const terminal = await drainUntilAutomaticTerminal(transientIntakeId);
    expect(terminal).toMatchObject({ status: "SUCCEEDED", attemptCount: 2 });
    expect(transientAnalysisCalls).toBe(2);
    expect(await prisma.automaticFascicoloReport.count({
      where: { neutralIntakeId: transientIntakeId },
    })).toBe(1);
  });
});