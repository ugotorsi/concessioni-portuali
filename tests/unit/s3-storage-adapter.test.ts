import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { DocumentStorageS3Error, S3StorageAdapter } from "@/server/documents/storage/s3StorageAdapter";

function configureS3(): void {
  process.env.DOCUMENT_STORAGE_BACKEND = "s3";
  process.env.S3_ENDPOINT = "https://example.invalid";
  process.env.S3_REGION = "auto";
  process.env.S3_BUCKET = "demo";
  process.env.S3_ACCESS_KEY_ID = "key";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
  process.env.S3_FORCE_PATH_STYLE = "true";
}

function putInput() {
  const body = Buffer.from("content");
  return {
    storageKey: "doc/file.txt",
    body,
    mimeType: "text/plain",
    originalName: "file.txt",
    sha256: "a".repeat(64),
    sizeBytes: body.length,
  };
}

describe("s3 storage adapter exists", () => {
  it("returns false for not found objects", async () => {
    configureS3();

    const adapter = new S3StorageAdapter();

    const mockClient = {
      send: async () => {
        const err = new Error("NotFound") as Error & {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        err.name = "NotFound";
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      },
    };

    Object.defineProperty(adapter, "client", {
      value: mockClient,
    });

    await expect(adapter.exists("doc/missing.txt")).resolves.toBe(false);
  });

  it("throws diagnostic error for auth/config failures", async () => {
    configureS3();

    const adapter = new S3StorageAdapter();

    const mockClient = {
      send: async () => {
        const err = new Error("AccessDenied") as Error & {
          name?: string;
          $metadata?: { httpStatusCode?: number };
          retryable?: boolean;
        };
        err.name = "AccessDenied";
        err.$metadata = { httpStatusCode: 403 };
        err.retryable = false;
        throw err;
      },
    };

    Object.defineProperty(adapter, "client", {
      value: mockClient,
    });

    await expect(adapter.exists("doc/protected.txt")).rejects.toBeInstanceOf(DocumentStorageS3Error);
    await expect(adapter.exists("doc/protected.txt")).rejects.toMatchObject({
      diagnostics: {
        provider: "s3",
        operation: "HEAD",
        code: "AccessDenied",
        statusCode: 403,
      },
    });
  });
});

describe("s3 storage adapter conditional create", () => {
  it("uses one conditional PutObject request and returns CREATED", async () => {
    configureS3();
    const adapter = new S3StorageAdapter();
    const commands: unknown[] = [];
    Object.defineProperty(adapter, "client", {
      value: { send: async (command: unknown) => { commands.push(command); return {}; } },
    });

    await expect(adapter.createIfAbsent(putInput())).resolves.toMatchObject({
      disposition: "CREATED",
      ownedByAttempt: true,
      object: { storageProvider: "s3", storageKey: "doc/file.txt", bucket: "demo" },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: "demo",
      Key: "doc/file.txt",
      IfNoneMatch: "*",
    });
  });

  it.each([
    { name: "PreconditionFailed", statusCode: 400 },
    { name: "Unknown", statusCode: 412 },
  ])("returns ALREADY_EXISTS for conditional precondition failure %#", async ({ name, statusCode }) => {
    configureS3();
    const adapter = new S3StorageAdapter();
    Object.defineProperty(adapter, "client", {
      value: {
        send: async () => {
          const error = new Error(name) as Error & { $metadata?: { httpStatusCode?: number } };
          error.name = name;
          error.$metadata = { httpStatusCode: statusCode };
          throw error;
        },
      },
    });

    await expect(adapter.createIfAbsent(putInput())).resolves.toMatchObject({
      disposition: "ALREADY_EXISTS",
      ownedByAttempt: false,
    });
  });

  it.each([
    { name: "ConditionalRequestConflict", statusCode: 409 },
    { name: "InternalError", statusCode: 500 },
  ])("propagates non-precondition PUT failures %#", async ({ name, statusCode }) => {
    configureS3();
    const adapter = new S3StorageAdapter();
    Object.defineProperty(adapter, "client", {
      value: {
        send: async () => {
          const error = new Error(name) as Error & { $metadata?: { httpStatusCode?: number } };
          error.name = name;
          error.$metadata = { httpStatusCode: statusCode };
          throw error;
        },
      },
    });

    await expect(adapter.createIfAbsent(putInput())).rejects.toMatchObject({
      diagnostics: { operation: "PUT", code: name, statusCode },
    });
  });

  it("preserves unconditional put without IfNoneMatch", async () => {
    configureS3();
    const adapter = new S3StorageAdapter();
    let command: unknown;
    Object.defineProperty(adapter, "client", {
      value: { send: async (value: unknown) => { command = value; return {}; } },
    });

    await expect(adapter.put(putInput())).resolves.toMatchObject({ storageKey: "doc/file.txt" });
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input.IfNoneMatch).toBeUndefined();
  });
});
