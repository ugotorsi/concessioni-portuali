import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDocumentStorageBackend } from "@/server/documents/storage/config";
import { LocalStorageAdapter } from "@/server/documents/storage/localStorageAdapter";
import {
  getDocumentStorageAdapter,
  readStoredDocument,
  resetDocumentStorageAdapterForTests,
  storeDocumentFile,
  storedDocumentExists,
} from "@/server/documents/storage";

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
});
