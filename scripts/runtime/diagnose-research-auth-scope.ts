import { createHash } from "node:crypto";

import { resolveAuthSessionCookieName } from "@/lib/auth-session-cookie";
import { prisma } from "@/lib/prisma";

const missionId = process.argv[2]?.trim();
if (!missionId || !/^research-mission:[a-f0-9]{64}$/.test(missionId)) {
  throw new Error("RESEARCH_MISSION_ID_REQUIRED");
}

function digest(value: string | null): string | null {
  return value ? createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16) : null;
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return "INVALID_URL";
  }
}

function isConfigured(value: string | undefined, minimumLength = 1): boolean {
  return typeof value === "string" && value.trim().length >= minimumLength;
}

function auditReason(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const reason = (metadata as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const database = new URL(databaseUrl);
  const mission = await prisma.researchMissionRecord.findUnique({
    where: { id: missionId },
    select: {
      id: true,
      caseId: true,
      tenantId: true,
      assignedActorId: true,
      assignedActor: {
        select: {
          id: true,
          ruolo: true,
          attivo: true,
          passwordHash: true,
          passwordChangedAt: true,
          lastLoginAt: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          mfaEnabled: true,
          mfaSecret: true,
          mustChangePassword: true,
          tenantMemberships: {
            select: {
              enteId: true,
              role: true,
              isDefault: true,
            },
          },
        },
      },
    },
  });

  const authEvents = mission?.assignedActorId
    ? await prisma.activityLog.findMany({
        where: {
          userId: mission.assignedActorId,
          azione: {
            in: [
              "AUTH_LOGIN_FAILURE",
              "AUTH_MFA_FAILURE",
              "AUTH_ACCOUNT_LOCKED",
              "AUTH_MFA_SUCCESS",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          azione: true,
          esito: true,
          metadata: true,
          createdAt: true,
        },
      })
    : [];

  const now = new Date();
  const actor = mission?.assignedActor ?? null;
  const passwordHashMatch = actor?.passwordHash
    ? actor.passwordHash.match(/^\$(2[abxy])\$(\d{2})\$[./A-Za-z0-9]{53}$/)
    : null;
  const matchingMemberships = actor?.tenantMemberships.filter(
    (membership) => membership.enteId === mission?.tenantId,
  ) ?? [];

  console.log(JSON.stringify({
    environment: {
      vercelEnvironment: process.env.VERCEL_ENV ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentOrigin: safeOrigin(
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      ),
      nextAuthOrigin: safeOrigin(process.env.NEXTAUTH_URL),
      mcpResourceOrigin: safeOrigin(process.env.MCP_RESOURCE_URI),
      databaseHostDigest: digest(database.hostname),
      databaseName: database.pathname.replace(/^\//, ""),
      sessionCookieName: resolveAuthSessionCookieName(),
      nextAuthSecretConfigured: isConfigured(process.env.NEXTAUTH_SECRET, 32),
      mfaEncryptionKeyConfigured: isConfigured(process.env.MFA_ENCRYPTION_KEY),
      workosApiKeyConfigured: isConfigured(process.env.WORKOS_API_KEY),
      workosIssuerConfigured: isConfigured(process.env.WORKOS_AUTHKIT_ISSUER),
    },
    mission: {
      id: missionId,
      exists: mission !== null,
      caseId: mission?.caseId ?? null,
      tenantDigest: digest(mission?.tenantId ?? null),
      assignedActorDigest: digest(mission?.assignedActorId ?? null),
    },
    assignedActor: actor ? {
      actorDigest: digest(actor.id),
      active: actor.attivo,
      role: actor.ruolo,
      passwordHashPresent: actor.passwordHash !== null,
      passwordHashFormatValid: passwordHashMatch !== null,
      passwordHashAlgorithm: passwordHashMatch?.[1] ?? null,
      passwordHashCost: passwordHashMatch ? Number.parseInt(passwordHashMatch[2], 10) : null,
      passwordChangedAt: actor.passwordChangedAt?.toISOString() ?? null,
      lastLoginAt: actor.lastLoginAt?.toISOString() ?? null,
      mfaEnabled: actor.mfaEnabled,
      mfaSecretPresent: actor.mfaSecret !== null,
      mustChangePassword: actor.mustChangePassword,
      failedLoginAttempts: actor.failedLoginAttempts,
      lockoutActive: actor.lockedUntil !== null && actor.lockedUntil > now,
      lockedUntil: actor.lockedUntil?.toISOString() ?? null,
      membershipCount: actor.tenantMemberships.length,
      missionTenantMembershipCount: matchingMemberships.length,
      missionTenantDefaultMembership: matchingMemberships.some(
        (membership) => membership.isDefault,
      ),
      missionTenantRoles: [...new Set(matchingMemberships.map((membership) => membership.role))],
    } : null,
    recentAuthEvents: authEvents.map((event) => ({
      action: event.azione,
      outcome: event.esito,
      reason: auditReason(event.metadata),
      createdAt: event.createdAt.toISOString(),
    })),
  }, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
