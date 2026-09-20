"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import {
  canManageCriticita,
  canManageProcedimenti,
  getCurrentUser,
  requireRole,
  type DemoRole,
} from "@/lib/auth";
import { getCurrentTenantContext, requireTenantAccess, type CurrentTenantContext } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import {
  buildCriticitaCreateData,
  ensureTipologiaByRole,
  promoteFascicoloSignalCriticitaSchema,
  toOptional,
} from "@/server/criticita/criticitaDomain";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  fascicoloSignalTemporalFingerprint,
  fascicoloSignalTemporalFingerprintV2,
} from "@/server/fascicolo-lifecycle/fascicoloSignal";

const thresholdSchema = z.enum([
  "CONCESSION_90_DAYS",
  "CONCESSION_60_DAYS",
  "CONCESSION_30_DAYS",
  "DEADLINE_DUE",
]);

const reviewSchema = z.object({
  signalId: z.string().min(1),
  expectedThreshold: thresholdSchema,
  disposition: z.enum(["ACKNOWLEDGED", "DISMISSED"]),
  reviewNote: z.string().trim().max(2000).optional(),
});

const promotionSchema = promoteFascicoloSignalCriticitaSchema.extend({
  signalId: z.string().min(1),
  expectedThreshold: thresholdSchema,
});

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

function persistedUserId(userId: string): string | null {
  return userId === STAGING_PREVIEW_ADMIN_ID ? null : userId;
}

