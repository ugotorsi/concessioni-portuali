import { cookies } from "next/headers";
import QRCode from "qrcode";
import { z } from "zod";

import { getAuthSession } from "@/lib/next-auth";
import {
  createMfaOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyMfaCode,
} from "@/lib/mfa";
import { buildRateLimitKey, checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { isTrustedJsonMutation, untrustedMutationResponse } from "@/lib/request-security";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";

const ENROLLMENT_COOKIE = "noetra-mfa-enrollment";
const enrollmentSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

async function getEnrollmentSession() {
  const session = await getAuthSession();
  if (!session?.user?.id || !session.user.mfaEnrollmentRequired) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await getEnrollmentSession();
  if (!session) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const secret = generateMfaSecret();
  const accountLabel = session.user.email ?? session.user.id;
  const otpauthUri = createMfaOtpAuthUri(secret, accountLabel);
  const cookieStore = await cookies();
  cookieStore.set(
    ENROLLMENT_COOKIE,
    encryptMfaSecret(JSON.stringify({ userId: session.user.id, secret })),
    {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/mfa/enrollment",
      maxAge: 10 * 60,
    },
  );

  return Response.json({
    qrCodeDataUrl: await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: "M", margin: 1 }),
    manualKey: secret,
  });
}

export async function POST(request: Request) {
  if (!isTrustedJsonMutation(request)) {
    return untrustedMutationResponse();
  }

  const session = await getEnrollmentSession();
  if (!session) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = await checkRateLimit({
    key: `${buildRateLimitKey("auth:mfa-enrollment", request.headers)}:${session.user.id}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit);
  }

  const parsed = enrollmentSchema.safeParse(await request.json().catch(() => null));
  const cookieStore = await cookies();
  const encryptedEnrollment = cookieStore.get(ENROLLMENT_COOKIE)?.value;
  if (!parsed.success || !encryptedEnrollment) {
    return Response.json({ error: "Invalid MFA enrollment request." }, { status: 400 });
  }

  let enrollment: { userId: string; secret: string };
  try {
    enrollment = JSON.parse(decryptMfaSecret(encryptedEnrollment)) as typeof enrollment;
  } catch {
    return Response.json({ error: "Invalid MFA enrollment request." }, { status: 400 });
  }

  if (enrollment.userId !== session.user.id || !verifyMfaCode(enrollment.secret, parsed.data.code)) {
    await auditFailure({
      azione: "AUTH_MFA_FAILURE",
      entita: "User",
      entitaId: session.user.id,
      actor: {
        userId: session.user.id,
        userEmail: session.user.email,
        userRole: session.user.role,
      },
      metadata: { phase: "enrollment" },
    });
    return Response.json({ error: "Invalid verification code." }, { status: 400 });
  }

  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      mfaEnabled: true,
      mfaSecret: encryptMfaSecret(enrollment.secret),
      mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
      mfaVerifiedAt: new Date(),
    },
  });
  await auditSuccess({
    azione: "AUTH_MFA_ENROLL",
    entita: "User",
    entitaId: session.user.id,
    actor: {
      userId: session.user.id,
      userEmail: session.user.email,
      userRole: session.user.role,
    },
  });
  cookieStore.delete(ENROLLMENT_COOKIE);

  return Response.json({ recoveryCodes });
}