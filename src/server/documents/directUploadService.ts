import { createHash } from "node:crypto";

import { z } from "zod";

import { BACKOFFICE_ROLES, canManageProcedimenti, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { requireS3DocumentStorage } from "@/server/documents/storage";
import { getS3StorageConfig } from "@/server/documents/storage/config";
import type { StoredDocumentObject } from "@/server/documents/storage/types";
import {
  detectDocumentMimeType,
  getDocumentMaxBytes,
  parseUploadDocumentMetadata,
  validateUploadDescriptor,
  type ParsedUploadDocumentMetadata,
} from "@/server/documents/validation";
import { registerStoredDocument, type UploadActor } from "@/server/documents/uploadService";
import {
  createFascicoloDocumentRequirementEvidenceAuditInTransaction,
  createFascicoloDocumentRequirementEvidenceRecordInTransaction,
  type CreateFascicoloDocumentRequirementEvidenceInput,
} from "@/server/fascicolo-document-requirement-evidence";

const DIRECT_UPLOAD_EXPIRES_SECONDS = 10 * 60;
const operationIdSchema = z.string().uuid();
const purposeSchema = z.enum(["DOCUMENT", "REQUIREMENT_EVIDENCE"]);
const metadataSchema = z.record(z.string(), z.string());
const fileSchema = z.object({
  name: z.string().trim().min(1).max(240),
  size: z.number().int().positive(),
  type: z.string().trim().min(1).max(160),
}).strict();

export interface DirectDocumentUploadInput {
  purpose?: "DOCUMENT" | "REQUIREMENT_EVIDENCE";
  operationId: string;
  file: z.infer<typeof fileSchema>;
  metadata: Readonly<Record<string, string>>;
}

interface AuthorizedDirectUpload {
  operationId: string;
  file: z.infer<typeof fileSchema>;
  metadata: ParsedUploadDocumentMetadata;
  actor: UploadActor;
  canonicalEnteId: string;
  storageKey: string;
  storageMetadata: Readonly<Record<string, string>>;
  requirementEvidenceInput?: CreateFascicoloDocumentRequirementEvidenceInput;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function metadataSource(metadata: Readonly<Record<string, string>>) {
  return { get: (name: string) => metadata[name] ?? null };
}

function scopeFingerprint(metadata: ParsedUploadDocumentMetadata): string {
  return digest(JSON.stringify({
    concessioneId: metadata.concessioneId ?? null,
    criticitaId: metadata.criticitaId ?? null,
    procedimentoId: metadata.procedimentoId ?? null,
    sopralluogoId: metadata.sopralluogoId ?? null,
    pagamentoId: metadata.pagamentoId ?? null,
    reportId: metadata.reportId ?? null,
    tipologia: metadata.tipologia,
    source: metadata.source,
    status: metadata.status,
  }));
}

async function resolveCanonicalTenant(metadata: ParsedUploadDocumentMetadata): Promise<string> {
  const tenantIds = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value) tenantIds.add(value);
  };

  const [concessione, criticita, procedimento, sopralluogo, pagamento, report] = await Promise.all([
    metadata.concessioneId
      ? prisma.concessione.findUnique({ where: { id: metadata.concessioneId }, select: { enteId: true } })
      : null,
    metadata.criticitaId
      ? prisma.criticita.findUnique({ where: { id: metadata.criticitaId }, select: { concessione: { select: { enteId: true } } } })
      : null,
    metadata.procedimentoId
      ? prisma.procedimento.findUnique({ where: { id: metadata.procedimentoId }, select: { enteId: true } })
      : null,
    metadata.sopralluogoId
      ? prisma.sopralluogo.findUnique({ where: { id: metadata.sopralluogoId }, select: { concessione: { select: { enteId: true } } } })
      : null,
    metadata.pagamentoId
      ? prisma.pagamento.findUnique({ where: { id: metadata.pagamentoId }, select: { concessione: { select: { enteId: true } } } })
      : null,
    metadata.reportId
      ? prisma.report.findUnique({ where: { id: metadata.reportId }, select: { enteId: true, concessione: { select: { enteId: true } } } })
      : null,
  ]);

  if ((metadata.concessioneId && !concessione)
    || (metadata.criticitaId && !criticita)
    || (metadata.procedimentoId && !procedimento)
    || (metadata.sopralluogoId && !sopralluogo)
    || (metadata.pagamentoId && !pagamento)
    || (metadata.reportId && !report)) {
    throw new Error("Una o più entità collegate non esistono.");
  }
  add(concessione?.enteId);
  add(criticita?.concessione.enteId);
  add(procedimento?.enteId);
  add(sopralluogo?.concessione.enteId);
  add(pagamento?.concessione.enteId);
  add(report?.enteId);
  add(report?.concessione?.enteId);
  if (tenantIds.size !== 1) {
    throw new Error(tenantIds.size > 1
      ? "Entità collegate appartenenti a tenant diversi non consentite."
      : "Tenant canonico non derivabile per il caricamento documento.");
  }
  return tenantIds.values().next().value as string;
}

