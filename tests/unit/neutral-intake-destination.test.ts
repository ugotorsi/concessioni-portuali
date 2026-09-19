import { describe, expect, it, vi } from "vitest";

const runTransaction = vi.hoisted(() => vi.fn());
const admitAsyncJobInTransaction = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: runTransaction,
}));
vi.mock("@/server/async-jobs/persistence", () => ({ admitAsyncJobInTransaction }));

import {
  establishNeutralIntakeDestination,
  establishNeutralIntakeDestinationInTransaction,
  NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION,
  NeutralIntakeDestinationConflictError,
  NeutralIntakeDestinationHandoffError,
  resumeEffectiveCaseDocumentHandoffInTransaction,
} from "@/server/intake/neutralIntakeDestination";
import { hashNeutralIntakeClassificationEvidence } from "@/server/intake/classification/projection";

const input = {
  neutralIntakeId: "intake-1",
  procedimentoId: "procedimento-1",
  authoritySource: "CASE_FOLDER_UPLOAD",
  establishedByUserId: "user-1",
  establishedByActorId: "user-1",
  establishedByRole: "GIURIDICO",
};

function destination(overrides: Record<string, unknown> = {}) {
  return {
    ...input,
    contractVersion: NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION,
    establishedAt: new Date("2026-09-14T00:00:00.000Z"),
    ...overrides,
  };
}

function transaction(options: {
  intakeEnteId?: string | null;
  procedimentoEnteId?: string | null;
  existing?: ReturnType<typeof destination> | null;
} = {}) {
  let persisted = options.existing ?? null;
  const tx = {
    neutralIntake: {
      findUnique: vi.fn(async () => ({ id: "intake-1", enteId: options.intakeEnteId ?? "ente-1" })),
    },
    procedimento: {
      findUnique: vi.fn(async () => ({
        id: "procedimento-1",
        concessione: { enteId: options.procedimentoEnteId ?? "ente-1" },
      })),
    },
    neutralIntakeDestination: {
      findUnique: vi.fn(async () => persisted),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        persisted ??= destination(data[0]);
        return { count: 1 };
      }),
    },
  };
  return tx;
}

