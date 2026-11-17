import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser, DemoRole } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCurrentTenantContext,
  requireTenantAccess,
  type CurrentTenantContext,
} from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
} from "./documentExtractionPolicy";

const AUTHORIZATION_VERSION = "DOCUMENT_OCR_BATCH_AUTHORIZATION_V2";
const AUTHORIZATION_ACTION = "DOCUMENT_OCR_BATCH_AUTHORIZED";
const AUTHORIZATION_ENTITY = "DocumentOcrBatchAuthorization";
const AUTHORIZED_ROLES = new Set<DemoRole>(["ADMIN", "TECNICO"]);

type SourceAttempt = {
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

type AuthorizationRecord = {
  entitaId: string | null;
  userId: string | null;
  userRole: string | null;
  enteId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

export type DocumentOcrAuthorization = {
  authorizationRef: string;
  createdAt: Date;
  failedAttemptId: string;
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  actor: {
    userId: string;
    userEmail: string;
    userRole: DemoRole;
  };
};

export class DocumentOcrAuthorizationError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "ROLE_NOT_ALLOWED"
      | "TENANT_ACCESS_DENIED"
      | "FAILED_ATTEMPT_NOT_FOUND"
      | "FAILED_ATTEMPT_NOT_OCR_ELIGIBLE"
      | "FAILED_ATTEMPT_SCOPE_MISMATCH"
      | "AUTHORIZATION_NOT_FOUND"
      | "AUTHORIZATION_SCOPE_MISMATCH",
  ) {
    super(code);
    this.name = "DocumentOcrAuthorizationError";
  }
}

export interface DocumentOcrAuthorizationDependencies {
  getCurrentUser(): Promise<CurrentUser | null>;
  getCurrentTenantContext(): Promise<CurrentTenantContext | null>;
  loadAttempt(attemptId: string): Promise<SourceAttempt | null>;
  persistAuthorization(input: {
    authorizationRef: string;
    attempt: SourceAttempt;
    actor: CurrentUser;
  }): Promise<AuthorizationRecord>;
  loadAuthorization(authorizationRef: string): Promise<AuthorizationRecord | null>;
}

