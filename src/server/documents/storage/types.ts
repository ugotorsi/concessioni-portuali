export type DocumentStorageBackend = "local" | "s3";

export interface DocumentStoragePutInput {
  storageKey: string;
  body: Buffer;
  mimeType: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
}

export interface DocumentStorageGetOutput {
  body: Buffer;
}

export type DocumentStorageReadResult =
  | { disposition: "FOUND"; body: Buffer }
  | { disposition: "MISSING" };

export class DocumentStorageReadUnavailableError extends Error {
  readonly provider: DocumentStorageBackend;
  readonly code: string;
  readonly statusCode?: number;

  constructor(input: {
    provider: DocumentStorageBackend;
    code: string;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(`Document storage ${input.provider} read unavailable (${input.code}).`, { cause: input.cause });
    this.name = "DocumentStorageReadUnavailableError";
    this.provider = input.provider;
    this.code = input.code;
    this.statusCode = input.statusCode;
  }
}

export class DocumentStorageReadCoherenceError extends Error {
  readonly code: "PROVIDER_MISMATCH" | "BUCKET_MISMATCH";

  constructor(code: "PROVIDER_MISMATCH" | "BUCKET_MISMATCH") {
    super(`Document storage read coherence failed (${code}).`);
    this.name = "DocumentStorageReadCoherenceError";
    this.code = code;
  }
}

export interface StoredDocumentObject {
  storageProvider: DocumentStorageBackend;
  storageKey: string;
  fileName: string;
  bucket: string | null;
  publicUrl?: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  originalName: string;
}

export type DocumentStorageCreateResult =
  | {
      disposition: "CREATED";
      object: StoredDocumentObject;
      ownedByAttempt: true;
    }
  | {
      disposition: "ALREADY_EXISTS";
      object: StoredDocumentObject;
      ownedByAttempt: false;
    };

export interface DocumentStorageAdapter {
  put(input: DocumentStoragePutInput): Promise<StoredDocumentObject>;
  createIfAbsent(input: DocumentStoragePutInput): Promise<DocumentStorageCreateResult>;
  read(storageKey: string): Promise<DocumentStorageReadResult>;
  get(storageKey: string): Promise<DocumentStorageGetOutput>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}
