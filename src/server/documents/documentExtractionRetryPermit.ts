import { createHash } from "node:crypto";

import type { DemoRole, CurrentUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCurrentTenantContext,
  requireTenantAccess,
  type CurrentTenantContext,
} from "@/lib/tenant-auth";
import type { Prisma } from "@/generated/prisma/client";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  isRetryableDocumentExtractionFailure,
} from "./documentExtraction";

const RETRY_PERMIT_VERSION = "DOCUMENT_EXTRACTION_RETRY_PERMIT_V1";
const RETRY_PERMIT_ACTION = "DOCUMENT_EXTRACTION_RETRY_AUTHORIZED";
const RETRY_PERMIT_ENTITY = "DocumentExtractionRetryPermit";
const RETRY_ROLES = new Set<DemoRole>(["ADMIN", "TECNICO"]);

type RetryAttempt = {
  id: string;
  outcome: "SUCCEEDED" | "FAILED";
  failureCode: string | null;
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  policyVersion: string;
  documento: {
    enteId: string | null;
    procedimentoId: string | null;
    currentFileVersionId: string | null;
  };
};

type PermitRecord = {
  entitaId: string | null;
  userId: string | null;
  userRole: string | null;
  enteId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

export type DocumentExtractionRetryPermit = {
  permitRef: string;
  createdAt: Date;
  failedAttemptId: string;
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  policyVersion: typeof DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1;
  actor: {
    userId: string;
    userEmail: string;
    userRole: DemoRole;
  };
};

export class DocumentExtractionRetryPermitError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "ROLE_NOT_ALLOWED"
      | "TENANT_ACCESS_DENIED"
      | "FAILED_ATTEMPT_NOT_FOUND"
      | "FAILED_ATTEMPT_NOT_RETRYABLE"
      | "FAILED_ATTEMPT_SCOPE_MISMATCH"
      | "PERMIT_NOT_FOUND"
      | "PERMIT_SCOPE_MISMATCH",
  ) {
    super(code);
    this.name = "DocumentExtractionRetryPermitError";
  }
}

export interface DocumentExtractionRetryPermitDependencies {
  getCurrentUser(): Promise<CurrentUser | null>;
  getCurrentTenantContext(): Promise<CurrentTenantContext | null>;
  loadAttempt(attemptId: string): Promise<RetryAttempt | null>;
  persistPermit(input: {
    permitRef: string;
    attempt: RetryAttempt;
    actor: CurrentUser;
  }): Promise<PermitRecord>;
  loadPermit(permitRef: string): Promise<PermitRecord | null>;
}

