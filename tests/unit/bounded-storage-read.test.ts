import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStorageAdapter } from "@/server/documents/storage/localStorageAdapter";
import { S3StorageAdapter } from "@/server/documents/storage/s3StorageAdapter";

describe("bounded storage reads", () => {
  beforeEach(() => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://example.invalid";
    process.env.S3_REGION = "auto";
    process.env.S3_BUCKET = "demo";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_FORCE_PATH_STYLE = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an oversized S3 object from ranged response metadata", async () => {
    const adapter = new S3StorageAdapter();
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentRange: "bytes 0-10/11",
      ContentLength: 11,
      Body: Readable.from("12345678901"),
      $metadata: { httpStatusCode: 206 },
    } as never);

    await expect(adapter.readBounded("intake/item", 10)).rejects.toMatchObject({
      name: "DocumentStorageReadLimitError",
      code: "BYTE_LIMIT_EXCEEDED",
      maxBytes: 10,
      observedBytes: 11,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses one bounded range request and enforces bytes consumed", async () => {
    const adapter = new S3StorageAdapter();
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentRange: "bytes 0-6/7",
      ContentLength: 7,
      Body: Readable.from("content"),
      $metadata: { httpStatusCode: 206 },
    } as never);

    await expect(adapter.readBounded("intake/item", 10)).resolves.toEqual({
      disposition: "FOUND",
      body: Buffer.from("content"),
    });
    const command = send.mock.calls[0][0] as GetObjectCommand;
    expect(command.input.Range).toBe("bytes=0-10");
  });

  it("consumes an AWS SDK response through its bounded byte transform", async () => {
    const adapter = new S3StorageAdapter();
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 7,
      Body: {
        on: () => {
          throw new Error("stream event path must not be used");
        },
        transformToByteArray: async () => new TextEncoder().encode("content"),
      },
      $metadata: { httpStatusCode: 206 },
    } as never);

    await expect(adapter.readBounded("intake/item", 10)).resolves.toEqual({
      disposition: "FOUND",
      body: Buffer.from("content"),
    });
  });

  it("fails closed if the S3 body exceeds the advertised budget", async () => {
    const adapter = new S3StorageAdapter();
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: Readable.from("12345"),
      $metadata: { httpStatusCode: 206 },
    } as never);

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