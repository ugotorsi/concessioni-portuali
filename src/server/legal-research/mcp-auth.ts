import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

import { prisma } from "@/lib/prisma";

export const RESEARCH_MCP_READ_SCOPE = "research:read" as const;
export const RESEARCH_MCP_WRITE_SCOPE = "research:write" as const;
export const RESEARCH_MCP_ACTOR_ID_CLAIM = "urn:concessioni-portuali:actor_id" as const;
export const RESEARCH_MCP_TENANT_ID_CLAIM = "urn:concessioni-portuali:tenant_id" as const;

export type ResearchMcpScope =
  | typeof RESEARCH_MCP_READ_SCOPE
  | typeof RESEARCH_MCP_WRITE_SCOPE;

export type ResearchMcpPrincipal = Readonly<{
  actorId: string;
  tenantId: string;
  claimantId: string;
  scopes: readonly ResearchMcpScope[];
}>;

export type ResearchMcpAuthConfig = Readonly<{
  issuer: string;
  resource: string;
  jwksUri: string;
}>;

export type ResearchMcpLocalIdentity = Readonly<{
  active: boolean;
  defaultTenantId: string | null;
  tenantIds: readonly string[];
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
    readonly requiredScopes: readonly ResearchMcpScope[] = [],
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

function tokenScopes(payload: JWTPayload): ResearchMcpScope[] {
  const raw = payload.scope ?? payload.scp ?? payload.permissions;
  const values = typeof raw === "string"
    ? raw.split(/\s+/)
    : Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
  return [RESEARCH_MCP_READ_SCOPE, RESEARCH_MCP_WRITE_SCOPE].filter((scope) => values.includes(scope));
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
      tenantMemberships: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { enteId: true, isDefault: true },
      },
    },
  });
  if (!user) return null;
  return {
    active: user.attivo,
    defaultTenantId: user.tenantMemberships.find((membership) => membership.isDefault)?.enteId
      ?? user.tenantMemberships[0]?.enteId
      ?? null,
    tenantIds: user.tenantMemberships.map((membership) => membership.enteId),
  };
}

export function createWorkosResearchMcpPrincipalVerifier(options: Readonly<{
  config?: ResearchMcpAuthConfig | null;
  verifyJwt?: ResearchMcpJwtVerifier;
  resolveIdentity?: ResearchMcpIdentityResolver;
  requiredScopes?: readonly ResearchMcpScope[];
}> = {}): ResearchMcpPrincipalVerifier {
  const config = options.config === undefined ? getResearchMcpAuthConfig() : options.config;
  const verifyJwt = options.verifyJwt
    ?? (config ? createJoseResearchMcpJwtVerifier(createRemoteJWKSet(new URL(config.jwksUri))) : null);
  const resolveIdentity = options.resolveIdentity ?? resolveLocalIdentity;
  const requiredScopes = options.requiredScopes ?? [RESEARCH_MCP_READ_SCOPE];

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

      const scopes = tokenScopes(payload);
      const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));
      if (missingScopes.length > 0) {
        throw new ResearchMcpAuthError("FORBIDDEN", 403, missingScopes);
      }

      const identity = await resolveIdentity(actorId);
      if (!identity?.active) throw new ResearchMcpAuthError("FORBIDDEN", 403);

      const requestedTenantId = payload[RESEARCH_MCP_TENANT_ID_CLAIM];
      const tenantId = typeof requestedTenantId === "string"
        ? requestedTenantId
        : identity.defaultTenantId;
      if (!tenantId || !identity.tenantIds.includes(tenantId)) {
        throw new ResearchMcpAuthError("FORBIDDEN", 403);
      }

      return {
        actorId,
        tenantId,
        claimantId: `workos:${subject}`,
        scopes,
      };
    },
  };
}

export function researchMcpWwwAuthenticate(config: ResearchMcpAuthConfig, options: Readonly<{
  error?: "invalid_token" | "insufficient_scope";
  scopes?: readonly ResearchMcpScope[];
}> = {}): string {
  const fields = [
    `resource_metadata="${researchMcpProtectedResourceMetadataUrl(config.resource)}"`,
    ...(options.error ? [`error="${options.error}"`] : []),
    ...(options.scopes?.length ? [`scope="${options.scopes.join(" ")}"`] : []),
  ];
  return `Bearer ${fields.join(", ")}`;
}

export function researchMcpAuthResponse(
  config: ResearchMcpAuthConfig | null,
  options: Readonly<{
    status?: 401 | 403 | 503;
    error?: "AUTH_REQUIRED" | "FORBIDDEN" | "AUTH_UNAVAILABLE";
    invalidToken?: boolean;
    scopes?: readonly ResearchMcpScope[];
  }> = {},
): Response {
  const status = options.status ?? 401;
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (config && status !== 503) {
    headers.set("WWW-Authenticate", researchMcpWwwAuthenticate(config, {
      error: status === 403 ? "insufficient_scope" : options.invalidToken ? "invalid_token" : undefined,
      scopes: options.scopes,
    }));
  }
  return Response.json(
    { error: options.error ?? "AUTH_REQUIRED" },
    { status, headers },
  );
}