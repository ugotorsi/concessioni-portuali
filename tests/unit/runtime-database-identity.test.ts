import { describe, expect, it, vi } from "vitest";

import {
  getDatabaseIdentityDiagnostic,
  type DatabaseIdentityDiagnostic,
} from "@/server/runtime/databaseIdentity";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const previewEnvironment = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  VERCEL_PROJECT_ID: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  VERCEL_GIT_COMMIT_REF: "feat/noetra-legal-applicability-e4447",
  DATABASE_URL: "postgresql://ep-misty-shadow-atp8yuc1-pooler.c-9.us-east-1.aws.neon.tech/neondb",
} as const;

function executor(
  row: {
    databaseName: string;
    neonProjectId: string | null;
    neonBranchId: string | null;
    neonEndpointId: string | null;
  },
): RuntimeSqlExecutor {
  return { query: vi.fn().mockResolvedValue({ rows: [row] }) };
}

function expected(overrides: Partial<DatabaseIdentityDiagnostic> = {}): DatabaseIdentityDiagnostic {
  return {
    available: true,
    outcome: "MATCH",
    databaseConnected: true,
    endpointId: "ep-misty-shadow-atp8yuc1",
    neonProjectId: "aged-smoke-22484639",
    neonBranchId: "br-aged-truth-atfpqdbo",
    databaseName: "neondb",
    ...overrides,
  };
}

describe("Preview V3 database identity diagnostic", () => {
  it("reports MATCH only when every database identity field matches", async () => {
    await expect(getDatabaseIdentityDiagnostic(previewEnvironment, executor({
      databaseName: "neondb",
      neonProjectId: "aged-smoke-22484639",
      neonBranchId: "br-aged-truth-atfpqdbo",
      neonEndpointId: "ep-misty-shadow-atp8yuc1",
    }))).resolves.toEqual(expected());
  });

  it("reports MISMATCH when a connected database has a different identity", async () => {
    await expect(getDatabaseIdentityDiagnostic(previewEnvironment, executor({
      databaseName: "neondb",
      neonProjectId: "odd-term-33501783",
      neonBranchId: "br-mute-hill-au22t9l6",
      neonEndpointId: "ep-quiet-wildflower-au8eoq4s",
    }))).resolves.toEqual(expected({
      outcome: "MISMATCH",
      endpointId: "ep-quiet-wildflower-au8eoq4s",
      neonProjectId: "odd-term-33501783",
      neonBranchId: "br-mute-hill-au22t9l6",
    }));
  });

  it("reports NON_VERIFICABILE when the database cannot be reached", async () => {
    const unavailable: RuntimeSqlExecutor = {
      query: vi.fn().mockRejectedValue(new Error("connection failed")),
    };

    await expect(getDatabaseIdentityDiagnostic(previewEnvironment, unavailable)).resolves.toEqual(expected({
      outcome: "NON_VERIFICABILE",
      databaseConnected: false,
      endpointId: null,
      neonProjectId: null,
      neonBranchId: null,
      databaseName: null,
    }));
  });

  it("reports NON_VERIFICABILE when Neon does not expose complete identity settings", async () => {
    await expect(getDatabaseIdentityDiagnostic(previewEnvironment, executor({
      databaseName: "neondb",
      neonProjectId: null,
      neonBranchId: null,
      neonEndpointId: null,
    }))).resolves.toEqual(expected({
      outcome: "NON_VERIFICABILE",
      neonProjectId: null,
      neonBranchId: null,
    }));
  });
});
