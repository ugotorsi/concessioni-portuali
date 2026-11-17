import { describe, expect, it, vi } from "vitest";

import {
  getDatabaseIdentityDiagnostic,
  type DatabaseIdentityDiagnostic,
} from "@/server/runtime/databaseIdentity";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const productionEnvironment = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  DATABASE_URL: "postgresql://ep-misty-shadow-atp8yuc1-pooler.c-9.us-east-1.aws.neon.tech/neondb",
  RUNTIME_EXPECTED_NEON_ENDPOINT_ID: "ep-misty-shadow-atp8yuc1",
  RUNTIME_EXPECTED_NEON_PROJECT_ID: "aged-smoke-22484639",
  RUNTIME_EXPECTED_NEON_BRANCH_ID: "br-aged-truth-atfpqdbo",
  RUNTIME_EXPECTED_DATABASE_NAME: "neondb",
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
    expectedIdentityConfigured: true,
    ...overrides,
  };
}

describe("runtime database identity diagnostic", () => {
  it("reports MATCH only when every database identity field matches", async () => {
    await expect(getDatabaseIdentityDiagnostic(productionEnvironment, executor({
      databaseName: "neondb",
      neonProjectId: "aged-smoke-22484639",
      neonBranchId: "br-aged-truth-atfpqdbo",
      neonEndpointId: "ep-misty-shadow-atp8yuc1",
    }))).resolves.toEqual(expected());
  });

  it("reports MISMATCH when a connected database has a different identity", async () => {
    await expect(getDatabaseIdentityDiagnostic(productionEnvironment, executor({
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

    await expect(getDatabaseIdentityDiagnostic(productionEnvironment, unavailable)).resolves.toEqual(expected({
      outcome: "NON_VERIFICABILE",
      databaseConnected: false,
      endpointId: null,
      neonProjectId: null,
      neonBranchId: null,
      databaseName: null,
      expectedIdentityConfigured: false,
    }));
  });

  it("reports NON_VERIFICABILE when Neon does not expose complete identity settings", async () => {
    await expect(getDatabaseIdentityDiagnostic(productionEnvironment, executor({
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

  it("still verifies connectivity when no expected identity is configured", async () => {
    await expect(getDatabaseIdentityDiagnostic({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      DATABASE_URL: productionEnvironment.DATABASE_URL,
    }, executor({
      databaseName: "neondb",
      neonProjectId: "odd-term-33501783",
      neonBranchId: "br-production",
      neonEndpointId: "ep-production",
    }))).resolves.toEqual({
      available: true,
      outcome: "NON_VERIFICABILE",
      databaseConnected: true,
      endpointId: "ep-production",
      neonProjectId: "odd-term-33501783",
      neonBranchId: "br-production",
      databaseName: "neondb",
      expectedIdentityConfigured: false,
    });
  });
});
