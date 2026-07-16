import { promises as fs } from "node:fs";
import path from "node:path";

import { getDocumentStorageRoot } from "./config";
import type { DocumentStorageAdapter, DocumentStorageGetOutput, DocumentStoragePutInput, StoredDocumentObject } from "./types";

function assertSafeStorageKey(storageKey: string): string {
  const normalized = storageKey.trim();

  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error("Storage key documento non valido.");
  }

  return normalized;
}

async function resolveAbsolutePath(storageKey: string): Promise<string> {
  const safeKey = assertSafeStorageKey(storageKey);
  const root = path.resolve(getDocumentStorageRoot());
  const absolute = path.resolve(path.join(root, safeKey));

  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new Error("Percorso storage documento non valido.");
  }

  return absolute;
}

export class LocalStorageAdapter implements DocumentStorageAdapter {
  async put(input: DocumentStoragePutInput): Promise<StoredDocumentObject> {
    const absolutePath = await resolveAbsolutePath(input.storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.body);

    return {
      storageProvider: "local",
      storageKey: input.storageKey,
      fileName: path.basename(input.storageKey),
      bucket: null,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      mimeType: input.mimeType,
      originalName: input.originalName,
    };
  }

  async get(storageKey: string): Promise<DocumentStorageGetOutput> {
    const absolutePath = await resolveAbsolutePath(storageKey);
    const body = await fs.readFile(absolutePath);

    return { body };
  }

  async delete(storageKey: string): Promise<void> {
    const absolutePath = await resolveAbsolutePath(storageKey);
    await fs.rm(absolutePath, { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    const absolutePath = await resolveAbsolutePath(storageKey);

    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}
