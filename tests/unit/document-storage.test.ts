import { promises as fs } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { getDocumentStorageBackend } from "@/server/documents/storage/config";
import { LocalStorageAdapter } from "@/server/documents/storage/localStorageAdapter";
import { S3StorageAdapter } from "@/server/documents/storage/s3StorageAdapter";
import {
  createDocumentFileIfAbsent,
  deleteDocumentFile,
  getDocumentStorageAdapter,
  readDocumentFileFromProvider,
  readStoredDocument,
  resetDocumentStorageAdapterForTests,
  storeDocumentFile,
  storeDocumentFileAtKey,
  storedDocumentExists,
} from "@/server/documents/storage";
import {
  DocumentStorageReadCoherenceError,
  DocumentStorageReadUnavailableError,
  type DocumentStorageCreateResult,
} from "@/server/documents/storage/types";

const originalEnv = { ...process.env };

async function withTempStorageRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cp-storage-unit-"));
}

afterEach(async () => {
  process.env = { ...originalEnv };
  resetDocumentStorageAdapterForTests();
});

describe("document storage config", () => {
  it("defaults to local backend", () => {
    delete process.env.DOCUMENT_STORAGE_BACKEND;

    expect(getDocumentStorageBackend()).toBe("local");
  });

  it("throws explicit error when s3 backend is selected without credentials", () => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "";
    process.env.S3_REGION = "";
    process.env.S3_BUCKET = "";
    process.env.S3_ACCESS_KEY_ID = "";
    process.env.S3_SECRET_ACCESS_KEY = "";

    expect(() => getDocumentStorageAdapter()).toThrow(/DOCUMENT_STORAGE_BACKEND=s3/i);
  });
});

