import { describe, expect, it } from "vitest";

import {
  LEGACY_LEGAL_SOURCE_STATUS_MAP,
  LegalSourceStatusNormalizationError,
  normalizeLegacyLegalSourceStatus,
  sanitizeNormalizationErrorMessage,
  type LegacyLegalSourceStatus,
  type LegalSourceStatusNormalizationRepository,
} from "@/server/legal-rules/normalize-legal-source-status";

class FakeNormalizationRepository implements LegalSourceStatusNormalizationRepository {
  tableExists = true;
  enumExists = true;
  throwOnCount = false;
  throwOnUpdate = false;
  enumValues = new Set<string>(["VIGENTE", "SUPERATA", "BOZZA"]);
  counts: Record<LegacyLegalSourceStatus, number> = {
    VIGENTE: 0,
    SUPERATA: 0,
    BOZZA: 0,
  };

  async ensureLegalSourceTableExists(): Promise<boolean> {
    return this.tableExists;
  }

  async ensureLegalSourceStatusEnumExists(): Promise<boolean> {
    return this.enumExists;
  }

  async hasEnumValue(value: string): Promise<boolean> {
    return this.enumValues.has(value);
  }

  async addEnumValue(value: string): Promise<void> {
    this.enumValues.add(value);
  }

  async countLegacyStatuses(): Promise<Record<LegacyLegalSourceStatus, number>> {
    if (this.throwOnCount) {
      throw new Error("connect ECONNRESET");
    }
    return { ...this.counts };
  }

  async updateLegacyStatuses(mapping: Readonly<Record<LegacyLegalSourceStatus, string>>): Promise<number> {
    if (this.throwOnUpdate) {
      throw new Error("update failed");
    }
    const updated = this.counts.VIGENTE + this.counts.SUPERATA + this.counts.BOZZA;
    if (this.counts.VIGENTE > 0) {
      this.enumValues.add(mapping.VIGENTE);
    }
    if (this.counts.SUPERATA > 0) {
      this.enumValues.add(mapping.SUPERATA);
    }
    if (this.counts.BOZZA > 0) {
      this.enumValues.add(mapping.BOZZA);
    }
    this.counts.VIGENTE = 0;
    this.counts.SUPERATA = 0;
    this.counts.BOZZA = 0;
    return updated;
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

describe("legal source status normalization", () => {
  it("exposes the expected legacy mapping", () => {
    expect(LEGACY_LEGAL_SOURCE_STATUS_MAP).toEqual({
      VIGENTE: "CURRENT_SUBJECT_TO_REVIEW",
      SUPERATA: "SUPERSEDED",
      BOZZA: "DRAFT_OR_ONGOING_PROCEDURE",
    });
  });

  it("maps VIGENTE records", async () => {
    const repo = new FakeNormalizationRepository();
    repo.counts.VIGENTE = 3;

    const report = await normalizeLegacyLegalSourceStatus(repo);

    expect(report.updatedRecords).toBe(3);
    expect(report.remainingLegacy).toBe(0);
  });

  it("maps SUPERATA records", async () => {
    const repo = new FakeNormalizationRepository();
    repo.counts.SUPERATA = 2;

    const report = await normalizeLegacyLegalSourceStatus(repo);

    expect(report.updatedRecords).toBe(2);
    expect(report.remainingLegacy).toBe(0);
  });

  it("maps BOZZA records", async () => {
    const repo = new FakeNormalizationRepository();
    repo.counts.BOZZA = 4;

    const report = await normalizeLegacyLegalSourceStatus(repo);

    expect(report.updatedRecords).toBe(4);
    expect(report.remainingLegacy).toBe(0);
  });

  it("does not change already normalized rows", async () => {
    const repo = new FakeNormalizationRepository();
    const report = await normalizeLegacyLegalSourceStatus(repo);

    expect(report.status).toBe("NO_CHANGES");
    expect(report.updatedRecords).toBe(0);
  });

  it("handles no legacy values", async () => {
    const repo = new FakeNormalizationRepository();
    const report = await normalizeLegacyLegalSourceStatus(repo);

    expect(report.totalLegacyFound).toBe(0);
    expect(report.remainingLegacy).toBe(0);
  });

  it("supports dry-run with no writes", async () => {
    const repo = new FakeNormalizationRepository();
    repo.counts = { VIGENTE: 1, SUPERATA: 1, BOZZA: 1 };

    const report = await normalizeLegacyLegalSourceStatus(repo, { dryRun: true });

    expect(report.status).toBe("DRY_RUN");
    expect(report.updatedRecords).toBe(0);
    expect(report.remainingLegacy).toBe(3);
    expect(repo.counts).toEqual({ VIGENTE: 1, SUPERATA: 1, BOZZA: 1 });
  });

  it("is idempotent on second execution", async () => {
    const repo = new FakeNormalizationRepository();
    repo.counts = { VIGENTE: 2, SUPERATA: 1, BOZZA: 1 };

    const first = await normalizeLegacyLegalSourceStatus(repo);
    const second = await normalizeLegacyLegalSourceStatus(repo);

    expect(first.updatedRecords).toBe(4);
    expect(second.updatedRecords).toBe(0);
    expect(second.status).toBe("NO_CHANGES");
  });

  it("reports connection errors", async () => {
    const repo = new FakeNormalizationRepository();
    repo.throwOnCount = true;

    await expect(normalizeLegacyLegalSourceStatus(repo)).rejects.toThrow(/ECONNRESET/i);
  });

  it("fails when LegalSource table is missing", async () => {
    const repo = new FakeNormalizationRepository();
    repo.tableExists = false;

    await expect(normalizeLegacyLegalSourceStatus(repo)).rejects.toBeInstanceOf(LegalSourceStatusNormalizationError);
  });

  it("produces count report for legacy statuses", async () => {
    const repo = new FakeNormalizationRepository();
    repo.counts = { VIGENTE: 5, SUPERATA: 4, BOZZA: 3 };

    const report = await normalizeLegacyLegalSourceStatus(repo, { dryRun: true });

    expect(report.legacyFound).toEqual([
      { status: "VIGENTE", count: 5 },
      { status: "SUPERATA", count: 4 },
      { status: "BOZZA", count: 3 },
    ]);
    expect(report.totalLegacyFound).toBe(12);
  });

  it("sanitizes secret fragments in connection errors", () => {
    const sanitized = sanitizeNormalizationErrorMessage(
      "failed on postgresql://user:secret-password@localhost:5433/concessioni_portuali",
    );

    expect(sanitized).not.toContain("secret-password");
    expect(sanitized).toContain("postgresql://***@");
  });
});