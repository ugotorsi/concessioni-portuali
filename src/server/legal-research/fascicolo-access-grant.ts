import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { DemoRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadTenantResource, type CurrentTenantContext } from "@/lib/tenant-auth";

import { deriveFascicoloContextScope } from "./fascicolo-context";
import type { ResearchMcpPrincipal } from "./mcp-auth";

export const RESEARCH_FASCICOLO_ACCESS_GRANT_VERSION = "fg1" as const;
export const RESEARCH_FASCICOLO_ACCESS_GRANT_PURPOSE = "RESEARCH_FASCICOLO_ACCESS" as const;
export const RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER = "x-concessioni-fascicolo-grant" as const;
export const RESEARCH_FASCICOLO_ACCESS_GRANT_DEFAULT_TTL_SECONDS = 1_800;
export const RESEARCH_FASCICOLO_ACCESS_GRANT_MIN_TTL_SECONDS = 300;
export const RESEARCH_FASCICOLO_ACCESS_GRANT_MAX_TTL_SECONDS = 3_600;

export type ResearchFascicoloAccessGrantPayload = Readonly<{
  version: typeof RESEARCH_FASCICOLO_ACCESS_GRANT_VERSION;
  purpose: typeof RESEARCH_FASCICOLO_ACCESS_GRANT_PURPOSE;
  actorId: string;
  tenantId: string;
  fascicoloScopeId: string;
  originMissionId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}>;

export type ResearchFascicoloAccessGrantErrorCode =
  | "FASCICOLO_BINDING_REQUIRED"
  | "FASCICOLO_BINDING_INVALID"
  | "FASCICOLO_BINDING_EXPIRED"
  | "FASCICOLO_BINDING_FORBIDDEN"
  | "FASCICOLO_SCOPE_MISMATCH";

export type ResearchFascicoloAccessGrantDiagnosticCode =
  | "TRUSTED_READ_USER_ABSENT_OR_INACTIVE"
  | "TRUSTED_READ_MISSION_ABSENT"
  | "TRUSTED_READ_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED"
  | "TRUSTED_READ_GRANT_SECRET_INVALID"
  | "TRUSTED_READ_GRANT_TTL_INVALID";

export class ResearchFascicoloAccessGrantError extends Error {
  readonly status = 403 as const;

  constructor(
    readonly code: ResearchFascicoloAccessGrantErrorCode,
    readonly diagnosticCode?: ResearchFascicoloAccessGrantDiagnosticCode,
  ) {
    super(code);
    this.name = "ResearchFascicoloAccessGrantError";
  }
}

type GrantMissionContext = Readonly<{
  missionId: string;
  tenantId: string | null;
  caseId: string;
  fascicoloReference: string | null;
  actorActive: boolean;
  tenantContext: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">;
}>;

type GrantOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}>;

type MintOptions = GrantOptions & Readonly<{
  nonce?: () => string;
  loadMissionContext?: (missionId: string, actorId: string) => Promise<GrantMissionContext | null>;
}>;

function grantSecret(env: NodeJS.ProcessEnv): Buffer {
  const secret = env.MCP_FASCICOLO_GRANT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_INVALID",
      "TRUSTED_READ_GRANT_SECRET_INVALID",
    );
  }
  return Buffer.from(secret, "utf8");
}

function grantTtlSeconds(env: NodeJS.ProcessEnv): number {
  const raw = env.MCP_FASCICOLO_GRANT_TTL_SECONDS;
  if (raw === undefined || raw === "") return RESEARCH_FASCICOLO_ACCESS_GRANT_DEFAULT_TTL_SECONDS;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl)
    || ttl < RESEARCH_FASCICOLO_ACCESS_GRANT_MIN_TTL_SECONDS
    || ttl > RESEARCH_FASCICOLO_ACCESS_GRANT_MAX_TTL_SECONDS) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_INVALID",
      "TRUSTED_READ_GRANT_TTL_INVALID",
    );
  }
  return ttl;
}

function signature(payload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function isGrantPayload(value: unknown): value is ResearchFascicoloAccessGrantPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.version === RESEARCH_FASCICOLO_ACCESS_GRANT_VERSION
    && payload.purpose === RESEARCH_FASCICOLO_ACCESS_GRANT_PURPOSE
    && typeof payload.actorId === "string" && Boolean(payload.actorId)
    && typeof payload.tenantId === "string" && Boolean(payload.tenantId)
    && typeof payload.fascicoloScopeId === "string" && payload.fascicoloScopeId.startsWith("fascicolo-scope:")
    && typeof payload.originMissionId === "string" && Boolean(payload.originMissionId)
    && Number.isInteger(payload.issuedAt)
    && Number.isInteger(payload.expiresAt)
    && typeof payload.nonce === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(payload.nonce);
}

