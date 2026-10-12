import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const fileVersionMock = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { documentFileVersion: fileVersionMock },
}));

import {
  createSourceFileVersion,
  createSourceFileVersionInTransaction,
  getSourceFileVersionById,
  reconcileSourceFileVersionIdentityRaceAfterRollback,
  SourceFileVersionConflictError,
} from "@/server/documents/sourceFileVersion";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function input(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "document-1",
    canonicalEnteId: "ente-1",
    storageProvider: "s3" as const,
    storageKey: "documents/ente-1/document-1/a",
    storageBucket: "documents",
    mimeType: "application/pdf",
    sizeBytes: 42,
    sha256: hashA,
    createdByUserId: "user-1",
    createdByActorId: "actor-1",
    createdByRole: "ADMIN",
    ...overrides,
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    ...input(),
    createdAt: new Date("2026-09-02T00:00:00.000Z"),
    ...overrides,
  };
}

function p2002(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "DocumentFileVersion", target },
  });
}

const transactionClient = {
  documentFileVersion: fileVersionMock,
} as unknown as Prisma.TransactionClient;

describe("B2C9C1A2A transaction-compatible source file version primitives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileVersionMock.findUnique.mockResolvedValue(null);
    fileVersionMock.create.mockImplementation(async ({ data }) => version(data));
  });

  it("reuses an exact existing manifest through the transaction client", async () => {
    fileVersionMock.findUnique.mockResolvedValue(version());
    await expect(createSourceFileVersionInTransaction(transactionClient, input())).resolves.toMatchObject({
      outcome: "REUSED",
      version: { id: "version-1" },
    });
    expect(fileVersionMock.create).not.toHaveBeenCalled();
  });

  it("fails closed for an incoherent existing manifest through the transaction client", async () => {
    fileVersionMock.findUnique.mockResolvedValue(version({ storageKey: "documents/other" }));
    await expect(createSourceFileVersionInTransaction(transactionClient, input())).rejects.toBeInstanceOf(
      SourceFileVersionConflictError,
    );
  });

  it("creates a new manifest through the transaction client", async () => {
    await expect(createSourceFileVersionInTransaction(transactionClient, input())).resolves.toMatchObject({
      outcome: "CREATED",
      version: { id: "version-1" },
    });
    expect(fileVersionMock.create).toHaveBeenCalledTimes(1);
  });

  it("propagates identity P2002 without querying the failed transaction again", async () => {
    const failure = p2002(["documentId", "sha256"]);
    const events: string[] = [];
    fileVersionMock.findUnique.mockImplementation(async () => {
      events.push("findUnique");
      return null;
    });
    fileVersionMock.create.mockImplementation(async () => {
      events.push("create");
      throw failure;
    });

    await expect(createSourceFileVersionInTransaction(transactionClient, input())).rejects.toBe(failure);
    expect(fileVersionMock.findUnique).toHaveBeenCalledTimes(1);
    expect(fileVersionMock.create).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["findUnique", "create"]);
  });

  it("propagates locator P2002 and non-P2002 without a post-error query", async () => {
    const locatorFailure = p2002(["storageProvider", "storageKey"]);
    fileVersionMock.create.mockRejectedValueOnce(locatorFailure);
    await expect(createSourceFileVersionInTransaction(transactionClient, input())).rejects.toBe(locatorFailure);
    expect(fileVersionMock.findUnique).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    const runtimeFailure = new Error("database unavailable");
    fileVersionMock.findUnique.mockResolvedValue(null);
    fileVersionMock.create.mockRejectedValue(runtimeFailure);
    await expect(createSourceFileVersionInTransaction(transactionClient, input())).rejects.toBe(runtimeFailure);
    expect(fileVersionMock.findUnique).toHaveBeenCalledTimes(1);
  });

  it("reconciles an exact identity race with a fresh global lookup and preserves provenance", async () => {
    const original = version();
    fileVersionMock.findUnique.mockResolvedValue(original);
    const result = await reconcileSourceFileVersionIdentityRaceAfterRollback(input({
      createdByUserId: "user-2",
      createdByActorId: "actor-2",
      createdByRole: "GIURIDICO",
    }), p2002(["documentId", "sha256"]));
    expect(result).toEqual({ outcome: "REUSED", version: original });
    expect(result.version).toMatchObject({
      createdByUserId: "user-1",
      createdByActorId: "actor-1",
      createdByRole: "ADMIN",
    });
  });

  it("fails closed when fresh identity reconciliation finds an incoherent manifest", async () => {
    fileVersionMock.findUnique.mockResolvedValue(version({ sizeBytes: 43 }));
    await expect(reconcileSourceFileVersionIdentityRaceAfterRollback(
      input(),
      p2002("DocumentFileVersion_documentId_sha256_key"),
    )).rejects.toBeInstanceOf(SourceFileVersionConflictError);
  });

  it("propagates the original identity error when fresh reconciliation finds no record", async () => {
    const failure = p2002(["documentId", "sha256"]);
    await expect(reconcileSourceFileVersionIdentityRaceAfterRollback(input(), failure)).rejects.toBe(failure);
  });

  it("does not reconcile locator P2002 or other errors", async () => {
    const locatorFailure = p2002(["storageProvider", "storageKey"]);
    await expect(reconcileSourceFileVersionIdentityRaceAfterRollback(input(), locatorFailure)).rejects.toBe(
      locatorFailure,
    );
    expect(fileVersionMock.findUnique).not.toHaveBeenCalled();

    const runtimeFailure = new Error("database unavailable");
    await expect(reconcileSourceFileVersionIdentityRaceAfterRollback(input(), runtimeFailure)).rejects.toBe(
      runtimeFailure,
    );
    expect(fileVersionMock.findUnique).not.toHaveBeenCalled();
  });
});