function metadata(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function permitRef(attempt: RetryAttempt): string {
  return createHash("sha256").update([
    RETRY_PERMIT_VERSION,
    attempt.id,
    attempt.documentoId,
    attempt.documentFileVersionId,
    attempt.tenantId,
    attempt.procedimentoId,
    attempt.policyVersion,
  ].join("\n"), "utf8").digest("hex");
}

function validAttemptScope(attempt: RetryAttempt): boolean {
  return attempt.documento.enteId === attempt.tenantId
    && attempt.documento.procedimentoId === attempt.procedimentoId
    && attempt.documento.currentFileVersionId === attempt.documentFileVersionId
    && attempt.policyVersion === DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1;
}

function validPermitRecord(input: {
  record: PermitRecord;
  permitRef: string;
  attempt: RetryAttempt;
  actorUserId: string;
  actorRole: string;
}): boolean {
  const permitMetadata = metadata(input.record.metadata);
  return input.record.entitaId === input.permitRef
    && input.record.userId === input.actorUserId
    && input.record.userRole === input.actorRole
    && input.record.enteId === input.attempt.tenantId
    && permitMetadata?.permitVersion === RETRY_PERMIT_VERSION
    && permitMetadata?.failedAttemptId === input.attempt.id
    && permitMetadata?.documentoId === input.attempt.documentoId
    && permitMetadata?.documentFileVersionId === input.attempt.documentFileVersionId
    && permitMetadata?.procedimentoId === input.attempt.procedimentoId
    && permitMetadata?.policyVersion === input.attempt.policyVersion
    && permitMetadata?.failureCode === input.attempt.failureCode;
}

async function persistPermit(input: {
  permitRef: string;
  attempt: RetryAttempt;
  actor: CurrentUser;
}): Promise<PermitRecord> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('document-extraction-retry-permit:v1'),
        hashtext(${input.permitRef})
      )
    `;
    const existing = await tx.activityLog.findFirst({
      where: {
        azione: RETRY_PERMIT_ACTION,
        entita: RETRY_PERMIT_ENTITY,
        entitaId: input.permitRef,
        esito: "SUCCESS",
      },
      select: {
        entitaId: true,
        userId: true,
        userRole: true,
        enteId: true,
        metadata: true,
        createdAt: true,
      },
    });
    if (existing) return existing;
    return createAuditLogInTransaction(tx, {
      azione: RETRY_PERMIT_ACTION,
      entita: RETRY_PERMIT_ENTITY,
      entitaId: input.permitRef,
      enteId: input.attempt.tenantId,
      esito: "SUCCESS",
      actor: {
        userId: input.actor.id,
        userEmail: input.actor.email,
        userRole: input.actor.role,
      },
      metadata: {
        permitVersion: RETRY_PERMIT_VERSION,
        failedAttemptId: input.attempt.id,
        documentoId: input.attempt.documentoId,
        documentFileVersionId: input.attempt.documentFileVersionId,
        procedimentoId: input.attempt.procedimentoId,
        policyVersion: input.attempt.policyVersion,
        failureCode: input.attempt.failureCode,
      },
    });
  });
}

const defaultDependencies: DocumentExtractionRetryPermitDependencies = {
  getCurrentUser,
  getCurrentTenantContext,
  loadAttempt: (attemptId) => prisma.documentExtractionAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      outcome: true,
      failureCode: true,
      documentoId: true,
      documentFileVersionId: true,
      tenantId: true,
      procedimentoId: true,
      policyVersion: true,
      documento: {
        select: {
          enteId: true,
          procedimentoId: true,
          currentFileVersionId: true,
        },
      },
    },
  }),
  persistPermit,
  loadPermit: (permitRef) => prisma.activityLog.findFirst({
    where: {
      azione: RETRY_PERMIT_ACTION,
      entita: RETRY_PERMIT_ENTITY,
      entitaId: permitRef,
      esito: "SUCCESS",
    },
    select: {
      entitaId: true,
      userId: true,
      userRole: true,
      enteId: true,
      metadata: true,
      createdAt: true,
    },
  }),
};

export async function issueDocumentExtractionRetryPermit(
  failedAttemptId: string,
  dependencies: DocumentExtractionRetryPermitDependencies = defaultDependencies,
): Promise<DocumentExtractionRetryPermit> {
  const actor = await dependencies.getCurrentUser();
  const tenantContext = await dependencies.getCurrentTenantContext();
  if (!actor || !tenantContext || tenantContext.userId !== actor.id || tenantContext.role !== actor.role) {
    throw new DocumentExtractionRetryPermitError("UNAUTHENTICATED");
  }
  if (!RETRY_ROLES.has(actor.role)) {
    throw new DocumentExtractionRetryPermitError("ROLE_NOT_ALLOWED");
  }
  const attempt = await dependencies.loadAttempt(failedAttemptId);
  if (!attempt) {
    throw new DocumentExtractionRetryPermitError("FAILED_ATTEMPT_NOT_FOUND");
  }
  try {
    requireTenantAccess(tenantContext, attempt.tenantId, { mode: "write" });
  } catch {
    throw new DocumentExtractionRetryPermitError("TENANT_ACCESS_DENIED");
  }
  if (!validAttemptScope(attempt)) {
    throw new DocumentExtractionRetryPermitError("FAILED_ATTEMPT_SCOPE_MISMATCH");
  }
  if (
    attempt.outcome !== "FAILED"
    || !isRetryableDocumentExtractionFailure(attempt.failureCode)
  ) {
    throw new DocumentExtractionRetryPermitError("FAILED_ATTEMPT_NOT_RETRYABLE");
  }
  const reference = permitRef(attempt);
  const record = await dependencies.persistPermit({ permitRef: reference, attempt, actor });
  if (!validPermitRecord({
    record,
    permitRef: reference,
    attempt,
    actorUserId: actor.id,
    actorRole: actor.role,
  })) {
    throw new DocumentExtractionRetryPermitError("PERMIT_SCOPE_MISMATCH");
  }
  return {
    permitRef: reference,
    createdAt: record.createdAt,
    failedAttemptId: attempt.id,
    documentoId: attempt.documentoId,
    documentFileVersionId: attempt.documentFileVersionId,
    tenantId: attempt.tenantId,
    procedimentoId: attempt.procedimentoId,
    policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
    actor: {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
    },
  };
}

export async function verifyDocumentExtractionRetryPermit(
  input: {
    permitRef: string;
    failedAttemptId: string;
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    procedimentoId: string;
    actorUserId: string;
    actorRole: string;
  },
  dependencies: Pick<
    DocumentExtractionRetryPermitDependencies,
    "loadAttempt" | "loadPermit"
  > = defaultDependencies,
): Promise<void> {
  const attempt = await dependencies.loadAttempt(input.failedAttemptId);
  const record = await dependencies.loadPermit(input.permitRef);
  if (!attempt || !record) {
    throw new DocumentExtractionRetryPermitError("PERMIT_NOT_FOUND");
  }
  if (
    attempt.documentoId !== input.documentoId
    || attempt.documentFileVersionId !== input.documentFileVersionId
    || attempt.tenantId !== input.tenantId
    || attempt.procedimentoId !== input.procedimentoId
    || attempt.outcome !== "FAILED"
    || !validAttemptScope(attempt)
    || !isRetryableDocumentExtractionFailure(attempt.failureCode)
    || !validPermitRecord({
      record,
      permitRef: input.permitRef,
      attempt,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    })
  ) {
    throw new DocumentExtractionRetryPermitError("PERMIT_SCOPE_MISMATCH");
  }
}