describe("local storage adapter", () => {
  it("reads a found object once and returns its Buffer", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_ROOT = root;
    await writeFile(path.join(root, "found.txt"), "found-content");
    const readFileSpy = vi.spyOn(fs, "readFile");

    const result = await new LocalStorageAdapter().read("found.txt");

    expect(result).toEqual({ disposition: "FOUND", body: Buffer.from("found-content") });
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
  });

  it("maps only ENOENT to MISSING", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_ROOT = root;

    await expect(new LocalStorageAdapter().read("missing.txt")).resolves.toEqual({ disposition: "MISSING" });
    await rm(root, { recursive: true, force: true });
  });

  it("maps filesystem access failures to unavailable rather than MISSING", async () => {
    const readFailure = Object.assign(new Error("access denied"), { code: "EACCES" });
    vi.spyOn(fs, "readFile").mockRejectedValueOnce(readFailure);

    await expect(new LocalStorageAdapter().read("protected.txt")).rejects.toMatchObject({
      name: "DocumentStorageReadUnavailableError",
      provider: "local",
      code: "EACCES",
      cause: readFailure,
    });
  });

  it("preserves invalid locator rejection without attempting a filesystem read", async () => {
    const readFileSpy = vi.spyOn(fs, "readFile");
    readFileSpy.mockClear();

    await expect(new LocalStorageAdapter().read("../outside.txt")).rejects.toThrow(
      "Storage key documento non valido.",
    );
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("supports put/get/delete/exists", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_ROOT = root;

    const adapter = new LocalStorageAdapter();
    const body = Buffer.from("storage-adapter-local-test");

    const stored = await adapter.put({
      storageKey: "doc/one.txt",
      body,
      mimeType: "text/plain",
      originalName: "one.txt",
      sha256: "abc",
      sizeBytes: body.length,
    });

    expect(stored.storageProvider).toBe("local");
    expect(await adapter.exists("doc/one.txt")).toBe(true);

    const loaded = await adapter.get("doc/one.txt");
    expect(loaded.body.toString("utf8")).toBe("storage-adapter-local-test");

    await adapter.delete("doc/one.txt");
    expect(await adapter.exists("doc/one.txt")).toBe(false);

    await rm(root, { recursive: true, force: true });
  });

  it("computes SHA-256 and persists document via storage service", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    process.env.DOCUMENT_STORAGE_ROOT = root;

    const file = new File(["hash-check-content"], "hash-test.txt", { type: "text/plain" });
    const stored = await storeDocumentFile({ documentId: "doc-test", file });

    expect(stored.sha256).toHaveLength(64);
    expect(stored.storageProvider).toBe("local");
    expect(await storedDocumentExists(stored.storageKey)).toBe(true);

    const loaded = await readStoredDocument(stored.storageKey);
    expect(loaded.toString("utf8")).toBe("hash-check-content");

    await rm(root, { recursive: true, force: true });
  });

  it("stores at a caller-supplied deterministic key and deletes that exact object", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    process.env.DOCUMENT_STORAGE_ROOT = root;
    const storageKey = `documents/ente-1/${"a".repeat(32)}/${"b".repeat(64)}`;
    const file = new File(["deterministic-content"], "ignored-name.txt", { type: "text/plain" });

    const stored = await storeDocumentFileAtKey({ storageKey, file });

    expect(stored.storageKey).toBe(storageKey);
    expect(stored.sha256).toHaveLength(64);
    expect(await storedDocumentExists(storageKey)).toBe(true);

    await deleteDocumentFile(storageKey);
    expect(await storedDocumentExists(storageKey)).toBe(false);

    await rm(root, { recursive: true, force: true });
  });

  it("creates a missing object exclusively and returns an ownership receipt", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    process.env.DOCUMENT_STORAGE_ROOT = root;
    const body = Buffer.from("first-content");

    const result = await createDocumentFileIfAbsent({
      storageKey: "doc/exclusive.txt",
      body,
      mimeType: "text/plain",
      originalName: "exclusive.txt",
      sha256: "a".repeat(64),
      sizeBytes: body.length,
    });

    expect(result).toMatchObject({ disposition: "CREATED", ownedByAttempt: true });
    if (result.disposition === "CREATED") {
      expectTypeOf(result.ownedByAttempt).toEqualTypeOf<true>();
    }
    expectTypeOf<DocumentStorageCreateResult>().toEqualTypeOf<
      | { disposition: "CREATED"; object: typeof result.object; ownedByAttempt: true }
      | { disposition: "ALREADY_EXISTS"; object: typeof result.object; ownedByAttempt: false }
    >();

    await rm(root, { recursive: true, force: true });
  });

  it("returns ALREADY_EXISTS without reading, overwriting, or prechecking the object", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_ROOT = root;
    const adapter = new LocalStorageAdapter();
    const firstBody = Buffer.from("first-content");
    const secondBody = Buffer.from("second-content");
    const existsSpy = vi.spyOn(adapter, "exists");
    const input = {
      storageKey: "doc/exclusive.txt",
      mimeType: "text/plain",
      originalName: "exclusive.txt",
      sha256: "a".repeat(64),
    };

    await expect(adapter.createIfAbsent({ ...input, body: firstBody, sizeBytes: firstBody.length })).resolves.toMatchObject({
      disposition: "CREATED",
      ownedByAttempt: true,
    });
    await expect(adapter.createIfAbsent({ ...input, body: secondBody, sizeBytes: secondBody.length })).resolves.toMatchObject({
      disposition: "ALREADY_EXISTS",
      ownedByAttempt: false,
    });
    expect(existsSpy).not.toHaveBeenCalled();
    expect((await adapter.get(input.storageKey)).body.toString("utf8")).toBe("first-content");

    await rm(root, { recursive: true, force: true });
  });

  it("propagates non-EEXIST filesystem errors", async () => {
    const root = await withTempStorageRoot();
    const rootFile = path.join(root, "not-a-directory");
    await writeFile(rootFile, "content");
    process.env.DOCUMENT_STORAGE_ROOT = rootFile;
    const adapter = new LocalStorageAdapter();
    const body = Buffer.from("content");

    await expect(adapter.createIfAbsent({
      storageKey: "doc/file.txt",
      body,
      mimeType: "text/plain",
      originalName: "file.txt",
      sha256: "a".repeat(64),
      sizeBytes: body.length,
    })).rejects.toMatchObject({ code: expect.not.stringMatching(/^EEXIST$/) });

    await rm(root, { recursive: true, force: true });
  });

  it("preserves the existing unconditional put overwrite behavior", async () => {
    const root = await withTempStorageRoot();
    process.env.DOCUMENT_STORAGE_ROOT = root;
    const adapter = new LocalStorageAdapter();
    const input = {
      storageKey: "doc/unconditional.txt",
      mimeType: "text/plain",
      originalName: "unconditional.txt",
      sha256: "a".repeat(64),
    };

    await adapter.put({ ...input, body: Buffer.from("first"), sizeBytes: 5 });
    await adapter.put({ ...input, body: Buffer.from("second"), sizeBytes: 6 });

    expect((await adapter.get(input.storageKey)).body.toString("utf8")).toBe("second");
    await rm(root, { recursive: true, force: true });
  });
});

