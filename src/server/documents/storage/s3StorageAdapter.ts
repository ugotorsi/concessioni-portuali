import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { getS3StorageConfig } from "./config";
import type { DocumentStorageAdapter, DocumentStorageGetOutput, DocumentStoragePutInput, StoredDocumentObject } from "./types";

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

  async put(input: DocumentStoragePutInput): Promise<StoredDocumentObject> {
    const storageKey = assertSafeStorageKey(input.storageKey);

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
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: safeKey,
      }),
    );

    const body = await bodyToBuffer(response.Body);
    return { body };
  }

  async delete(storageKey: string): Promise<void> {
    const safeKey = assertSafeStorageKey(storageKey);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: safeKey,
      }),
    );
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
    } catch {
      return false;
    }
  }
}
