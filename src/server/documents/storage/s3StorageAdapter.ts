import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { getS3StorageConfig } from "./config";
import type { DocumentStorageAdapter, DocumentStorageGetOutput, DocumentStoragePutInput, StoredDocumentObject } from "./types";

type StorageOperation = "PUT" | "GET" | "DELETE" | "HEAD";

interface StorageDiagnostics {
  provider: "s3";
  operation: StorageOperation;
  code: string;
  statusCode?: number;
  retryable?: boolean;
  bucketConfigured: boolean;
  endpointConfigured: boolean;
  regionConfigured: boolean;
  forcePathStyle: boolean;
}

export class DocumentStorageS3Error extends Error {
  readonly diagnostics: StorageDiagnostics;

  constructor(message: string, diagnostics: StorageDiagnostics, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DocumentStorageS3Error";
    this.diagnostics = diagnostics;
  }
}

interface AwsLikeError {
  name?: string;
  code?: string;
  $metadata?: {
    httpStatusCode?: number;
  };
  retryable?: boolean;
}

function extractErrorCode(error: unknown): string {
  const candidate = error as AwsLikeError;
  return candidate.code ?? candidate.name ?? "UNKNOWN_S3_ERROR";
}

function extractStatusCode(error: unknown): number | undefined {
  const candidate = error as AwsLikeError;
  return candidate.$metadata?.httpStatusCode;
}

function isNotFoundLike(code: string, statusCode?: number): boolean {
  return code === "NotFound" || code === "NoSuchKey" || statusCode === 404;
}

function assertSafeStorageKey(storageKey: string): string {
  const normalized = storageKey.trim();

  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error("Storage key documento non valido.");
  }

  return normalized;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  const streamLike = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };

  if (typeof streamLike.transformToByteArray === "function") {
    const bytes = await streamLike.transformToByteArray();
    return Buffer.from(bytes);
  }

  const nodeStream = body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    nodeStream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    nodeStream.on("error", reject);
    nodeStream.on("end", () => resolve());
  });

  return Buffer.concat(chunks);
}

export class S3StorageAdapter implements DocumentStorageAdapter {
  private readonly config = getS3StorageConfig();

  private readonly client = new S3Client({
    endpoint: this.config.endpoint,
    region: this.config.region,
    credentials: {
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
    },
    forcePathStyle: this.config.forcePathStyle,
  });

  private toS3Error(operation: StorageOperation, error: unknown): DocumentStorageS3Error {
    const code = extractErrorCode(error);
    const statusCode = extractStatusCode(error);

    return new DocumentStorageS3Error(`Storage S3 ${operation} failed (${code}).`, {
      provider: "s3",
      operation,
      code,
      statusCode,
      retryable: (error as AwsLikeError).retryable,
      bucketConfigured: this.config.bucket.length > 0,
      endpointConfigured: this.config.endpoint.length > 0,
      regionConfigured: this.config.region.length > 0,
      forcePathStyle: this.config.forcePathStyle,
    }, { cause: error });
  }

  async put(input: DocumentStoragePutInput): Promise<StoredDocumentObject> {
    const storageKey = assertSafeStorageKey(input.storageKey);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          Body: input.body,
          ContentType: input.mimeType,
          Metadata: {
            sha256: input.sha256,
            originalname: input.originalName,
          },
        }),
      );
    } catch (error) {
      throw this.toS3Error("PUT", error);
    }

    return {
      storageProvider: "s3",
      storageKey,
      fileName: storageKey.split("/").pop() ?? storageKey,
      bucket: this.config.bucket,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      mimeType: input.mimeType,
      originalName: input.originalName,
    };
  }

  async get(storageKey: string): Promise<DocumentStorageGetOutput> {
    const safeKey = assertSafeStorageKey(storageKey);
    let response;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: safeKey,
        }),
      );
    } catch (error) {
      throw this.toS3Error("GET", error);
    }

    const body = await bodyToBuffer(response.Body);
    return { body };
  }

  async delete(storageKey: string): Promise<void> {
    const safeKey = assertSafeStorageKey(storageKey);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: safeKey,
        }),
      );
    } catch (error) {
      throw this.toS3Error("DELETE", error);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const safeKey = assertSafeStorageKey(storageKey);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: safeKey,
        }),
      );
      return true;
    } catch (error) {
      const code = extractErrorCode(error);
      const statusCode = extractStatusCode(error);

      if (isNotFoundLike(code, statusCode)) {
        return false;
      }

      throw this.toS3Error("HEAD", error);
    }
  }
}
