import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_STORAGE_ROOT = path.join(process.cwd(), ".local-storage", "documents");

function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base.length > 0 ? base : "documento";
}

function getStorageRoot(): string {
  const configured = process.env.DOCUMENT_STORAGE_ROOT?.trim();
  if (!configured) {
    return DEFAULT_STORAGE_ROOT;
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }

  return path.join(process.cwd(), configured);
}

export function getDocumentStorageRoot(): string {
  return getStorageRoot();
}

export async function ensureDocumentStorageRoot(): Promise<void> {
  await fs.mkdir(getStorageRoot(), { recursive: true });
}

function buildStorageFileName(documentId: string, originalName: string): string {
  const safeOriginal = sanitizeFileName(originalName);
  return `${documentId}-${safeOriginal}`;
}

function assertInsideStorageRoot(candidatePath: string): void {
  const root = path.resolve(getStorageRoot());
  const absolute = path.resolve(candidatePath);

  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new Error("Percorso storage documento non valido.");
  }
}

export interface StoredFileInfo {
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export async function storeDocumentFile(input: {
  documentId: string;
  file: File;
}): Promise<StoredFileInfo> {
  await ensureDocumentStorageRoot();

  const fileName = buildStorageFileName(input.documentId, input.file.name);
  const absolutePath = path.join(getStorageRoot(), fileName);
  assertInsideStorageRoot(absolutePath);

  const arrayBuffer = await input.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  await fs.writeFile(absolutePath, buffer);

  return {
    storagePath: fileName,
    fileName,
    mimeType: input.file.type,
    size: input.file.size,
    sha256,
  };
}

export function resolveStoredDocumentAbsolutePath(storagePath: string): string {
  const normalized = storagePath.trim();
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error("Storage path documento non valido.");
  }

  const absolutePath = path.join(getStorageRoot(), normalized);
  assertInsideStorageRoot(absolutePath);
  return absolutePath;
}

export async function readStoredDocument(storagePath: string): Promise<Buffer> {
  const absolutePath = resolveStoredDocumentAbsolutePath(storagePath);
  return fs.readFile(absolutePath);
}