function resolveAuthorizedTenantRole(
  context: CurrentTenantContext,
  enteId: string,
  authorizeRole: (role: DemoRole) => boolean,
): DemoRole {
  requireTenantAccess(context, enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const effectiveRole = context.isAdmin
    ? context.role
    : context.tenantMemberships.find((membership) => membership.enteId === enteId)?.role;
  if (!effectiveRole || !authorizeRole(effectiveRole)) {
    throw new Error("Tenant access denied.");
  }
  return effectiveRole;
}

async function loadCanonicalCurrentSignal(
  tx: Prisma.TransactionClient,
  input: {
    signalId: string;
    expectedThreshold: z.infer<typeof thresholdSchema>;
    tenantContext: CurrentTenantContext;
    authorizeRole: typeof canManageProcedimenti;
  },
) {
  const signal = await tx.fascicoloSignal.findUnique({
    where: { id: input.signalId },
    select: {
      id: true,
      enteId: true,
      concessioneId: true,
      procedimentoId: true,
      subjectType: true,
      subjectId: true,
      generationFingerprint: true,
      expiryGeneration: true,
      currentThreshold: true,
      status: true,
      humanDisposition: true,
      dispositionThreshold: true,
      reviewNote: true,
      criticitaId: true,
      procedimento: {
        select: {
          id: true,
          concessioneId: true,
          concessione: { select: { id: true, enteId: true, dataScadenza: true, expiryGeneration: true } },
        },
      },
    },
  });
  if (!signal) throw new Error("FASCICOLO_SIGNAL_NOT_FOUND");

  const concessione = signal.procedimento.concessione;
  if (
    !concessione.enteId
    || signal.procedimentoId !== signal.procedimento.id
    || signal.procedimento.concessioneId !== concessione.id
    || signal.concessioneId !== concessione.id
    || signal.enteId !== concessione.enteId
    || signal.subjectType !== "CONCESSIONE"
    || signal.subjectId !== concessione.id
  ) {
    throw new Error("FASCICOLO_SIGNAL_CANONICAL_SCOPE_MISMATCH");
  }
  if (signal.status !== "OPEN") throw new Error("FASCICOLO_SIGNAL_NOT_OPEN");
  if (signal.currentThreshold !== input.expectedThreshold) throw new Error("FASCICOLO_SIGNAL_THRESHOLD_CHANGED");
  const currentFingerprint = signal.expiryGeneration === null
    ? fascicoloSignalTemporalFingerprint({
        id: concessione.id,
        enteId: concessione.enteId,
        dataScadenza: concessione.dataScadenza,
      })
    : fascicoloSignalTemporalFingerprintV2({
        id: concessione.id,
        enteId: concessione.enteId,
        dataScadenza: concessione.dataScadenza,
        expiryGeneration: concessione.expiryGeneration,
      });
  if (
    (signal.expiryGeneration === null && concessione.expiryGeneration !== 0)
    || (signal.expiryGeneration !== null && signal.expiryGeneration !== concessione.expiryGeneration)
    || signal.generationFingerprint !== currentFingerprint
  ) {
    throw new Error("FASCICOLO_SIGNAL_STALE_GENERATION");
  }

  const effectiveRole = resolveAuthorizedTenantRole(
    input.tenantContext,
    concessione.enteId,
    input.authorizeRole,
  );
  return { signal, concessione, effectiveRole };
}

export async function reviewFascicoloSignalAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) throw new Error("Profilo non autorizzato alla review del signal.");
  const [currentUser, tenantContext] = await Promise.all([getCurrentUser(), getCurrentTenantContext()]);
  if (!currentUser || !tenantContext) throw new Error("Utente o tenant non disponibile.");

  const parsed = reviewSchema.parse({
    signalId: formData.get("signalId"),
    expectedThreshold: formData.get("expectedThreshold"),
    disposition: formData.get("disposition"),
    reviewNote: toOptional(formData.get("reviewNote")?.toString()),
  });
  if (parsed.disposition === "DISMISSED" && !parsed.reviewNote) {
    throw new Error("La nota di review e obbligatoria per il dismissal.");
  }

  const result = await runSerializableTransactionWithRetry(async (tx) => {
    const { signal, concessione, effectiveRole } = await loadCanonicalCurrentSignal(tx, {
      signalId: parsed.signalId,
      expectedThreshold: parsed.expectedThreshold,
      tenantContext,
      authorizeRole: canManageProcedimenti,
    });

    if (signal.humanDisposition === "ACKNOWLEDGED" && parsed.disposition === "ACKNOWLEDGED"
      && signal.dispositionThreshold === parsed.expectedThreshold) {
      return { outcome: "ALREADY_ACKNOWLEDGED" as const, signalId: signal.id, procedimentoId: signal.procedimentoId };
    }
    if (signal.humanDisposition === "DISMISSED" && parsed.disposition === "DISMISSED"
      && signal.dispositionThreshold === parsed.expectedThreshold && signal.reviewNote === parsed.reviewNote) {
      return { outcome: "ALREADY_DISMISSED" as const, signalId: signal.id, procedimentoId: signal.procedimentoId };
    }
    const allowed = parsed.disposition === "ACKNOWLEDGED"
      ? signal.humanDisposition === "UNREVIEWED"
      : signal.humanDisposition === "UNREVIEWED" || signal.humanDisposition === "ACKNOWLEDGED";
    if (!allowed) throw new Error("FASCICOLO_SIGNAL_REVIEW_TRANSITION_NOT_ALLOWED");

    const reviewedAt = new Date();
    const updated = await tx.fascicoloSignal.updateMany({
      where: {
        id: signal.id,
        status: "OPEN",
        currentThreshold: parsed.expectedThreshold,
        humanDisposition: signal.humanDisposition,
      },
      data: {
        humanDisposition: parsed.disposition,
        dispositionThreshold: signal.currentThreshold,
        reviewedAt,
        reviewedByUserId: persistedUserId(currentUser.id),
        reviewedByActorId: currentUser.id,
        reviewedByEmail: currentUser.email,
        reviewedByRole: effectiveRole,
        reviewNote: parsed.reviewNote ?? null,
      },
    });
    if (updated.count !== 1) throw new Error("FASCICOLO_SIGNAL_CONCURRENTLY_CHANGED");

    await createAuditLogInTransaction(tx, {
      azione: parsed.disposition === "ACKNOWLEDGED"
        ? "FASCICOLO_SIGNAL_ACKNOWLEDGED"
        : "FASCICOLO_SIGNAL_DISMISSED",
      entita: "FascicoloSignal",
      entitaId: signal.id,
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      esito: "SUCCESS",
      actor: {
        userId: persistedUserId(currentUser.id),
        userEmail: currentUser.email,
        userRole: effectiveRole,
      },
      metadata: {
        signalId: signal.id,
        currentThreshold: signal.currentThreshold,
        previousDisposition: signal.humanDisposition,
        newDisposition: parsed.disposition,
      },
    });
    return { outcome: parsed.disposition, signalId: signal.id, procedimentoId: signal.procedimentoId };
  });

  revalidatePath(`/procedimenti/${result.procedimentoId}`);
  const { procedimentoId: _procedimentoId, ...response } = result;
  return response;
}

