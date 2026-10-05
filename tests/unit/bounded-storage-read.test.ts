import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStorageAdapter } from "@/server/documents/storage/localStorageAdapter";
import { S3StorageAdapter } from "@/server/documents/storage/s3StorageAdapter";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://example.invalid/presigned"),
}));

describe("bounded storage reads", () => {
  beforeEach(() => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://example.invalid";
    process.env.S3_REGION = "auto";
    process.env.S3_BUCKET = "demo";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_FORCE_PATH_STYLE = "true";
    vi.mocked(getSignedUrl).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an oversized S3 object from ranged response metadata", async () => {
    const adapter = new S3StorageAdapter();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 206,
      headers: { "content-range": "bytes 0-10/11" },
    })));

    await expect(adapter.readBounded("intake/item", 10)).rejects.toMatchObject({
      name: "DocumentStorageReadLimitError",
      code: "BYTE_LIMIT_EXCEEDED",
      maxBytes: 10,
      observedBytes: 11,
    });
    expect(getSignedUrl).toHaveBeenCalledOnce();
  });

  it("uses one bounded range request and enforces bytes consumed", async () => {
    const adapter = new S3StorageAdapter();
    const fetchMock = vi.fn(async () => new Response("content", {
      status: 206,
      headers: { "content-range": "bytes 0-6/7" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adapter.readBounded("intake/item", 10)).resolves.toEqual({
      disposition: "FOUND",
      body: Buffer.from("content"),
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.invalid/presigned", {
      headers: { Range: "bytes=0-10" },
    });
  });

  it("fails closed if the S3 body exceeds the advertised budget", async () => {
    const adapter = new S3StorageAdapter();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("12345", { status: 200 })));

    await expect(adapter.readBounded("intake/item", 4)).rejects.toMatchObject({
      code: "BYTE_LIMIT_EXCEEDED",
      maxBytes: 4,
    });
  });

  it("reads a local object only when its metadata fits the byte budget", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "b2c9-bounded-local-"));
    process.env.DOCUMENT_STORAGE_ROOT = root;
    await writeFile(path.join(root, "item"), "content");
    try {
      await expect(new LocalStorageAdapter().readBounded("item", 7)).resolves.toEqual({
        disposition: "FOUND",
        body: Buffer.from("content"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized local metadata before allocating the body", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "b2c9-bounded-local-"));
    process.env.DOCUMENT_STORAGE_ROOT = root;
    await writeFile(path.join(root, "item"), "content");
    try {
      await expect(new LocalStorageAdapter().readBounded("item", 6)).rejects.toMatchObject({
        name: "DocumentStorageReadLimitError",
        code: "BYTE_LIMIT_EXCEEDED",
        maxBytes: 6,
        observedBytes: 7,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});