async function authorize(input: DirectDocumentUploadInput): Promise<AuthorizedDirectUpload> {
  const operationId = operationIdSchema.parse(input.operationId);
  const file = fileSchema.parse(input.file);
  const purpose = purposeSchema.parse(input.purpose ?? "DOCUMENT");
  const submittedMetadata = metadataSchema.parse(input.metadata);
  validateUploadDescriptor(file);
  const user = await getCurrentUser();
  if (!user || !BACKOFFICE_ROLES.includes(user.role)) {
    throw new Error("Profilo non autorizzato al caricamento documentale.");
  }
  let requirementEvidenceInput: CreateFascicoloDocumentRequirementEvidenceInput | undefined;
  let metadataRecord = submittedMetadata;
  if (purpose === "REQUIREMENT_EVIDENCE") {
    if (!canManageProcedimenti(user.role)) {
      throw new Error("Profilo non autorizzato al caricamento di evidenze istruttorie.");
    }
    const proposalId = z.string().trim().min(1).parse(submittedMetadata.proposalId);
    const proposal = await prisma.fascicoloDocumentRequirementProposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        enteId: true,
        procedimentoId: true,
        status: true,
        procedimento: { select: { enteId: true, concessioneId: true } },
      },
    });
    if (!proposal || proposal.status !== "VALIDATO" || proposal.enteId !== proposal.procedimento.enteId
      || !proposal.procedimento.concessioneId) {
      throw new Error("Proposta non disponibile o non valida per il caricamento.");
    }
    metadataRecord = {
      ...submittedMetadata,
      source: "UPLOAD_UTENTE",
      status: "ATTIVO",
      procedimentoId: proposal.procedimentoId,
      concessioneId: proposal.procedimento.concessioneId,
    };
    requirementEvidenceInput = {
      canonicalEnteId: proposal.enteId,
      proposalId: proposal.id,
      documentoId: operationId,
      concessioneId: proposal.procedimento.concessioneId,
      createdByUserId: user.id === "staging-preview-admin" ? null : user.id,
      createdByActorId: user.id,
      createdByEmail: user.email,
      createdByRole: user.role,
    };
  }
  const metadata = parseUploadDocumentMetadata(metadataSource(metadataRecord));
  if (metadata.procedimentoId && !canManageProcedimenti(user.role)) {
    throw new Error("Profilo non autorizzato al caricamento nel procedimento.");
  }
  const canonicalEnteId = await resolveCanonicalTenant(metadata);
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext || tenantContext.userId !== user.id) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }
  requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });

  const actorRef = digest(user.id);
  const tenantRef = digest(canonicalEnteId);
  return {
    operationId,
    file,
    metadata,
    actor: { id: user.id, email: user.email, role: user.role },
    canonicalEnteId,
    storageKey: `pending-documents/${tenantRef}/${actorRef}/${operationId}`,
    storageMetadata: {
      operationid: operationId,
      tenantref: tenantRef,
      actorref: actorRef,
      scopefingerprint: scopeFingerprint(metadata),
      originalnamehash: digest(file.name),
    },
    requirementEvidenceInput,
  };
}

export async function initiateDirectDocumentUpload(input: DirectDocumentUploadInput) {
  const authorized = await authorize(input);
  const uploadUrl = await requireS3DocumentStorage().createPresignedPut({
    storageKey: authorized.storageKey,
    mimeType: authorized.file.type.toLowerCase(),
    sizeBytes: authorized.file.size,
    metadata: authorized.storageMetadata,
    expiresInSeconds: DIRECT_UPLOAD_EXPIRES_SECONDS,
  });
  return {
    operationId: authorized.operationId,
    objectKey: authorized.storageKey,
    uploadUrl,
    expiresAt: new Date(Date.now() + DIRECT_UPLOAD_EXPIRES_SECONDS * 1_000).toISOString(),
    headers: {
      "Content-Type": authorized.file.type.toLowerCase(),
      "If-None-Match": "*",
      ...Object.fromEntries(Object.entries(authorized.storageMetadata).map(([key, value]) => [`x-amz-meta-${key}`, value])),
    },
  };
}

