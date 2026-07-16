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

export interface DocumentStorageAdapter {
  put(input: DocumentStoragePutInput): Promise<StoredDocumentObject>;
  get(storageKey: string): Promise<DocumentStorageGetOutput>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}
