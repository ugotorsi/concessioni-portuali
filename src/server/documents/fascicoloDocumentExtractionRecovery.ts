import { prisma } from "@/lib/prisma";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";

import { ensureDocumentExtractionJob } from "./documentExtractionAdmission";

const RECOVERY_POLICY_DECISION = "FASCICOLO_EXISTING_DOCUMENT_EXTRACTION_ADMISSION_V1";
const RECOVERY_ACTOR_ID = "fascicolo-existing-document-extraction";

interface RecoveryTarget {
  documentoId: string;
  documentFileVersionId: string;
  createdAt: Date;
}

interface FascicoloDocumentExtractionRecoveryDependencies {
  loadTargets(input: {
    tenantId: string;
    procedimentoId: string;
  }): Promise<readonly RecoveryTarget[] | null>;
  admit(input: Parameters<typeof ensureDocumentExtractionJob>[0]): ReturnType<typeof ensureDocumentExtractionJob>;
  activate: typeof requestDocumentWorkerActivation;
}

const defaultDependencies: FascicoloDocumentExtractionRecoveryDependencies = {
  async loadTargets(input) {
    const procedimento = await prisma.procedimento.findFirst({
      where: {
        id: input.procedimentoId,
        enteId: input.tenantId,
      },
      select: { id: true },
    });
    if (!procedimento) return null;

    const documents = await prisma.documento.findMany({
      where: {
        enteId: input.tenantId,
        procedimentoId: input.procedimentoId,
        statoDocumento: "ATTIVO",
        currentFileVersionId: { not: null },
        currentFileVersion: {
          is: {
            canonicalEnteId: input.tenantId,
            mimeType: "application/pdf",
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        currentFileVersion: {
          select: {
            id: true,
            createdAt: true,
          },
        },
      },
    });

    return documents.flatMap((document) => document.currentFileVersion
      ? [{
          documentoId: document.id,
          documentFileVersionId: document.currentFileVersion.id,
          createdAt: document.currentFileVersion.createdAt,
        }]
      : []);
  },
  admit: (input) => ensureDocumentExtractionJob(input),
  activate: requestDocumentWorkerActivation,
};

export class FascicoloDocumentExtractionRecoveryError extends Error {
  constructor(readonly code: "FASCICOLO_NOT_FOUND") {
    super(code);
    this.name = "FascicoloDocumentExtractionRecoveryError";
  }
}

export async function ensureFascicoloDocumentExtractionJobs(
  input: {
    tenantId: string;
    procedimentoId: string;
  },
  dependencies: FascicoloDocumentExtractionRecoveryDependencies = defaultDependencies,
) {
  const targets = await dependencies.loadTargets(input);
  if (!targets) {
    throw new FascicoloDocumentExtractionRecoveryError("FASCICOLO_NOT_FOUND");
  }

  const admissions = [];
  for (const target of targets) {
    admissions.push(await dependencies.admit({
      documentoId: target.documentoId,
      documentFileVersionId: target.documentFileVersionId,
      procedimentoId: input.procedimentoId,
      correlationId: `existing-document-extraction:${target.documentoId}:${target.documentFileVersionId}`,
      availableAt: target.createdAt,
      authority: {
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId: input.tenantId,
        initiatingUserId: null,
        actorId: RECOVERY_ACTOR_ID,
        actorEmail: null,
        actorRole: "SYSTEM",
        policyDecisionRef: RECOVERY_POLICY_DECISION,
      },
    }));
  }

  const activation = targets.length > 0
    ? await dependencies.activate({
        kind: "DOCUMENT_EXTRACTION",
        procedimentoId: input.procedimentoId,
      })
    : { outcome: "NOT_REQUIRED" as const };

  return {
    targetCount: targets.length,
    createdJobCount: admissions.filter((admission) => admission.outcome === "CREATED").length,
    reusedJobCount: admissions.filter((admission) => admission.outcome === "REUSED").length,
    activation,
  };
}