export async function promoteFascicoloSignalAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageCriticita(role)) throw new Error("Profilo non autorizzato alla promotion del signal.");
  const [currentUser, tenantContext] = await Promise.all([getCurrentUser(), getCurrentTenantContext()]);
  if (!currentUser || !tenantContext) throw new Error("Utente o tenant non disponibile.");

  const parsed = promotionSchema.parse({
    signalId: formData.get("signalId"),
    expectedThreshold: formData.get("expectedThreshold"),
    tipologia: formData.get("tipologia"),
    gravita: formData.get("gravita"),
    descrizione: formData.get("descrizione"),
    noteIstruttorie: toOptional(formData.get("noteIstruttorie")?.toString()),
    rilevanzaArt47: formData.get("rilevanzaArt47") ?? "false",
    letteraArt47: toOptional(formData.get("letteraArt47")?.toString()),
    rischioDecadenza: toOptional(formData.get("rischioDecadenza")?.toString()),
    motivazioneArt47: toOptional(formData.get("motivazioneArt47")?.toString()),
    azioneIstruttoriaArt47: toOptional(formData.get("azioneIstruttoriaArt47")?.toString()),
    regolarizzata: formData.get("regolarizzata") ?? "false",
    dataRegolarizzazione: toOptional(formData.get("dataRegolarizzazione")?.toString()),
    descrizioneRegolarizzazione: toOptional(formData.get("descrizioneRegolarizzazione")?.toString()),
    esitoRegolarizzazione: toOptional(formData.get("esitoRegolarizzazione")?.toString()),
    verificataRegolarizzazione: formData.get("verificataRegolarizzazione") ?? "false",
    dataVerificaRegolarizzazione: toOptional(formData.get("dataVerificaRegolarizzazione")?.toString()),
    noteVerificaRegolarizzazione: toOptional(formData.get("noteVerificaRegolarizzazione")?.toString()),
  });
  ensureTipologiaByRole(role, parsed.tipologia);

  const result = await runSerializableTransactionWithRetry(async (tx) => {
    const { signal, concessione, effectiveRole } = await loadCanonicalCurrentSignal(tx, {
      signalId: parsed.signalId,
      expectedThreshold: parsed.expectedThreshold,
      tenantContext,
      authorizeRole: canManageCriticita,
    });
    ensureTipologiaByRole(effectiveRole, parsed.tipologia);
    if (signal.humanDisposition === "PROMOTED" && signal.criticitaId) {
      return {
        outcome: "ALREADY_PROMOTED" as const,
        signalId: signal.id,
        criticitaId: signal.criticitaId,
        procedimentoId: signal.procedimentoId,
      };
    }
    if (signal.criticitaId || signal.humanDisposition === "PROMOTED") {
      throw new Error("FASCICOLO_SIGNAL_PROMOTION_STATE_INVALID");
    }

    const reviewedAt = new Date();
    const criticita = await tx.criticita.create({
      data: buildCriticitaCreateData(parsed, {
        concessioneId: concessione.id,
        fonte: "ALERT_AUTOMATICO",
        now: reviewedAt,
      }),
      select: { id: true },
    });
    const updated = await tx.fascicoloSignal.updateMany({
      where: {
        id: signal.id,
        status: "OPEN",
        currentThreshold: parsed.expectedThreshold,
        humanDisposition: signal.humanDisposition,
        criticitaId: null,
      },
      data: {
        humanDisposition: "PROMOTED",
        dispositionThreshold: signal.currentThreshold,
        reviewedAt,
        reviewedByUserId: persistedUserId(currentUser.id),
        reviewedByActorId: currentUser.id,
        reviewedByEmail: currentUser.email,
        reviewedByRole: effectiveRole,
        reviewNote: null,
        criticitaId: criticita.id,
      },
    });
    if (updated.count !== 1) throw new Error("FASCICOLO_SIGNAL_CONCURRENTLY_CHANGED");

    const actor = {
      userId: persistedUserId(currentUser.id),
      userEmail: currentUser.email,
      userRole: effectiveRole,
    };
    await createAuditLogInTransaction(tx, {
      azione: "CRITICITA_CREATE",
      entita: "Criticita",
      entitaId: criticita.id,
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      esito: "SUCCESS",
      actor,
      metadata: {
        tipologia: parsed.tipologia,
        gravita: parsed.gravita,
        fonte: "ALERT_AUTOMATICO",
        stato: "APERTA",
        rilevanzaArt47: parsed.rilevanzaArt47,
      },
    });
    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_SIGNAL_PROMOTED",
      entita: "FascicoloSignal",
      entitaId: signal.id,
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      esito: "SUCCESS",
      actor,
      metadata: {
        signalId: signal.id,
        criticitaId: criticita.id,
        currentThreshold: signal.currentThreshold,
        previousDisposition: signal.humanDisposition,
        newDisposition: "PROMOTED",
      },
    });
    return {
      outcome: "PROMOTED" as const,
      signalId: signal.id,
      criticitaId: criticita.id,
      procedimentoId: signal.procedimentoId,
    };
  });

  revalidatePath("/criticita");
  revalidatePath(`/procedimenti/${result.procedimentoId}`);
  const { procedimentoId: _procedimentoId, ...response } = result;
  return response;
}