function recordMetadata(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function authorizationRef(attempt: SourceAttempt): string {
  return createHash("sha256").update([
    AUTHORIZATION_VERSION,
    attempt.id,
    attempt.documentoId,
    attempt.documentFileVersionId,
    attempt.tenantId,
    attempt.procedimentoId,
    DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
  ].join("\n"), "utf8").digest("hex");
}

function validSourceScope(attempt: SourceAttempt): boolean {
  return attempt.documento.enteId === attempt.tenantId
    && attempt.documento.procedimentoId === attempt.procedimentoId
    && attempt.documento.currentFileVersionId === attempt.documentFileVersionId
    && attempt.policyVersion === DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1;
}

function validAuthorizationRecord(input: {
  record: AuthorizationRecord;
  authorizationRef: string;
  attempt: SourceAttempt;
  actorUserId: string;
  actorRole: string;
}): boolean {
  const metadata = recordMetadata(input.record.metadata);
  const persistedVersion = metadata?.permitVersion ?? metadata?.authorizationVersion;
  const isHistoricalSanitizedRecord =
    metadata !== null
    && !Object.hasOwn(metadata, "permitVersion")
    && !Object.hasOwn(metadata, "authorizationVersion");
  return input.record.entitaId === input.authorizationRef
    && input.authorizationRef === authorizationRef(input.attempt)
    && input.record.userId === input.actorUserId
    && input.record.userRole === input.actorRole
    && input.record.enteId === input.attempt.tenantId
    && (
      persistedVersion === AUTHORIZATION_VERSION
      || isHistoricalSanitizedRecord
    )
    && metadata?.failedAttemptId === input.attempt.id
    && metadata?.documentoId === input.attempt.documentoId
    && metadata?.documentFileVersionId === input.attempt.documentFileVersionId
    && metadata?.procedimentoId === input.attempt.procedimentoId
    && metadata?.sourcePolicyVersion === DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1
    && metadata?.targetPolicyVersion === DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2
    && (
      metadata?.failureCode === "OCR_REQUIRED"
      || metadata?.failureCode === "ARTIFACT_TOO_LARGE"
    );
}

async function persistAuthorization(input: {
  authorizationRef: string;
  attempt: SourceAttempt;
  actor: CurrentUser;
}): Promise<AuthorizationRecord> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(
        hashtext('document-ocr-batch-authorization:v2'),
        hashtext(${input.authorizationRef})
      )
    `;
    if (rows.length !== 1 || rows[0]?.acquired !== true) {
      throw new Error("DOCUMENT_OCR_AUTHORIZATION_LOCK_FAILED");
    }
    const existing = await tx.activityLog.findFirst({
      where: {
        azione: AUTHORIZATION_ACTION,
        entita: AUTHORIZATION_ENTITY,
        entitaId: input.authorizationRef,
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
      azione: AUTHORIZATION_ACTION,
      entita: AUTHORIZATION_ENTITY,
      entitaId: input.authorizationRef,
      enteId: input.attempt.tenantId,
      esito: "SUCCESS",
      actor: {
        userId: input.actor.id,
        userEmail: input.actor.email,
        userRole: input.actor.role,
      },
      metadata: {
        permitVersion: AUTHORIZATION_VERSION,
        failedAttemptId: input.attempt.id,
        documentoId: input.attempt.documentoId,
        documentFileVersionId: input.attempt.documentFileVersionId,
        procedimentoId: input.attempt.procedimentoId,
        sourcePolicyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        targetPolicyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
        failureCode: input.attempt.failureCode,
      },
    });
  });
}

const defaultDependencies: DocumentOcrAuthorizationDependencies = {
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
  persistAuthorization,
  loadAuthorization: (authorizationRef) => prisma.activityLog.findFirst({
    where: {
      azione: AUTHORIZATION_ACTION,
      entita: AUTHORIZATION_ENTITY,
      entitaId: authorizationRef,
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

export async function issueDocumentOcrAuthorization(
  failedAttemptId: string,
  dependencies: DocumentOcrAuthorizationDependencies = defaultDependencies,
): Promise<DocumentOcrAuthorization> {
  const actor = await dependencies.getCurrentUser();
  const tenantContext = await dependencies.getCurrentTenantContext();
  if (!actor || !tenantContext || tenantContext.userId !== actor.id || tenantContext.role !== actor.role) {
    throw new DocumentOcrAuthorizationError("UNAUTHENTICATED");
  }
  if (!AUTHORIZED_ROLES.has(actor.role)) {
    throw new DocumentOcrAuthorizationError("ROLE_NOT_ALLOWED");
  }
  const attempt = await dependencies.loadAttempt(failedAttemptId);
  if (!attempt) {
    throw new DocumentOcrAuthorizationError("FAILED_ATTEMPT_NOT_FOUND");
  }
  try {
    requireTenantAccess(tenantContext, attempt.tenantId, { mode: "write" });
  } catch {
    throw new DocumentOcrAuthorizationError("TENANT_ACCESS_DENIED");
  }
  if (!validSourceScope(attempt)) {
    throw new DocumentOcrAuthorizationError("FAILED_ATTEMPT_SCOPE_MISMATCH");
  }
  if (
    attempt.outcome !== "FAILED"
    || (attempt.failureCode !== "OCR_REQUIRED" && attempt.failureCode !== "ARTIFACT_TOO_LARGE")
  ) {
    throw new DocumentOcrAuthorizationError("FAILED_ATTEMPT_NOT_OCR_ELIGIBLE");
  }
  const reference = authorizationRef(attempt);
  const record = await dependencies.persistAuthorization({
    authorizationRef: reference,
    attempt,
    actor,
  });
  if (!validAuthorizationRecord({
    record,
    authorizationRef: reference,
    attempt,
    actorUserId: actor.id,
    actorRole: actor.role,
  })) {
    throw new DocumentOcrAuthorizationError("AUTHORIZATION_SCOPE_MISMATCH");
  }
  return {
    authorizationRef: reference,
    createdAt: record.createdAt,
    failedAttemptId: attempt.id,
    documentoId: attempt.documentoId,
    documentFileVersionId: attempt.documentFileVersionId,
    tenantId: attempt.tenantId,
    procedimentoId: attempt.procedimentoId,
    actor: {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
    },
  };
}

export async function verifyDocumentOcrAuthorization(
  input: {
    authorizationRef: string;
    failedAttemptId: string;
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    procedimentoId: string;
    actorUserId: string;
    actorRole: string;
  },
  dependencies: Pick<
    DocumentOcrAuthorizationDependencies,
    "loadAttempt" | "loadAuthorization"
  > = defaultDependencies,
): Promise<void> {
  const attempt = await dependencies.loadAttempt(input.failedAttemptId);
  const record = await dependencies.loadAuthorization(input.authorizationRef);
  if (!attempt || !record) {
    throw new DocumentOcrAuthorizationError("AUTHORIZATION_NOT_FOUND");
  }
  if (
    attempt.documentoId !== input.documentoId
    || attempt.documentFileVersionId !== input.documentFileVersionId
    || attempt.tenantId !== input.tenantId
    || attempt.procedimentoId !== input.procedimentoId
    || attempt.outcome !== "FAILED"
    || (attempt.failureCode !== "OCR_REQUIRED" && attempt.failureCode !== "ARTIFACT_TOO_LARGE")
    || !validSourceScope(attempt)
    || !validAuthorizationRecord({
      record,
      authorizationRef: input.authorizationRef,
      attempt,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    })
  ) {
    throw new DocumentOcrAuthorizationError("AUTHORIZATION_SCOPE_MISMATCH");
  }
}
