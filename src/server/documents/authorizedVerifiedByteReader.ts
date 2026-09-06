import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { readDocumentFileFromProvider } from "@/server/documents/storage";
import {
  DocumentStorageReadCoherenceError,
  DocumentStorageReadUnavailableError,
  type DocumentStorageBackend,
} from "@/server/documents/storage/types";

export type AuthorizedDocumentByteReadResult =
  | { status: "NO_FILE_VERSION" }
  | { status: "LEGACY_UNVERIFIED" }
  | { status: "SOURCE_MISSING" }
  | { status: "SOURCE_UNAVAILABLE" }
  | {
      status: "AVAILABLE_VERIFIED";
      body: Buffer;
      mimeType: string;
      fileName: string;
      sizeBytes: number;
      sha256: string;
    };

export type DocumentReadAuthorizationErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND_NON_OBSERVABLE";

export class DocumentReadAuthorizationError extends Error {
  readonly code: DocumentReadAuthorizationErrorCode;

  constructor(code: DocumentReadAuthorizationErrorCode) {
    super(`Document read authorization failed (${code}).`);
    this.name = "DocumentReadAuthorizationError";
    this.code = code;
  }
}

export type DocumentReadIntegrityErrorCode =
  | "INVALID_MANIFEST"
  | "DOCUMENT_VERSION_MISMATCH"
  | "TENANT_VERSION_MISMATCH"
  | "PROVIDER_COHERENCE_FAILURE"
  | "BUCKET_COHERENCE_FAILURE"
  | "SIZE_MISMATCH"
  | "SHA256_MISMATCH";

export class DocumentReadIntegrityError extends Error {
  readonly code: DocumentReadIntegrityErrorCode;

  constructor(code: DocumentReadIntegrityErrorCode) {
    super(`Document read integrity failed (${code}).`);
    this.name = "DocumentReadIntegrityError";
    this.code = code;
  }
}

export class DocumentReadAuditError extends Error {
  readonly code = "AUDIT_UNAVAILABLE" as const;

  constructor(cause?: unknown) {
    super("Document read audit unavailable.", { cause });
    this.name = "DocumentReadAuditError";
  }
}

type AuditContext = {
  documentoId: string;
  userId: string | null;
  role: string | null;
  enteId?: string | null;
  concessioneId?: string | null;
  fileVersionId?: string | null;
};

async function writeAudit(
  outcome: string,
  context: AuditContext,
  success = false,
): Promise<void> {
  const write = success ? auditSuccess : auditFailure;

  try {
    await write({
      azione: outcome === "UNAUTHENTICATED" || outcome === "FORBIDDEN" || outcome === "NOT_FOUND_NON_OBSERVABLE"
        ? "AUTHZ_DENIED"
        : "DOCUMENT_DOWNLOAD",
      entita: "Documento",
      entitaId: context.documentoId,
      enteId: context.enteId ?? null,
      concessioneId: context.concessioneId ?? null,
      actor: {
        userId: context.userId,
        userRole: context.role,
      },
      metadata: {
        actionType: "DOCUMENT_DOWNLOAD",
        outcome,
        ...(context.fileVersionId ? { fileVersionId: context.fileVersionId } : {}),
      },
    });
  } catch (error) {
    throw new DocumentReadAuditError(error);
  }
}