async function loadMissionContext(missionId: string, actorId: string): Promise<GrantMissionContext | null> {
  const [mission, user] = await Promise.all([
    prisma.researchMissionRecord.findUnique({
      where: { id: missionId },
      select: { id: true, tenantId: true, caseId: true, fascicoloReference: true },
    }),
    prisma.user.findUnique({
      where: { id: actorId },
      select: {
        attivo: true,
        ruolo: true,
        tenantMemberships: { select: { enteId: true } },
      },
    }),
  ]);
  if (!mission) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_FORBIDDEN",
      "TRUSTED_READ_MISSION_ABSENT",
    );
  }
  if (!user || !user.attivo) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_FORBIDDEN",
      "TRUSTED_READ_USER_ABSENT_OR_INACTIVE",
    );
  }
  const role = user.ruolo as DemoRole;
  return {
    missionId: mission.id,
    tenantId: mission.tenantId,
    caseId: mission.caseId,
    fascicoloReference: mission.fascicoloReference,
    actorActive: user.attivo,
    tenantContext: {
      role,
      isAdmin: role === "ADMIN",
      accessibleTenantIds: user.tenantMemberships.map((membership) => membership.enteId),
    },
  };
}

export async function mintResearchFascicoloAccessGrant(
  input: Readonly<{
    missionId: string;
    principal: Pick<ResearchMcpPrincipal, "actorId" | "tenantId">;
  }>,
  options: MintOptions = {},
): Promise<Readonly<{
  grant: string;
  expiresAt: string;
  fascicoloScopeId: string;
}>> {
  const env = options.env ?? process.env;
  const secret = grantSecret(env);
  const context = await (options.loadMissionContext ?? loadMissionContext)(
    input.missionId,
    input.principal.actorId,
  );
  if (!context) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_FORBIDDEN",
      "TRUSTED_READ_MISSION_ABSENT",
    );
  }
  if (!context.actorActive) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_FORBIDDEN",
      "TRUSTED_READ_USER_ABSENT_OR_INACTIVE",
    );
  }
  if (!context.tenantId || context.tenantId !== input.principal.tenantId
    || !canReadTenantResource(context.tenantContext, context.tenantId, { allowWhenEnteMissing: false })) {
    throw new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_FORBIDDEN",
      "TRUSTED_READ_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED",
    );
  }
  const scope = deriveFascicoloContextScope({
    tenantId: context.tenantId,
    caseReference: {
      caseId: context.caseId,
      ...(context.fascicoloReference ? { fascicoloReference: context.fascicoloReference } : {}),
    },
  });
  const issuedAt = Math.floor((options.now?.() ?? new Date()).getTime() / 1_000);
  const expiresAt = issuedAt + grantTtlSeconds(env);
  const payload: ResearchFascicoloAccessGrantPayload = {
    version: RESEARCH_FASCICOLO_ACCESS_GRANT_VERSION,
    purpose: RESEARCH_FASCICOLO_ACCESS_GRANT_PURPOSE,
    actorId: input.principal.actorId,
    tenantId: context.tenantId,
    fascicoloScopeId: scope.scopeId,
    originMissionId: context.missionId,
    issuedAt,
    expiresAt,
    nonce: options.nonce?.() ?? randomBytes(18).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const encodedSignature = signature(encodedPayload, secret).toString("base64url");
  return {
    grant: `${RESEARCH_FASCICOLO_ACCESS_GRANT_VERSION}.${encodedPayload}.${encodedSignature}`,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    fascicoloScopeId: scope.scopeId,
  };
}

export function verifyResearchFascicoloAccessGrant(
  grant: string | null | undefined,
  principal: Pick<ResearchMcpPrincipal, "actorId" | "tenantId">,
  options: GrantOptions = {},
): ResearchFascicoloAccessGrantPayload {
  if (!grant) throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_REQUIRED");
  const secret = grantSecret(options.env ?? process.env);
  const parts = grant.split(".");
  if (parts.length !== 3 || parts[0] !== RESEARCH_FASCICOLO_ACCESS_GRANT_VERSION) {
    throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_INVALID");
  }
  let suppliedSignature: Buffer;
  let payload: unknown;
  try {
    suppliedSignature = Buffer.from(parts[2], "base64url");
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_INVALID");
  }
  const expectedSignature = signature(parts[1], secret);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
    || !isGrantPayload(payload)
    || payload.expiresAt <= payload.issuedAt
    || payload.expiresAt - payload.issuedAt > RESEARCH_FASCICOLO_ACCESS_GRANT_MAX_TTL_SECONDS) {
    throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_INVALID");
  }
  const now = Math.floor((options.now?.() ?? new Date()).getTime() / 1_000);
  if (payload.expiresAt <= now) {
    throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_EXPIRED");
  }
  if (payload.actorId !== principal.actorId || payload.tenantId !== principal.tenantId) {
    throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_FORBIDDEN");
  }
  return payload;
}