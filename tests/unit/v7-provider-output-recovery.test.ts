import { describe, expect, it } from "vitest";

import type {
  DocumentStorageCreateResult,
  DocumentStorageReadResult,
} from "@/server/documents/storage/types";
import {
  deleteV7ProviderOutputRecoveryArtifact,
  loadV7ProviderOutputRecoveryArtifact,
  persistV7ProviderOutputRecoveryArtifact,
  V7ProviderOutputRecoveryError,
} from "@/server/ai/v7ProviderOutputRecovery";

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    storage: {
      async createIfAbsent(input: {
        storageKey: string;
        body: Buffer;
        mimeType: string;
        originalName: string;
        sha256: string;
        sizeBytes: number;
      }): Promise<DocumentStorageCreateResult> {
        if (objects.has(input.storageKey)) {
          return {
            disposition: "ALREADY_EXISTS",
            ownedByAttempt: false,
            object: {
              storageProvider: "s3",
              storageKey: input.storageKey,
              fileName: input.originalName,
              bucket: "test",
              sizeBytes: input.sizeBytes,
              sha256: input.sha256,
              mimeType: input.mimeType,
              originalName: input.originalName,
            },
          };
        }
        objects.set(input.storageKey, Buffer.from(input.body));
        return {
          disposition: "CREATED",
          ownedByAttempt: true,
          object: {
            storageProvider: "s3",
            storageKey: input.storageKey,
            fileName: input.originalName,
            bucket: "test",
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            mimeType: input.mimeType,
            originalName: input.originalName,
          },
        };
      },
      async readBounded(storageKey: string, maxBytes: number): Promise<DocumentStorageReadResult> {
        const body = objects.get(storageKey);
        if (!body) return { disposition: "MISSING" };
        if (body.length > maxBytes) throw new Error("limit");
        return { disposition: "FOUND", body: Buffer.from(body) };
      },
      async delete(storageKey: string): Promise<void> {
        objects.delete(storageKey);
      },
    },
  };
}

const binding = {
  jobId: "job-one-shot-08",
  tenantId: "tenant-selvara",
  procedimentoId: "procedure-selvara",
  corpusFingerprint: "a".repeat(64),
  approvalId: "NOETRA-V7-SELVARA-2026-10-29-CONTROLLED-ONE-SHOT-08",
};
const key = Buffer.alloc(32, 17);

describe("V7 provider output recovery", () => {
  it("round-trips a protected output and deletes it after successful persistence", async () => {
    const { storage, objects } = memoryStorage();
    const output = { chronology: [{ fact: "verified" }], citations: ["doc:1"] };

    const artifact = await persistV7ProviderOutputRecoveryArtifact({
      binding,
      output,
      storage,
      encryptionKey: key,
    });
    const recovered = await loadV7ProviderOutputRecoveryArtifact({
      binding,
      storage,
      encryptionKey: key,
    });

    expect(recovered.output).toEqual(output);
    expect(recovered.outputFingerprint).toBe(artifact.outputFingerprint);
    expect(objects.get(artifact.storageKey)?.toString("utf8")).not.toContain("verified");

    await deleteV7ProviderOutputRecoveryArtifact({ binding, storage });
    await expect(loadV7ProviderOutputRecoveryArtifact({
      binding,
      storage,
      encryptionKey: key,
    })).rejects.toMatchObject({ code: "RECOVERY_ARTIFACT_MISSING" });
  });

  it("rejects decryption under a different authorization binding", async () => {
    const { storage } = memoryStorage();
    await persistV7ProviderOutputRecoveryArtifact({
      binding,
      output: { facts: ["paid output"] },
      storage,
      encryptionKey: key,
    });

    await expect(loadV7ProviderOutputRecoveryArtifact({
      binding: { ...binding, approvalId: "different-approval" },
      storage,
      encryptionKey: key,
    })).rejects.toBeInstanceOf(V7ProviderOutputRecoveryError);
  });

  it("rejects a conflicting second output for the same one-shot job", async () => {
    const { storage } = memoryStorage();
    await persistV7ProviderOutputRecoveryArtifact({
      binding,
      output: { result: "first" },
      storage,
      encryptionKey: key,
    });

    await expect(persistV7ProviderOutputRecoveryArtifact({
      binding,
      output: { result: "second" },
      storage,
      encryptionKey: key,
    })).rejects.toMatchObject({ code: "RECOVERY_ARTIFACT_CONFLICT" });
  });
});