function hasNonBlank(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasLegacyFileIndicator(documento: {
  storageKey: string | null;
  storagePath: string | null;
  nomeStorage: string | null;
  publicUrl: string | null;
  checksumSha256: string | null;
  sha256: string | null;
  dimensioneBytes: number | null;
  sizeBytes: number | null;
}): boolean {
  return (
    hasNonBlank(documento.storageKey) ||
    hasNonBlank(documento.storagePath) ||
    hasNonBlank(documento.nomeStorage) ||
    hasNonBlank(documento.publicUrl) ||
    hasNonBlank(documento.checksumSha256) ||
    hasNonBlank(documento.sha256) ||
    (documento.dimensioneBytes ?? 0) > 0 ||
    (documento.sizeBytes ?? 0) > 0
  );
}

function resolveResourceTenantId(input: {
  documentoEnteId: string | null;
  concessioneEnteId: string | null;
  procedimentoEnteId: string | null;
}): string | null {
  const tenantIds = new Set(
    [input.documentoEnteId, input.concessioneEnteId, input.procedimentoEnteId].filter(
      (value): value is string => hasNonBlank(value),
    ),
  );

  return tenantIds.size === 1 ? tenantIds.values().next().value ?? null : null;
}

function validateManifest(input: {
  documentoId: string;
  documentoEnteId: string | null;
  currentFileVersionId: string;
  version: {
    id: string;
    documentId: string;
    canonicalEnteId: string;
    storageProvider: string;
    storageKey: string;
    storageBucket: string | null;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  } | null;
}): {
  id: string;
  storageProvider: DocumentStorageBackend;
  storageKey: string;
  storageBucket: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
} {
  const { version } = input;
  if (!version || !hasNonBlank(version.id) || version.id !== input.currentFileVersionId) {
    throw new DocumentReadIntegrityError("INVALID_MANIFEST");
  }
  if (version.documentId !== input.documentoId) {
    throw new DocumentReadIntegrityError("DOCUMENT_VERSION_MISMATCH");
  }
  if (!input.documentoEnteId || version.canonicalEnteId !== input.documentoEnteId) {
    throw new DocumentReadIntegrityError("TENANT_VERSION_MISMATCH");
  }
  if (version.storageProvider !== "local" && version.storageProvider !== "s3") {
    throw new DocumentReadIntegrityError("INVALID_MANIFEST");
  }
  if (
    !hasNonBlank(version.storageKey) ||
    !hasNonBlank(version.mimeType) ||
    !Number.isInteger(version.sizeBytes) ||
    version.sizeBytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(version.sha256)
  ) {
    throw new DocumentReadIntegrityError("INVALID_MANIFEST");
  }
  if (version.storageProvider === "local" && version.storageBucket !== null) {
    throw new DocumentReadIntegrityError("BUCKET_COHERENCE_FAILURE");
  }
  if (version.storageProvider === "s3" && !hasNonBlank(version.storageBucket)) {
    throw new DocumentReadIntegrityError("BUCKET_COHERENCE_FAILURE");
  }

  return {
    id: version.id,
    storageProvider: version.storageProvider,
    storageKey: version.storageKey,
    storageBucket: version.storageBucket,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    sha256: version.sha256,
  };
}

export async function readAuthorizedVerifiedDocumentBytes(input: {
  documentoId: string;
}): Promise<AuthorizedDocumentByteReadResult> {
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    await writeAudit("UNAUTHENTICATED", {
      documentoId: input.documentoId,
      userId: null,
      role: null,
    });
    throw new DocumentReadAuthorizationError("UNAUTHENTICATED");
  }

  const documento = await prisma.documento.findUnique({
    where: { id: input.documentoId },
    select: {
      id: true,
      nome: true,
      originalName: true,
      statoDocumento: true,
      enteId: true,
      concessioneId: true,
      procedimentoId: true,
      storageKey: true,
      storagePath: true,
      nomeStorage: true,
      publicUrl: true,
      url: true,
      checksumSha256: true,
      sha256: true,
      dimensioneBytes: true,
      sizeBytes: true,
      currentFileVersionId: true,
      concessione: { select: { enteId: true } },
      procedimento: { select: { concessione: { select: { enteId: true } } } },
      currentFileVersion: {
        select: {
          id: true,
          documentId: true,
          canonicalEnteId: true,
          storageProvider: true,
          storageKey: true,
          storageBucket: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
        },
      },
    },
  });

  if (!documento) {
    await writeAudit("NOT_FOUND_NON_OBSERVABLE", {
      documentoId: input.documentoId,
      userId: tenantContext.userId,
      role: tenantContext.role,
    });
    throw new DocumentReadAuthorizationError("NOT_FOUND_NON_OBSERVABLE");
  }

  const auditContext: AuditContext = {
    documentoId: documento.id,
    userId: tenantContext.userId,
    role: tenantContext.role,
    enteId: documento.enteId,
    concessioneId: documento.concessioneId,
    fileVersionId: documento.currentFileVersionId,
  };
  const resourceEnteId = resolveResourceTenantId({
    documentoEnteId: documento.enteId,
    concessioneEnteId: documento.concessione?.enteId ?? null,
    procedimentoEnteId: documento.procedimento?.concessione.enteId ?? null,
  });

  if (!resourceEnteId) {
    await writeAudit("NOT_FOUND_NON_OBSERVABLE", auditContext);
    throw new DocumentReadAuthorizationError("NOT_FOUND_NON_OBSERVABLE");
  }

  try {
    requireTenantAccess(tenantContext, resourceEnteId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  } catch {
    await writeAudit("NOT_FOUND_NON_OBSERVABLE", auditContext);
    throw new DocumentReadAuthorizationError("NOT_FOUND_NON_OBSERVABLE");
  }

  if (tenantContext.role === "VIEWER_ADSP" && documento.statoDocumento === "ARCHIVIATO") {
    await writeAudit("FORBIDDEN", auditContext);
    throw new DocumentReadAuthorizationError("FORBIDDEN");
  }

  if (documento.currentFileVersionId == null) {
    const status = hasLegacyFileIndicator(documento) ? "LEGACY_UNVERIFIED" : "NO_FILE_VERSION";
    await writeAudit(status, auditContext);
    return { status };
  }

  let manifest;
  try {
    manifest = validateManifest({
      documentoId: documento.id,
      documentoEnteId: documento.enteId,
      currentFileVersionId: documento.currentFileVersionId,
      version: documento.currentFileVersion,
    });
  } catch (error) {
    if (error instanceof DocumentReadIntegrityError) {
      await writeAudit(error.code, auditContext);
    }
    throw error;
  }

  let storageResult;
  try {
    storageResult = await readDocumentFileFromProvider({
      storageProvider: manifest.storageProvider,
      storageKey: manifest.storageKey,
      storageBucket: manifest.storageBucket,
    });
  } catch (error) {
    if (error instanceof DocumentStorageReadUnavailableError) {
      await writeAudit("SOURCE_UNAVAILABLE", auditContext);
      return { status: "SOURCE_UNAVAILABLE" };
    }
    if (error instanceof DocumentStorageReadCoherenceError) {
      const integrityError = new DocumentReadIntegrityError(
        error.code === "PROVIDER_MISMATCH"
          ? "PROVIDER_COHERENCE_FAILURE"
          : "BUCKET_COHERENCE_FAILURE",
      );
      await writeAudit(integrityError.code, auditContext);
      throw integrityError;
    }

    await writeAudit("SOURCE_READ_FAILED", auditContext);
    throw error;
  }

  if (storageResult.disposition === "MISSING") {
    await writeAudit("SOURCE_MISSING", auditContext);
    return { status: "SOURCE_MISSING" };
  }

  if (storageResult.body.length !== manifest.sizeBytes) {
    const error = new DocumentReadIntegrityError("SIZE_MISMATCH");
    await writeAudit(error.code, auditContext);
    throw error;
  }

  const sha256 = createHash("sha256").update(storageResult.body).digest("hex");
  if (sha256 !== manifest.sha256) {
    const error = new DocumentReadIntegrityError("SHA256_MISMATCH");
    await writeAudit(error.code, auditContext);
    throw error;
  }

  await writeAudit("AVAILABLE_VERIFIED", auditContext, true);
  return {
    status: "AVAILABLE_VERIFIED",
    body: storageResult.body,
    mimeType: manifest.mimeType,
    fileName: hasNonBlank(documento.originalName) ? documento.originalName!.trim() : documento.nome,
    sizeBytes: manifest.sizeBytes,
    sha256: manifest.sha256,
  };
}