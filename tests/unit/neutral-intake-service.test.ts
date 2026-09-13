import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUser: vi.fn(),
  create: vi.fn(),
  createFile: vi.fn(),
  readFile: vi.fn(),
  admitAsyncJobInTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { neutralIntake: { findUnique: mocks.findUnique, create: mocks.create } },
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: (callback: (tx: unknown) => unknown) => callback({
    neutralIntake: { findUnique: mocks.findUnique, create: mocks.create },
    user: { findUnique: mocks.findUser },
  }),
}));

vi.mock("@/server/documents/storage", () => ({
  createDocumentFileIfAbsent: mocks.createFile,
  readDocumentFileFromProvider: mocks.readFile,
}));

vi.mock("@/server/async-jobs/persistence", () => ({
  admitAsyncJobInTransaction: mocks.admitAsyncJobInTransaction,
}));

import {
  createNeutralIntake,
  NeutralIntakeIdempotencyConflictError,
  NeutralIntakeStorageConflictError,
} from "@/server/intake/createNeutralIntake";
import { buildNeutralIntakeIdempotencyKeyV1 } from "@/server/intake/neutralIntakeIdentity";

const body = Buffer.from("neutral-intake-content");
const sha256 = createHash("sha256").update(body).digest("hex");

function input(overrides: Record<string, unknown> = {}) {
  return {
    body,
    mimeType: "application/pdf",
    originalName: "source.pdf",
    ingressChannel: "FUTURE_PROVIDER",
    originReference: "provider/item-1",
    enteId: null,
    receivedByUserId: null,
    receivedByActorId: "actor-1",
    receivedByRole: "ADMIN",
    idempotencyAnchor: { type: "ORIGIN_REFERENCE" as const, value: "provider/item-1" },
    ...overrides,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "intake-1",
    idempotencyKey: "a".repeat(64),
    storageProvider: "local",
    storageBucket: null,
    storageKey: `intake/sha256/${sha256}`,
    sha256,
    mimeType: "application/pdf",
    sizeBytes: body.length,
    originalName: "source.pdf",
    ingressChannel: "FUTURE_PROVIDER",
    originReference: "provider/item-1",
    enteId: null,
    receivedByUserId: null,
    receivedByActorId: "actor-1",
    receivedByRole: "ADMIN",
    receivedAt: new Date("2026-09-12T00:00:00.000Z"),
    status: "RECEIVED",
    statusVersion: 0,
    ...overrides,
  };
}

function stored(disposition: "CREATED" | "ALREADY_EXISTS" = "CREATED") {
  return {
    disposition,
    ownedByAttempt: disposition === "CREATED",
    object: {
      storageProvider: "local",
      storageKey: `intake/sha256/${sha256}`,
      fileName: sha256,
      bucket: null,
      sizeBytes: body.length,
      sha256,
      mimeType: "application/pdf",
      originalName: "source.pdf",
    },
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "NeutralIntake", target: ["idempotencyKey"] },
  });
}

