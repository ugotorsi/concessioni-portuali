import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { getDocumentStorageBackend } from "@/server/documents/storage/config";
import { LocalStorageAdapter } from "@/server/documents/storage/localStorageAdapter";
import {
  createDocumentFileIfAbsent,
  deleteDocumentFile,
  getDocumentStorageAdapter,
  readStoredDocument,
  resetDocumentStorageAdapterForTests,
  storeDocumentFile,
  storeDocumentFileAtKey,
  storedDocumentExists,
} from "@/server/documents/storage";
import type { DocumentStorageCreateResult } from "@/server/documents/storage/types";

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
