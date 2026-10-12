import { promises as fs } from "node:fs";
import path from "node:path";

import { getDocumentStorageRoot } from "./config";
import type {
  DocumentStorageAdapter,
  DocumentStorageCreateResult,
  DocumentStorageGetOutput,
  DocumentStoragePutInput,
  DocumentStorageReadResult,
  StoredDocumentObject,
} from "./types";
import { DocumentStorageReadLimitError, DocumentStorageReadUnavailableError } from "./types";

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

function storedObject(input: DocumentStoragePutInput): StoredDocumentObject {
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

export class LocalStorageAdapter implements DocumentStorageAdapter {
  async put(input: DocumentStoragePutInput): Promise<StoredDocumentObject> {
    const absolutePath = await resolveAbsolutePath(input.storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.body);

    return storedObject(input);
  }

  async createIfAbsent(input: DocumentStoragePutInput): Promise<DocumentStorageCreateResult> {
    const absolutePath = await resolveAbsolutePath(input.storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await fs.writeFile(absolutePath, input.body, { flag: "wx" });
      return { disposition: "CREATED", object: storedObject(input), ownedByAttempt: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return { disposition: "ALREADY_EXISTS", object: storedObject(input), ownedByAttempt: false };
      }
      throw error;
    }
  }

  async get(storageKey: string): Promise<DocumentStorageGetOutput> {
    const absolutePath = await resolveAbsolutePath(storageKey);
    const body = await fs.readFile(absolutePath);

    return { body };
  }

  async read(storageKey: string): Promise<DocumentStorageReadResult> {
    const absolutePath = await resolveAbsolutePath(storageKey);

    try {
      return { disposition: "FOUND", body: await fs.readFile(absolutePath) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN_FILESYSTEM_ERROR";
      if (code === "ENOENT") {
        return { disposition: "MISSING" };
      }
      throw new DocumentStorageReadUnavailableError({ provider: "local", code, cause: error });
    }
  }

  async readBounded(storageKey: string, maxBytes: number): Promise<DocumentStorageReadResult> {
    const absolutePath = await resolveAbsolutePath(storageKey);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError("Document storage byte limit must be a positive safe integer.");
    }

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(absolutePath, "r");
      const metadata = await handle.stat();
      if (metadata.size > maxBytes) {
        throw new DocumentStorageReadLimitError({ maxBytes, observedBytes: metadata.size });
      }
      const body = Buffer.alloc(metadata.size);
      let offset = 0;
      while (offset < body.length) {
        const result = await handle.read(body, offset, body.length - offset, offset);
        if (result.bytesRead === 0) {
          break;
        }
        offset += result.bytesRead;
      }
      if (offset !== metadata.size) {
        throw new DocumentStorageReadUnavailableError({ provider: "local", code: "SHORT_READ" });
      }
      return { disposition: "FOUND", body };
    } catch (error) {
      if (error instanceof DocumentStorageReadLimitError || error instanceof DocumentStorageReadUnavailableError) {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN_FILESYSTEM_ERROR";
      if (code === "ENOENT") {
        return { disposition: "MISSING" };
      }
      throw new DocumentStorageReadUnavailableError({ provider: "local", code, cause: error });
    } finally {
      await handle?.close();
    }
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
