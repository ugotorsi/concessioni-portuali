import { createHash } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkosUser = {
  id?: unknown;
  email?: unknown;
  email_verified?: unknown;
  external_id?: unknown;
};

async function workosList(apiKey: string, url: URL): Promise<unknown[] | null> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = await response.json() as { data?: unknown };
  return Array.isArray(body.data) ? body.data : null;
}

export async function GET(): Promise<Response> {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (actor.role !== "ADMIN") return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503 });

  const localUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      email: true,
      attivo: true,
      ruolo: true,
      mfaEnabled: true,
      mfaVerifiedAt: true,
      tenantMemberships: {
        select: { enteId: true, role: true, isDefault: true },
      },
      assignedResearchMissions: {
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
        select: { id: true },
      },
    },
  });
  if (
    !localUser?.attivo
    || localUser.ruolo !== "ADMIN"
    || !localUser.mfaEnabled
    || !localUser.mfaVerifiedAt
  ) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const usersUrl = new URL("https://api.workos.com/user_management/users");
  usersUrl.searchParams.set("email", localUser.email);
  usersUrl.searchParams.set("limit", "2");
  const matchingUsers = await workosList(apiKey, usersUrl);
  if (!matchingUsers) return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503 });

  const workosUser = matchingUsers.length === 1
    ? matchingUsers[0] as WorkosUser
    : null;
  const validWorkosUser = workosUser
    && typeof workosUser.id === "string"
    && /^user_[A-Za-z0-9]{1,128}$/.test(workosUser.id)
    && typeof workosUser.email === "string"
    ? workosUser
    : null;

  if (!validWorkosUser) {
    return Response.json({
      uniqueWorkosUser: false,
      matchingWorkosUserCount: matchingUsers.length,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const workosUserId = validWorkosUser.id as string;
  const workosEmail = validWorkosUser.email as string;
  const priorExternalId = typeof validWorkosUser.external_id === "string"
    ? validWorkosUser.external_id
    : null;
  const priorLocalUser = priorExternalId
    ? await prisma.user.findUnique({
        where: { id: priorExternalId },
        select: { id: true, email: true, attivo: true },
      })
    : null;

  const membershipsUrl = new URL("https://api.workos.com/user_management/organization_memberships");
  membershipsUrl.searchParams.set("user_id", workosUserId);
  membershipsUrl.searchParams.set("limit", "100");
  const applicationsUrl = new URL(
    `https://api.workos.com/user_management/users/${encodeURIComponent(workosUserId)}/authorized_applications`,
  );
  const sessionsUrl = new URL(
    `https://api.workos.com/user_management/users/${encodeURIComponent(workosUserId)}/sessions`,
  );
  const [memberships, applications, sessions] = await Promise.all([
    workosList(apiKey, membershipsUrl),
    workosList(apiKey, applicationsUrl),
    workosList(apiKey, sessionsUrl),
  ]);
  if (!memberships || !applications || !sessions) {
    return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503 });
  }

  const activeMembershipCount = memberships.filter((membership) => (
    membership
    && typeof membership === "object"
    && (membership as { status?: unknown }).status === "active"
  )).length;
  const noetraAuthorizedApplicationCount = applications.filter((application) => (
    application
    && typeof application === "object"
    && (application as { oauth_resource?: unknown }).oauth_resource === "https://app.noetra.it/api/mcp"
  )).length;
  const authorizedApplications = applications.map((application) => {
    if (!application || typeof application !== "object") return null;
    const record = application as {
      oauth_resource?: unknown;
      application?: { name?: unknown };
    };
    return {
      resource: typeof record.oauth_resource === "string" ? record.oauth_resource : null,
      name: typeof record.application?.name === "string" ? record.application.name : null,
    };
  });

  return Response.json({
    uniqueWorkosUser: true,
    matchingWorkosUserCount: 1,
    exactEmailMatch: workosEmail.toLowerCase() === localUser.email.toLowerCase(),
    workosEmailVerified: validWorkosUser.email_verified === true,
    priorExternalIdPresent: priorExternalId !== null,
    priorExternalIdMatchesCurrentUser: priorExternalId === localUser.id,
    priorExternalIdMapsToLocalUser: priorLocalUser !== null,
    priorExternalIdMapsToSameEmail: priorLocalUser?.email.toLowerCase() === localUser.email.toLowerCase(),
    priorExternalIdMapsToActiveLocalUser: priorLocalUser?.attivo === true,
    localAccountActive: localUser.attivo,
    localAccountAdmin: localUser.ruolo === "ADMIN",
    localAccountMfaVerified: localUser.mfaEnabled && localUser.mfaVerifiedAt !== null,
    localTenantMembershipCount: localUser.tenantMemberships.length,
    localDefaultTenantMembershipCount: localUser.tenantMemberships.filter((membership) => membership.isDefault).length,
    activeAssignedResearchMissionCount: localUser.assignedResearchMissions.length,
    workosOrganizationMembershipCount: memberships.length,
    activeWorkosOrganizationMembershipCount: activeMembershipCount,
    authorizedApplicationCount: applications.length,
    noetraAuthorizedApplicationCount,
    authorizedApplications,
    activeSessionCount: sessions.length,
    priorBindingRestorable: priorExternalId !== null && priorExternalId.length <= 64,
    priorBindingFingerprint: priorExternalId
      ? createHash("sha256").update(priorExternalId).digest("hex")
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
