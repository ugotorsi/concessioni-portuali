import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const createFileMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const admitJobMock = vi.hoisted(() => vi.fn());
const uploadDocumentMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const runTransactionMock = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  intake: null as Record<string, unknown> | null,
  destination: null as Record<string, unknown> | null,
  physicalStorageWrites: 0,
}));

const txMock = vi.hoisted(() => ({
  neutralIntake: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
      if (where.idempotencyKey) {
        return state.intake?.idempotencyKey === where.idempotencyKey ? state.intake : null;
      }
      return state.intake;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.intake = { id: "intake-1", receivedAt: new Date("2026-09-14T00:00:00.000Z"), ...data };
      return state.intake;
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  procedimento: {
    findUnique: vi.fn(async () => ({
      id: "procedimento-1",
      concessione: { id: "concessione-1", enteId: "ente-1" },
    })),
  },
  neutralIntakeDestination: {
    findUnique: vi.fn(async () => state.destination),
    findFirst: vi.fn(async ({ where }) => (
      state.destination?.procedimentoId === where.procedimentoId
      && state.intake?.enteId === where.neutralIntake.is.enteId
      && state.intake?.sha256 === where.neutralIntake.is.sha256
      && state.intake?.status !== "FAILED_EXTRACTION"
        ? state.destination
        : null
    )),
    createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      if (!state.destination) state.destination = data[0];
      return { count: state.destination ? 1 : 0 };
    }),
  },
  user: { findUnique: vi.fn(async () => ({ ruolo: "GIURIDICO" })) },
  asyncJob: { findUnique: vi.fn() },
  neutralIntakeClassificationAttempt: { findUnique: vi.fn() },
  legalSourceCandidateAdmission: { createMany: vi.fn(), findFirst: vi.fn() },
  legalSource: { create: vi.fn() },
  documento: { createMany: vi.fn(), findFirst: vi.fn(async () => null), findUnique: vi.fn(), updateMany: vi.fn() },
  documentFileVersion: { createMany: vi.fn(), findUnique: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  neutralIntake: {
    findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => (
      state.intake?.idempotencyKey === where.idempotencyKey ? state.intake : null
    )),
  },
  neutralIntakeDestination: {
    findFirst: vi.fn(async ({ where }) => (
      state.destination?.procedimentoId === where.procedimentoId
      && state.intake?.enteId === where.neutralIntake.is.enteId
      && state.intake?.sha256 === where.neutralIntake.is.sha256
      && state.intake?.status !== "FAILED_EXTRACTION"
        ? state.destination
        : null
    )),
  },
  documento: { findFirst: vi.fn(async () => null) },
  procedimento: {
    findUnique: vi.fn(async () => ({
      id: "procedimento-1",
      concessione: { id: "concessione-1", enteId: "ente-1" },
    })),
  },
}));

vi.mock("@/lib/auth", () => ({
  BACKOFFICE_ROLES: ["ADMIN", "GIURIDICO"],
  canManageProcedimenti: vi.fn(() => true),
  requireRole: requireRoleMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/documents/storage", () => ({
  createDocumentFileIfAbsent: createFileMock,
  readDocumentFileFromProvider: readFileMock,
}));
vi.mock("@/server/async-jobs/persistence", () => ({ admitAsyncJobInTransaction: admitJobMock }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: runTransactionMock,
}));
vi.mock("@/server/documents/uploadService", () => ({ uploadDocument: uploadDocumentMock }));
vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: auditSuccessMock,
  auditFailure: auditFailureMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { createDocumentoUploadAction } from "@/server/actions/documenti";
import { ensureClassificationHandoffInTransaction } from "@/server/intake/classification/handoff";

const operationId = "2e1bf47e-9b2f-4ee8-a41a-4ea6ca4e4619";
const body = Buffer.from("procedimento upload content");
const sha256 = createHash("sha256").update(body).digest("hex");
const storageObject = {
  storageProvider: "local" as const,
  storageKey: `intake/sha256/${sha256}`,
  fileName: sha256,
  bucket: null,
  sizeBytes: body.length,
  sha256,
  mimeType: "text/plain",
  originalName: "istanza.txt",
};

