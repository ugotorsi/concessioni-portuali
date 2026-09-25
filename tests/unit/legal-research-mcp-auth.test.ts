import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type KeyLike,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

const findUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: findUserMock } },
}));

import { GET as protectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import {
  RESEARCH_MCP_ACTOR_ID_CLAIM,
  RESEARCH_MCP_TENANT_ID_CLAIM,
  ResearchMcpAuthError,
  createJoseResearchMcpJwtVerifier,
  createWorkosResearchMcpPrincipalVerifier,
  getResearchMcpAuthConfig,
  researchMcpAuthResponse,
  type ResearchMcpAuthConfig,
  type ResearchMcpLocalIdentity,
} from "@/server/legal-research/mcp-auth";

const config: ResearchMcpAuthConfig = {
  issuer: "https://auth.example.workos.com",
  resource: "https://mcp.example.test/api/mcp",
  jwksUri: "https://auth.example.workos.com/oauth2/jwks",
};

const activeIdentity: ResearchMcpLocalIdentity = {
  active: true,
  role: "GIURIDICO",
  isAdmin: false,
  defaultTenantId: "tenant-a",
  tenantIds: ["tenant-a", "tenant-b"],
  accessibleTenantIds: ["tenant-a", "tenant-b"],
};

let firstPrivateKey: KeyLike;
let secondPrivateKey: KeyLike;
let firstJwk: JWK;
let secondJwk: JWK;

beforeAll(async () => {
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  firstPrivateKey = first.privateKey;
  secondPrivateKey = second.privateKey;
  firstJwk = { ...await exportJWK(first.publicKey), kid: "key-1", alg: "RS256", use: "sig" };
  secondJwk = { ...await exportJWK(second.publicKey), kid: "key-2", alg: "RS256", use: "sig" };
});

async function token(options: Readonly<{
  key?: KeyLike;
  kid?: string;
  issuer?: string;
  audience?: string;
  expiresAt?: string;
  scope?: string;
  permissions?: string[];
  actorId?: string | null;
  tenantId?: string | null;
}> = {}): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (options.scope !== undefined) claims.scope = options.scope;
  if (options.permissions !== undefined) claims.permissions = options.permissions;
  if (options.actorId !== null) claims[RESEARCH_MCP_ACTOR_ID_CLAIM] = options.actorId ?? "actor-a";
  if (options.tenantId !== null) claims[RESEARCH_MCP_TENANT_ID_CLAIM] = options.tenantId ?? "tenant-a";

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "key-1" })
    .setSubject("user_workos_a")
    .setIssuer(options.issuer ?? config.issuer)
    .setAudience(options.audience ?? config.resource)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? "5m")
    .sign(options.key ?? firstPrivateKey);
}

