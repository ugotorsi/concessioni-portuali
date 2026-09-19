import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const admitAsyncJobInTransactionMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/async-jobs/persistence", () => ({
  admitAsyncJobInTransaction: admitAsyncJobInTransactionMock,
}));

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  FASCICOLO_REEVALUATE_OPERATION,
  parseFascicoloReevaluationReference,
} from "@/server/fascicolo-lifecycle/fascicoloReevaluationJob";
import {
  ensureClassificationHandoffInTransaction,
  NEUTRAL_INTAKE_HANDOFF_CONTRACT_VERSION,
  NeutralIntakeHandoffConflictError,
} from "@/server/intake/classification/handoff";

const evidenceHash = "a".repeat(64);
const intake = {
  id: "intake-1",
  enteId: "ente-1",
  storageProvider: "local",
  storageBucket: null,
  storageKey: `intake/sha256/${"b".repeat(64)}`,
  sha256: "b".repeat(64),
  mimeType: "application/pdf",
  sizeBytes: 123,
  originalName: "atto.pdf",
  receivedAt: new Date("2026-09-14T00:00:00.000Z"),
  destination: {
    neutralIntakeId: "intake-1",
    procedimentoId: "procedimento-1",
    procedimento: {
      id: "procedimento-1",
      concessioneId: "concessione-1",
      concessione: { id: "concessione-1", enteId: "ente-1" },
    },
  },
};

function decision(
  outcome: "LEGAL_SOURCE_CANDIDATE" | "CASE_DOCUMENT" | "UNCERTAIN_REVIEW_REQUIRED",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "classification-1",
    neutralIntakeId: "intake-1",
    extractionAttemptId: "extraction-1",
    evidenceHash,
    classifierVersion: "B2C9_NEUTRAL_INTAKE_CLASSIFIER_V1",
    outcome,
    neutralIntake: intake,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    neutralIntakeId: "intake-1",
    classificationAttemptId: "classification-1",
    evidenceHash,
    classifierVersion: "B2C9_NEUTRAL_INTAKE_CLASSIFIER_V1",
    ...overrides,
  };
}

function transaction(persistedDecision: ReturnType<typeof decision>) {
  let candidate: Record<string, unknown> | null = null;
  let document: Record<string, unknown> | null = null;
  let version: Record<string, unknown> | null = null;
  const tx = {
    asyncJob: { findUnique: vi.fn(async () => ({
      operation: "NEUTRAL_INTAKE_CLASSIFICATION_V1",
      tenantId: "ente-1",
      initiatingUserId: "user-1",
      actorId: "user-1",
      actorEmail: "user@example.test",
      actorRole: "GIURIDICO",
      purpose: "NEUTRAL_INTAKE_CLASSIFICATION",
      admissionType: "AUTHENTICATED_USER",
      correlationId: "correlation-1",
      policyDecisionRef: null,
    })) },
    neutralIntakeClassificationAttempt: { findUnique: vi.fn(async () => persistedDecision) },
    legalSourceCandidateAdmission: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        candidate ??= { id: "candidate-1", ...data[0] };
        return { count: candidate ? 1 : 0 };
      }),
      findFirst: vi.fn(async () => candidate),
    },
    legalSource: { create: vi.fn() },
    documento: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        document ??= { ...data[0], currentFileVersionId: null };
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => document),
      updateMany: vi.fn(async ({ data }: { data: { currentFileVersionId: string } }) => {
        if (document) document.currentFileVersionId = data.currentFileVersionId;
        return { count: 1 };
      }),
    },
    documentFileVersion: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        version ??= data[0];
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => version),
    },
    neutralIntake: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  return tx;
}

