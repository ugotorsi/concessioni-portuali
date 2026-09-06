import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { auditFailure, createAuditLogInTransaction } from "@/server/audit/auditLog";
import { prisma } from "@/lib/prisma";
import { createDocumentFileIfAbsent } from "@/server/documents/storage";
import {
  createSourceFileVersionInTransaction,
  reconcileSourceFileVersionIdentityRaceAfterRollback,
  type CreateSourceFileVersionInput,
} from "@/server/documents/sourceFileVersion";
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
  enteId: string;
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

interface UploadTransactionExtension<Result> {
  createRecord(tx: Prisma.TransactionClient): Promise<Result>;
  writeAudit(tx: Prisma.TransactionClient, result: Result): Promise<void>;
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

export async function uploadDocument<Result = never>(
  input: UploadDocumentInput & { transactionExtension?: UploadTransactionExtension<Result> },
) {
  validateUploadFile(input.file);
  const body = Buffer.from(await input.file.arrayBuffer());
  const checksum = createHash("sha256").update(body).digest("hex");
  const mimeType = input.file.type.trim().toLowerCase();
  const storageKey = `documents/${input.enteId}/${input.documentId}/${checksum}`;
  const existing = input.deterministicStorage ? await findDocumentState(input.documentId) : null;
  if (existing && !matchesExisting(existing, input, checksum, storageKey)) {
    throw new Error("Conflitto di idempotenza per il documento richiesto.");
  }

  let stored: StoredDocumentObject;
  try {
    const receipt = await createDocumentFileIfAbsent({
      storageKey,
      body,
      mimeType,
      originalName: input.file.name,
      sha256: checksum,
      sizeBytes: body.length,
    });
    stored = receipt.object;
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

  const sourceFileVersionInput: CreateSourceFileVersionInput = {
    documentId: input.documentId,
    canonicalEnteId: input.enteId,
    storageProvider: stored.storageProvider,
    storageKey: stored.storageKey,
    storageBucket: stored.bucket,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    sha256: stored.sha256,
    createdByUserId: persistedUserId(input.actor.id),
    createdByActorId: input.actor.id,
    createdByRole: input.actor.role,
  };

  const runAtomicUnit = (reusedDocument: UploadedDocumentState | null) => prisma.$transaction(async (tx) => {
    const created = reusedDocument
      ? await tx.documento.findUniqueOrThrow({ where: { id: reusedDocument.id } })
      : await tx.documento.create({
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

    const fileVersion = await createSourceFileVersionInTransaction(tx, sourceFileVersionInput);
    const document = await tx.documento.update({
      where: { id: created.id },
      data: { currentFileVersionId: fileVersion.version.id },
    });
    const extensionResult = input.transactionExtension
      ? await input.transactionExtension.createRecord(tx)
      : undefined;

    if (!reusedDocument) {
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
    }
    if (input.transactionExtension && extensionResult !== undefined) {
      await input.transactionExtension.writeAudit(tx, extensionResult);
    }

    return { created: !reusedDocument, document, extensionResult };
  });

  try {
    const result = await runAtomicUnit(existing);
    return { ...result, storageKey: stored.storageKey, checksum };
  } catch (error) {
    let sourceFileVersionRace = false;
    try {
      await reconcileSourceFileVersionIdentityRaceAfterRollback(sourceFileVersionInput, error);
      sourceFileVersionRace = true;
    } catch (reconciliationError) {
      if (reconciliationError !== error) {
        throw reconciliationError;
      }
    }
    if (!input.deterministicStorage || (!sourceFileVersionRace && !isDocumentoIdentityP2002(error))) {
      throw error;
    }
    const concurrent = await findDocumentState(input.documentId);
    if (!concurrent || !matchesExisting(concurrent, input, checksum, storageKey)) {
      throw new Error("Conflitto di idempotenza per il documento richiesto.");
    }
    const retried = await runAtomicUnit(concurrent);
    return { ...retried, storageKey: stored.storageKey, checksum };
  }
}

function isDocumentoIdentityP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "Documento") {
    return false;
  }
  const target = meta.target;
  return target === "Documento_pkey"
    || target === "id"
    || (Array.isArray(target) && target.length === 1 && target[0] === "id");
}