describe("provider-aware normalized storage read facade", () => {
  it("routes local and s3 reads only to the explicitly coherent provider", async () => {
    const localRead = vi.spyOn(LocalStorageAdapter.prototype, "read").mockResolvedValue({
      disposition: "FOUND",
      body: Buffer.from("local"),
    });
    const s3Read = vi.spyOn(S3StorageAdapter.prototype, "read").mockResolvedValue({
      disposition: "FOUND",
      body: Buffer.from("s3"),
    });

    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    await expect(readDocumentFileFromProvider({
      storageProvider: "local",
      storageKey: "doc/local.txt",
    })).resolves.toMatchObject({ disposition: "FOUND", body: Buffer.from("local") });
    expect(localRead).toHaveBeenCalledTimes(1);
    expect(s3Read).not.toHaveBeenCalled();

    resetDocumentStorageAdapterForTests();
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://example.invalid";
    process.env.S3_REGION = "auto";
    process.env.S3_BUCKET = "demo";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    await expect(readDocumentFileFromProvider({
      storageProvider: "s3",
      storageKey: "doc/s3.txt",
      storageBucket: "demo",
    })).resolves.toMatchObject({ disposition: "FOUND", body: Buffer.from("s3") });
    expect(s3Read).toHaveBeenCalledTimes(1);
    expect(localRead).toHaveBeenCalledTimes(1);
  });

  it("rejects provider mismatch before either adapter reads", async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    const localRead = vi.spyOn(LocalStorageAdapter.prototype, "read");
    const s3Read = vi.spyOn(S3StorageAdapter.prototype, "read");
    localRead.mockClear();
    s3Read.mockClear();

    await expect(readDocumentFileFromProvider({
      storageProvider: "s3",
      storageKey: "doc/file.txt",
      storageBucket: "demo",
    })).rejects.toMatchObject({ code: "PROVIDER_MISMATCH" });
    expect(localRead).not.toHaveBeenCalled();
    expect(s3Read).not.toHaveBeenCalled();
  });

  it("rejects an authoritative S3 bucket mismatch before GET", async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://example.invalid";
    process.env.S3_REGION = "auto";
    process.env.S3_BUCKET = "configured-bucket";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    const s3Read = vi.spyOn(S3StorageAdapter.prototype, "read");
    s3Read.mockClear();

    await expect(readDocumentFileFromProvider({
      storageProvider: "s3",
      storageKey: "doc/file.txt",
      storageBucket: "manifest-bucket",
    })).rejects.toBeInstanceOf(DocumentStorageReadCoherenceError);
    expect(s3Read).not.toHaveBeenCalled();
  });

  it("exposes unavailable reads as a typed internal error", () => {
    expect(new DocumentStorageReadUnavailableError({ provider: "local", code: "EIO" })).toMatchObject({
      provider: "local",
      code: "EIO",
    });
  });
});
