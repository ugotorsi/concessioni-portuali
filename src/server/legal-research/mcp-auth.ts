import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

import type { DemoRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canReadTenantResource,
  canWriteTenantResource,
  resolveAccessibleTenantIds,
} from "@/lib/tenant-auth";

export const RESEARCH_MCP_READ_PERMISSION = "research:read" as const;
export const RESEARCH_MCP_WRITE_PERMISSION = "research:write" as const;
export const RESEARCH_MCP_ACTOR_ID_CLAIM = "urn:concessioni-portuali:actor_id" as const;
export const RESEARCH_MCP_TENANT_ID_CLAIM = "urn:concessioni-portuali:tenant_id" as const;

export type ResearchMcpPermission =
  | typeof RESEARCH_MCP_READ_PERMISSION
  | typeof RESEARCH_MCP_WRITE_PERMISSION;

export type ResearchMcpPrincipal = Readonly<{
  actorId: string;
  tenantId: string;
  claimantId: string;
  permissions: readonly ResearchMcpPermission[];
}>;

export type ResearchMcpAuthConfig = Readonly<{
  issuer: string;
  resource: string;
  jwksUri: string;
}>;

export type ResearchMcpLocalIdentity = Readonly<{
  active: boolean;
  role: DemoRole;
  isAdmin: boolean;
  defaultTenantId: string | null;
  tenantIds: readonly string[];
  accessibleTenantIds: readonly string[];
}>;

export type ResearchMcpJwtVerifier = (
  token: string,
  config: ResearchMcpAuthConfig,
) => Promise<JWTPayload>;

export type ResearchMcpIdentityResolver = (
  actorId: string,
) => Promise<ResearchMcpLocalIdentity | null>;

export interface ResearchMcpPrincipalVerifier {
  verify(request: Request): Promise<ResearchMcpPrincipal | null>;
}

export class ResearchMcpAuthError extends Error {
  constructor(
    readonly code: "AUTH_UNAVAILABLE" | "FORBIDDEN",
    readonly status: 503 | 403,
  ) {
    super(code);
    this.name = "ResearchMcpAuthError";
  }
}

function configuredHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getResearchMcpAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResearchMcpAuthConfig | null {
  const issuer = configuredHttpsUrl(env.WORKOS_AUTHKIT_ISSUER);
  const resource = configuredHttpsUrl(env.MCP_RESOURCE_URI);
  if (!issuer || !resource) return null;
  return { issuer, resource, jwksUri: `${issuer}/oauth2/jwks` };
}

export function researchMcpProtectedResourceMetadataUrl(resource: string): string {
  return `${new URL(resource).origin}/.well-known/oauth-protected-resource`;
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function createJoseResearchMcpJwtVerifier(jwks: JWTVerifyGetKey): ResearchMcpJwtVerifier {
  return async (token, config) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["RS256"],
    });
    return payload;
  };
}

async function resolveLocalIdentity(actorId: string): Promise<ResearchMcpLocalIdentity | null> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: {
      attivo: true,
      role: true,
      tenantMemberships: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { enteId: true, isDefault: true },
      },
    },
  });
  if (!user) return null;
  const role = user.role as DemoRole;
  return {
    active: user.attivo,
    role,
    isAdmin: role === "ADMIN",
    defaultTenantId: user.tenantMemberships.find((membership) => membership.isDefault)?.enteId
      ?? user.tenantMemberships[0]?.enteId
      ?? null,
    tenantIds: user.tenantMemberships.map((membership) => membership.enteId),
    accessibleTenantIds: resolveAccessibleTenantIds({ role, memberships: user.tenantMemberships }),
  };
}

export function createWorkosResearchMcpPrincipalVerifier(options: Readonly<{
  config?: ResearchMcpAuthConfig | null;
  verifyJwt?: ResearchMcpJwtVerifier;
  resolveIdentity?: ResearchMcpIdentityResolver;
}> = {}): ResearchMcpPrincipalVerifier {
  const config = options.config === undefined ? getResearchMcpAuthConfig() : options.config;
  const verifyJwt = options.verifyJwt
    ?? (config ? createJoseResearchMcpJwtVerifier(createRemoteJWKSet(new URL(config.jwksUri))) : null);
  const resolveIdentity = options.resolveIdentity ?? resolveLocalIdentity;

  return {
    async verify(request) {
      if (!config || !verifyJwt) throw new ResearchMcpAuthError("AUTH_UNAVAILABLE", 503);
      const token = bearerToken(request);
      if (!token) return null;

      let payload: JWTPayload;
      try {
        payload = await verifyJwt(token, config);
      } catch {
        return null;
      }

      const actorId = payload[RESEARCH_MCP_ACTOR_ID_CLAIM];
      const subject = payload.sub;
      if (typeof actorId !== "string" || !actorId || typeof subject !== "string" || !subject) return null;

      const identity = await resolveIdentity(actorId);
      if (!identity?.active) throw new ResearchMcpAuthError("FORBIDDEN", 403);

      const requestedTenantId = payload[RESEARCH_MCP_TENANT_ID_CLAIM];
      const tenantId = typeof requestedTenantId === "string"
        ? requestedTenantId
        : identity.defaultTenantId;
      if (!tenantId || !identity.tenantIds.includes(tenantId)) {
        throw new ResearchMcpAuthError("FORBIDDEN", 403);
      }
      const localContext = {
        role: identity.role,
        isAdmin: identity.isAdmin,
        accessibleTenantIds: [...identity.accessibleTenantIds],
      };
      const permissions: ResearchMcpPermission[] = [];
      if (canReadTenantResource(localContext, tenantId, { allowWhenEnteMissing: false })) {
        permissions.push(RESEARCH_MCP_READ_PERMISSION);
      }
      if (canWriteTenantResource(localContext, tenantId, { allowWhenEnteMissing: false })) {
        permissions.push(RESEARCH_MCP_WRITE_PERMISSION);
      }

      return {
        actorId,
        tenantId,
        claimantId: `workos:${subject}`,
        permissions,
      };
    },
  };
}

export function researchMcpWwwAuthenticate(config: ResearchMcpAuthConfig, options: Readonly<{
  error?: "invalid_token";
}> = {}): string {
  const fields = [
    `resource_metadata="${researchMcpProtectedResourceMetadataUrl(config.resource)}"`,
    ...(options.error ? [`error="${options.error}"`] : []),
  ];
  return `Bearer ${fields.join(", ")}`;
}

export function researchMcpAuthResponse(
  config: ResearchMcpAuthConfig | null,
  options: Readonly<{
    status?: 401 | 403 | 503;
    error?: "AUTH_REQUIRED" | "FORBIDDEN" | "AUTH_UNAVAILABLE";
    invalidToken?: boolean;
  }> = {},
): Response {
  const status = options.status ?? 401;
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (config && status === 401) {
    headers.set("WWW-Authenticate", researchMcpWwwAuthenticate(config, {
      error: options.invalidToken ? "invalid_token" : undefined,
    }));
  }
  return Response.json(
    { error: options.error ?? "AUTH_REQUIRED" },
    { status, headers },
  );
}