function resumeTransaction(outcome: "CASE_DOCUMENT" | "UNCERTAIN_REVIEW_REQUIRED" = "CASE_DOCUMENT") {
  const extractionAttempt = {
    id: "extraction-1",
    neutralIntakeId: "intake-1",
    policyVersion: "B2C9_EXTRACTION_POLICY_V1",
    artifactSha256: "b".repeat(64),
    completedAt: new Date("2026-09-14T00:00:00.000Z"),
    warnings: [],
    pages: [{
      pageNumber: 1,
      normalizedText: "ISTANZA DI RINNOVO DELLA CONCESSIONE PORTUALE CON DOCUMENTAZIONE ALLEGATA",
      textSha256: "c".repeat(64),
      normalizedCharacterCount: 74,
      ocrConfidence: null,
      warnings: [],
    }],
  };
  const evidenceHash = hashNeutralIntakeClassificationEvidence(extractionAttempt);
  const intakeRecord = {
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
  const persistedDecision = {
    id: "classification-1",
    neutralIntakeId: "intake-1",
    extractionAttemptId: "extraction-1",
    evidenceHash,
    classifierVersion: "neutral-intake-classifier/v1",
    outcome,
    neutralIntake: intakeRecord,
  };
  let document: Record<string, unknown> | null = null;
  let version: Record<string, unknown> | null = null;
  return {
    neutralIntake: {
      findUnique: vi.fn(async () => ({ id: "intake-1", enteId: "ente-1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    neutralIntakeExtractionAttempt: { findFirst: vi.fn(async () => extractionAttempt) },
    neutralIntakeClassificationAttempt: {
      findUnique: vi.fn(async () => persistedDecision),
      create: vi.fn(),
    },
    asyncJob: {
      findFirst: vi.fn(async () => ({ id: "job-1" })),
      findUnique: vi.fn(async () => ({
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
      })),
    },
    legalSourceCandidateAdmission: { createMany: vi.fn(), findFirst: vi.fn() },
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
  };
}

describe("B2C9 Block 3B.4A-R1 neutral intake destination", () => {
  it("persists one typed procedimento authority without consulting originReference", async () => {
    const tx = transaction();
    await expect(establishNeutralIntakeDestinationInTransaction(tx as never, input))
      .resolves.toMatchObject({ outcome: "CREATED", destination: { procedimentoId: "procedimento-1" } });
    expect(tx.neutralIntakeDestination.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        neutralIntakeId: "intake-1",
        procedimentoId: "procedimento-1",
        contractVersion: NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION,
        authoritySource: "CASE_FOLDER_UPLOAD",
      })],
      skipDuplicates: true,
    });
    expect(JSON.stringify(tx.neutralIntakeDestination.createMany.mock.calls)).not.toContain("originReference");
  });

  it("reuses the same destination and never writes it again", async () => {
    const tx = transaction({ existing: destination() });
    await expect(establishNeutralIntakeDestinationInTransaction(tx as never, input))
      .resolves.toMatchObject({ outcome: "REUSED" });
    expect(tx.neutralIntakeDestination.createMany).not.toHaveBeenCalled();
  });

  it("rejects silent rebinding to a different procedimento", async () => {
    const tx = transaction({ existing: destination({ procedimentoId: "procedimento-2" }) });
    await expect(establishNeutralIntakeDestinationInTransaction(tx as never, input))
      .rejects.toBeInstanceOf(NeutralIntakeDestinationConflictError);
  });

  it("reconciles a concurrent insertion of the same destination", async () => {
    const tx = transaction();
    await expect(Promise.all([
      establishNeutralIntakeDestinationInTransaction(tx as never, input),
      establishNeutralIntakeDestinationInTransaction(tx as never, input),
    ])).resolves.toHaveLength(2);
  });

  it("rejects a procedimento belonging to another tenant", async () => {
    const tx = transaction({ procedimentoEnteId: "ente-2" });
    await expect(establishNeutralIntakeDestinationInTransaction(tx as never, input))
      .rejects.toBeInstanceOf(NeutralIntakeDestinationConflictError);
    expect(tx.neutralIntakeDestination.createMany).not.toHaveBeenCalled();
  });

  it("resumes the exact effective CASE_DOCUMENT decision without reclassification", async () => {
    const tx = resumeTransaction();
    await expect(resumeEffectiveCaseDocumentHandoffInTransaction(tx as never, "intake-1"))
      .resolves.toMatchObject({ outcome: "CASE_DOCUMENT_ROUTED" });
    expect(tx.neutralIntakeExtractionAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { neutralIntakeId: "intake-1", outcome: "SUCCEEDED" },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    }));
    expect(tx.neutralIntakeClassificationAttempt.findUnique.mock.calls[0][0])
      .toHaveProperty("where.neutralIntakeId_evidenceHash_classifierVersion");
    expect(tx.asyncJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ operation: "NEUTRAL_INTAKE_CLASSIFICATION_V1" }),
    }));
    expect(tx.neutralIntakeClassificationAttempt.create).not.toHaveBeenCalled();
    expect(tx.documento.createMany).toHaveBeenCalledTimes(1);
    expect(tx.neutralIntake.updateMany).toHaveBeenCalledWith({
      where: { id: "intake-1", status: { in: ["EVIDENCE_READY", "REVIEW_REQUIRED"] } },
      data: { status: "ROUTED", statusVersion: { increment: 1 } },
    });
  });

  it("does not route a non-CASE_DOCUMENT effective classification", async () => {
    const tx = resumeTransaction("UNCERTAIN_REVIEW_REQUIRED");
    await expect(resumeEffectiveCaseDocumentHandoffInTransaction(tx as never, "intake-1"))
      .resolves.toEqual({ outcome: "NOT_CASE_DOCUMENT" });
    expect(tx.asyncJob.findFirst).not.toHaveBeenCalled();
    expect(tx.documento.createMany).not.toHaveBeenCalled();
  });

  it("preserves the destination when resume infrastructure fails and recovers on replay", async () => {
    const destinationTx = transaction();
    runTransaction
      .mockImplementationOnce(async (work: (tx: never) => Promise<unknown>) => work(destinationTx as never))
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(establishNeutralIntakeDestination(input))
      .rejects.toBeInstanceOf(NeutralIntakeDestinationHandoffError);
    await expect(destinationTx.neutralIntakeDestination.findUnique()).resolves.toMatchObject({
      procedimentoId: "procedimento-1",
    });

    const handoffTx = resumeTransaction();
    runTransaction
      .mockImplementationOnce(async (work: (tx: never) => Promise<unknown>) => work(destinationTx as never))
      .mockImplementationOnce(async (work: (tx: never) => Promise<unknown>) => work(handoffTx as never));
    const recovered = await establishNeutralIntakeDestination(input);
    expect(recovered).toMatchObject({
      outcome: "REUSED",
      handoff: { outcome: "CASE_DOCUMENT_ROUTED" },
    });

    runTransaction
      .mockImplementationOnce(async (work: (tx: never) => Promise<unknown>) => work(destinationTx as never))
      .mockImplementationOnce(async (work: (tx: never) => Promise<unknown>) => work(handoffTx as never));
    await expect(establishNeutralIntakeDestination(input)).resolves.toEqual(recovered);
    expect(destinationTx.neutralIntakeDestination.createMany).toHaveBeenCalledTimes(1);
    expect(handoffTx.documento.createMany).toHaveBeenCalledTimes(2);
  });
});