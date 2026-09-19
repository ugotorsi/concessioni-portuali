import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import { buildFascicoloReevaluationAdmission } from "@/server/fascicolo-lifecycle/fascicoloReevaluationJob";

export const NEUTRAL_INTAKE_HANDOFF_CONTRACT_VERSION =
  "B2C9_NEUTRAL_INTAKE_HANDOFF_V1" as const;

export class NeutralIntakeHandoffConflictError extends Error {
  readonly code = "NEUTRAL_INTAKE_HANDOFF_CONFLICT" as const;

  constructor() {
    super("Neutral intake classification handoff authority or identity does not match.");
    this.name = "NeutralIntakeHandoffConflictError";
  }
}

interface EnsureClassificationHandoffInput {
  jobId: string;
  neutralIntakeId: string;
  classificationAttemptId: string;
  evidenceHash: string;
  classifierVersion: string;
}

interface DocumentFileVersionArtifact {
  documentId: string;
  canonicalEnteId: string;
  storageProvider: string;
  storageKey: string;
  storageBucket: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

function hasExpectedArtifactBinding(
  version: DocumentFileVersionArtifact,
  expected: DocumentFileVersionArtifact,
): boolean {
  return version.documentId === expected.documentId
    && version.canonicalEnteId === expected.canonicalEnteId
    && version.storageProvider === expected.storageProvider
    && version.storageKey === expected.storageKey
    && version.storageBucket === expected.storageBucket
    && version.mimeType === expected.mimeType
    && version.sizeBytes === expected.sizeBytes
    && version.sha256 === expected.sha256;
}

function deterministicId(kind: string, fields: readonly string[]): string {
  return createHash("sha256")
    .update([NEUTRAL_INTAKE_HANDOFF_CONTRACT_VERSION, kind, ...fields].join("\n"), "utf8")
    .digest("hex");
}

export async function ensureClassificationHandoffInTransaction(
  tx: Prisma.TransactionClient,
  input: EnsureClassificationHandoffInput,
) {
  const [job, decision] = await Promise.all([
    tx.asyncJob.findUnique({
      where: { id: input.jobId },
      select: {
        operation: true,
        tenantId: true,
        initiatingUserId: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
        purpose: true,
        admissionType: true,
        correlationId: true,
        policyDecisionRef: true,
      },
    }),
    tx.neutralIntakeClassificationAttempt.findUnique({
      where: { id: input.classificationAttemptId },
      include: {
        neutralIntake: {
          include: {
            destination: {
              include: { procedimento: { include: { concessione: true } } },
            },
          },
        },
      },
    }),
  ]);
  const intake = decision?.neutralIntake;
  if (
    !job
    || job.operation !== "NEUTRAL_INTAKE_CLASSIFICATION_V1"
    || !decision
    || !intake
    || decision.neutralIntakeId !== input.neutralIntakeId
    || decision.evidenceHash !== input.evidenceHash
    || decision.classifierVersion !== input.classifierVersion
    || job.tenantId !== intake.enteId
  ) {
    throw new NeutralIntakeHandoffConflictError();
  }

  if (decision.outcome === "UNCERTAIN_REVIEW_REQUIRED") {
    return { outcome: "REVIEW_REQUIRED" as const, classificationAttemptId: decision.id };
  }

  if (decision.outcome === "LEGAL_SOURCE_CANDIDATE") {
    await tx.legalSourceCandidateAdmission.createMany({
      data: [{
        enteId: intake.enteId,
        neutralIntakeId: intake.id,
        classificationAttemptId: decision.id,
        extractionAttemptId: decision.extractionAttemptId,
        evidenceHash: decision.evidenceHash,
        classifierVersion: decision.classifierVersion,
        classificationOutcome: decision.outcome,
        contractVersion: NEUTRAL_INTAKE_HANDOFF_CONTRACT_VERSION,
        actorId: job.actorId,
        actorEmail: job.actorEmail,
        actorRole: job.actorRole,
        purpose: job.purpose,
      }],
      skipDuplicates: true,
    });
    const admission = await tx.legalSourceCandidateAdmission.findFirst({
      where: {
        neutralIntakeId: intake.id,
        classificationAttemptId: decision.id,
        evidenceHash: decision.evidenceHash,
        contractVersion: NEUTRAL_INTAKE_HANDOFF_CONTRACT_VERSION,
      },
    });
    if (!admission) throw new NeutralIntakeHandoffConflictError();
    await markRouted(tx, intake.id);
    return { outcome: "LEGAL_SOURCE_CANDIDATE_ADMITTED" as const, admissionId: admission.id };
  }

  const destination = intake.destination;
  if (!destination) {
    await markReviewRequired(tx, intake.id);
    return { outcome: "REVIEW_REQUIRED" as const, classificationAttemptId: decision.id };
  }
  const concessione = destination.procedimento.concessione;
  if (!intake.enteId || concessione.enteId !== intake.enteId) {
    throw new NeutralIntakeHandoffConflictError();
  }

  const documentId = deterministicId("DOCUMENTO", [
    intake.id,
    decision.id,
    decision.evidenceHash,
    destination.procedimentoId,
  ]);
  const fileVersionId = deterministicId("DOCUMENT_FILE_VERSION", [documentId, intake.sha256]);
  await tx.documento.createMany({
    data: [{
      id: documentId,
      nome: intake.originalName ?? `Neutral intake ${intake.id}`,
      tipologia: "ALTRO",
      statoDocumento: "ATTIVO",
      mimeType: intake.mimeType,
      dimensioneBytes: intake.sizeBytes,
      checksumSha256: intake.sha256,
      sha256: intake.sha256,
      url: `/documenti/${documentId}/download`,
      storagePath: intake.storageKey,
      storageKey: intake.storageKey,
      storageProvider: intake.storageProvider,
      storageBucket: intake.storageBucket,
      nomeStorage: intake.sha256,
      originalName: intake.originalName,
      sizeBytes: intake.sizeBytes,
      documentType: "ALTRO",
      documentDate: intake.receivedAt,
      source: "NEUTRAL_INTAKE_CLASSIFICATION",
      status: "ATTIVO",
      uploadedByUserId: job.initiatingUserId,
      uploadedByUserEmail: job.actorEmail,
      uploadedByUserRole: job.actorRole,
      enteId: intake.enteId,
      concessioneId: destination.procedimento.concessioneId,
      procedimentoId: destination.procedimentoId,
    }],
    skipDuplicates: true,
  });
  const document = await tx.documento.findUnique({ where: { id: documentId } });
  if (
    !document
    || document.enteId !== intake.enteId
    || document.concessioneId !== destination.procedimento.concessioneId
    || document.procedimentoId !== destination.procedimentoId
    || document.sha256 !== intake.sha256
    || document.storageProvider !== intake.storageProvider
    || document.storageKey !== intake.storageKey
  ) {
    throw new NeutralIntakeHandoffConflictError();
  }
  const expectedVersion = {
    documentId,
    canonicalEnteId: intake.enteId,
    storageProvider: intake.storageProvider,
    storageKey: intake.storageKey,
    storageBucket: intake.storageBucket,
    mimeType: intake.mimeType,
    sizeBytes: intake.sizeBytes,
    sha256: intake.sha256,
  };
  await tx.documentFileVersion.createMany({
    data: [{
      id: fileVersionId,
      ...expectedVersion,
      createdByUserId: job.initiatingUserId,
      createdByActorId: job.actorId,
      createdByRole: job.actorRole,
    }],
    skipDuplicates: true,
  });
  const version = await tx.documentFileVersion.findUnique({ where: { id: fileVersionId } });
  if (!version || !hasExpectedArtifactBinding(version, expectedVersion)) {
    throw new NeutralIntakeHandoffConflictError();
  }
  if (document.currentFileVersionId === null) {
    await tx.documento.updateMany({
      where: { id: documentId, currentFileVersionId: null },
      data: { currentFileVersionId: fileVersionId },
    });
  } else if (document.currentFileVersionId !== fileVersionId) {
    throw new NeutralIntakeHandoffConflictError();
  }
  await markRouted(tx, intake.id);
  await admitAsyncJobInTransaction(tx, buildFascicoloReevaluationAdmission({
    procedimentoId: destination.procedimentoId,
    change: {
      kind: "DOCUMENT_CHANGED",
      triggeredAt: intake.receivedAt.toISOString(),
      origin: "WORKER",
      stateFingerprint: deterministicId("DOCUMENT_STATE", [
        documentId,
        fileVersionId,
        version.sha256,
        "ATTIVO",
      ]),
      legalAssessmentTarget: { kind: "UNDETERMINED" },
      procedimentoId: destination.procedimentoId,
      documentId,
      documentVersionId: fileVersionId,
      changeType: "CREATED",
      legalEvidenceKind: "NONE",
    },
  }, {
    tenantId: job.tenantId,
    admissionType: job.admissionType,
    initiatingUserId: job.initiatingUserId,
    actorId: job.actorId,
    actorEmail: job.actorEmail,
    actorRole: job.actorRole,
    policyDecisionRef: job.policyDecisionRef,
    correlationId: job.correlationId,
  }));
  return { outcome: "CASE_DOCUMENT_ROUTED" as const, documentId };
}

function markRouted(tx: Prisma.TransactionClient, neutralIntakeId: string) {
  return tx.neutralIntake.updateMany({
    where: { id: neutralIntakeId, status: { in: ["EVIDENCE_READY", "REVIEW_REQUIRED"] } },
    data: { status: "ROUTED", statusVersion: { increment: 1 } },
  });
}

function markReviewRequired(tx: Prisma.TransactionClient, neutralIntakeId: string) {
  return tx.neutralIntake.updateMany({
    where: { id: neutralIntakeId, status: "EVIDENCE_READY" },
    data: { status: "REVIEW_REQUIRED", statusVersion: { increment: 1 } },
  });
}