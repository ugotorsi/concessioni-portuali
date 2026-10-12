import { afterEach, describe, expect, it, vi } from "vitest";

import { S3StorageAdapter } from "@/server/documents/storage/s3StorageAdapter";

describe("document S3 presigned PUT", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs browser-controlled headers and keeps metadata in the signed query only", async () => {
    vi.stubEnv("S3_ENDPOINT", "https://account-id.r2.cloudflarestorage.com");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_BUCKET", "private-documents");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "true");

    const adapter = new S3StorageAdapter();
    const signed = new URL(await adapter.createPresignedPut({
      storageKey: "pending-documents/tenant/actor/operation",
      mimeType: "application/pdf",
      sizeBytes: 5 * 1024 * 1024,
      metadata: {
        operationid: "operation",
        tenantref: "tenant",
      },
      expiresInSeconds: 600,
    }));

    expect(signed.searchParams.get("x-amz-meta-operationid")).toBe("operation");
    expect(signed.searchParams.get("x-amz-meta-tenantref")).toBe("tenant");
    expect(signed.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual([
      "content-length",
      "content-type",
      "host",
      "if-none-match",
    ]);
  });
});