describe("B2C9 Block 3B.4A-R1 classification handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admitAsyncJobInTransactionMock.mockResolvedValue({ outcome: "CREATED", job: { id: "reevaluation-job-1" } });
  });

  it("contains no provider, research, AI, automatic issue, or legal-source side effect", () => {
    const source = readFileSync(resolve("src/server/intake/classification/handoff.ts"), "utf8");
    expect(source).not.toMatch(/openai|provider.*invoke|legalResearch|researchMission|\.criticita\.|\.legalSource\.create/i);
  });

  it("admits a reference-only legal source candidate and never creates LegalSource", async () => {
    const tx = transaction(decision("LEGAL_SOURCE_CANDIDATE"));
    await expect(ensureClassificationHandoffInTransaction(tx as never, input()))
      .resolves.toEqual({ outcome: "LEGAL_SOURCE_CANDIDATE_ADMITTED", admissionId: "candidate-1" });
    const persisted = tx.legalSourceCandidateAdmission.createMany.mock.calls[0][0];
    expect(persisted).toEqual({
      data: [expect.objectContaining({
        enteId: "ente-1",
        neutralIntakeId: "intake-1",
        classificationAttemptId: "classification-1",
        extractionAttemptId: "extraction-1",
        evidenceHash,
        classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
        contractVersion: NEUTRAL_INTAKE_HANDOFF_CONTRACT_VERSION,
        actorId: "user-1",
        actorRole: "GIURIDICO",
        purpose: "NEUTRAL_INTAKE_CLASSIFICATION",
      })],
      skipDuplicates: true,
    });
    expect(JSON.stringify(persisted)).not.toMatch(/normalizedText|extractedText|ocrText|pages|content/);
    expect(tx.legalSource.create).not.toHaveBeenCalled();
    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
  });

  it("replays the same source decision to the same candidate admission", async () => {
    const tx = transaction(decision("LEGAL_SOURCE_CANDIDATE"));
    const first = await ensureClassificationHandoffInTransaction(tx as never, input());
    const replay = await ensureClassificationHandoffInTransaction(tx as never, input());
    expect(replay).toEqual(first);
  });

  it("keeps changed decision and evidence identities distinguishable", async () => {
    const firstTx = transaction(decision("LEGAL_SOURCE_CANDIDATE"));
    const changedHash = "c".repeat(64);
    const secondTx = transaction(decision("LEGAL_SOURCE_CANDIDATE", {
      id: "classification-2",
      evidenceHash: changedHash,
    }));
    await ensureClassificationHandoffInTransaction(firstTx as never, input());
    await ensureClassificationHandoffInTransaction(secondTx as never, input({
      classificationAttemptId: "classification-2",
      evidenceHash: changedHash,
    }));
    expect(firstTx.legalSourceCandidateAdmission.createMany.mock.calls[0][0].data[0])
      .not.toEqual(secondTx.legalSourceCandidateAdmission.createMany.mock.calls[0][0].data[0]);
  });

  it("creates and reuses one Documento and file version for an authoritative destination", async () => {
    const tx = transaction(decision("CASE_DOCUMENT"));
    const first = await ensureClassificationHandoffInTransaction(tx as never, input());
    const replay = await ensureClassificationHandoffInTransaction(tx as never, input());
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ outcome: "CASE_DOCUMENT_ROUTED", documentId: expect.any(String) });
    expect(tx.documento.createMany.mock.calls[0][0]).toEqual({
      data: [expect.objectContaining({
        enteId: "ente-1",
        concessioneId: "concessione-1",
        procedimentoId: "procedimento-1",
        storageKey: intake.storageKey,
        sha256: intake.sha256,
      })],
      skipDuplicates: true,
    });
    expect(tx.documentFileVersion.createMany).toHaveBeenCalledTimes(2);
    expect(admitAsyncJobInTransactionMock).toHaveBeenCalledTimes(2);
    const firstAdmission = normalizeAsyncJobAdmission(admitAsyncJobInTransactionMock.mock.calls[0][1]);
    const replayAdmission = normalizeAsyncJobAdmission(admitAsyncJobInTransactionMock.mock.calls[1][1]);
    expect(admitAsyncJobInTransactionMock.mock.calls[0][0]).toBe(tx);
    expect(tx.neutralIntake.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(admitAsyncJobInTransactionMock.mock.invocationCallOrder[0]);
    expect(firstAdmission.operation).toBe(FASCICOLO_REEVALUATE_OPERATION);
    expect(firstAdmission.idempotencyKey).toBe(replayAdmission.idempotencyKey);
    expect(firstAdmission.requestFingerprint).toBe(replayAdmission.requestFingerprint);
    const reevaluation = parseFascicoloReevaluationReference(firstAdmission.inputReference);
    expect(reevaluation).toMatchObject({
      procedimentoId: "procedimento-1",
      change: {
        kind: "DOCUMENT_CHANGED",
        procedimentoId: "procedimento-1",
        documentId: first.documentId,
        documentVersionId: expect.any(String),
        changeType: "CREATED",
        legalEvidenceKind: "NONE",
        legalAssessmentTarget: { kind: "UNDETERMINED" },
      },
    });
    expect(reevaluation.change.stateFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes reevaluation identity when the materialized file version changes", async () => {
    const firstTx = transaction(decision("CASE_DOCUMENT"));
    const changedSha = "c".repeat(64);
    const changedTx = transaction(decision("CASE_DOCUMENT", {
      neutralIntake: {
        ...intake,
        sha256: changedSha,
        storageKey: `intake/sha256/${changedSha}`,
      },
    }));

    await ensureClassificationHandoffInTransaction(firstTx as never, input());
    await ensureClassificationHandoffInTransaction(changedTx as never, input());
    const firstAdmission = normalizeAsyncJobAdmission(admitAsyncJobInTransactionMock.mock.calls[0][1]);
    const changedAdmission = normalizeAsyncJobAdmission(admitAsyncJobInTransactionMock.mock.calls[1][1]);

    expect(firstAdmission.idempotencyKey).not.toBe(changedAdmission.idempotencyKey);
    expect(parseFascicoloReevaluationReference(firstAdmission.inputReference).change.stateFingerprint)
      .not.toBe(parseFascicoloReevaluationReference(changedAdmission.inputReference).change.stateFingerprint);
  });

  it("propagates reevaluation admission failure through the materialization transaction", async () => {
    const tx = transaction(decision("CASE_DOCUMENT"));
    const admissionFailure = new Error("reevaluation admission failed");
    admitAsyncJobInTransactionMock.mockRejectedValueOnce(admissionFailure);

    await expect(ensureClassificationHandoffInTransaction(tx as never, input())).rejects.toBe(admissionFailure);
    expect(tx.documento.createMany).toHaveBeenCalledOnce();
    expect(tx.documentFileVersion.createMany).toHaveBeenCalledOnce();
    expect(tx.neutralIntake.updateMany).toHaveBeenCalledOnce();
    expect(admitAsyncJobInTransactionMock).toHaveBeenCalledWith(tx, expect.any(Object));
  });

  it.each([
    ["documentId", "different-document"],
    ["canonicalEnteId", "different-ente"],
    ["storageProvider", "different-provider"],
    ["storageKey", "different-key"],
    ["storageBucket", ""],
    ["mimeType", "application/octet-stream"],
    ["sizeBytes", 124],
    ["sha256", "c".repeat(64)],
  ])("rejects a replay whose file version differs in %s", async (field, conflictingValue) => {
    const tx = transaction(decision("CASE_DOCUMENT"));
    await ensureClassificationHandoffInTransaction(tx as never, input());
    const persistedVersion = tx.documentFileVersion.createMany.mock.calls[0][0].data[0];
    persistedVersion[field] = conflictingValue;

    await expect(ensureClassificationHandoffInTransaction(tx as never, input()))
      .rejects.toBeInstanceOf(NeutralIntakeHandoffConflictError);
    expect(tx.documentFileVersion.createMany).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a concurrent version insert has a conflicting artifact binding", async () => {
    const tx = transaction(decision("CASE_DOCUMENT"));
    let racedVersion: Record<string, unknown> | null = null;
    tx.documentFileVersion.createMany.mockImplementationOnce(async ({ data }) => {
      racedVersion = { ...data[0], storageKey: "conflicting/concurrent/key" };
      return { count: 0 };
    });
    tx.documentFileVersion.findUnique.mockImplementation(async () => racedVersion);

    await expect(ensureClassificationHandoffInTransaction(tx as never, input()))
      .rejects.toBeInstanceOf(NeutralIntakeHandoffConflictError);
    expect(tx.documento.updateMany).not.toHaveBeenCalled();
  });

  it("requires review and creates no document when destination authority is absent", async () => {
    const noDestination = decision("CASE_DOCUMENT", {
      neutralIntake: { ...intake, destination: null },
    });
    const tx = transaction(noDestination);
    await expect(ensureClassificationHandoffInTransaction(tx as never, input()))
      .resolves.toMatchObject({ outcome: "REVIEW_REQUIRED" });
    expect(tx.neutralIntake.updateMany).toHaveBeenCalledWith({
      where: { id: "intake-1", status: "EVIDENCE_READY" },
      data: { status: "REVIEW_REQUIRED", statusVersion: { increment: 1 } },
    });
    expect(tx.documento.createMany).not.toHaveBeenCalled();
    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
  });

  it("leaves uncertain classification in review without any handoff target", async () => {
    const tx = transaction(decision("UNCERTAIN_REVIEW_REQUIRED"));
    await expect(ensureClassificationHandoffInTransaction(tx as never, input()))
      .resolves.toMatchObject({ outcome: "REVIEW_REQUIRED" });
    expect(tx.legalSourceCandidateAdmission.createMany).not.toHaveBeenCalled();
    expect(tx.documento.createMany).not.toHaveBeenCalled();
    expect(tx.neutralIntake.updateMany).not.toHaveBeenCalled();
    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
  });
});