import { createHash } from "node:crypto";

import { getDocumentStorageBackend } from "./config";
import { LocalStorageAdapter } from "./localStorageAdapter";
import { S3StorageAdapter } from "./s3StorageAdapter";
import type { DocumentStorageAdapter, DocumentStorageBackend, StoredDocumentObject } from "./types";

function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base.length > 0 ? base : "documento";
}

function buildStorageKey(documentId: string, originalName: string): string {
  const now = Date.now();
  return `${documentId}/${now}-${sanitizeFileName(originalName)}`;
}

let adapter: DocumentStorageAdapter | null = null;

export function getDocumentStorageAdapter(): DocumentStorageAdapter {
  if (adapter) {
    return adapter;
  }

  const backend = getDocumentStorageBackend();
  adapter = backend === "s3" ? new S3StorageAdapter() : new LocalStorageAdapter();
  return adapter;
}

export function getActiveDocumentStorageBackend(): DocumentStorageBackend {
  return getDocumentStorageBackend();
}

export function resetDocumentStorageAdapterForTests(): void {
  adapter = null;
}

export async function storeDocumentFile(input: {
  documentId: string;
  file: File;
}): Promise<StoredDocumentObject> {
  const storage = getDocumentStorageAdapter();
  const arrayBuffer = await input.file.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const storageKey = buildStorageKey(input.documentId, input.file.name);

  return storage.put({
    storageKey,
    body,
    mimeType: input.file.type || "application/octet-stream",
    originalName: input.file.name,
    sha256,
    sizeBytes: input.file.size,
  });
}

export async function readStoredDocument(storageKey: string): Promise<Buffer> {
  const storage = getDocumentStorageAdapter();
  const result = await storage.get(storageKey);
  return result.body;
}

export async function storedDocumentExists(storageKey: string): Promise<boolean> {
  const storage = getDocumentStorageAdapter();
  return storage.exists(storageKey);
}
