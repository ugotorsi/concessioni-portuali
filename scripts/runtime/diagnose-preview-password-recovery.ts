import { createHash } from "node:crypto";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const missionId = process.argv[2]?.trim();
if (!missionId || !/^research-mission:[a-f0-9]{64}$/.test(missionId)) {
  throw new Error("RESEARCH_MISSION_ID_REQUIRED");
}
if (process.env.VERCEL_ENV !== "preview") {
  throw new Error("PREVIEW_ENVIRONMENT_REQUIRED");
}

const workosUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  external_id: z.string().min(1).nullable(),
});
const workosUserListSchema = z.object({
  data: z.array(workosUserSchema),
});

function digest(value: string | null): string | null {
  return value
    ? createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16)
    : null;
}

function safeProviderValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && /^[A-Za-z0-9_.:/-]{1,128}$/.test(normalized)
    ? normalized
    : null;
}

async function responseDiagnostic(response: Response) {
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  const message = typeof body?.message === "string" ? body.message : null;
  return {
    httpStatus: response.status,
    providerCode: safeProviderValue(body?.code ?? body?.error_code ?? body?.error),
    providerRequestId: safeProviderValue(
      response.headers.get("x-request-id")
        ?? response.headers.get("workos-request-id")
        ?? response.headers.get("x-workos-request-id"),
    ),
    providerMessageDigest: digest(message),
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.WORKOS_API_KEY?.trim();
  const clientId = process.env.WORKOS_CLIENT_ID?.trim();
  if (!apiKey || !clientId) throw new Error("WORKOS_RECOVERY_CONFIG_REQUIRED");

  const mission = await prisma.researchMissionRecord.findUnique({
    where: { id: missionId },
    select: {
      assignedActorId: true,
      assignedActor: {
        select: {
          id: true,
          email: true,
          attivo: true,
          mfaEnabled: true,
          mfaSecret: true,
          mfaVerifiedAt: true,
        },
      },
    },
  });
  const actor = mission?.assignedActor;
  if (!mission?.assignedActorId || !actor) throw new Error("ASSIGNED_ACTOR_REQUIRED");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const externalIdResponse = await fetch(
    `https://api.workos.com/user_management/users/external_id/${encodeURIComponent(actor.id)}`,
    { headers, cache: "no-store" },
  );
  const externalIdDiagnostic = await responseDiagnostic(externalIdResponse);
  const externalIdUser = externalIdResponse.ok
    ? workosUserSchema.safeParse(await externalIdResponse.json())
    : null;

  const emailUrl = new URL("https://api.workos.com/user_management/users");
  emailUrl.searchParams.set("email", actor.email);
  emailUrl.searchParams.set("limit", "10");
  const emailResponse = await fetch(emailUrl, { headers, cache: "no-store" });
  const emailDiagnostic = await responseDiagnostic(emailResponse);
  const emailUsers = emailResponse.ok
    ? workosUserListSchema.safeParse(await emailResponse.json())
    : null;
  const exactEmailUsers = emailUsers?.success
    ? emailUsers.data.data.filter(
        (user) => user.email.toLowerCase() === actor.email.toLowerCase(),
      )
    : [];

  console.log(JSON.stringify({
    environment: {
      vercelEnvironment: process.env.VERCEL_ENV,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      clientIdDigest: digest(clientId),
      apiKeyConfigured: true,
    },
    localIdentity: {
      actorDigest: digest(actor.id),
      emailDigest: digest(actor.email.toLowerCase()),
      active: actor.attivo,
      mfaEnabled: actor.mfaEnabled,
      mfaSecretPresent: actor.mfaSecret !== null,
      mfaVerified: actor.mfaVerifiedAt !== null,
    },
    externalIdLookup: {
      ...externalIdDiagnostic,
      responseValid: externalIdUser?.success ?? false,
      identityMatches: externalIdUser?.success
        ? externalIdUser.data.external_id === actor.id
          && externalIdUser.data.email.toLowerCase() === actor.email.toLowerCase()
          && externalIdUser.data.email_verified
        : false,
    },
    emailLookup: {
      ...emailDiagnostic,
      responseValid: emailUsers?.success ?? false,
      exactMatchCount: exactEmailUsers.length,
      users: exactEmailUsers.map((user) => ({
        userDigest: digest(user.id),
        emailVerified: user.email_verified,
        externalIdPresent: user.external_id !== null,
        externalIdMatches: user.external_id === actor.id,
        externalIdDigest: digest(user.external_id),
      })),
    },
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
