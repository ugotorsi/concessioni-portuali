import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildSnapshot: vi.fn(),
  createPreparation: vi.fn(),
  buildEvidence: vi.fn(),
  buildTrustedReview: vi.fn(),
  persist: vi.fn(),
}));

vi.mock("@/server/ai/fascicoloLiveAnalysis", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloLiveAnalysis")>();
  mocks.createPreparation.mockImplementation(original.createFascicoloLiveAnalysisPreparationService);
  return {
    ...original,
    createFascicoloLiveAnalysisPreparationService: mocks.createPreparation,
  };
});

vi.mock("@/server/ai/fascicoloSnapshot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloSnapshot")>();
  return { ...original, buildAiFascicoloSnapshotV1: mocks.buildSnapshot };
});

vi.mock("@/server/ai/fascicoloAuthoritativeEvidence", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloAuthoritativeEvidence")>();
  return { ...original, buildAiFascicoloAuthoritativeEvidenceV1: mocks.buildEvidence };
});

vi.mock("@/server/ai/fascicoloTrustedReview", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloTrustedReview")>();
  return { ...original, buildAiFascicoloTrustedReviewV1: mocks.buildTrustedReview };
});

vi.mock("@/server/ai/fascicoloReviewPersistence", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloReviewPersistence")>();
  return { ...original, persistAiFascicoloTrustedReviewMaterial: mocks.persist };
});

import type {
  AiFascicoloOutboundAnalysisV1,
  AiOutboundAnalysisProvider,
  ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  type AiFascicoloLiveAnalysisPreparedContext,
  type FascicoloLiveAnalysisPreparationService,
} from "@/server/ai/fascicoloLiveAnalysis";
import {
  AiFascicoloTrustedReviewProductionError,
  createFascicoloTrustedReviewProductionService,
} from "@/server/ai/fascicoloTrustedReviewProduction";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";

const approvedActivation = createRealDataActivationPolicy({
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "B2C6-TEST",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
});

function providerPayload(): ProviderAnalysisPayloadV1 {
  return {
    summary: { text: "Sintesi locale", basisRefs: ["PROCEDIMENTO_A.dataAvvio"] },
    timeline: [],
    recordedState: [],
    signals: [],
    investigativeQuestions: [],
    suggestedActivities: [],
    legalResearchQuestions: [],
  };
}

function snapshotFixture() {
  return {
    metadata: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      generatedAt: "2026-09-01T10:00:00.000Z",
      generatedByActorId: "actor-1",
      generatedByRole: "ADMIN",
      contentHashAlgorithm: "sha256",
      contentHash: "a".repeat(64),
    },
    content: {
      identityContext: { procedimentoId: "proc-1", canonicalEnteId: "ente-1" },
      procedimento: {
        id: "proc-1",
        dataAvvio: "2026-01-01T00:00:00.000Z",
        dataScadenzaContraddittorio: null,
        dataProvvedimentoFinale: null,
        responsabileAssegnatoAt: null,
        comunicazioneAvvioInviata: true,
        dataComunicazioneAvvio: null,
        termineMemorieGiorni: 30,
        termineMemorieScadenza: null,
        memorieRicevute: false,
        dataRicezioneMemorie: null,
        audizioneRichiesta: false,
        audizioneSvolta: false,
        dataAudizione: null,
        sopralluogoIstruttorioSvolto: false,
        contestazioneFormaleInviata: false,
        dataContestazioneFormale: null,
        controdeduzioniValutate: false,
        preavvisoRigettoApplicabile: false,
        dataPreavvisoRigetto: null,
        termineOsservazioniPreavviso: null,
        osservazioniPreavvisoRicevute: false,
        dataOsservazioniPreavviso: null,
        responsibilityAssignments: [],
      },
      concessione: {
        id: "concessione-1",
        dataRilascio: "2020-01-01T00:00:00.000Z",
        dataScadenza: "2030-01-01T00:00:00.000Z",
      },
      concessionario: { id: "concessionario-1" },
      requirements: [],
      evidence: [],
      humanReviewReceipts: [],
      checklist: {
        checklistContraddittorioCompleta: false,
        checklistCompletedItems: 0,
        checklistTotalItems: 1,
        checklistPercentage: 0,
        evidence: [],
      },
      fascicoloObservations: [],
      documents: [],
      criticita: { coverage: "SELECTED", items: [] },
      pagamenti: { coverage: "SELECTED", items: [] },
      scadenze: { coverage: "SELECTED", items: [] },
      sopralluoghi: { coverage: "SELECTED", items: [] },
      finalActContext: null,
    },
  };
}

