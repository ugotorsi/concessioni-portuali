import bcrypt from "bcryptjs";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const DUMMY_PASSWORD_HASH = "$2a$10$7x44xI7qxyfGeQ8YV6f8wum8Iat3A80efjhbj4AtNQ35n4NQH6aQW";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? "phase1-demo-auth-secret-change-me",
  session: {
    strategy: "jwt",
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
          },
        });

        if (!user) {
          await bcrypt.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
          return null;
        }

        if (!user.attivo || !user.passwordHash) {
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > now) {
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

          return null;
        }

        if (user.mfaEnabled) {
          return null;
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
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : "";
        session.user.role = typeof token.role === "string" ? token.role : "";
      }

      return session;
    },
  },
};

export function getAuthSession() {
  return getServerSession(authOptions);
}
