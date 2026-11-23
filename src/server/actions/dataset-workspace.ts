"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminWithMfa } from "@/lib/auth";
import {
  createDatasetWorkspaceToken,
  DATASET_WORKSPACE_COOKIE,
  DATASET_WORKSPACE_TTL_SECONDS,
  SELECTABLE_DATASET_SCOPES,
} from "@/lib/dataset-workspace";
import { resolveNextAuthSecret } from "@/lib/next-auth-secret";
import { auditSuccess } from "@/server/audit/auditLog";

const scopeSchema = z.enum(SELECTABLE_DATASET_SCOPES);

export async function selectDatasetWorkspaceAction(formData: FormData): Promise<void> {
  const actor = await requireAdminWithMfa();
  const scope = scopeSchema.parse(formData.get("scope"));
  if (formData.get("confirmation") !== `SELECT_DATASET_WORKSPACE_${scope}`) {
    throw new Error("DATASET_WORKSPACE_CONFIRMATION_REQUIRED");
  }

  const cookieStore = await cookies();
  cookieStore.set(DATASET_WORKSPACE_COOKIE, createDatasetWorkspaceToken({
    userId: actor.id,
    scope,
    secret: resolveNextAuthSecret(),
  }), {
    httpOnly: true,
    maxAge: DATASET_WORKSPACE_TTL_SECONDS,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV),
  });

  await auditSuccess({
    azione: "DATASET_WORKSPACE_SELECT",
    entita: "User",
    entitaId: actor.id,
    actor: {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
    },
    metadata: { scope },
  });
  redirect("/dashboard");
}
