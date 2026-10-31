import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";

import { validatePasswordPolicy } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";
import {
  buildRateLimitKey,
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
} from "@/lib/rate-limit";
import {
  auditFailure,
  createAuditLogInTransaction,
} from "@/server/audit/auditLog";
import {
  getPreviewPasswordRecoveryConfig,
  PreviewPasswordRecoveryError,
  requireVerifiedWorkosIdentity,
  sendWorkosMagicAuthCode,
  verifyWorkosMagicAuthCode,
} from "@/server/auth/preview-password-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  action: z.literal("start"),
  email: z.string().email().transform((value) => value.toLowerCase()),
});

const completeSchema = z.object({
  action: z.literal("complete"),
  email: z.string().email().transform((value) => value.toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(1).max(128),
});

const requestSchema = z.discriminatedUnion("action", [startSchema, completeSchema]);
const genericStartResponse = { ok: true, message: "Se l'account e recuperabile, riceverai un codice email." };

function emailRateLimitKey(scope: string, email: string): string {
  return `${scope}:${createHash("sha256").update(email).digest("hex")}`;
}

function clientContext(request: Request): Readonly<{
  ipAddress?: string;
  userAgent?: string;
}> {
  const ipAddress = getClientIp(request.headers);
  return {
    ...(ipAddress !== "unknown" ? { ipAddress } : {}),
    ...(request.headers.get("user-agent")
      ? { userAgent: request.headers.get("user-agent")!.slice(0, 512) }
      : {}),
  };
}

function recoveryLog(
  code: string,
  diagnostic?: PreviewPasswordRecoveryError["diagnostic"],
): void {
  console.error(JSON.stringify({
    event: "preview_password_recovery",
    code,
    ...diagnostic,
  }));
}

async function recordFailure(input: Readonly<{
  userId?: string;
  email: string;
  role?: string;
  reason: string;
  diagnostic?: PreviewPasswordRecoveryError["diagnostic"];
}>): Promise<void> {
  try {
    await auditFailure({
      azione: "AUTH_PASSWORD_RECOVERY_FAILURE",
      entita: "User",
      entitaId: input.userId,
      actor: {
        userId: input.userId,
        userEmail: input.email,
        userRole: input.role,
      },
      metadata: {
        reason: input.reason,
        ...input.diagnostic,
      },
    });
  } catch {
    recoveryLog("AUDIT_FAILURE");
  }
}

async function findRecoverableUser(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      ruolo: true,
      attivo: true,
      mfaEnabled: true,
      mfaSecret: true,
      mfaVerifiedAt: true,
    },
  });
}