describe("B2C9C1A1 source file version repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileVersionMock.findUnique.mockResolvedValue(null);
    fileVersionMock.create.mockImplementation(async ({ data }) => version(data));
  });

  it("creates a valid immutable manifest", async () => {
    await expect(createSourceFileVersion(input())).resolves.toMatchObject({ outcome: "CREATED" });
    expect(fileVersionMock.create).toHaveBeenCalledWith({ data: expect.objectContaining(input()) });
  });

  it("normalizes uppercase SHA-256 and MIME type", async () => {
    await createSourceFileVersion(input({ sha256: hashA.toUpperCase(), mimeType: "APPLICATION/PDF" }));
    expect(fileVersionMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sha256: hashA, mimeType: "application/pdf" }),
    });
  });

  it.each([
    ["invalid SHA", { sha256: "invalid" }],
    ["blank storage key", { storageKey: "  " }],
    ["unsupported provider", { storageProvider: "azure" }],
    ["zero size", { sizeBytes: 0 }],
    ["negative size", { sizeBytes: -1 }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(createSourceFileVersion(input(overrides))).rejects.toThrow();
    expect(fileVersionMock.create).not.toHaveBeenCalled();
  });

  it("reuses the exact same document and hash without creating a duplicate", async () => {
    fileVersionMock.findUnique.mockResolvedValue(version());
    await expect(createSourceFileVersion(input())).resolves.toMatchObject({ outcome: "REUSED", version: { id: "version-1" } });
    expect(fileVersionMock.create).not.toHaveBeenCalled();
  });

  it("reuses a coherent physical manifest without replacing its original provenance", async () => {
    const original = version();
    fileVersionMock.findUnique.mockResolvedValue(original);
    const result = await createSourceFileVersion(input({
      createdByUserId: "user-2",
      createdByActorId: "actor-2",
      createdByRole: "OPERATORE_DOCUMENTALE",
    }));
    expect(result).toEqual({ outcome: "REUSED", version: original });
    expect(result.version).toMatchObject({
      createdByUserId: "user-1",
      createdByActorId: "actor-1",
      createdByRole: "ADMIN",
    });
    expect(fileVersionMock).not.toHaveProperty("update");
  });

  it.each([
    ["size", { sizeBytes: 43 }],
    ["locator", { storageKey: "documents/other" }],
    ["tenant", { canonicalEnteId: "ente-2" }],
    ["provider", { storageProvider: "local" }],
    ["bucket", { storageBucket: "other-bucket" }],
    ["MIME type", { mimeType: "text/plain" }],
  ])("fails closed when the same document/hash has different %s", async (_label, overrides) => {
    fileVersionMock.findUnique.mockResolvedValue(version());
    await expect(createSourceFileVersion(input(overrides))).rejects.toBeInstanceOf(SourceFileVersionConflictError);
    expect(fileVersionMock.create).not.toHaveBeenCalled();
  });

  it("allows different hashes for one document and the same hash for distinct documents or tenants", async () => {
    await createSourceFileVersion(input({ sha256: hashA }));
    await createSourceFileVersion(input({ sha256: hashB, storageKey: "documents/version-b" }));
    await createSourceFileVersion(input({ documentId: "document-2", storageKey: "documents/document-2" }));
    await createSourceFileVersion(input({ documentId: "document-3", canonicalEnteId: "ente-2", storageKey: "documents/ente-2/document-3" }));
    expect(fileVersionMock.create).toHaveBeenCalledTimes(4);
  });

  it("recovers an exact P2002 identity race but never mutates the existing row", async () => {
    fileVersionMock.create.mockRejectedValue(p2002(["documentId", "sha256"]));
    fileVersionMock.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(version());
    await expect(createSourceFileVersion(input())).resolves.toMatchObject({ outcome: "REUSED" });
    expect(fileVersionMock).not.toHaveProperty("update");
    expect(fileVersionMock).not.toHaveProperty("delete");
  });

  it("fails closed when a P2002 identity race resolves to a conflicting manifest", async () => {
    fileVersionMock.create.mockRejectedValue(p2002("DocumentFileVersion_documentId_sha256_key"));
    fileVersionMock.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(version({ sizeBytes: 43 }));
    await expect(createSourceFileVersion(input())).rejects.toBeInstanceOf(SourceFileVersionConflictError);
  });

  it("propagates non-P2002 failures without a recovery reread", async () => {
    const failure = new Error("database unavailable");
    fileVersionMock.create.mockRejectedValue(failure);
    await expect(createSourceFileVersion(input())).rejects.toBe(failure);
    expect(fileVersionMock.findUnique).toHaveBeenCalledTimes(1);
  });

  it("propagates P2002 on another unique constraint without a recovery reread", async () => {
    const failure = p2002(["storageProvider", "storageKey"]);
    fileVersionMock.create.mockRejectedValue(failure);
    await expect(createSourceFileVersion(input())).rejects.toBe(failure);
    expect(fileVersionMock.findUnique).toHaveBeenCalledTimes(1);
  });

  it("reads by validated version id", async () => {
    fileVersionMock.findUnique.mockResolvedValue(version());
    await expect(getSourceFileVersionById(" version-1 ")).resolves.toMatchObject({ id: "version-1" });
    expect(fileVersionMock.findUnique).toHaveBeenCalledWith({ where: { id: "version-1" } });
  });
});

