import { createHash } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { getResearchMcpAuthConfig, RESEARCH_MCP_TENANT_ID_CLAIM } from "@/server/legal-research/mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json({ error: "AUTH_UNAVAILABLE" }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

function logCompletionFailure(input: Readonly<{
  stage: "WORKOS_RESPONSE" | "WORKOS_PAYLOAD" | "WORKOS_REQUEST" | "IDENTITY_RECONCILIATION" | "REDIRECT_VALIDATION";
  status?: number;
  code?: string;
  category?: "API_CREDENTIAL" | "CONSENT_OPTIONS" | "EXTERNAL_AUTH_ID" | "USER" | "VALIDATION_OTHER";
  reason?: "LIST_RESPONSE" | "LIST_CARDINALITY" | "INVALID_RECORD" | "EMAIL_UNVERIFIED"
    | "EXTERNAL_ID_CONFLICT" | "UPDATE_RESPONSE" | "UPDATE_MISMATCH";
}>): void {
  console.error(JSON.stringify({
    event: "workos_oauth_completion_failure",
    stage: input.stage,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.code ? { code: input.code } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  }));
}

async function workosErrorDetails(response: Response): Promise<Readonly<{
  code?: string;
  category?: "API_CREDENTIAL" | "CONSENT_OPTIONS" | "EXTERNAL_AUTH_ID" | "USER" | "VALIDATION_OTHER";
}>> {
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    const code = [body.error, body.code, body.error_code].find(
      (value): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value),
    );
    const text = JSON.stringify(body).toLowerCase().replace(/[_-]/g, " ");
    const category = text.includes("external_auth_id") || text.includes("external auth")
      ? "EXTERNAL_AUTH_ID"
      : text.includes("consent")
        ? "CONSENT_OPTIONS"
        : text.includes("api key") || text.includes("authentication")
          ? "API_CREDENTIAL"
          : text.includes("user")
            ? "USER"
            : "VALIDATION_OTHER";
    return { code, category };
  } catch {
    return {};
  }
}

async function reconcileVerifiedWorkosUser(input: Readonly<{
  apiKey: string;
  localUserId: string;
  email: string;
}>): Promise<
  | Readonly<{ ok: true }>
  | Readonly<{
    ok: false;
    reason: "LIST_RESPONSE" | "LIST_CARDINALITY" | "INVALID_RECORD" | "EMAIL_UNVERIFIED"
      | "EXTERNAL_ID_CONFLICT" | "UPDATE_RESPONSE" | "UPDATE_MISMATCH";
  }>
> {
  const listUrl = new URL("https://api.workos.com/user_management/users");
  listUrl.searchParams.set("email", input.email);
  listUrl.searchParams.set("limit", "2");
  const headers = { Authorization: `Bearer ${input.apiKey}` };
  const listResponse = await fetch(listUrl, { headers, cache: "no-store" });
  if (!listResponse.ok) return { ok: false, reason: "LIST_RESPONSE" };

  const listBody = await listResponse.json() as { data?: unknown };
  if (!Array.isArray(listBody.data) || listBody.data.length !== 1) {
    return { ok: false, reason: "LIST_CARDINALITY" };
  }
  const [existingUser] = listBody.data as Array<Record<string, unknown>>;
  if (
    typeof existingUser.id !== "string"
    || !/^user_[A-Za-z0-9]{1,128}$/.test(existingUser.id)
    || typeof existingUser.email !== "string"
    || existingUser.email.toLowerCase() !== input.email.toLowerCase()
  ) {
    return { ok: false, reason: "INVALID_RECORD" };
  }
  if (existingUser.email_verified !== true) {
    return { ok: false, reason: "EMAIL_UNVERIFIED" };
  }
  if (existingUser.external_id !== null && existingUser.external_id !== undefined) {
    if (
      typeof existingUser.external_id === "string"
      && await rebindVerifiedWorkosUser({
        apiKey: input.apiKey,
        localUserId: input.localUserId,
        workosUserId: existingUser.id,
        previousExternalId: existingUser.external_id,
      })
    ) {
      return { ok: true };
    }
    return { ok: false, reason: "EXTERNAL_ID_CONFLICT" };
  }

  const updateResponse = await fetch(
    `https://api.workos.com/user_management/users/${encodeURIComponent(existingUser.id)}`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ external_id: input.localUserId }),
      cache: "no-store",
    },
  );
  if (!updateResponse.ok) return { ok: false, reason: "UPDATE_RESPONSE" };
  const updatedUser = await updateResponse.json() as { external_id?: unknown };
  return updatedUser.external_id === input.localUserId
    ? { ok: true }
    : { ok: false, reason: "UPDATE_MISMATCH" };
}

async function workosIdentitySnapshot(apiKey: string, workosUserId: string): Promise<string | null> {
  const urls = [
    `https://api.workos.com/user_management/organization_memberships?user_id=${encodeURIComponent(workosUserId)}&limit=100`,
    `https://api.workos.com/user_management/users/${encodeURIComponent(workosUserId)}/authorized_applications`,
    `https://api.workos.com/user_management/users/${encodeURIComponent(workosUserId)}/sessions`,
  ];
  const responses = await Promise.all(urls.map((url) => fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  })));
  if (responses.some((response) => !response.ok)) return null;
  const lists = await Promise.all(responses.map(async (response) => {
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data)) return null;
    const ids = body.data.map((item) => (
      item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
        ? (item as { id: string }).id
        : null
    ));
    return ids.every((id): id is string => id !== null) ? ids.sort() : null;
  }));
  if (lists.some((list) => list === null)) return null;
  return createHash("sha256").update(JSON.stringify(lists)).digest("hex");
}

