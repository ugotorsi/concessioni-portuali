import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { decryptMfaSecret, isMfaRequiredRole, verifyMfaCode } from "@/lib/mfa";
import { resolveNextAuthSecret } from "@/lib/next-auth-secret";
import { prisma } from "@/lib/prisma";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";

const DUMMY_PASSWORD_HASH = "$2a$10$7x44xI7qxyfGeQ8YV6f8wum8Iat3A80efjhbj4AtNQ35n4NQH6aQW";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
});

function getAuthMaxFailedAttempts(): number {
  const parsed = Number.parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS ?? "5", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }

  return parsed;
}

function getAuthLockoutMinutes(): number {
  const parsed = Number.parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? "15", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 15;
  }

  return parsed;
}

async function recordAuthFailure(input: {
  action?: "AUTH_LOGIN_FAILURE" | "AUTH_MFA_FAILURE" | "AUTH_ACCOUNT_LOCKED";
  userId?: string;
  email: string;
  role?: string;
  reason: string;
}): Promise<void> {
  await auditFailure({
    azione: input.action ?? "AUTH_LOGIN_FAILURE",
    entita: "User",
    entitaId: input.userId,
    actor: {
      userId: input.userId,
      userEmail: input.email,
      userRole: input.role,
    },
    metadata: { reason: input.reason },
  }).catch(() => undefined);
}

export const authOptions: NextAuthOptions = {
  secret: resolveNextAuthSecret(),
  useSecureCookies: process.env.NODE_ENV === "production",
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email e password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "Codice MFA", type: "text" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);

        if (!parsed.success) {
          return null;
        }

        const now = new Date();
        const maxFailedAttempts = getAuthMaxFailedAttempts();
        const lockoutMinutes = getAuthLockoutMinutes();
        const email = parsed.data.email.toLowerCase();

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            nome: true,
            ruolo: true,
            attivo: true,
            passwordHash: true,
            failedLoginAttempts: true,
            lockedUntil: true,
            mfaEnabled: true,
            mfaSecret: true,
            mustChangePassword: true,
          },
        });

        if (!user) {
          await bcrypt.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
          await recordAuthFailure({ email, reason: "invalid_credentials" });
          return null;
        }

        if (!user.attivo) {
          await recordAuthFailure({
            userId: user.id,
            email,
            role: user.ruolo,
            reason: "account_inactive",
          });
          return null;
        }

        if (!user.passwordHash) {
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > now) {
          await recordAuthFailure({
            action: "AUTH_ACCOUNT_LOCKED",
            userId: user.id,
            email,
            role: user.ruolo,
            reason: "account_locked",
          });
          return null;
        }

        const isPasswordValid = await bcrypt.compare(parsed.data.password, user.passwordHash);

        if (!isPasswordValid) {
          const updatedAttempts = user.failedLoginAttempts + 1;
          const shouldLock = updatedAttempts >= maxFailedAttempts;

          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: updatedAttempts,
              lastFailedLoginAt: now,
              lockedUntil: shouldLock ? new Date(now.getTime() + lockoutMinutes * 60 * 1000) : null,
            },
          });

          await recordAuthFailure({
            action: shouldLock ? "AUTH_ACCOUNT_LOCKED" : "AUTH_LOGIN_FAILURE",
            userId: user.id,
            email,
            role: user.ruolo,
            reason: shouldLock ? "lockout_threshold_reached" : "invalid_credentials",
          });

          return null;
        }

        const mfaEnrollmentRequired = isMfaRequiredRole(user.ruolo) && !user.mfaEnabled;
        let mfaVerified = !user.mfaEnabled;

        if (user.mfaEnabled) {
          if (!parsed.data.mfaCode) {
            throw new Error("MFA_REQUIRED");
          }

          const rateLimit = await checkRateLimit({
            key: `auth:mfa:${createHash("sha256").update(email).digest("hex")}`,
            limit: 5,
            windowMs: 60_000,
          });
          if (!rateLimit.allowed) {
            throw new Error("MFA_RATE_LIMITED");
          }

          if (!user.mfaSecret) {
            await recordAuthFailure({
              action: "AUTH_MFA_FAILURE",
              userId: user.id,
              email,
              role: user.ruolo,
              reason: "mfa_configuration_invalid",
            });
            return null;
          }

          let secret: string;
          try {
            secret = decryptMfaSecret(user.mfaSecret);
          } catch {
            await recordAuthFailure({
              action: "AUTH_MFA_FAILURE",
              userId: user.id,
              email,
              role: user.ruolo,
              reason: "mfa_configuration_invalid",
            });
            return null;
          }

          if (!verifyMfaCode(secret, parsed.data.mfaCode)) {
            await recordAuthFailure({
              action: "AUTH_MFA_FAILURE",
              userId: user.id,
              email,
              role: user.ruolo,
              reason: "invalid_otp",
            });
            throw new Error("MFA_INVALID");
          }

          mfaVerified = true;
          await auditSuccess({
            azione: "AUTH_MFA_SUCCESS",
            entita: "User",
            entitaId: user.id,
            actor: { userId: user.id, userEmail: email, userRole: user.ruolo },
          }).catch(() => undefined);
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastFailedLoginAt: null,
            lastLoginAt: now,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.nome,
          role: user.ruolo,
          mfaEnrollmentRequired,
          mfaVerified,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.mfaEnrollmentRequired = user.mfaEnrollmentRequired === true;
        token.mfaVerified = user.mfaVerified === true;
      }

      return token;
    },
    async session({ session, token }) {
      if (!token.id || token.invalidated) {
        if (session.user) {
          session.user.id = "";
          session.user.role = "";
          session.user.mfaEnrollmentRequired = false;
        }
        return session;
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: { attivo: true, ruolo: true, lockedUntil: true, mfaEnabled: true },
      });
      const operationalMfaMissing =
        !!currentUser
        && isMfaRequiredRole(currentUser.ruolo)
        && currentUser.mfaEnabled
        && token.mfaVerified !== true;

      if (
        !currentUser
        || !currentUser.attivo
        || (currentUser.lockedUntil && currentUser.lockedUntil > new Date())
        || currentUser.ruolo !== token.role
        || operationalMfaMissing
      ) {
        token.invalidated = true;
        if (session.user) {
          session.user.id = "";
          session.user.role = "";
          session.user.mfaEnrollmentRequired = false;
        }
        return session;
      }

      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : "";
        session.user.role = typeof token.role === "string" ? token.role : "";
        session.user.mfaEnrollmentRequired = token.mfaEnrollmentRequired === true;
      }

      return session;
    },
  },
  events: {
    async signIn({ user }) {
      await auditSuccess({
        azione: "AUTH_LOGIN_SUCCESS",
        entita: "User",
        entitaId: user.id,
        actor: {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
        },
      }).catch(() => undefined);
    },
  },
};

export function getAuthSession() {
  return getServerSession(authOptions);
}
