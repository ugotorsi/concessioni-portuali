import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getResearchMcpAuthConfig, RESEARCH_MCP_TENANT_ID_CLAIM } from "@/server/legal-research/mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json({ error: "AUTH_UNAVAILABLE" }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
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
    const completion = await fetch("https://api.workos.com/authkit/oauth2/complete", {
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
    if (!completion.ok) return unavailable();

    const body = await completion.json() as { redirect_uri?: unknown };
    if (typeof body.redirect_uri !== "string") return unavailable();
    redirectUri = new URL(body.redirect_uri);
  } catch {
    return unavailable();
  }
  if (redirectUri.protocol !== "https:" || redirectUri.origin !== new URL(config.issuer).origin) {
    return unavailable();
  }
  return Response.redirect(redirectUri);
}