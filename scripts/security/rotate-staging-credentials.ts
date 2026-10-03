import bcrypt from "bcryptjs";

import { prisma } from "../../src/lib/prisma";
import { createAuditLogInTransaction } from "../../src/server/audit/auditLog";

const EXPECTED_BRANCH_ID = "br-frosty-moon-atdf29s8";
const EXPECTED_ENDPOINT_ID = "ep-jolly-hall-atts00ke";
const knownPasswords = [
  "admin123",
  "operatore123",
  "giuridico123",
  "tecnico123",
  "economico123",
  "adsp123",
  "pm123",
  "lockout123",
];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const branchId = requiredEnvironment("NEON_BRANCH_ID");
  const databaseUrl = new URL(requiredEnvironment("DATABASE_URL"));
  const email = requiredEnvironment("STAGING_OPERATIONAL_EMAIL").toLowerCase();
  const password = requiredEnvironment("STAGING_OPERATIONAL_PASSWORD");

  if (branchId !== EXPECTED_BRANCH_ID || !databaseUrl.hostname.startsWith(EXPECTED_ENDPOINT_ID)) {
    throw new Error("Credential rotation is restricted to the staging-operativo Neon branch.");
  }
  if (email.endsWith("@demo.local") || email.endsWith("@concessioni.local")) {
    throw new Error("Operational identity cannot use a demo domain.");
  }
  if (password.length < 24) throw new Error("Operational password must contain at least 24 characters.");

  const activeUsers = await prisma.user.findMany({
    where: { attivo: true },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      ruolo: true,
      tenantMemberships: { select: { enteId: true, isDefault: true } },
    },
  });
  const sourceAdmin = activeUsers.find((user) => user.ruolo === "ADMIN" && user.tenantMemberships.length > 0);
  if (!sourceAdmin) throw new Error("No active ADMIN tenant membership is available for operational provisioning.");

  const knownCredentialUserIds: string[] = [];
  for (const user of activeUsers) {
    if (!user.passwordHash) continue;
    const matchesKnownPassword = (await Promise.all(
      knownPasswords.map((knownPassword) => bcrypt.compare(knownPassword, user.passwordHash!)),
    )).some(Boolean);
    if (matchesKnownPassword) knownCredentialUserIds.push(user.id);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async (tx) => {
    const operationalUser = await tx.user.upsert({
      where: { email },
      create: {
        nome: "Pre-production Security Admin",
        email,
        passwordHash,
        ruolo: "ADMIN",
        attivo: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: undefined,
        mfaVerifiedAt: null,
      },
      update: {
        nome: "Pre-production Security Admin",
        passwordHash,
        ruolo: "ADMIN",
        attivo: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: undefined,
        mfaVerifiedAt: null,
      },
      select: { id: true, passwordHash: true },
    });

    await tx.tenantMembership.deleteMany({ where: { userId: operationalUser.id } });
    await tx.tenantMembership.createMany({
      data: sourceAdmin.tenantMemberships.map((membership) => ({
        userId: operationalUser.id,
        enteId: membership.enteId,
        role: "ADMIN" as const,
        isDefault: membership.isDefault,
      })),
    });

    const disabled = await tx.user.updateMany({
      where: {
        id: { in: knownCredentialUserIds },
        NOT: { id: operationalUser.id },
      },
      data: { attivo: false },
    });

    await createAuditLogInTransaction(tx, {
      azione: "STAGING_CREDENTIAL_ROTATION",
      entita: "User",
      entitaId: operationalUser.id,
      actor: { userId: operationalUser.id, userEmail: email, userRole: "ADMIN" },
      requestContext: { ipAddress: null, userAgent: "security-hardening-cli" },
      esito: "SUCCESS",
      metadata: {
        branchId,
        disabledKnownCredentialUsers: disabled.count,
        operationalMemberships: sourceAdmin.tenantMemberships.length,
      },
    });

    return {
      disabledKnownCredentialUsers: disabled.count,
      operationalMemberships: sourceAdmin.tenantMemberships.length,
      credentialVerified: await bcrypt.compare(password, operationalUser.passwordHash ?? ""),
    };
  });

  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Credential rotation failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());