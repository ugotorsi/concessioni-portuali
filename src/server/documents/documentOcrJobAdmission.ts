import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";

import {
  issueDocumentOcrAuthorization,
  verifyDocumentOcrAuthorization,
} from "./documentOcrAuthorization";
import { DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2 } from "./documentExtractionPolicy";

export const DOCUMENT_OCR_COORDINATOR_OPERATION =
  "DOCUMENT_OCR_COORDINATOR_V2" as const;

export async function ensureAuthorizedDocumentOcrExtractionJob(
  failedAttemptId: string,
) {
  const authorization = await issueDocumentOcrAuthorization(failedAttemptId);
  await verifyDocumentOcrAuthorization({
    authorizationRef: authorization.authorizationRef,
    failedAttemptId: authorization.failedAttemptId,
    documentoId: authorization.documentoId,
    documentFileVersionId: authorization.documentFileVersionId,
    tenantId: authorization.tenantId,
    procedimentoId: authorization.procedimentoId,
    actorUserId: authorization.actor.userId,
    actorRole: authorization.actor.userRole,
  });
  const admission = await admitAsyncJob({
    operation: DOCUMENT_OCR_COORDINATOR_OPERATION,
    logicalOperationId: [
      authorization.documentoId,
      authorization.documentFileVersionId,
      DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
      authorization.authorizationRef,
    ].join(":"),
    purpose: "DOCUMENT_OCR_EXTRACTION",
    correlationId: `document-ocr:${authorization.authorizationRef}`,
    procedimentoId: authorization.procedimentoId,
    policyDecisionRef: authorization.authorizationRef,
    inputReference: {
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: authorization.documentFileVersionId,
      referenceVersion: "V2",
      metadata: {
        documentoId: authorization.documentoId,
        procedimentoId: authorization.procedimentoId,
        policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
        failedAttemptId: authorization.failedAttemptId,
        permitRef: authorization.authorizationRef,
      },
    },
    maxAttempts: 3,
    availableAt: authorization.createdAt,
    admission: {
      admissionType: "AUTHENTICATED_USER",
      tenantId: authorization.tenantId,
      initiatingUserId: authorization.actor.userId,
      actor: {
        actorId: authorization.actor.userId,
        actorEmail: authorization.actor.userEmail,
        actorRole: authorization.actor.userRole,
      },
    },
  });
  await requestDocumentWorkerActivation({
    kind: "DOCUMENT_OCR",
    procedimentoId: authorization.procedimentoId,
  });
  return admission;
}
