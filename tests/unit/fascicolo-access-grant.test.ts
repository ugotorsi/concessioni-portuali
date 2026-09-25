import { describe, expect, it } from "vitest";

import {
  mintResearchFascicoloAccessGrant,
  ResearchFascicoloAccessGrantError,
  verifyResearchFascicoloAccessGrant,
} from "@/server/legal-research/fascicolo-access-grant";
import type { ResearchMcpPrincipal } from "@/server/legal-research/mcp-auth";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-04-01T10:00:00.000Z");

const principal: ResearchMcpPrincipal = {
  actorId: "user-a",
  tenantId: "tenant-a",
  claimantId: "workos:subject-a",
  permissions: ["research:read", "research:write"],
};

const missionContext = {
  missionId: "mission-a",
  tenantId: "tenant-a",
  caseId: "case-a",
  fascicoloReference: "FASC-2026-001",
  actorActive: true,
  tenantContext: {
    role: "GIURIDICO" as const,
    isAdmin: false,
    accessibleTenantIds: ["tenant-a"],
  },
};

const env = {
  MCP_FASCICOLO_GRANT_SECRET: SECRET,
  MCP_FASCICOLO_GRANT_TTL_SECONDS: "1800",
} as NodeJS.ProcessEnv;

async function mint(overrides: Record<string, unknown> = {}) {
  return mintResearchFascicoloAccessGrant(
    { missionId: "mission-a", principal },
    {
      env,
      now: () => NOW,
      nonce: () => "deterministic_nonce_12345",
      loadMissionContext: async () => ({ ...missionContext, ...overrides }),
    },
  );
}

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof ResearchFascicoloAccessGrantError ? error.code : undefined;
  }
}

describe("trusted fascicolo access grants", () => {
  it("mints and verifies a deterministic actor, tenant, mission, and scope binding", async () => {
    const minted = await mint();
    expect(minted.grant).toMatch(/^fg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(minted.expiresAt).toBe("2026-04-01T10:30:00.000Z");

    const payload = verifyResearchFascicoloAccessGrant(minted.grant, principal, { env, now: () => NOW });
    expect(payload).toEqual(expect.objectContaining({
      actorId: "user-a",
      tenantId: "tenant-a",
      originMissionId: "mission-a",
      fascicoloScopeId: minted.fascicoloScopeId,
      issuedAt: 1_775_037_600,
      expiresAt: 1_775_039_400,
    }));
    expect(JSON.stringify(payload)).not.toContain(minted.grant);
  });

  it("rejects missing, malformed, and tampered grants", async () => {
    expect(errorCode(() => verifyResearchFascicoloAccessGrant(undefined, principal, { env })))
      .toBe("FASCICOLO_BINDING_REQUIRED");
    expect(errorCode(() => verifyResearchFascicoloAccessGrant("not-a-grant", principal, { env })))
      .toBe("FASCICOLO_BINDING_INVALID");

    const minted = await mint();
    const parts = minted.grant.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}A`;
    expect(errorCode(() => verifyResearchFascicoloAccessGrant(tampered, principal, { env, now: () => NOW })))
      .toBe("FASCICOLO_BINDING_INVALID");
  });

  it("distinguishes expiry from actor and tenant mismatches", async () => {
    const minted = await mint();
    expect(errorCode(() => verifyResearchFascicoloAccessGrant(minted.grant, principal, {
      env,
      now: () => new Date("2026-04-01T10:30:00.000Z"),
    }))).toBe("FASCICOLO_BINDING_EXPIRED");
    expect(errorCode(() => verifyResearchFascicoloAccessGrant(minted.grant, {
      actorId: "user-b",
      tenantId: "tenant-a",
    }, { env, now: () => NOW }))).toBe("FASCICOLO_BINDING_FORBIDDEN");
    expect(errorCode(() => verifyResearchFascicoloAccessGrant(minted.grant, {
      actorId: "user-a",
      tenantId: "tenant-b",
    }, { env, now: () => NOW }))).toBe("FASCICOLO_BINDING_FORBIDDEN");
  });

  it("fails closed for inactive actors, cross-tenant missions, and missing membership", async () => {
    await expect(mint({ actorActive: false })).rejects.toMatchObject({
      code: "FASCICOLO_BINDING_FORBIDDEN",
      diagnosticCode: "TRUSTED_READ_USER_ABSENT_OR_INACTIVE",
    });
    await expect(mint({ tenantId: "tenant-b" })).rejects.toMatchObject({
      code: "FASCICOLO_BINDING_FORBIDDEN",
      diagnosticCode: "TRUSTED_READ_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED",
    });
    await expect(mint({
      tenantContext: { role: "GIURIDICO", isAdmin: false, accessibleTenantIds: [] },
    })).rejects.toMatchObject({
      code: "FASCICOLO_BINDING_FORBIDDEN",
      diagnosticCode: "TRUSTED_READ_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED",
    });
    await expect(mintResearchFascicoloAccessGrant(
      { missionId: "missing-mission", principal },
      { env, loadMissionContext: async () => null },
    )).rejects.toMatchObject({
      code: "FASCICOLO_BINDING_FORBIDDEN",
      diagnosticCode: "TRUSTED_READ_MISSION_ABSENT",
    });
  });

  it("requires a secret of at least 32 bytes and a bounded TTL", async () => {
    await expect(mintResearchFascicoloAccessGrant(
      { missionId: "mission-a", principal },
      { env: { MCP_FASCICOLO_GRANT_SECRET: "too-short" }, loadMissionContext: async () => missionContext },
    )).rejects.toMatchObject({
      code: "FASCICOLO_BINDING_INVALID",
      diagnosticCode: "TRUSTED_READ_GRANT_SECRET_INVALID",
    });
    await expect(mintResearchFascicoloAccessGrant(
      { missionId: "mission-a", principal },
      {
        env: { ...env, MCP_FASCICOLO_GRANT_TTL_SECONDS: "3601" },
        loadMissionContext: async () => missionContext,
      },
    )).rejects.toMatchObject({
      code: "FASCICOLO_BINDING_INVALID",
      diagnosticCode: "TRUSTED_READ_GRANT_TTL_INVALID",
    });
  });
});