import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const bootstrapSchema = z.object({
  token: z.string().min(32).max(256),
  nome: z.string().trim().min(2).max(120),
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

function verifyToken(token: string): boolean {
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN_SHA256;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "Bootstrap non disponibile." }, { status: 404 });
  }

  const parsed = bootstrapSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !verifyToken(parsed.data.token)) {
    return NextResponse.json({ error: "Bootstrap non autorizzato." }, { status: 403 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      if (await tx.user.count() !== 0) {
        throw new Error("ADMIN_BOOTSTRAP_ALREADY_COMPLETED");
      }
      const tenants = await tx.ente.findMany({ select: { id: true }, take: 2 });
      if (tenants.length !== 1) {
        throw new Error("ADMIN_BOOTSTRAP_TENANT_SCOPE_INVALID");
      }
      const user = await tx.user.create({
        data: {
          nome: parsed.data.nome,
          email: parsed.data.email,
          passwordHash,
          ruolo: "ADMIN",
          attivo: true,
          mustChangePassword: false,
          mfaEnabled: false,
        },
        select: { id: true },
      });
      await tx.tenantMembership.create({
        data: {
          userId: user.id,
          enteId: tenants[0].id,
          role: "ADMIN",
          isDefault: true,
        },
      });
    }, { isolationLevel: "Serializable", timeout: 15_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ADMIN_BOOTSTRAP_ALREADY_COMPLETED") {
      return NextResponse.json({ error: "Bootstrap gia completato." }, { status: 409 });
    }
    if (message === "ADMIN_BOOTSTRAP_TENANT_SCOPE_INVALID") {
      return NextResponse.json({ error: "Perimetro tenant non valido." }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