export async function completeDirectDocumentUpload(input: DirectDocumentUploadInput & { objectKey: string }) {
  const authorized = await authorize(input);
  if (input.objectKey !== authorized.storageKey) {
    throw new Error("Chiave oggetto non coerente con l'operazione autorizzata.");
  }
  const storage = requireS3DocumentStorage();
  const head = await storage.head(authorized.storageKey);
  if (!head) throw new Error("Upload non trovato o non ancora completato.");
  if (head.sizeBytes !== authorized.file.size) {
    throw new Error("Upload incompleto: la dimensione ricevuta non corrisponde al file selezionato.");
  }
  if (head.mimeType !== authorized.file.type.toLowerCase()) {
    throw new Error("Il tipo dichiarato dell'oggetto non corrisponde all'upload autorizzato.");
  }
  for (const [key, value] of Object.entries(authorized.storageMetadata)) {
    if (head.metadata[key] !== value) {
      throw new Error("Identità dell'oggetto caricato non valida.");
    }
  }
  const read = await storage.readBounded(authorized.storageKey, getDocumentMaxBytes());
  if (read.disposition !== "FOUND") throw new Error("Upload non trovato o non ancora completato.");
  const actualMimeType = detectDocumentMimeType(read.body, head.mimeType);
  const sha256 = createHash("sha256").update(read.body).digest("hex");
  const stored: StoredDocumentObject = {
    storageProvider: "s3",
    storageKey: authorized.storageKey,
    fileName: authorized.operationId,
    bucket: getS3StorageConfig().bucket,
    sizeBytes: read.body.length,
    sha256,
    mimeType: actualMimeType,
    originalName: authorized.file.name,
  };
  const transactionExtension = authorized.requirementEvidenceInput
    ? {
        createRecord: (tx: Parameters<typeof createFascicoloDocumentRequirementEvidenceRecordInTransaction>[0]) =>
          createFascicoloDocumentRequirementEvidenceRecordInTransaction(tx, authorized.requirementEvidenceInput!),
        writeAudit: async (
          tx: Parameters<typeof createFascicoloDocumentRequirementEvidenceAuditInTransaction>[0],
          result: Awaited<ReturnType<typeof createFascicoloDocumentRequirementEvidenceRecordInTransaction>>,
        ) => {
          if (result.created) {
            await createFascicoloDocumentRequirementEvidenceAuditInTransaction(
              tx,
              authorized.requirementEvidenceInput!,
              result.evidence.id,
            );
          }
        },
      }
    : undefined;
  const result = await registerStoredDocument({
    documentId: authorized.operationId,
    actor: authorized.actor,
    enteId: authorized.canonicalEnteId,
    concessioneId: authorized.metadata.concessioneId,
    criticitaId: authorized.metadata.criticitaId,
    procedimentoId: authorized.metadata.procedimentoId,
    sopralluogoId: authorized.metadata.sopralluogoId,
    pagamentoId: authorized.metadata.pagamentoId,
    reportId: authorized.metadata.reportId,
    nome: authorized.metadata.nome ?? authorized.file.name,
    tipologia: authorized.metadata.tipologia,
    descrizione: authorized.metadata.descrizione,
    dataDocumento: authorized.metadata.dataDocumento,
    source: authorized.metadata.source,
    status: authorized.metadata.status,
    direzione: authorized.metadata.direzione,
    canale: authorized.metadata.canale,
    numeroProtocollo: authorized.metadata.numeroProtocollo,
    dataProtocollo: authorized.metadata.dataProtocollo,
    mittente: authorized.metadata.mittente,
    destinatario: authorized.metadata.destinatario,
    pecMessageId: authorized.metadata.pecMessageId,
    pecRicevutaAccettazioneId: authorized.metadata.pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId: authorized.metadata.pecRicevutaConsegnaId,
    pecWarningMancataRicevuta: authorized.metadata.pecWarningMancataRicevuta,
    deterministicStorage: {
      canonicalEnteId: authorized.canonicalEnteId,
      operationId: authorized.operationId,
    },
    transactionExtension,
  }, stored);
  return {
    created: result.created,
    documentId: result.document.id,
    procedimentoId: result.document.procedimentoId,
    sha256,
    sizeBytes: stored.sizeBytes,
    downloadUrl: `/documenti/${result.document.id}/download`,
  };
}
