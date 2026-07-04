"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { BACKOFFICE_ROLES, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { buildLinkedEntityMetadata, parseUploadDocumentFormData, DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";
import { storeDocumentFile } from "@/server/documents/storage";

async function assertLinkedEntitiesExist(input: {
  concessioneId?: string;
  criticitaId?: string;
  procedimentoId?: string;
  sopralluogoId?: string;
  pagamentoId?: string;
  reportId?: string;
}): Promise<void> {
  const checks: Array<Promise<unknown>> = [];

  if (input.concessioneId) {
    checks.push(prisma.concessione.findUnique({ where: { id: input.concessioneId }, select: { id: true } }));
  }
  if (input.criticitaId) {
    checks.push(prisma.criticita.findUnique({ where: { id: input.criticitaId }, select: { id: true } }));
  }
  if (input.procedimentoId) {
    checks.push(prisma.procedimento.findUnique({ where: { id: input.procedimentoId }, select: { id: true } }));
  }
  if (input.sopralluogoId) {
    checks.push(prisma.sopralluogo.findUnique({ where: { id: input.sopralluogoId }, select: { id: true } }));
  }
  if (input.pagamentoId) {
    checks.push(prisma.pagamento.findUnique({ where: { id: input.pagamentoId }, select: { id: true } }));
  }
  if (input.reportId) {
    checks.push(prisma.report.findUnique({ where: { id: input.reportId }, select: { id: true } }));
  }

  const result = await Promise.all(checks);
  if (result.some((item) => !item)) {
    throw new Error("Una o piu entita collegate non esistono.");
  }
}

function revalidateLinkedPaths(input: {
  concessioneId?: string;
  criticitaId?: string;
  procedimentoId?: string;
  sopralluogoId?: string;
  pagamentoId?: string;
  reportId?: string;
}): void {
  revalidatePath("/documenti");
  revalidatePath("/dashboard");

  if (input.concessioneId) {
    revalidatePath(`/concessioni/${input.concessioneId}`);
  }
  if (input.criticitaId) {
    revalidatePath(`/criticita/${input.criticitaId}`);
  }
  if (input.procedimentoId) {
    revalidatePath(`/procedimenti/${input.procedimentoId}`);
  }
  if (input.sopralluogoId) {
    revalidatePath(`/sopralluoghi/${input.sopralluogoId}`);
  }
  if (input.pagamentoId) {
    revalidatePath(`/pagamenti/${input.pagamentoId}`);
  }
  if (input.reportId) {
    revalidatePath(`/report/${input.reportId}`);
  }
}