function uploadFormData(input: { operationId?: string; fileName?: string } = {}) {
  const formData = new FormData();
  formData.set("intakeOperationId", input.operationId ?? operationId);
  formData.set("file", new File([body], input.fileName ?? "istanza.txt", { type: "text/plain" }));
  formData.set("nome", "Istanza");
  formData.set("tipologia", "NOTA");
  formData.set("source", "UPLOAD_UTENTE");
  formData.set("status", "ATTIVO");
  formData.set("procedimentoId", "procedimento-1");
  return formData;
}

function prepareHandoff(outcome: "CASE_DOCUMENT" | "LEGAL_SOURCE_CANDIDATE" | "UNCERTAIN_REVIEW_REQUIRED") {
  const intake = {
    ...state.intake,
    destination: {
      ...state.destination,
      procedimento: {
        id: "procedimento-1",
        concessioneId: "concessione-1",
        concessione: { id: "concessione-1", enteId: "ente-1" },
      },
    },
  };
  const decision = {
    id: "classification-1",
    neutralIntakeId: "intake-1",
    extractionAttemptId: "extraction-1",
    evidenceHash: "a".repeat(64),
    classifierVersion: "B2C9_NEUTRAL_INTAKE_CLASSIFIER_V1",
    outcome,
    neutralIntake: intake,
  };
  let candidate: Record<string, unknown> | null = null;
  let document: Record<string, unknown> | null = null;
  let version: Record<string, unknown> | null = null;
  txMock.asyncJob.findUnique.mockResolvedValue({
    operation: "NEUTRAL_INTAKE_CLASSIFICATION_V1",
    tenantId: "ente-1",
    initiatingUserId: "user-1",
    actorId: "user-1",
    actorEmail: "user@example.test",
    actorRole: "GIURIDICO",
    purpose: "NEUTRAL_INTAKE_CLASSIFICATION",
  });
  txMock.neutralIntakeClassificationAttempt.findUnique.mockResolvedValue(decision);
  txMock.legalSourceCandidateAdmission.createMany.mockImplementation(async ({ data }) => {
    candidate ??= { id: "candidate-1", ...data[0] };
    return { count: 1 };
  });
  txMock.legalSourceCandidateAdmission.findFirst.mockImplementation(async () => candidate);
  txMock.documento.createMany.mockImplementation(async ({ data }) => {
    document ??= { ...data[0], currentFileVersionId: null };
    return { count: 1 };
  });
  txMock.documento.findUnique.mockImplementation(async () => document);
  txMock.documento.updateMany.mockImplementation(async ({ data }) => {
    if (document) document.currentFileVersionId = data.currentFileVersionId;
    return { count: 1 };
  });
  txMock.documentFileVersion.createMany.mockImplementation(async ({ data }) => {
    version ??= data[0];
    return { count: 1 };
  });
  txMock.documentFileVersion.findUnique.mockImplementation(async () => version);
}

async function runHandoff(outcome: "CASE_DOCUMENT" | "LEGAL_SOURCE_CANDIDATE" | "UNCERTAIN_REVIEW_REQUIRED") {
  prepareHandoff(outcome);
  return ensureClassificationHandoffInTransaction(txMock as never, {
    jobId: "job-1",
    neutralIntakeId: "intake-1",
    classificationAttemptId: "classification-1",
    evidenceHash: "a".repeat(64),
    classifierVersion: "B2C9_NEUTRAL_INTAKE_CLASSIFIER_V1",
  });
}