async function rebindVerifiedWorkosUser(input: Readonly<{
  apiKey: string;
  localUserId: string;
  workosUserId: string;
  previousExternalId: string;
}>): Promise<boolean> {
  const previousFingerprint = createHash("sha256").update(input.previousExternalId).digest("hex");
  if (
    process.env.WORKOS_EXTERNAL_ID_REBIND_PERMIT
    !== `${input.localUserId}:${previousFingerprint}`
  ) {
    return false;
  }
  const beforeSnapshot = await workosIdentitySnapshot(input.apiKey, input.workosUserId);
  if (!beforeSnapshot) return false;

  const userUrl = `https://api.workos.com/user_management/users/${encodeURIComponent(input.workosUserId)}`;
  const update = (externalId: string) => fetch(userUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ external_id: externalId }),
    cache: "no-store",
  });
  const updateResponse = await update(input.localUserId);
  if (!updateResponse.ok) {
    await auditFailure({
      azione: "WORKOS_EXTERNAL_ID_REBIND",
      entita: "WorkosUser",
      entitaId: input.workosUserId,
      metadata: { reason: "UPDATE_REJECTED", previousFingerprint },
    });
    return false;
  }
  const updatedUser = await updateResponse.json() as { id?: unknown; external_id?: unknown };
  const afterSnapshot = await workosIdentitySnapshot(input.apiKey, input.workosUserId);
  if (
    updatedUser.id !== input.workosUserId
    || updatedUser.external_id !== input.localUserId
    || afterSnapshot !== beforeSnapshot
  ) {
    const rollbackResponse = await update(input.previousExternalId);
    await auditFailure({
      azione: "WORKOS_EXTERNAL_ID_REBIND",
      entita: "WorkosUser",
      entitaId: input.workosUserId,
      metadata: {
        reason: "POSTCONDITION_FAILED",
        previousExternalId: input.previousExternalId,
        requestedExternalId: input.localUserId,
        rollbackSucceeded: rollbackResponse.ok,
        beforeSnapshot,
        afterSnapshot,
      },
    });
    return false;
  }

  try {
    await auditSuccess({
      azione: "WORKOS_EXTERNAL_ID_REBIND",
      entita: "WorkosUser",
      entitaId: input.workosUserId,
      metadata: {
        previousExternalId: input.previousExternalId,
        externalId: input.localUserId,
        invariantSnapshot: beforeSnapshot,
      },
    });
    return true;
  } catch {
    const rollbackResponse = await update(input.previousExternalId);
    await auditFailure({
      azione: "WORKOS_EXTERNAL_ID_REBIND",
      entita: "WorkosUser",
      entitaId: input.workosUserId,
      metadata: {
        reason: "AUDIT_WRITE_FAILED",
        previousExternalId: input.previousExternalId,
        requestedExternalId: input.localUserId,
        rollbackSucceeded: rollbackResponse.ok,
      },
    });
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const config = getResearchMcpAuthConfig();
  const apiKey = process.env.WORKOS_API_KEY;
  if (!config || !apiKey) return unavailable();

  const externalAuthId = new URL(request.url).searchParams.get("external_auth_id");
  if (!externalAuthId || !/^[A-Za-z0-9_-]{1,256}$/.test(externalAuthId)) {
    return Response.json({ error: "INVALID_EXTERNAL_AUTH_ID" }, { status: 400 });
  }

  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    const callbackUrl = `/api/auth/workos/complete?external_auth_id=${encodeURIComponent(externalAuthId)}`;
    return Response.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.url));
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      nome: true,
      email: true,
      attivo: true,
      tenantMemberships: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { enteId: true, ente: { select: { nome: true, codice: true } } },
      },
    },
  });
  if (!user?.attivo || user.tenantMemberships.length === 0) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let redirectUri: URL;
  try {
    const complete = () => fetch("https://api.workos.com/authkit/oauth2/complete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_auth_id: externalAuthId,
        user: { id: user.id, email: user.email, name: user.nome },
        user_consent_options: [{
          claim: RESEARCH_MCP_TENANT_ID_CLAIM,
          type: "enum",
          label: "Ente",
          choices: user.tenantMemberships.map((membership) => ({
            value: membership.enteId,
            label: `${membership.ente.nome} (${membership.ente.codice})`,
          })),
        }],
      }),
      cache: "no-store",
    });
    let completion = await complete();
    if (!completion.ok) {
      const details = await workosErrorDetails(completion);
      if (details.code === "email_not_available") {
        const reconciliation = await reconcileVerifiedWorkosUser({
          apiKey,
          localUserId: user.id,
          email: user.email,
        });
        if (reconciliation.ok) {
          completion = await complete();
        } else {
          logCompletionFailure({
            stage: "IDENTITY_RECONCILIATION",
            reason: reconciliation.reason,
          });
        }
      }
      if (!completion.ok) {
        const finalDetails = await workosErrorDetails(completion);
        logCompletionFailure({
          stage: "WORKOS_RESPONSE",
          status: completion.status,
          ...finalDetails,
        });
        return unavailable();
      }
    }

    const body = await completion.json() as { redirect_uri?: unknown };
    if (typeof body.redirect_uri !== "string") {
      logCompletionFailure({ stage: "WORKOS_PAYLOAD" });
      return unavailable();
    }
    redirectUri = new URL(body.redirect_uri);
  } catch {
    logCompletionFailure({ stage: "WORKOS_REQUEST" });
    return unavailable();
  }
  if (redirectUri.protocol !== "https:" || redirectUri.origin !== new URL(config.issuer).origin) {
    logCompletionFailure({ stage: "REDIRECT_VALIDATION" });
    return unavailable();
  }
  return Response.redirect(redirectUri);
}