export async function createDocumentoUploadAction(formData: FormData) {
  const role = await requireRole();

  if (!BACKOFFICE_ROLES.includes(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Documento",
      actor: { userRole: role },
      metadata: {
        actionType: "DOCUMENT_UPLOAD",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    redirect(role === "VIEWER_ADSP" ? "/adsp" : "/dashboard");
  }

  let payload;
  try {
    payload = parseUploadDocumentFormData(formData);
    await assertLinkedEntitiesExist(payload);
  } catch (error) {
    await auditFailure({
      azione: "DOCUMENT_UPLOAD",
      entita: "Documento",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: error instanceof Error ? error.message : "Dati documento non validi.",
      },
    });
    throw error;
  }

  const currentUser = await getCurrentUser();

  const linked = buildLinkedEntityMetadata(payload);

  const created = await prisma.documento.create({
    data: {
      nome: payload.nome,
      tipologia: payload.tipologia,
      descrizione: payload.descrizione ?? null,
      dataDocumento: payload.dataDocumento ?? null,
      uploadedByUserId: currentUser?.id ?? null,
      uploadedByUserEmail: currentUser?.email ?? null,
      uploadedByUserRole: role,
      concessioneId: payload.concessioneId ?? null,
      criticitaId: payload.criticitaId ?? null,
      procedimentoId: payload.procedimentoId ?? null,
      sopralluogoId: payload.sopralluogoId ?? null,
      pagamentoId: payload.pagamentoId ?? null,
      reportId: payload.reportId ?? null,
    },
    select: {
      id: true,
      concessioneId: true,
      criticitaId: true,
      procedimentoId: true,
      sopralluogoId: true,
      pagamentoId: true,
      reportId: true,
    },
  });

  const stored = await storeDocumentFile({ documentId: created.id, file: payload.file });

  await prisma.documento.update({
    where: { id: created.id },
    data: {
      nomeStorage: stored.fileName,
      storagePath: stored.storagePath,
      mimeType: stored.mimeType,
      dimensioneBytes: stored.size,
      checksumSha256: stored.sha256,
      url: `/documenti/${created.id}/download`,
    },
  });

  await auditSuccess({
    azione: "DOCUMENT_UPLOAD",
    entita: "Documento",
    entitaId: created.id,
    concessioneId: created.concessioneId,
    actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
    metadata: {
      tipologia: payload.tipologia,
      mimeType: stored.mimeType,
      dimensioneBytes: stored.size,
      storagePath: stored.storagePath,
      linkedEntities: linked,
    },
  });

  revalidateLinkedPaths({
    concessioneId: created.concessioneId ?? undefined,
    criticitaId: created.criticitaId ?? undefined,
    procedimentoId: created.procedimentoId ?? undefined,
    sopralluogoId: created.sopralluogoId ?? undefined,
    pagamentoId: created.pagamentoId ?? undefined,
    reportId: created.reportId ?? undefined,
  });

  redirect("/documenti");
}

const archiveDocumentoSchema = z.object({
  id: z.string().min(1),
});

export async function archiveDocumentoAction(formData: FormData) {
  const role = await requireRole();

  if (!BACKOFFICE_ROLES.includes(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Documento",
      actor: { userRole: role },
      metadata: {
        actionType: "DOCUMENT_ARCHIVE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    redirect(role === "VIEWER_ADSP" ? "/adsp" : "/dashboard");
  }

  const parsed = archiveDocumentoSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    throw new Error("Documento non valido.");
  }

  const currentUser = await getCurrentUser();

  const updated = await prisma.documento.update({
    where: { id: parsed.data.id },
    data: {
      statoDocumento: "ARCHIVIATO",
      archivedAt: new Date(),
    },
    select: {
      id: true,
      concessioneId: true,
      criticitaId: true,
      procedimentoId: true,
      sopralluogoId: true,
      pagamentoId: true,
      reportId: true,
    },
  });

  await auditSuccess({
    azione: "DOCUMENT_ARCHIVE",
    entita: "Documento",
    entitaId: updated.id,
    concessioneId: updated.concessioneId,
    actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
    metadata: {
      changedFields: ["statoDocumento", "archivedAt"],
    },
  });

  revalidateLinkedPaths({
    concessioneId: updated.concessioneId ?? undefined,
    criticitaId: updated.criticitaId ?? undefined,
    procedimentoId: updated.procedimentoId ?? undefined,
    sopralluogoId: updated.sopralluogoId ?? undefined,
    pagamentoId: updated.pagamentoId ?? undefined,
    reportId: updated.reportId ?? undefined,
  });

  redirect("/documenti");
}

const updateDocumentoMetadataSchema = z.object({
  id: z.string().min(1),
  nome: z.string().trim().min(1).max(180),
  tipologia: z.enum(DOCUMENT_TIPOLOGIA_VALUES),
  descrizione: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export async function updateDocumentoMetadataAction(formData: FormData) {
  const role = await requireRole();

  if (!BACKOFFICE_ROLES.includes(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Documento",
      actor: { userRole: role },
      metadata: {
        actionType: "DOCUMENT_METADATA_UPDATE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    redirect(role === "VIEWER_ADSP" ? "/adsp" : "/dashboard");
  }

  const parsed = updateDocumentoMetadataSchema.safeParse({
    id: formData.get("id"),
    nome: formData.get("nome"),
    tipologia: formData.get("tipologia"),
    descrizione: formData.get("descrizione")?.toString(),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati documento non validi.");
  }

  const currentUser = await getCurrentUser();

  const updated = await prisma.documento.update({
    where: { id: parsed.data.id },
    data: {
      nome: parsed.data.nome,
      tipologia: parsed.data.tipologia,
      descrizione: parsed.data.descrizione,
    },
    select: {
      id: true,
      concessioneId: true,
      criticitaId: true,
      procedimentoId: true,
      sopralluogoId: true,
      pagamentoId: true,
      reportId: true,
    },
  });

  await auditSuccess({
    azione: "DOCUMENT_METADATA_UPDATE",
    entita: "Documento",
    entitaId: updated.id,
    concessioneId: updated.concessioneId,
    actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
    metadata: {
      changedFields: ["nome", "tipologia", "descrizione"],
    },
  });

  revalidateLinkedPaths({
    concessioneId: updated.concessioneId ?? undefined,
    criticitaId: updated.criticitaId ?? undefined,
    procedimentoId: updated.procedimentoId ?? undefined,
    sopralluogoId: updated.sopralluogoId ?? undefined,
    pagamentoId: updated.pagamentoId ?? undefined,
    reportId: updated.reportId ?? undefined,
  });

  redirect("/documenti");
}
