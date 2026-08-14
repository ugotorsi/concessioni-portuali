import { auditFailure, auditSuccess, createAuditLogInTransaction } from "@/server/audit/auditLog";
import { prisma } from "@/lib/prisma";
import {
  computeDocumentFileSha256,
  deleteDocumentFile,
  storeDocumentFile,
  storeDocumentFileAtKey,
} from "@/server/documents/storage";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";
import type { StoredDocumentObject } from "@/server/documents/storage/types";
import { validateUploadFile, type ParsedUploadDocumentInput } from "@/server/documents/validation";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

interface UploadActor {
  id: string;
  email: string | null;
  role: string;
}

interface UploadDocumentInput {
  documentId: string;
  file: File;
  actor: UploadActor;
  enteId: string | null;
  concessioneId?: string | null;
  criticitaId?: string | null;
  procedimentoId?: string | null;
  sopralluogoId?: string | null;
  pagamentoId?: string | null;
  reportId?: string | null;
  nome: string;
  tipologia: ParsedUploadDocumentInput["tipologia"];
  descrizione?: string | null;
  dataDocumento?: Date | null;
  source: ParsedUploadDocumentInput["source"];
  status: ParsedUploadDocumentInput["status"];
  direzione?: ParsedUploadDocumentInput["direzione"] | null;
  canale?: ParsedUploadDocumentInput["canale"] | null;
  numeroProtocollo?: string | null;
  dataProtocollo?: Date | null;
  mittente?: string | null;
  destinatario?: string | null;
  pecMessageId?: string | null;
  pecRicevutaAccettazioneId?: string | null;
  pecRicevutaConsegnaId?: string | null;
  pecWarningMancataRicevuta?: boolean;
  deterministicStorage?: {
    canonicalEnteId: string;
    operationId: string;
  };
}

interface UploadedDocumentState {
  id: string;
  enteId: string | null;
  concessioneId: string | null;
  criticitaId: string | null;
  procedimentoId: string | null;
  sopralluogoId: string | null;
  pagamentoId: string | null;
  reportId: string | null;
  statoDocumento: string;
  source: string | null;
  storageKey: string | null;
  storagePath: string | null;
  storageProvider: string | null;
  checksumSha256: string | null;
  sha256: string | null;
}

function persistedUserId(actorId: string): string | null {
  return actorId === STAGING_PREVIEW_ADMIN_ID ? null : actorId;
}

function matchesExisting(
  existing: UploadedDocumentState,
  input: UploadDocumentInput,
  checksum: string,
  storageKey: string,
) {
  return existing.enteId === input.enteId
    && existing.concessioneId === (input.concessioneId ?? null)
    && existing.procedimentoId === (input.procedimentoId ?? null)
    && existing.statoDocumento === input.status
    && existing.source === input.source
    && (existing.checksumSha256 ?? existing.sha256) === checksum
    && (existing.storageKey ?? existing.storagePath) === storageKey;
}

async function findDocumentState(documentId: string): Promise<UploadedDocumentState | null> {
  return prisma.documento.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      enteId: true,
      concessioneId: true,
      criticitaId: true,
      procedimentoId: true,
      sopralluogoId: true,
      pagamentoId: true,
      reportId: true,
      statoDocumento: true,
      source: true,
      storageKey: true,
      storagePath: true,
      storageProvider: true,
      checksumSha256: true,
      sha256: true,
    },
  });
}

export async function recordUploadCleanupFailure(input: {
  operationId: string;
  documentId: string;
  phase: string;
  provider: string;
  storageKey: string;
  cleanupTarget: "DOCUMENTO" | "OBJECT";
  error: unknown;
  actor: UploadActor;
  enteId: string;
  concessioneId: string;
}) {
  const metadata = {
    operationId: input.operationId,
    documentoId: input.documentId,
    phase: input.phase,
    provider: input.provider,
    storageKey: input.storageKey,
    cleanupTarget: input.cleanupTarget,
    errorClass: input.error instanceof Error ? input.error.name : "UnknownError",
  };

  try {
    await auditFailure({
      azione: "DOCUMENT_UPLOAD_CLEANUP_FAILURE",
      entita: "Documento",
      entitaId: input.documentId,
      enteId: input.enteId,
      concessioneId: input.concessioneId,
      actor: { userId: persistedUserId(input.actor.id), userEmail: input.actor.email, userRole: input.actor.role },
      metadata,
    });
  } catch (auditError) {
    console.error("DOCUMENT_UPLOAD_CLEANUP_FAILURE", {
      ...metadata,
      auditErrorClass: auditError instanceof Error ? auditError.name : "UnknownError",
    });
  }
}

export async function recordUploadCompensated(input: {
  operationId: string;
  documentId: string;
  phase: string;
  provider: string;
  storageKey: string;
  reasonClass: string;
  actor: UploadActor;
  enteId: string;
  concessioneId: string;
}) {
  const metadata = {
    operationId: input.operationId,
    documentoId: input.documentId,
    phase: input.phase,
    provider: input.provider,
    storageKey: input.storageKey,
    reasonClass: input.reasonClass,
    cleanupState: "DOCUMENTO_AND_OBJECT_DELETED",
  };

  try {
    await auditSuccess({
      azione: "DOCUMENT_UPLOAD_COMPENSATED",
      entita: "Documento",
      entitaId: input.documentId,
      enteId: input.enteId,
      concessioneId: input.concessioneId,
      actor: { userId: persistedUserId(input.actor.id), userEmail: input.actor.email, userRole: input.actor.role },
      metadata,
    });
  } catch (auditError) {
    console.error("DOCUMENT_UPLOAD_COMPENSATED_AUDIT_FAILURE", {
      operationId: input.operationId,
      documentoId: input.documentId,
      phase: input.phase,
      cleanupState: metadata.cleanupState,
      errorClass: auditError instanceof Error ? auditError.name : "UnknownError",
      errorMessage: auditError instanceof Error ? auditError.message : "Compensation audit write failed.",
    });
  }
}