describe("B2C9 Block 3B.1 neutral intake service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ ruolo: "ADMIN" });
    mocks.create.mockImplementation(async ({ data }) => record(data));
    mocks.createFile.mockResolvedValue(stored());
    mocks.admitAsyncJobInTransaction.mockImplementation(async (_tx, admission) => ({
      outcome: "CREATED",
      job: { id: "job-1", inputReference: admission.inputReference },
    }));
  });

  it("creates RECEIVED version zero at a deterministic content-addressed key", async () => {
    await expect(createNeutralIntake(input())).resolves.toMatchObject({ outcome: "CREATED" });
    expect(mocks.createFile).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: `intake/sha256/${sha256}`,
      sha256,
      sizeBytes: body.length,
    }));
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "RECEIVED", statusVersion: 0 }),
    });
    expect(`intake/sha256/${sha256}`).not.toMatch(/ente|document|legal/i);
  });

  it("atomically admits one reference-only extraction job with preserved provenance", async () => {
    const result = await createNeutralIntake(input({ enteId: "ente-1", receivedByUserId: "actor-1" }));
    const correlationId = buildNeutralIntakeIdempotencyKeyV1({
      ingressChannel: "FUTURE_PROVIDER",
      anchor: { type: "ORIGIN_REFERENCE", value: "provider/item-1" },
    });
    expect(result).toMatchObject({ outcome: "CREATED", extractionJob: { id: "job-1" } });
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledOnce();
    expect(mocks.admitAsyncJobInTransaction.mock.calls[0][0]).toEqual(expect.objectContaining({
      neutralIntake: expect.any(Object),
    }));
    expect(mocks.admitAsyncJobInTransaction.mock.calls[0][1]).toMatchObject({
      operation: "NEUTRAL_INTAKE_EXTRACTION_V1",
      logicalOperationId: "intake-1",
      purpose: "NEUTRAL_INTAKE_EXTRACTION",
      correlationId,
      inputReference: {
        referenceType: "NEUTRAL_INTAKE",
        referenceId: "intake-1",
        referenceVersion: "V1",
        metadata: {},
      },
      maxAttempts: 1,
      admission: {
        admissionType: "AUTHENTICATED_USER",
        tenantId: "ente-1",
        initiatingUserId: "actor-1",
        actor: { actorId: "actor-1", actorEmail: null, actorRole: "ADMIN" },
      },
    });
    expect(JSON.stringify(mocks.admitAsyncJobInTransaction.mock.calls[0][1].inputReference))
      .not.toMatch(/text|body|bytes|filename|storage|ocr/i);
  });

  it("accepts provider-neutral channels and nullable tenant/user", async () => {
    await createNeutralIntake(input({ ingressChannel: "ARBITRARY_FUTURE_API" }));
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ingressChannel: "ARBITRARY_FUTURE_API",
      enteId: null,
      receivedByUserId: null,
    }) });
  });

  it("accepts tenant and optional user provenance", async () => {
    mocks.findUser.mockResolvedValueOnce({ ruolo: "TECNICO" });
    await createNeutralIntake(input({ enteId: "ente-1", receivedByUserId: "user-1" }));
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      enteId: "ente-1",
      receivedByUserId: "user-1",
    }) });
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inputReference: expect.objectContaining({
          metadata: { receivedActorId: "actor-1", receivedActorRoleCode: "ADMIN" },
        }),
        admission: expect.objectContaining({
          admissionType: "AUTHENTICATED_USER",
          initiatingUserId: "user-1",
          actor: expect.objectContaining({ actorId: "user-1", actorRole: "TECNICO" }),
        }),
      }),
    );
  });

  it("preserves system receipt actor identity and role without loading a user", async () => {
    await createNeutralIntake(input());
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inputReference: expect.objectContaining({ metadata: {} }),
        admission: expect.objectContaining({
          admissionType: "AUTHORIZED_SYSTEM",
          initiatingUserId: null,
          actor: expect.objectContaining({ actorId: "actor-1", actorRole: "ADMIN" }),
        }),
      }),
    );
  });

  it("reuses an exact retry without creating a second row", async () => {
    mocks.createFile.mockResolvedValueOnce(stored("ALREADY_EXISTS"));
    mocks.readFile.mockResolvedValueOnce({ disposition: "FOUND", body });
    mocks.findUnique.mockResolvedValue(record());
    await expect(createNeutralIntake(input())).resolves.toMatchObject({ outcome: "REUSED" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledOnce();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logicalOperationId: "intake-1", availableAt: record().receivedAt }),
    );
  });

  it("keeps event identity stable and fails when the same event changes artifact", async () => {
    const changedBody = Buffer.from("changed-content");
    const expectedEventKey = buildNeutralIntakeIdempotencyKeyV1({
      ingressChannel: "FUTURE_PROVIDER",
      anchor: { type: "ORIGIN_REFERENCE", value: "provider/item-1" },
    });
    mocks.findUnique.mockResolvedValue(record());
    await expect(createNeutralIntake(input())).resolves.toMatchObject({ outcome: "REUSED" });
    await expect(createNeutralIntake(input({ body: changedBody })))
      .rejects.toBeInstanceOf(NeutralIntakeIdempotencyConflictError);
    expect(mocks.findUnique).toHaveBeenNthCalledWith(1, { where: { idempotencyKey: expectedEventKey } });
    expect(mocks.findUnique).toHaveBeenNthCalledWith(2, { where: { idempotencyKey: expectedEventKey } });
    expect(mocks.createFile).toHaveBeenNthCalledWith(1, expect.objectContaining({
      storageKey: `intake/sha256/${sha256}`,
    }));
    expect(mocks.createFile).toHaveBeenNthCalledWith(2, expect.objectContaining({
      storageKey: `intake/sha256/${createHash("sha256").update(changedBody).digest("hex")}`,
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows the same artifact under distinct provenance events", async () => {
    await createNeutralIntake(input());
    await createNeutralIntake(input({
      originReference: "provider/item-2",
      idempotencyAnchor: { type: "ORIGIN_REFERENCE", value: "provider/item-2" },
    }));
    const keys = mocks.create.mock.calls.map(([argument]) => argument.data.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(mocks.create.mock.calls[0][0].data.sha256).toBe(mocks.create.mock.calls[1][0].data.sha256);
  });

  it("reconciles an equivalent unique-key race after rollback", async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(record());
    mocks.create.mockRejectedValueOnce(p2002());
    await expect(createNeutralIntake(input())).resolves.toMatchObject({ outcome: "REUSED" });
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });

  it("fails closed when race reconciliation finds a divergent manifest", async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(record({ receivedByRole: "VIEWER_ADSP" }));
    mocks.create.mockRejectedValueOnce(p2002());
    await expect(createNeutralIntake(input())).rejects.toBeInstanceOf(NeutralIntakeIdempotencyConflictError);
  });

  it("does not call persistence when storage fails", async () => {
    mocks.createFile.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(createNeutralIntake(input())).rejects.toThrow("storage unavailable");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).not.toHaveBeenCalled();
  });

  it("does not attempt an unsafe delete when persistence fails", async () => {
    mocks.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(createNeutralIntake(input())).rejects.toThrow("database unavailable");
    expect(mocks.createFile).toHaveBeenCalledTimes(1);
  });

  it("does not return a committed intake when extraction-job admission fails", async () => {
    mocks.admitAsyncJobInTransaction.mockRejectedValueOnce(new Error("job admission unavailable"));
    await expect(createNeutralIntake(input())).rejects.toThrow("job admission unavailable");
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("verifies reused object bytes without rewriting them", async () => {
    mocks.createFile.mockResolvedValueOnce(stored("ALREADY_EXISTS"));
    mocks.readFile.mockResolvedValueOnce({ disposition: "FOUND", body });
    await expect(createNeutralIntake(input())).resolves.toMatchObject({ outcome: "CREATED" });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or mismatched bytes at an existing locator", async () => {
    mocks.createFile.mockResolvedValue(stored("ALREADY_EXISTS"));
    mocks.readFile.mockResolvedValueOnce({ disposition: "MISSING" });
    await expect(createNeutralIntake(input())).rejects.toBeInstanceOf(NeutralIntakeStorageConflictError);
    mocks.readFile.mockResolvedValueOnce({ disposition: "FOUND", body: Buffer.from("wrong") });
    await expect(createNeutralIntake(input())).rejects.toBeInstanceOf(NeutralIntakeStorageConflictError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires a semantic origin reference to match its event anchor", async () => {
    await expect(createNeutralIntake(input({
      idempotencyAnchor: { type: "ORIGIN_REFERENCE", value: "other" },
    }))).rejects.toThrow(/originReference/);
    expect(mocks.createFile).not.toHaveBeenCalled();
  });
});
