const DEFAULT_STORAGE_ROOT = ".local-storage/documents";

async function getFsModule() {
  return import("node:fs/promises");
}

async function getPathModule() {
  return import("node:path");
}

async function getCryptoModule() {
  return import("node:crypto");
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base.length > 0 ? base : "documento";
}

async function getStorageRoot(): Promise<string> {
  const path = await getPathModule();
  const configured = process.env.DOCUMENT_STORAGE_ROOT?.trim();
  if (!configured) {
    return DEFAULT_STORAGE_ROOT;
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }

  return configured;
}

export function getDocumentStorageRoot(): string {
  return process.env.DOCUMENT_STORAGE_ROOT?.trim() || DEFAULT_STORAGE_ROOT;
}

export async function ensureDocumentStorageRoot(): Promise<void> {
  const fs = await getFsModule();
  await fs.mkdir(await getStorageRoot(), { recursive: true });
}

function buildStorageFileName(documentId: string, originalName: string): string {
  const safeOriginal = sanitizeFileName(originalName);
  return `${documentId}-${safeOriginal}`;
}

async function assertInsideStorageRoot(candidatePath: string): Promise<void> {
  const path = await getPathModule();
  const root = path.resolve(await getStorageRoot());
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
  const path = await getPathModule();
  const fs = await getFsModule();
  const { createHash } = await getCryptoModule();

  await ensureDocumentStorageRoot();

  const fileName = buildStorageFileName(input.documentId, input.file.name);
  const absolutePath = path.join(await getStorageRoot(), fileName);
  await assertInsideStorageRoot(absolutePath);

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

export async function resolveStoredDocumentAbsolutePath(storagePath: string): Promise<string> {
  const path = await getPathModule();
  const normalized = storagePath.trim();
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error("Storage path documento non valido.");
  }

  const absolutePath = path.join(await getStorageRoot(), normalized);
  await assertInsideStorageRoot(absolutePath);
  return absolutePath;
}

export async function readStoredDocument(storagePath: string): Promise<Buffer> {
  const fs = await getFsModule();
  const absolutePath = await resolveStoredDocumentAbsolutePath(storagePath);
  return fs.readFile(absolutePath);
}