describe("primary Procedimento upload convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.intake = null;
    state.destination = null;
    state.physicalStorageWrites = 0;
    requireRoleMock.mockResolvedValue("GIURIDICO");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "user@example.test", role: "GIURIDICO" });
    getTenantContextMock.mockResolvedValue({ userId: "user-1", accessibleTenantIds: ["ente-1"] });
    requireTenantAccessMock.mockImplementation(() => undefined);
    runTransactionMock.mockImplementation(async (work) => work(txMock));
    admitJobMock.mockResolvedValue({ outcome: "CREATED", job: { id: "extraction-job-1" } });
    createFileMock.mockImplementation(async () => {
      if (state.physicalStorageWrites === 0) {
        state.physicalStorageWrites += 1;
        return { disposition: "CREATED", object: storageObject, ownedByAttempt: true };
      }
      return { disposition: "ALREADY_EXISTS", object: storageObject, ownedByAttempt: false };
    });
    readFileMock.mockResolvedValue({ disposition: "FOUND", body });
    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
    redirectMock.mockImplementation(() => undefined);
  });

  it("stores one artifact, admits one destination-bound intake, retries idempotently, and routes CASE_DOCUMENT", async () => {
    await createDocumentoUploadAction(uploadFormData());
    await createDocumentoUploadAction(uploadFormData());

    expect(createFileMock).toHaveBeenCalledTimes(2);
    expect(state.physicalStorageWrites).toBe(1);
    expect(txMock.neutralIntake.create).toHaveBeenCalledTimes(1);
    expect(txMock.neutralIntakeDestination.createMany).toHaveBeenCalledTimes(1);
    expect(state.destination).toMatchObject({
      neutralIntakeId: "intake-1",
      procedimentoId: "procedimento-1",
      authoritySource: "CASE_FOLDER_UPLOAD",
    });
    expect(uploadDocumentMock).not.toHaveBeenCalled();
    expect(txMock.documento.createMany).not.toHaveBeenCalled();

    await expect(runHandoff("CASE_DOCUMENT")).resolves.toMatchObject({ outcome: "CASE_DOCUMENT_ROUTED" });
    expect(txMock.documento.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.documento.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        procedimentoId: "procedimento-1",
        storageKey: storageObject.storageKey,
        sha256,
      })],
      skipDuplicates: true,
    });
    expect(txMock.documentFileVersion.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ storageKey: storageObject.storageKey, sha256 })],
      skipDuplicates: true,
    });
  });

  it("converges race-shaped new operations with identical bytes in one fascicolo", async () => {
    let transactionTail = Promise.resolve<unknown>(undefined);
    runTransactionMock.mockImplementation((work) => {
      const result = transactionTail.then(() => work(txMock));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    });

    await Promise.all([
      createDocumentoUploadAction(uploadFormData({
        operationId: "61d399ba-b3c5-4faa-88b8-9a477c993431",
        fileName: "istanza.txt",
      })),
      createDocumentoUploadAction(uploadFormData({
        operationId: "02f41460-9f68-47d6-97a4-936063720974",
        fileName: "istanza-rinominata.txt",
      })),
    ]);

    expect(txMock.neutralIntake.create).toHaveBeenCalledTimes(1);
    expect(txMock.neutralIntakeDestination.createMany).toHaveBeenCalledTimes(1);
    expect(admitJobMock).toHaveBeenCalledTimes(1);
    expect(uploadDocumentMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/procedimenti/procedimento-1?documentUpload=duplicate");
  });

  it.each([
    ["LEGAL_SOURCE_CANDIDATE", "LEGAL_SOURCE_CANDIDATE_ADMITTED"],
    ["UNCERTAIN_REVIEW_REQUIRED", "REVIEW_REQUIRED"],
  ] as const)("retains procedure context without forcing %s into CASE_DOCUMENT", async (outcome, expected) => {
    await createDocumentoUploadAction(uploadFormData());

    await expect(runHandoff(outcome)).resolves.toMatchObject({ outcome: expected });
    expect(state.destination).toMatchObject({ procedimentoId: "procedimento-1" });
    expect(txMock.documento.createMany).not.toHaveBeenCalled();
    expect(txMock.legalSource.create).not.toHaveBeenCalled();
  });
});