describe("B2C9C1A1 schema and migration invariants", () => {
  const root = process.cwd();
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const migration = readFileSync(
    path.join(root, "prisma/migrations/20260902_document_file_version/migration.sql"),
    "utf8",
  );

  it("keeps the pointer nullable and enforces same-document and same-tenant coherence", () => {
    expect(schema).toContain("currentFileVersionId      String?             @unique");
    expect(migration).toContain('FOREIGN KEY ("currentFileVersionId", "id", "enteId")');
    expect(migration).toContain('REFERENCES "DocumentFileVersion"("id", "documentId", "canonicalEnteId")');
    expect(migration).toContain('CHECK ("currentFileVersionId" IS NULL OR "enteId" IS NOT NULL)');
  });

  it("enforces identity, locator, hash, size and provider constraints", () => {
    expect(migration).toContain('("documentId", "sha256")');
    expect(migration).toContain('("storageProvider", "storageKey")');
    expect(migration).toContain("^[0-9a-f]{64}$");
    expect(migration).toContain('CHECK ("sizeBytes" > 0)');
    expect(migration).toContain("CHECK (\"storageProvider\" IN ('local', 's3'))");
  });

  it("makes committed versions append-only and restricts parent deletion", () => {
    expect(migration).toContain('BEFORE UPDATE ON "DocumentFileVersion"');
    expect(migration).toContain('BEFORE DELETE ON "DocumentFileVersion"');
    expect(migration.match(/ON DELETE RESTRICT/g)?.length).toBeGreaterThanOrEqual(3);
    expect(schema).not.toContain("extractionStatus");
  });

  it("restricts deletion of the recorded creator without weakening immutability", () => {
    const creatorForeignKey = migration.match(
      /ALTER TABLE "DocumentFileVersion" ADD CONSTRAINT "DocumentFileVersion_createdByUserId_fkey"[^;]+;/,
    )?.[0];
    expect(creatorForeignKey).toContain('REFERENCES "User"("id") ON DELETE RESTRICT');
    expect(creatorForeignKey).not.toContain("ON DELETE SET NULL");
  });

  it("is additive and performs no backfill", () => {
    expect(migration).toContain('ADD COLUMN "currentFileVersionId" TEXT');
    expect(migration).not.toMatch(/UPDATE\s+"Documento"/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"DocumentFileVersion"/i);
  });
});