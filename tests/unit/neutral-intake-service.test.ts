import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findPreflightIdempotency: vi.fn(),
  findPreflightDuplicateIntake: vi.fn(),
  findPreflightDuplicateDocument: vi.fn(),
  findUser: vi.fn(),
  create: vi.fn(),
  createFile: vi.fn(),
  readFile: vi.fn(),
  admitAsyncJobInTransaction: vi.fn(),
  findProcedimento: vi.fn(),
  findDestination: vi.fn(),
  findDuplicateIntake: vi.fn(),
  findDuplicateDocument: vi.fn(),
  createDestination: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    neutralIntake: { findUnique: mocks.findPreflightIdempotency, create: mocks.create },
    neutralIntakeDestination: { findFirst: mocks.findPreflightDuplicateIntake },
    documento: { findFirst: mocks.findPreflightDuplicateDocument },
  },
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: (callback: (tx: unknown) => unknown) => callback({
    neutralIntake: { findUnique: mocks.findUnique, create: mocks.create },
    user: { findUnique: mocks.findUser },
    procedimento: { findUnique: mocks.findProcedimento },
    neutralIntakeDestination: {
      findUnique: mocks.findDestination,
      findFirst: mocks.findDuplicateIntake,
      createMany: mocks.createDestination,
    },
    documento: { findFirst: mocks.findDuplicateDocument },
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

type RoutedDocumentWhere = {
  enteId: string;
  procedimentoId: string;
  OR: Array<{
    sha256?: string;
    checksumSha256?: string;
    fileVersions?: { some: { canonicalEnteId: string; sha256: string } };
  }>;
};

function matchesRoutedDocumentHash(
  where: RoutedDocumentWhere,
  document: {
    enteId: string;
    procedimentoId: string;
    sha256: string | null;
    checksumSha256: string | null;
    fileVersionSha256s: string[];
  },
) {
  return where.enteId === document.enteId
    && where.procedimentoId === document.procedimentoId
    && where.OR.some((candidate) => (
      candidate.sha256 === document.sha256
      || candidate.checksumSha256 === document.checksumSha256
      || (
        candidate.fileVersions?.some.canonicalEnteId === document.enteId
        && document.fileVersionSha256s.includes(candidate.fileVersions.some.sha256)
      )
    ));
}

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
    mocks.findPreflightIdempotency.mockResolvedValue(null);
    mocks.findPreflightDuplicateIntake.mockResolvedValue(null);
    mocks.findPreflightDuplicateDocument.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ ruolo: "ADMIN" });
    mocks.findProcedimento.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: "ente-1" } });
    mocks.findDestination.mockResolvedValue(null);
    mocks.findDuplicateIntake.mockResolvedValue(null);
    mocks.findDuplicateDocument.mockResolvedValue(null);
    mocks.createDestination.mockImplementation(async ({ data }) => {
      mocks.findDestination.mockResolvedValue({ ...data[0], establishedAt: new Date() });
      return { count: 1 };
    });
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

  it("rejects an exact-content duplicate in the same procedimento before intake and job creation", async () => {
    mocks.findPreflightDuplicateIntake.mockResolvedValue({ neutralIntakeId: "intake-existing" });

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "2e1bf47e-9b2f-4ee8-a41a-4ea6ca4e4619" },
    }))).resolves.toEqual({ outcome: "DUPLICATE_DOCUMENT_IN_FASCICOLO" });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.createDestination).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).not.toHaveBeenCalled();
    expect(mocks.findPreflightDuplicateIntake).toHaveBeenCalledWith({
      where: {
        procedimentoId: "procedimento-1",
        neutralIntake: {
          is: {
            enteId: "ente-1",
            sha256,
            status: { not: "FAILED_EXTRACTION" },
          },
        },
      },
      select: { neutralIntakeId: true },
    });
  });

  it("rejects renamed exact bytes because filename is not part of duplicate identity", async () => {
    mocks.findPreflightDuplicateIntake.mockResolvedValue({ neutralIntakeId: "intake-existing" });

    await expect(createNeutralIntake(input({
      originalName: "renamed-copy.pdf",
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "34aa0288-feba-4757-b2e4-afd9edaa8c75" },
    }))).resolves.toEqual({ outcome: "DUPLICATE_DOCUMENT_IN_FASCICOLO" });

    expect(mocks.findPreflightDuplicateIntake.mock.calls[0][0].where).not.toHaveProperty("originalName");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["same-name-different-content", "source.pdf"],
    ["similar-concession-different-date-and-content", "concessione.pdf"],
  ])("allows %s when the exact content hash differs", async (content, originalName) => {
    const changedBody = Buffer.from(content);
    const changedSha256 = createHash("sha256").update(changedBody).digest("hex");
    mocks.createFile.mockResolvedValueOnce({
      ...stored(),
      object: {
        ...stored().object,
        storageKey: `intake/sha256/${changedSha256}`,
        fileName: changedSha256,
        sizeBytes: changedBody.length,
        sha256: changedSha256,
        originalName,
      },
    });
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ enteId: "ente-1" }));

    await expect(createNeutralIntake(input({
      body: changedBody,
      originalName,
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "dce1b95b-cc34-49f2-9729-532fe44841bc" },
    }))).resolves.toMatchObject({ outcome: "CREATED" });

    expect(mocks.findDuplicateIntake).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        procedimentoId: "procedimento-1",
        neutralIntake: { is: expect.objectContaining({ sha256: changedSha256 }) },
      }),
    }));
  });

  it("allows the same exact bytes in another procedimento", async () => {
    mocks.findPreflightDuplicateIntake.mockImplementation(async ({ where }) => (
      where.procedimentoId === "procedimento-1" ? { neutralIntakeId: "intake-existing" } : null
    ));
    mocks.findProcedimento.mockResolvedValue({ id: "procedimento-2", concessione: { enteId: "ente-1" } });
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ enteId: "ente-1" }));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-2", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "fe5d4817-800d-4500-990d-93320105e769" },
    }))).resolves.toMatchObject({ outcome: "CREATED" });

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledOnce();
  });

  it("rejects an exact hash already materialized as a routed Documento", async () => {
    mocks.findPreflightDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, {
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        sha256,
        checksumSha256: null,
        fileVersionSha256s: [],
      }) ? { id: "documento-existing" } : null
    ));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "341f318a-a86a-4bb4-985b-209590605714" },
    }))).resolves.toEqual({ outcome: "DUPLICATE_DOCUMENT_IN_FASCICOLO" });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).not.toHaveBeenCalled();
  });

  it("rejects a legacy checksum-only routed Documento before storage", async () => {
    mocks.findPreflightDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, {
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        sha256: null,
        checksumSha256: sha256,
        fileVersionSha256s: [],
      }) ? { id: "documento-legacy-checksum" } : null
    ));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "1853a30d-35c9-42e9-bf58-3fc750946da4" },
    }))).resolves.toEqual({ outcome: "DUPLICATE_DOCUMENT_IN_FASCICOLO" });

    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createDestination).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).not.toHaveBeenCalled();
  });

  it("rejects renamed bytes found only in a legacy file version before storage", async () => {
    mocks.findPreflightDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, {
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        sha256: null,
        checksumSha256: null,
        fileVersionSha256s: [sha256],
      }) ? { id: "documento-legacy-version" } : null
    ));

    await expect(createNeutralIntake(input({
      originalName: "renamed-legacy-copy.pdf",
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "17525d71-72da-4814-908e-39973cafb174" },
    }))).resolves.toEqual({ outcome: "DUPLICATE_DOCUMENT_IN_FASCICOLO" });

    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createDestination).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).not.toHaveBeenCalled();
    expect(mocks.findPreflightDuplicateDocument.mock.calls[0][0].where).not.toHaveProperty("originalName");
  });

  it("allows a routed Documento when all persisted exact hashes differ", async () => {
    const otherSha256 = createHash("sha256").update("other-routed-bytes").digest("hex");
    mocks.findPreflightDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, {
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        sha256: otherSha256,
        checksumSha256: otherSha256,
        fileVersionSha256s: [otherSha256],
      }) ? { id: "documento-other" } : null
    ));
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ enteId: "ente-1" }));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "ac3d03bc-42be-4490-ad06-d31f536ffb72" },
    }))).resolves.toMatchObject({ outcome: "CREATED" });

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledOnce();
  });

  it("allows a legacy matching file version in another procedimento", async () => {
    const legacyDocument = {
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      sha256: null,
      checksumSha256: null,
      fileVersionSha256s: [sha256],
    };
    mocks.findPreflightDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, legacyDocument) ? { id: "documento-other-fascicolo" } : null
    ));
    mocks.findDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, legacyDocument) ? { id: "documento-other-fascicolo" } : null
    ));
    mocks.findProcedimento.mockResolvedValue({ id: "procedimento-2", concessione: { enteId: "ente-1" } });
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ enteId: "ente-1" }));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-2", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "266b723a-e754-4055-a625-6f00dd37cac8" },
    }))).resolves.toMatchObject({ outcome: "CREATED" });

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledOnce();
  });

  it("rejects a legacy file-version winner during the transactional recheck", async () => {
    mocks.createFile.mockResolvedValueOnce(stored("ALREADY_EXISTS"));
    mocks.readFile.mockResolvedValueOnce({ disposition: "FOUND", body });
    mocks.findDuplicateDocument.mockImplementation(async ({ where }: { where: RoutedDocumentWhere }) => (
      matchesRoutedDocumentHash(where, {
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        sha256: null,
        checksumSha256: null,
        fileVersionSha256s: [sha256],
      }) ? { id: "documento-race-winner" } : null
    ));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "db5a5149-124a-4f18-910b-4a00baac6afd" },
    }))).resolves.toEqual({ outcome: "DUPLICATE_DOCUMENT_IN_FASCICOLO" });

    expect(mocks.createFile).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createDestination).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).not.toHaveBeenCalled();
  });

  it("allows a new operation after terminal FAILED_EXTRACTION with no usable Documento", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ enteId: "ente-1" }));

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "69954c84-e2e8-4a2b-944a-91e90cb25534" },
    }))).resolves.toMatchObject({ outcome: "CREATED" });

    expect(mocks.findPreflightDuplicateIntake).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        neutralIntake: { is: expect.objectContaining({ status: { not: "FAILED_EXTRACTION" } }) },
      }),
    }));
    expect(mocks.findDuplicateIntake).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        neutralIntake: { is: expect.objectContaining({ status: { not: "FAILED_EXTRACTION" } }) },
      }),
    }));
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
      maxAttempts: 2,
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

  it("atomically preserves an explicit typed case destination", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ enteId: "ente-1", receivedByUserId: "user-1" }));
    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      receivedByUserId: "user-1",
      destination: {
        procedimentoId: "procedimento-1",
        authoritySource: "CASE_FOLDER_UPLOAD",
      },
    }))).resolves.toMatchObject({
      destination: { procedimentoId: "procedimento-1" },
    });
    expect(mocks.createDestination).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        neutralIntakeId: "intake-1",
        procedimentoId: "procedimento-1",
        authoritySource: "CASE_FOLDER_UPLOAD",
      })],
      skipDuplicates: true,
    });
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
    mocks.findPreflightIdempotency.mockResolvedValue(record());
    await expect(createNeutralIntake(input())).resolves.toMatchObject({ outcome: "REUSED" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.findDuplicateIntake).not.toHaveBeenCalled();
    expect(mocks.findDuplicateDocument).not.toHaveBeenCalled();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledOnce();
    expect(mocks.admitAsyncJobInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logicalOperationId: "intake-1", availableAt: record().receivedAt }),
    );
  });

  it("keeps a destination-bound same-operation retry distinct from a new content duplicate", async () => {
    const existing = record({ enteId: "ente-1", receivedByUserId: "actor-1" });
    mocks.createFile.mockResolvedValueOnce(stored("ALREADY_EXISTS"));
    mocks.readFile.mockResolvedValueOnce({ disposition: "FOUND", body });
    mocks.findPreflightIdempotency.mockResolvedValue(existing);
    mocks.findUnique.mockResolvedValue(existing);
    mocks.findDestination.mockResolvedValue({
      neutralIntakeId: existing.id,
      procedimentoId: "procedimento-1",
      contractVersion: "B2C9_NEUTRAL_INTAKE_DESTINATION_V1",
    });

    await expect(createNeutralIntake(input({
      enteId: "ente-1",
      receivedByUserId: "actor-1",
      destination: { procedimentoId: "procedimento-1", authoritySource: "CASE_FOLDER_UPLOAD" },
      idempotencyAnchor: { type: "OPERATION_ID", value: "2e1bf47e-9b2f-4ee8-a41a-4ea6ca4e4619" },
    }))).resolves.toMatchObject({ outcome: "REUSED" });

    expect(mocks.findPreflightDuplicateIntake).not.toHaveBeenCalled();
    expect(mocks.findDuplicateIntake).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
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
