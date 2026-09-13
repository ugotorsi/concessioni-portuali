import { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it } from "vitest";

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

  it("rejects oversized S3 metadata before GetObject", async () => {
    const adapter = new S3StorageAdapter();
    const commands: unknown[] = [];
    Object.defineProperty(adapter, "client", { value: {
      send: async (command: unknown) => {
        commands.push(command);
        return { ContentLength: 11 };
      },
    } });

    await expect(adapter.readBounded("intake/item", 10)).rejects.toMatchObject({
      name: "DocumentStorageReadLimitError",
      code: "BYTE_LIMIT_EXCEEDED",
      maxBytes: 10,
      observedBytes: 11,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("uses HEAD plus a bounded range and enforces bytes consumed", async () => {
    const adapter = new S3StorageAdapter();
    const commands: unknown[] = [];
    Object.defineProperty(adapter, "client", { value: {
      send: async (command: unknown) => {
        commands.push(command);
        if (command instanceof HeadObjectCommand) {
          return { ContentLength: 7 };
        }
        return { Body: Readable.from([Buffer.from("content")]) };
      },
    } });

    await expect(adapter.readBounded("intake/item", 10)).resolves.toEqual({
      disposition: "FOUND",
      body: Buffer.from("content"),
    });
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBeInstanceOf(GetObjectCommand);
    expect((commands[1] as GetObjectCommand).input.Range).toBe("bytes=0-9");
  });

  it("fails closed if the S3 body exceeds the advertised budget", async () => {
    const adapter = new S3StorageAdapter();
    Object.defineProperty(adapter, "client", { value: {
      send: async (command: unknown) => command instanceof HeadObjectCommand
        ? { ContentLength: 4 }
        : { Body: Readable.from([Buffer.from("12345")]) },
    } });

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