function analysisFixture(): AiFascicoloOutboundAnalysisV1 {
  return {
    analysisSchemaVersion: "ai-fascicolo-analysis/v1",
    snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
    outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    sourceSnapshotContentHash: "a".repeat(64),
    outboundProjectionHash: "b".repeat(64),
    outboundProjectionHashAlgorithm: "sha256",
    generatedAt: "2026-09-01T10:01:00.000Z",
    analysis: providerPayload(),
    resolvedBasisRefs: [],
    limitations: {
      generatedByAI: true,
      decisionAuthority: "NONE",
      administrativeEffect: "NONE",
      humanReviewRequired: true,
      legalResearchNotSubstituted: true,
      allowedSignalTypes: ["INFO", "VERIFY"],
      allowedSections: [
        "summary",
        "timeline",
        "recordedState",
        "signals",
        "investigativeQuestions",
        "suggestedActivities",
        "legalResearchQuestions",
      ],
      signalTypes: ["INFO", "VERIFY"],
      basisRefsMeaning: "TECHNICAL_SNAPSHOT_GROUNDING_ONLY",
    },
  };
}

function contextFixture(): AiFascicoloLiveAnalysisPreparedContext {
  return {
    snapshot: { context: "snapshot" } as unknown as AiFascicoloLiveAnalysisPreparedContext["snapshot"],
    projection: { context: "projection" } as unknown as AiFascicoloLiveAnalysisPreparedContext["projection"],
    analysis: analysisFixture(),
  };
}

function preparation(context = contextFixture()) {
  const prepare = vi.fn<FascicoloLiveAnalysisPreparationService["prepare"]>().mockResolvedValue(context);
  return { service: { prepare } satisfies FascicoloLiveAnalysisPreparationService, prepare, context };
}

function liveConfig() {
  return {
    provider: { analyze: vi.fn<AiOutboundAnalysisProvider["analyze"]>() },
    maxInputBytes: 100_000,
    realDataActivation: approvedActivation,
  };
}

function serviceWithPreparation(prepared = preparation()) {
  mocks.createPreparation.mockReturnValueOnce(prepared.service);
  const config = liveConfig();
  const service = createFascicoloTrustedReviewProductionService(config);
  return { service, prepared, config };
}

function expectInvalid(operation: Promise<unknown>): Promise<void> {
  return operation.catch((error) => {
    expect(error).toBeInstanceOf(AiFascicoloTrustedReviewProductionError);
    expect(error).toMatchObject({ code: "INVALID_INPUT", message: "INVALID_INPUT" });
  });
}

