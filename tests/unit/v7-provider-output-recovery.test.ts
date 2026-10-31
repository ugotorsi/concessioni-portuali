import { describe, expect, it } from "vitest";

import {
  deleteV7ProviderOutputRecoveryArtifact,
  loadV7ProviderOutputRecoveryArtifact,
  persistV7ProviderOutputRecoveryArtifact,
  V7ProviderOutputRecoveryError,
} from "@/server/ai/v7ProviderOutputRecovery";

function memoryRepository() {
  type Row = {
    id: string;
    jobId: string;
    tenantId: string;
    procedimentoId: string;
    corpusFingerprint: string;
    approvalId: string;
    outputFingerprint: string;
    encryptedPayload: string;
    sizeBytes: number;
    expiresAt: Date;
  };
  const rows = new Map<string, Row>();
  return {
    rows,
    repository: {
      async create(input: Omit<Row, "id">): Promise<Row> {
        const row = { id: "artifact-1", ...input };
        rows.set(input.jobId, row);
        return row;
      },
      async findByJobId(jobId: string): Promise<Row | null> {
        return rows.get(jobId) ?? null;
      },
      async deleteByBinding(input: { jobId: string }): Promise<void> {
        rows.delete(input.jobId);
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
const now = new Date("2026-10-29T12:00:00Z");

describe("V7 provider output recovery", () => {
  it("round-trips a protected output and deletes it after successful persistence", async () => {
    const { repository, rows } = memoryRepository();
    const output = { chronology: [{ fact: "verified" }], citations: ["doc:1"] };

    const artifact = await persistV7ProviderOutputRecoveryArtifact({
      binding,
      output,
      repository,
      encryptionKey: key,
      now,
    });
    const recovered = await loadV7ProviderOutputRecoveryArtifact({
      binding,
      repository,
      encryptionKey: key,
      now,
    });

    expect(recovered.output).toEqual(output);
    expect(recovered.outputFingerprint).toBe(artifact.outputFingerprint);
    expect(rows.get(binding.jobId)?.encryptedPayload).not.toContain("verified");

    await deleteV7ProviderOutputRecoveryArtifact({ binding, repository });
    await expect(loadV7ProviderOutputRecoveryArtifact({
      binding,
      repository,
      encryptionKey: key,
      now,
    })).rejects.toMatchObject({ code: "RECOVERY_ARTIFACT_MISSING" });
  });

  it("rejects decryption under a different authorization binding", async () => {
    const { repository } = memoryRepository();
    await persistV7ProviderOutputRecoveryArtifact({
      binding,
      output: { facts: ["paid output"] },
      repository,
      encryptionKey: key,
      now,
    });

    await expect(loadV7ProviderOutputRecoveryArtifact({
      binding: { ...binding, approvalId: "different-approval" },
      repository,
      encryptionKey: key,
      now,
    })).rejects.toBeInstanceOf(V7ProviderOutputRecoveryError);
  });

  it("rejects an expired artifact", async () => {
    const { repository } = memoryRepository();
    await persistV7ProviderOutputRecoveryArtifact({
      binding,
      output: { facts: ["paid output"] },
      repository,
      encryptionKey: key,
      now,
    });

    await expect(loadV7ProviderOutputRecoveryArtifact({
      binding,
      repository,
      encryptionKey: key,
      now: new Date("2026-11-06T12:00:00Z"),
    })).rejects.toMatchObject({ code: "RECOVERY_ARTIFACT_EXPIRED" });
  });
});
