import { describe, expect, it } from "vitest";

import { DocumentStorageS3Error, S3StorageAdapter } from "@/server/documents/storage/s3StorageAdapter";

describe("s3 storage adapter exists", () => {
  it("returns false for not found objects", async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://example.invalid";
    process.env.S3_REGION = "auto";
    process.env.S3_BUCKET = "demo";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_FORCE_PATH_STYLE = "true";

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
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://example.invalid";
    process.env.S3_REGION = "auto";
    process.env.S3_BUCKET = "demo";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_FORCE_PATH_STYLE = "true";

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