function request(accessToken?: string): Request {
  return new Request(config.resource, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}

function verifier(jwks: JWK[] = [firstJwk, secondJwk], identity = activeIdentity) {
  return createWorkosResearchMcpPrincipalVerifier({
    config,
    verifyJwt: createJoseResearchMcpJwtVerifier(createLocalJWKSet({ keys: jwks })),
    resolveIdentity: async () => identity,
  });
}

describe("Block 3B.13D WorkOS MCP auth", () => {
  it("derives permissions through the default local identity resolver using User.ruolo", async () => {
    findUserMock.mockResolvedValueOnce({
      attivo: true,
      ruolo: "GIURIDICO",
      tenantMemberships: [{ enteId: "tenant-a", isDefault: true }],
    });
    const auth = createWorkosResearchMcpPrincipalVerifier({
      config,
      verifyJwt: async () => ({
        sub: "user_workos_a",
        [RESEARCH_MCP_ACTOR_ID_CLAIM]: "actor-a",
        [RESEARCH_MCP_TENANT_ID_CLAIM]: "tenant-a",
      }),
    });

    const principal = await auth.verify(request("signed-token"));
    expect(findUserMock).toHaveBeenCalledWith({
      where: { id: "actor-a" },
      select: {
        attivo: true,
        ruolo: true,
        tenantMemberships: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: { enteId: true, isDefault: true },
        },
      },
    });
    expect(findUserMock.mock.calls[0]?.[0]?.select).not.toHaveProperty("role");
    expect(principal).toMatchObject({
      actorId: "actor-a",
      tenantId: "tenant-a",
      permissions: ["research:read", "research:write"],
    });
  });

  it("accepts valid tokens across JWKS key rotation and maps immutable local identity", async () => {
    const auth = verifier();
    for (const accessToken of [
      await token(),
      await token({ key: secondPrivateKey, kid: "key-2", tenantId: "tenant-b" }),
    ]) {
      const principal = await auth.verify(request(accessToken));
      expect(principal).toMatchObject({
        actorId: "actor-a",
        claimantId: "workos:user_workos_a",
        permissions: ["research:read", "research:write"],
      });
      expect(activeIdentity.tenantIds).toContain(principal?.tenantId);
    }
  });

  it.each([
    ["wrong issuer", () => token({ issuer: "https://attacker.example" })],
    ["wrong audience", () => token({ audience: "https://other.example/api/mcp" })],
    ["expired token", () => token({ expiresAt: "0s" })],
    ["unknown signing key", () => token({ key: secondPrivateKey, kid: "key-2" })],
  ])("rejects %s", async (_label, createToken) => {
    const auth = _label === "unknown signing key" ? verifier([firstJwk]) : verifier();
    expect(await auth.verify(request(await createToken()))).toBeNull();
  });

  it.each([
    ["missing token", undefined],
    ["malformed bearer", "not-a-jwt"],
  ])("rejects %s", async (_label, accessToken) => {
    expect(await verifier().verify(request(accessToken))).toBeNull();
  });

  it.each([
    ["scope", { scope: "research:write" }],
    ["permissions", { permissions: ["research:write"] }],
  ] as const)("does not derive local permissions from the JWT %s claim", async (_label, claims) => {
    const identity = { ...activeIdentity, accessibleTenantIds: [] };
    const principal = await verifier(undefined, identity).verify(request(await token(claims)));
    expect(principal?.permissions).toEqual([]);
  });

  it.each([
    [
      "disabled local user",
      { ...activeIdentity, active: false },
      "tenant-a",
      "TRUSTED_READ_USER_ABSENT_OR_INACTIVE",
    ],
    [
      "cross-tenant claim",
      activeIdentity,
      "tenant-c",
      "TRUSTED_READ_TENANT_ABSENT_OR_MEMBERSHIP_DENIED",
    ],
    ["no local membership", {
      ...activeIdentity,
      defaultTenantId: null,
      tenantIds: [],
      accessibleTenantIds: [],
    }, null, "TRUSTED_READ_TENANT_ABSENT_OR_MEMBERSHIP_DENIED"],
  ] as const)("rejects %s", async (_label, identity, tenantId, diagnosticCode) => {
    await expect(verifier(undefined, identity).verify(request(await token({ tenantId }))))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403, diagnosticCode });
  });

  it("uses the local default tenant when the signed tenant claim is absent", async () => {
    const principal = await verifier().verify(request(await token({ tenantId: null })));
    expect(principal?.tenantId).toBe("tenant-a");
  });

  it("fails closed with AUTH_UNAVAILABLE when provider configuration is absent", async () => {
    const auth = createWorkosResearchMcpPrincipalVerifier({ config: null });
    await expect(auth.verify(request())).rejects.toEqual(
      expect.objectContaining<Partial<ResearchMcpAuthError>>({ code: "AUTH_UNAVAILABLE", status: 503 }),
    );
  });

  it("publishes exact protected-resource metadata", async () => {
    const previousIssuer = process.env.WORKOS_AUTHKIT_ISSUER;
    const previousResource = process.env.MCP_RESOURCE_URI;
    process.env.WORKOS_AUTHKIT_ISSUER = config.issuer;
    process.env.MCP_RESOURCE_URI = config.resource;
    try {
      const response = await protectedResourceMetadata();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: config.resource,
        authorization_servers: [config.issuer],
        bearer_methods_supported: ["header"],
      });
    } finally {
      if (previousIssuer === undefined) delete process.env.WORKOS_AUTHKIT_ISSUER;
      else process.env.WORKOS_AUTHKIT_ISSUER = previousIssuer;
      if (previousResource === undefined) delete process.env.MCP_RESOURCE_URI;
      else process.env.MCP_RESOURCE_URI = previousResource;
    }
  });

  it("emits authentication-only bearer challenges", () => {
    const unauthorized = researchMcpAuthResponse(config);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    expect(unauthorized.headers.get("WWW-Authenticate")).not.toContain("research:");

    const invalid = researchMcpAuthResponse(config, { invalidToken: true });
    expect(invalid.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(invalid.headers.get("WWW-Authenticate")).not.toContain("research:");

    const forbidden = researchMcpAuthResponse(config, {
      status: 403,
      error: "FORBIDDEN",
    });
    expect(forbidden.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("accepts only complete HTTPS provider configuration", () => {
    expect(getResearchMcpAuthConfig({
      WORKOS_AUTHKIT_ISSUER: config.issuer,
      MCP_RESOURCE_URI: config.resource,
    } as NodeJS.ProcessEnv)).toEqual(config);
    expect(getResearchMcpAuthConfig({
      WORKOS_AUTHKIT_ISSUER: "http://auth.example.test",
      MCP_RESOURCE_URI: config.resource,
    } as NodeJS.ProcessEnv)).toBeNull();
  });
});