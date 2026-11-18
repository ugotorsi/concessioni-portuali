import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(
  root,
  "prisma/migrations/20260913_b2c9_block3b2b_generic_async_jobs/migration.sql",
), "utf8");
const implementation = ["domain.ts", "persistence.ts", "registry.ts", "worker.ts"]
  .map((file) => readFileSync(resolve(root, "src/server/async-jobs", file), "utf8"))
  .join("\n");

describe("B2C9 generic async job architecture", () => {
  it("keeps the migration expand-only and free of data mutation", () => {
    expect(migration).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|INSERT)\b/im);
    expect(migration).not.toMatch(/^\s*ALTER\s+TABLE[\s\S]*?\sDROP\b/im);
    expect(migration).toContain('CREATE TABLE "AsyncJob"');
  });

  it("enforces lifecycle, lease, attempts, cancellation, and immutable admission invariants", () => {
    expect(migration).toContain('CONSTRAINT "async_job_attempts_ck"');
    expect(migration).toContain('CONSTRAINT "async_job_reference_size_ck"');
    expect(migration).toContain('CONSTRAINT "async_job_lease_status_ck"');
    expect(migration).toContain('CONSTRAINT "async_job_cancellation_ck"');
    expect(migration).toContain('CONSTRAINT "async_job_terminal_ck"');
    expect(migration).toContain('CREATE TRIGGER "async_job_reject_admission_mutation"');
    expect(migration).toContain('ON DELETE RESTRICT');
  });

  it("uses atomic skip-locked claiming and lease-token CAS", () => {
    expect(implementation).toContain("FOR UPDATE SKIP LOCKED");
    expect(implementation).toContain('"leaseToken" = ${lease.leaseToken}');
    expect(implementation).toContain('"leaseExpiresAt" > CURRENT_TIMESTAMP');
    expect(implementation).not.toContain("input.now");
  });

  it("does not wire extraction, OCR, AI, legal-source, or review workloads", () => {
    expect(implementation).not.toMatch(/@\/server\/(?:ai|intake|legal-rules)/);
    expect(implementation).not.toMatch(/openai|tesseract|pdfjs|fascicoloOutboundProjection/i);
    expect(implementation).not.toContain("EVIDENCE_READY");
  });

  it("ships with an empty production registry", () => {
    expect(implementation).toContain("new AsyncJobHandlerRegistry()");
    expect(implementation).not.toMatch(/operation:\s*["'](?:EXTRACTION|OCR|AI|CLASSIF|SIMPLICIT|LEGAL|RESEARCH|CASE_GUARDIAN)/i);
  });
});