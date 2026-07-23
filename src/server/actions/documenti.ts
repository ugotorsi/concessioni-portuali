"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { BACKOFFICE_ROLES, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { buildLinkedEntityMetadata, parseUploadDocumentFormData, DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";
import { DOCUMENT_CANALE_VALUES, DOCUMENT_DIREZIONE_VALUES, normalizeProtocolloMetadata } from "@/server/documents/protocollo";
import { storeDocumentFile } from "@/server/documents/storage";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";

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
    throw new Error("Una o più entità collegate non esistono.");
  }
}

async function resolveLinkedTenantForDocumento(input: {
  concessioneId?: string;
  criticitaId?: string;
  procedimentoId?: string;
  sopralluogoId?: string;
  pagamentoId?: string;
  reportId?: string;
}): Promise<{ enteId: string | null }> {
  const candidateTenantIds = new Set<string>();

  if (input.concessioneId) {
    const concessione = await prisma.concessione.findUnique({
      where: { id: input.concessioneId },
      select: { id: true, enteId: true },
    });
    if (!concessione) {
      throw new Error("Concessione collegata non trovata.");
    }
    if (concessione.enteId) {
      candidateTenantIds.add(concessione.enteId);
    }
  }

  if (input.criticitaId) {
    const criticita = await prisma.criticita.findUnique({
      where: { id: input.criticitaId },
      select: { id: true, concessione: { select: { enteId: true } } },
    });
    if (!criticita) {
      throw new Error("Criticita collegata non trovata.");
    }
    if (criticita.concessione.enteId) {
      candidateTenantIds.add(criticita.concessione.enteId);
    }
  }

  if (input.procedimentoId) {
    const procedimento = await prisma.procedimento.findUnique({
      where: { id: input.procedimentoId },
      select: { id: true, concessione: { select: { enteId: true } } },
    });
    if (!procedimento) {
      throw new Error("Procedimento collegato non trovato.");
    }
    if (procedimento.concessione.enteId) {
      candidateTenantIds.add(procedimento.concessione.enteId);
    }
  }

  if (input.sopralluogoId) {
    const sopralluogo = await prisma.sopralluogo.findUnique({
      where: { id: input.sopralluogoId },
      select: { id: true, concessione: { select: { enteId: true } } },
    });
    if (!sopralluogo) {
      throw new Error("Sopralluogo collegato non trovato.");
    }
    if (sopralluogo.concessione.enteId) {
      candidateTenantIds.add(sopralluogo.concessione.enteId);
    }
  }

  if (input.pagamentoId) {
    const pagamento = await prisma.pagamento.findUnique({
      where: { id: input.pagamentoId },
      select: { id: true, concessione: { select: { enteId: true } } },
    });
    if (!pagamento) {
      throw new Error("Pagamento collegato non trovato.");
    }
    if (pagamento.concessione.enteId) {
      candidateTenantIds.add(pagamento.concessione.enteId);
    }
  }

  if (input.reportId) {
    const report = await prisma.report.findUnique({
      where: { id: input.reportId },
      select: {
        id: true,
        enteId: true,
        concessione: {
          select: {
            enteId: true,
          },
        },
      },
    });
    if (!report) {
      throw new Error("Report collegato non trovato.");
    }
    if (report.enteId) {
      candidateTenantIds.add(report.enteId);
    }
    if (report.concessione?.enteId) {
      candidateTenantIds.add(report.concessione.enteId);
    }
  }

  if (candidateTenantIds.size > 1) {
    throw new Error("Entita collegate appartenenti a tenant diversi non consentite.");
  }

  return {
    enteId: candidateTenantIds.values().next().value ?? null,
  };
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
  const tenantContext = await getCurrentTenantContext();
  const linkedTenant = await resolveLinkedTenantForDocumento(payload);

  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, linkedTenant.enteId, {
        mode: "write",
        allowWhenEnteMissing: true,
      });
    } catch {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Documento",
        concessioneId: payload.concessioneId ?? null,
        enteId: linkedTenant.enteId,
        actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
        metadata: {
          actionType: "DOCUMENT_UPLOAD",
          reason: "CROSS_TENANT_BLOCKED",
        },
      });
      throw new Error("Accesso tenant non consentito.");
    }
  }

  const linked = buildLinkedEntityMetadata(payload);

  const created = await prisma.documento.create({
    data: {
      nome: payload.nome,
      tipologia: payload.tipologia,
      documentType: payload.tipologia,
      source: payload.source,
      status: payload.status,
      descrizione: payload.descrizione ?? null,
      dataDocumento: payload.dataDocumento ?? null,
      documentDate: payload.dataDocumento ?? new Date(),
      statoDocumento: payload.status,
      direzione: payload.direzione ?? null,
      canale: payload.canale ?? null,
      numeroProtocollo: payload.numeroProtocollo ?? null,
      dataProtocollo: payload.dataProtocollo ?? null,
      mittente: payload.mittente ?? null,
      destinatario: payload.destinatario ?? null,
      pecMessageId: payload.pecMessageId ?? null,
      pecRicevutaAccettazioneId: payload.pecRicevutaAccettazioneId ?? null,
      pecRicevutaConsegnaId: payload.pecRicevutaConsegnaId ?? null,
      pecWarningMancataRicevuta: payload.pecWarningMancataRicevuta,
      uploadedByUserId: currentUser?.id ?? null,
      uploadedByUserEmail: currentUser?.email ?? null,
      uploadedByUserRole: role,
      enteId: linkedTenant.enteId,
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

  let stored;
  try {
    stored = await storeDocumentFile({ documentId: created.id, file: payload.file });
  } catch (error) {
    const storageDiagnostics =
      error instanceof DocumentStorageS3Error
        ? {
            provider: error.diagnostics.provider,
            operation: error.diagnostics.operation,
            code: error.diagnostics.code,
            statusCode: error.diagnostics.statusCode,
            retryable: error.diagnostics.retryable,
            bucketConfigured: error.diagnostics.bucketConfigured,
            endpointConfigured: error.diagnostics.endpointConfigured,
            regionConfigured: error.diagnostics.regionConfigured,
            forcePathStyle: error.diagnostics.forcePathStyle,
          }
        : undefined;

    await auditFailure({
      azione: "DOCUMENT_UPLOAD",
      entita: "Documento",
      entitaId: created.id,
      concessioneId: created.concessioneId,
      actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
      metadata: {
        reason: "STORAGE_WRITE_FAILED",
        issue: error instanceof Error ? error.message : "Errore storage documento.",
        storageDiagnostics,
      },
      enteId: linkedTenant.enteId,
    });
    throw new Error("Caricamento documento non riuscito: errore durante la persistenza storage.");
  }

  await prisma.documento.update({
    where: { id: created.id },
    data: {
      nomeStorage: stored.fileName,
      storagePath: stored.storageKey,
      storageKey: stored.storageKey,
      storageProvider: stored.storageProvider,
      storageBucket: stored.bucket,
      publicUrl: stored.publicUrl ?? null,
      mimeType: stored.mimeType,
      originalName: stored.originalName,
      dimensioneBytes: stored.sizeBytes,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.sha256,
      sha256: stored.sha256,
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
      source: payload.source,
      status: payload.status,
      mimeType: stored.mimeType,
      dimensioneBytes: stored.sizeBytes,
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey,
      protocollo: {
        direzione: payload.direzione ?? null,
        canale: payload.canale ?? null,
        numeroProtocollo: payload.numeroProtocollo ?? null,
        dataProtocollo: payload.dataProtocollo?.toISOString() ?? null,
        pecWarningMancataRicevuta: payload.pecWarningMancataRicevuta,
      },
      notaLegale: "Metadato registrato a fini istruttori",
      linkedEntities: linked,
    },
    enteId: linkedTenant.enteId,
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

  const existing = await prisma.documento.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      enteId: true,
      concessione: {
        select: {
          enteId: true,
        },
      },
    },
  });

  if (!existing) {
    throw new Error("Documento non trovato.");
  }

  const resourceEnteId = existing.enteId ?? existing.concessione?.enteId ?? null;
  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, resourceEnteId, {
        mode: "write",
        allowWhenEnteMissing: true,
      });
    } catch {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Documento",
        entitaId: parsed.data.id,
        enteId: resourceEnteId,
        actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
        metadata: {
          actionType: "DOCUMENT_ARCHIVE",
          reason: "CROSS_TENANT_BLOCKED",
        },
      });
      throw new Error("Accesso tenant non consentito.");
    }
  }

  const updated = await prisma.documento.update({
    where: { id: parsed.data.id },
    data: {
      statoDocumento: "ARCHIVIATO",
      status: "ARCHIVIATO",
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
    enteId: resourceEnteId,
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
  direzione: z
    .enum(DOCUMENT_DIREZIONE_VALUES)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  canale: z
    .enum(DOCUMENT_CANALE_VALUES)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  numeroProtocollo: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  dataProtocollo: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  mittente: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  destinatario: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  pecMessageId: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  pecRicevutaAccettazioneId: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  pecRicevutaConsegnaId: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
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
    direzione: formData.get("direzione")?.toString(),
    canale: formData.get("canale")?.toString(),
    numeroProtocollo: formData.get("numeroProtocollo")?.toString(),
    dataProtocollo: formData.get("dataProtocollo")?.toString(),
    mittente: formData.get("mittente")?.toString(),
    destinatario: formData.get("destinatario")?.toString(),
    pecMessageId: formData.get("pecMessageId")?.toString(),
    pecRicevutaAccettazioneId: formData.get("pecRicevutaAccettazioneId")?.toString(),
    pecRicevutaConsegnaId: formData.get("pecRicevutaConsegnaId")?.toString(),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati documento non validi.");
  }

  const protocolloMetadata = normalizeProtocolloMetadata({
    direzione: parsed.data.direzione,
    canale: parsed.data.canale,
    numeroProtocollo: parsed.data.numeroProtocollo,
    dataProtocollo: parsed.data.dataProtocollo,
    mittente: parsed.data.mittente,
    destinatario: parsed.data.destinatario,
    pecMessageId: parsed.data.pecMessageId,
    pecRicevutaAccettazioneId: parsed.data.pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId: parsed.data.pecRicevutaConsegnaId,
  });

  const currentUser = await getCurrentUser();

  const existing = await prisma.documento.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      enteId: true,
      concessione: {
        select: {
          enteId: true,
        },
      },
    },
  });

  if (!existing) {
    throw new Error("Documento non trovato.");
  }

  const resourceEnteId = existing.enteId ?? existing.concessione?.enteId ?? null;
  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, resourceEnteId, {
        mode: "write",
        allowWhenEnteMissing: true,
      });
    } catch {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Documento",
        entitaId: parsed.data.id,
        enteId: resourceEnteId,
        actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
        metadata: {
          actionType: "DOCUMENT_METADATA_UPDATE",
          reason: "CROSS_TENANT_BLOCKED",
        },
      });
      throw new Error("Accesso tenant non consentito.");
    }
  }

  const updated = await prisma.documento.update({
    where: { id: parsed.data.id },
    data: {
      nome: parsed.data.nome,
      tipologia: parsed.data.tipologia,
      descrizione: parsed.data.descrizione,
      direzione: protocolloMetadata.direzione ?? null,
      canale: protocolloMetadata.canale ?? null,
      numeroProtocollo: protocolloMetadata.numeroProtocollo ?? null,
      dataProtocollo: protocolloMetadata.dataProtocollo ?? null,
      mittente: protocolloMetadata.mittente ?? null,
      destinatario: protocolloMetadata.destinatario ?? null,
      pecMessageId: protocolloMetadata.pecMessageId ?? null,
      pecRicevutaAccettazioneId: protocolloMetadata.pecRicevutaAccettazioneId ?? null,
      pecRicevutaConsegnaId: protocolloMetadata.pecRicevutaConsegnaId ?? null,
      pecWarningMancataRicevuta: protocolloMetadata.pecWarningMancataRicevuta,
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
      changedFields: [
        "nome",
        "tipologia",
        "descrizione",
        "direzione",
        "canale",
        "numeroProtocollo",
        "dataProtocollo",
        "mittente",
        "destinatario",
        "pecMessageId",
        "pecRicevutaAccettazioneId",
        "pecRicevutaConsegnaId",
        "pecWarningMancataRicevuta",
      ],
      notaLegale: "Metadato registrato a fini istruttori",
    },
    enteId: resourceEnteId,
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
