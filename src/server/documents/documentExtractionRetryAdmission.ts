import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";

import {
  DOCUMENT_EXTRACTION_OPERATION,
  DOCUMENT_EXTRACTION_PURPOSE,
} from "./documentExtractionAdmission";
import { DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1 } from "./documentExtractionPolicy";
import {
  issueDocumentExtractionRetryPermit,
  verifyDocumentExtractionRetryPermit,
  type DocumentExtractionRetryPermit,
} from "./documentExtractionRetryPermit";

// Kept free of extractor imports so web server actions can admit retries without bundling OCR.
function buildAuthorizedRetryAdmission(
  permit: DocumentExtractionRetryPermit,
): AsyncJobAdmissionInput {
  return {
    operation: DOCUMENT_EXTRACTION_OPERATION,
    logicalOperationId: [
      permit.documentoId,
      permit.documentFileVersionId,
      DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      `retry:${permit.failedAttemptId}:${permit.permitRef}`,
    ].join(":"),
    purpose: DOCUMENT_EXTRACTION_PURPOSE,
    correlationId: `document-extraction-retry:${permit.permitRef}`,
    procedimentoId: permit.procedimentoId,
    policyDecisionRef: permit.permitRef,
    inputReference: {
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: permit.documentFileVersionId,
      referenceVersion: "V1",
      metadata: {
        documentoId: permit.documentoId,
        procedimentoId: permit.procedimentoId,
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        retryAttemptId: permit.failedAttemptId,
        retryPermitRef: permit.permitRef,
      },
    },
    maxAttempts: 1,
    availableAt: permit.createdAt,
    admission: {
      admissionType: "AUTHENTICATED_USER",
      tenantId: permit.tenantId,
      initiatingUserId: permit.actor.userId,
      actor: {
        actorId: permit.actor.userId,
        actorEmail: permit.actor.userEmail,
        actorRole: permit.actor.userRole,
      },
    },
  };
}

export async function ensureAuthorizedDocumentExtractionRetryJob(
  failedAttemptId: string,
) {
  const permit = await issueDocumentExtractionRetryPermit(failedAttemptId);
  await verifyDocumentExtractionRetryPermit({
    permitRef: permit.permitRef,
    failedAttemptId: permit.failedAttemptId,
    documentoId: permit.documentoId,
    documentFileVersionId: permit.documentFileVersionId,
    tenantId: permit.tenantId,
    procedimentoId: permit.procedimentoId,
    actorUserId: permit.actor.userId,
    actorRole: permit.actor.userRole,
  });
  return admitAsyncJob(buildAuthorizedRetryAdmission(permit));
}