export async function uploadDocument(input: UploadDocumentInput) {
  validateUploadFile(input.file);
  const checksum = await computeDocumentFileSha256(input.file);
  const deterministicKey = input.deterministicStorage
    ? `documents/${input.deterministicStorage.canonicalEnteId}/${input.deterministicStorage.operationId}/${checksum}`
    : null;

  if (deterministicKey) {
    const existing = await findDocumentState(input.documentId);
    if (existing) {
      if (!matchesExisting(existing, input, checksum, deterministicKey)) {
        throw new Error("Conflitto di idempotenza per il documento richiesto.");
      }
      return { created: false, document: existing, storageKey: deterministicKey, checksum };
    }
  }

  let stored: StoredDocumentObject;
  try {
    stored = deterministicKey
      ? await storeDocumentFileAtKey({ storageKey: deterministicKey, file: input.file })
      : await storeDocumentFile({ documentId: input.documentId, file: input.file });
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
      entitaId: input.documentId,
      enteId: input.enteId,
      concessioneId: input.concessioneId ?? null,
      actor: {
        userId: persistedUserId(input.actor.id),
        userEmail: input.actor.email,
        userRole: input.actor.role,
      },
      metadata: {
        reason: "STORAGE_WRITE_FAILED",
        issue: error instanceof Error ? error.message : "Errore storage documento.",
        storageDiagnostics,
      },
    });
    throw new Error("Caricamento documento non riuscito: errore durante la persistenza storage.");
  }

  try {
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.documento.create({
        data: {
          id: input.documentId,
          nome: input.nome,
          tipologia: input.tipologia,
          documentType: input.tipologia,
          source: input.source,
          status: input.status,
          descrizione: input.descrizione ?? null,
          dataDocumento: input.dataDocumento ?? null,
          documentDate: input.dataDocumento ?? new Date(),
          statoDocumento: input.status,
          direzione: input.direzione ?? null,
          canale: input.canale ?? null,
          numeroProtocollo: input.numeroProtocollo ?? null,
          dataProtocollo: input.dataProtocollo ?? null,
          mittente: input.mittente ?? null,
          destinatario: input.destinatario ?? null,
          pecMessageId: input.pecMessageId ?? null,
          pecRicevutaAccettazioneId: input.pecRicevutaAccettazioneId ?? null,
          pecRicevutaConsegnaId: input.pecRicevutaConsegnaId ?? null,
          pecWarningMancataRicevuta: input.pecWarningMancataRicevuta ?? false,
          uploadedByUserId: persistedUserId(input.actor.id),
          uploadedByUserEmail: input.actor.email,
          uploadedByUserRole: input.actor.role,
          enteId: input.enteId,
          concessioneId: input.concessioneId ?? null,
          criticitaId: input.criticitaId ?? null,
          procedimentoId: input.procedimentoId ?? null,
          sopralluogoId: input.sopralluogoId ?? null,
          pagamentoId: input.pagamentoId ?? null,
          reportId: input.reportId ?? null,
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
          url: `/documenti/${input.documentId}/download`,
        },
      });

      await createAuditLogInTransaction(tx, {
        azione: "DOCUMENT_UPLOAD",
        entita: "Documento",
        entitaId: created.id,
        enteId: input.enteId,
        concessioneId: input.concessioneId ?? null,
        actor: {
          userId: persistedUserId(input.actor.id),
          userEmail: input.actor.email,
          userRole: input.actor.role,
        },
        esito: "SUCCESS",
        metadata: {
          tipologia: input.tipologia,
          source: input.source,
          status: input.status,
          mimeType: stored.mimeType,
          dimensioneBytes: stored.sizeBytes,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          protocollo: {
            direzione: input.direzione ?? null,
            canale: input.canale ?? null,
            numeroProtocollo: input.numeroProtocollo ?? null,
            dataProtocollo: input.dataProtocollo?.toISOString() ?? null,
            pecWarningMancataRicevuta: input.pecWarningMancataRicevuta ?? false,
          },
          notaLegale: "Metadato registrato a fini istruttori",
          linkedEntities: {
            concessioneId: input.concessioneId ?? null,
            criticitaId: input.criticitaId ?? null,
            procedimentoId: input.procedimentoId ?? null,
            sopralluogoId: input.sopralluogoId ?? null,
            pagamentoId: input.pagamentoId ?? null,
            reportId: input.reportId ?? null,
          },
        },
      });

      return created;
    });

    return { created: true, document, storageKey: stored.storageKey, checksum };
  } catch (error) {
    if (deterministicKey) {
      const concurrent = await findDocumentState(input.documentId);
      if (concurrent && matchesExisting(concurrent, input, checksum, deterministicKey)) {
        return { created: false, document: concurrent, storageKey: deterministicKey, checksum };
      }
    }

    try {
      await deleteDocumentFile(stored.storageKey);
    } catch (cleanupError) {
      if (input.enteId && input.concessioneId) {
        await recordUploadCleanupFailure({
          operationId: input.documentId,
          documentId: input.documentId,
          phase: "DOCUMENTO_TRANSACTION",
          provider: stored.storageProvider,
          storageKey: stored.storageKey,
          cleanupTarget: "OBJECT",
          error: cleanupError,
          actor: input.actor,
          enteId: input.enteId,
          concessioneId: input.concessioneId,
        });
      }
    }
    throw error;
  }
}