async function startRecovery(
  request: Request,
  email: string,
  config: NonNullable<ReturnType<typeof getPreviewPasswordRecoveryConfig>>,
): Promise<Response> {
  const emailLimit = await checkRateLimit({
    key: emailRateLimitKey("auth:password-recovery:start", email),
    limit: 3,
    windowMs: 15 * 60_000,
  });
  if (!emailLimit.allowed) return Response.json(genericStartResponse, { status: 202 });

  const user = await findRecoverableUser(email);
  if (
    !user?.attivo
    || !user.mfaEnabled
    || !user.mfaSecret
    || !user.mfaVerifiedAt
  ) {
    await bcrypt.compare("not-a-real-password", "$2a$10$7x44xI7qxyfGeQ8YV6f8wum8Iat3A80efjhbj4AtNQ35n4NQH6aQW");
    return Response.json(genericStartResponse, { status: 202 });
  }

  try {
    await requireVerifiedWorkosIdentity({
      localUserId: user.id,
      email: user.email,
      config,
    });
    await sendWorkosMagicAuthCode({
      email: user.email,
      config,
      ...clientContext(request),
    });
  } catch (error) {
    const reason = error instanceof PreviewPasswordRecoveryError
      ? error.code
      : "WORKOS_REQUEST_FAILED";
    await recordFailure({
      userId: user.id,
      email: user.email,
      role: user.ruolo,
      reason,
      ...(error instanceof PreviewPasswordRecoveryError
        ? { diagnostic: error.diagnostic }
        : {}),
    });
    recoveryLog(
      reason,
      error instanceof PreviewPasswordRecoveryError ? error.diagnostic : undefined,
    );
  }

  return Response.json(genericStartResponse, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

async function completeRecovery(
  request: Request,
  input: z.infer<typeof completeSchema>,
  config: NonNullable<ReturnType<typeof getPreviewPasswordRecoveryConfig>>,
): Promise<Response> {
  const emailLimit = await checkRateLimit({
    key: emailRateLimitKey("auth:password-recovery:complete", input.email),
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (!emailLimit.allowed) return createRateLimitResponse(emailLimit);

  const passwordValidation = validatePasswordPolicy(input.password, input.email);
  if (!passwordValidation.valid) {
    return Response.json(
      { error: "PASSWORD_POLICY_REJECTED", details: passwordValidation.errors },
      { status: 400 },
    );
  }

  const user = await findRecoverableUser(input.email);
  if (
    !user?.attivo
    || !user.mfaEnabled
    || !user.mfaSecret
    || !user.mfaVerifiedAt
  ) {
    return Response.json({ error: "RECOVERY_VERIFICATION_FAILED" }, { status: 400 });
  }

  try {
    await verifyWorkosMagicAuthCode({
      email: user.email,
      code: input.code,
      localUserId: user.id,
      config,
      ...clientContext(request),
    });
  } catch (error) {
    const reason = error instanceof PreviewPasswordRecoveryError
      ? error.code
      : "WORKOS_REQUEST_FAILED";
    await recordFailure({
      userId: user.id,
      email: user.email,
      role: user.ruolo,
      reason,
      ...(error instanceof PreviewPasswordRecoveryError
        ? { diagnostic: error.diagnostic }
        : {}),
    });
    return Response.json({ error: "RECOVERY_VERIFICATION_FAILED" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const changedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          email: true,
          attivo: true,
          mfaEnabled: true,
          mfaSecret: true,
          mfaVerifiedAt: true,
        },
      });
      if (
        !current?.attivo
        || current.email.toLowerCase() !== input.email
        || !current.mfaEnabled
        || !current.mfaSecret
        || !current.mfaVerifiedAt
      ) {
        throw new PreviewPasswordRecoveryError("WORKOS_IDENTITY_MISMATCH");
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: changedAt,
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
          mustChangePassword: false,
        },
      });
      await createAuditLogInTransaction(tx, {
        azione: "AUTH_PASSWORD_RECOVERY_SUCCESS",
        entita: "User",
        entitaId: user.id,
        esito: "SUCCESS",
        actor: {
          userId: user.id,
          userEmail: user.email,
          userRole: user.ruolo,
        },
        metadata: {
          workosEmailVerified: true,
          mfaPreserved: true,
        },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const reason = error instanceof PreviewPasswordRecoveryError
      ? error.code
      : "PASSWORD_UPDATE_FAILED";
    await recordFailure({
      userId: user.id,
      email: user.email,
      role: user.ruolo,
      reason,
      ...(error instanceof PreviewPasswordRecoveryError
        ? { diagnostic: error.diagnostic }
        : {}),
    });
    recoveryLog(
      reason,
      error instanceof PreviewPasswordRecoveryError ? error.diagnostic : undefined,
    );
    return Response.json({ error: "RECOVERY_UPDATE_FAILED" }, { status: 409 });
  }

  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const config = getPreviewPasswordRecoveryConfig();
  if (!config) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const requestLimit = await checkRateLimit({
    key: buildRateLimitKey("auth:password-recovery", request.headers),
    limit: 10,
    windowMs: 15 * 60_000,
  });
  if (!requestLimit.allowed) return createRateLimitResponse(requestLimit);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "INVALID_RECOVERY_REQUEST" }, { status: 400 });
  }
  return parsed.data.action === "start"
    ? startRecovery(request, parsed.data.email, config)
    : completeRecovery(request, parsed.data, config);
}
