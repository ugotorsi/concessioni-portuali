import { describe, expect, it } from "vitest";

import {
  assertStagingE2eCaseEnvironment,
  parseStagingE2eCaseMode,
  STAGING_E2E_CASE,
} from "../../scripts/runtime/staging-e2e-case";

const validEnvironment = {
  ALLOW_STAGING_E2E_CASE_CREATION: "true",
  NEON_PROJECT_ID: STAGING_E2E_CASE.projectId,
  NEON_BRANCH_ID: STAGING_E2E_CASE.branchId,
  DATABASE_URL: `postgresql://user:password@${STAGING_E2E_CASE.endpointId}.eu-central-1.aws.neon.tech/neondb`,
};

describe("staging E2E case guard", () => {
  it("accepts only the audited staging project, branch, endpoint, and database", () => {
    expect(() => assertStagingE2eCaseEnvironment(validEnvironment)).not.toThrow();
  });

  it.each([
    ["opt-in", { ...validEnvironment, ALLOW_STAGING_E2E_CASE_CREATION: "false" }],
    ["project", { ...validEnvironment, NEON_PROJECT_ID: "wrong-project" }],
    ["branch", { ...validEnvironment, NEON_BRANCH_ID: "wrong-branch" }],
    ["endpoint", { ...validEnvironment, DATABASE_URL: "postgresql://user:password@wrong-endpoint/neondb" }],
    ["database", {
      ...validEnvironment,
      DATABASE_URL: `postgresql://user:password@${STAGING_E2E_CASE.endpointId}.eu-central-1.aws.neon.tech/other`,
    }],
  ])("rejects a mismatched %s", (_name, environment) => {
    expect(() => assertStagingE2eCaseEnvironment(environment)).toThrow();
  });

  it("uses identifiers distinct from the protected mission and case", () => {
    expect(STAGING_E2E_CASE.procedimentoId).not.toBe(STAGING_E2E_CASE.protectedCaseId);
    expect(STAGING_E2E_CASE.procedimentoId).not.toContain("7cd3faa5");
    expect(STAGING_E2E_CASE.tenantCode).toBe("DEMO-COMUNE-COSTIERO");
  });

  it("supports only create and explicit cleanup modes", () => {
    expect(parseStagingE2eCaseMode([])).toBe("create");
    expect(parseStagingE2eCaseMode(["--cleanup"])).toBe("cleanup");
    expect(() => parseStagingE2eCaseMode(["--unknown"])).toThrow();
  });
});