describe("B2C6 trusted review production service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildEvidence.mockReturnValue({ evidence: "authoritative" });
    mocks.buildTrustedReview.mockReturnValue({ review: "trusted" });
    mocks.persist.mockResolvedValue({
      materialId: "material-1",
      enteId: "ente-1",
      procedimentoId: "proc-1",
      fingerprint: "fingerprint-1",
      outcome: "CREATED",
    });
  });

  it.each([
    undefined,
    null,
    "proc-1",
    42,
    true,
    [],
    {},
    { unrelated: "proc-1" },
    { procedimentoId: "" },
    { procedimentoId: "   " },
    { procedimentoId: 42 },
    { procedimentoId: "proc-1", tenantId: "tenant-client" },
    { procedimentoId: "proc-1", snapshot: {} },
  ])("rejects invalid or authority-bearing input before every side effect", async (input) => {
    const { service, prepared } = serviceWithPreparation();

    await expectInvalid(service.execute(input));

    expect(prepared.prepare).not.toHaveBeenCalled();
    expect(mocks.buildEvidence).not.toHaveBeenCalled();
    expect(mocks.buildTrustedReview).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("constructs the authority-bearing preparation exactly once from the exact live config", async () => {
    const { service, prepared, config } = serviceWithPreparation();

    expect(mocks.createPreparation).toHaveBeenCalledOnce();
    expect(mocks.createPreparation).toHaveBeenCalledWith(config);

    await service.execute({ procedimentoId: "proc-1" });

    expect(prepared.prepare).toHaveBeenCalledOnce();
    expect(prepared.prepare).toHaveBeenCalledWith("proc-1");
  });

  it("does not expose a caller-supplied preparation dependency in the production factory", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/server/ai/fascicoloTrustedReviewProduction.ts"),
      "utf8",
    );
    const factory = source.slice(source.indexOf("export function createFascicoloTrustedReviewProductionService"));

    expect(factory).toContain("createFascicoloLiveAnalysisPreparationService(config)");
    expect(factory).not.toMatch(/config\s*:\s*\{[^}]*\bpreparation\s*:/s);
    expect(factory).not.toContain("config.preparation");
  });

  it.each(["CREATED", "REUSED", "REUSED_AFTER_RACE"] as const)(
    "returns the minimal frozen %s result and preserves exact references and lineage",
    async (outcome) => {
      const prepared = preparation();
      const authoritativeEvidence = { evidence: "exact" };
      const trustedReview = { review: "exact" };
      mocks.buildEvidence.mockReturnValue(authoritativeEvidence);
      mocks.buildTrustedReview.mockReturnValue(trustedReview);
      mocks.persist.mockResolvedValue({
        materialId: "material-1",
        enteId: "ente-1",
        procedimentoId: "proc-1",
        fingerprint: "not-exposed",
        outcome,
      });
      const { service } = serviceWithPreparation(prepared);

      const result = await service.execute({ procedimentoId: "proc-1" });

      expect(result).toEqual({ materialId: "material-1", procedimentoId: "proc-1", outcome });
      expect(Object.keys(result).sort()).toEqual(["materialId", "outcome", "procedimentoId"]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(prepared.prepare).toHaveBeenCalledOnce();
      expect(prepared.prepare).toHaveBeenCalledWith("proc-1");
      expect(mocks.buildEvidence).toHaveBeenCalledWith({
        snapshot: prepared.context.snapshot,
        projection: prepared.context.projection,
      });
      const evidenceInput = mocks.buildEvidence.mock.calls[0][0];
      expect(evidenceInput.snapshot).toBe(prepared.context.snapshot);
      expect(evidenceInput.projection).toBe(prepared.context.projection);
      expect(mocks.buildTrustedReview).toHaveBeenCalledWith({
        trustedResult: prepared.context.analysis,
        authoritativeEvidence,
      });
      const trustedReviewInput = mocks.buildTrustedReview.mock.calls[0][0];
      expect(trustedReviewInput.trustedResult).toBe(prepared.context.analysis);
      expect(trustedReviewInput.authoritativeEvidence).toBe(authoritativeEvidence);
      expect(mocks.persist).toHaveBeenCalledWith({
        procedimentoId: "proc-1",
        trustedReview,
        lineage: {
          analysisSchemaVersion: prepared.context.analysis.analysisSchemaVersion,
          snapshotSchemaVersion: prepared.context.analysis.snapshotSchemaVersion,
          outboundSchemaVersion: prepared.context.analysis.outboundSchemaVersion,
          sourceSnapshotContentHash: prepared.context.analysis.sourceSnapshotContentHash,
          outboundProjectionHash: prepared.context.analysis.outboundProjectionHash,
          outboundProjectionHashAlgorithm: prepared.context.analysis.outboundProjectionHashAlgorithm,
        },
      });
      expect(mocks.persist.mock.calls[0][0].trustedReview).toBe(trustedReview);
      expect(prepared.prepare.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.buildEvidence.mock.invocationCallOrder[0],
      );
      expect(mocks.buildEvidence.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.buildTrustedReview.mock.invocationCallOrder[0],
      );
      expect(mocks.buildTrustedReview.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.persist.mock.invocationCallOrder[0],
      );
    },
  );

  it("propagates preparation failure and stops every downstream stage", async () => {
    const error = new Error("PREPARATION_FAILURE");
    const prepared = preparation();
    prepared.prepare.mockRejectedValue(error);
    const { service } = serviceWithPreparation(prepared);

    await expect(service.execute({ procedimentoId: "proc-1" })).rejects.toBe(error);
    expect(mocks.buildEvidence).not.toHaveBeenCalled();
    expect(mocks.buildTrustedReview).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("propagates B2C5 failure and does not build or persist Trusted Review", async () => {
    const error = new Error("B2C5_FAILURE");
    mocks.buildEvidence.mockImplementation(() => { throw error; });
    const { service } = serviceWithPreparation();

    await expect(service.execute({ procedimentoId: "proc-1" })).rejects.toBe(error);
    expect(mocks.buildTrustedReview).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("propagates Trusted Review failure and does not persist", async () => {
    const error = new Error("TRUSTED_REVIEW_FAILURE");
    mocks.buildTrustedReview.mockImplementation(() => { throw error; });
    const { service } = serviceWithPreparation();

    await expect(service.execute({ procedimentoId: "proc-1" })).rejects.toBe(error);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("propagates B2C1 failure unchanged without retry", async () => {
    const error = new Error("B2C1_FAILURE");
    mocks.persist.mockRejectedValue(error);
    const { service } = serviceWithPreparation();

    await expect(service.execute({ procedimentoId: "proc-1" })).rejects.toBe(error);
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it("uses one real preparation flow, one snapshot, one provider call, and one final persistence", async () => {
    const snapshot = snapshotFixture();
    mocks.buildSnapshot.mockResolvedValue(snapshot);
    const providerAnalyze = vi.fn<AiOutboundAnalysisProvider["analyze"]>()
      .mockResolvedValue(providerPayload());
    const events: unknown[] = [];
    const config = {
      provider: { analyze: providerAnalyze },
      maxInputBytes: 100_000,
      realDataActivation: approvedActivation,
      logger: { log: (event) => events.push(event) },
    };
    const service = createFascicoloTrustedReviewProductionService(config);

    await expect(service.execute({ procedimentoId: "proc-1" })).resolves.toEqual({
      materialId: "material-1",
      procedimentoId: "proc-1",
      outcome: "CREATED",
    });

    expect(mocks.buildSnapshot).toHaveBeenCalledOnce();
    expect(mocks.buildSnapshot).toHaveBeenCalledWith("proc-1");
    expect(providerAnalyze).toHaveBeenCalledOnce();
    expect(mocks.buildEvidence).toHaveBeenCalledOnce();
    expect(mocks.buildEvidence.mock.calls[0][0].snapshot).toBe(snapshot);
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
  });
});
