"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser, requireRole } from "@/lib/auth";
import { getCurrentTenantContext } from "@/lib/tenant-auth";
import { reviewOfficialReconciliation } from "@/server/intake/official-hit-reconciliation/review";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const inputSchema = z.object({
  reconciliationId: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative(),
  reviewNote: z.string().trim().max(2000).optional(),
  decision: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("ACCEPT_NEW"),
      title: z.string().trim().min(1).max(500),
    }).strict(),
    z.object({
      action: z.literal("LINK_EXISTING"),
      legalSourceId: z.string().trim().min(1),
    }).strict(),
    z.object({ action: z.literal("REJECT") }).strict(),
  ]),
}).strict();

export async function reviewLegalReferenceOfficialReconciliation(
  input: z.input<typeof inputSchema>,
) {
  const parsed = inputSchema.parse(input);
  const role = await requireRole(["ADMIN", "GIURIDICO"]);
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("Utente non autenticato.");
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) throw new Error("Contesto tenant non disponibile.");

  const result = await reviewOfficialReconciliation({
    reconciliationId: parsed.reconciliationId,
    expectedRevision: parsed.expectedRevision,
    decision: parsed.decision,
    reviewNote: parsed.reviewNote || null,
    reviewer: {
      userId: currentUser.id === STAGING_PREVIEW_ADMIN_ID ? null : currentUser.id,
      actorId: currentUser.id,
      email: currentUser.email,
      role,
    },
    tenantContext,
  });

  revalidatePath("/normativa");
  return result;
}