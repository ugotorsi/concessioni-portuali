import { getCurrentRole } from "@/lib/auth";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { readStoredDocumentWithProvider, storedDocumentExists } from "@/server/documents/storage";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const role = await getCurrentRole();

  if (!role) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Documento",
      entitaId: id,
      actor: { userRole: null },
      metadata: {
        actionType: "DOCUMENT_DOWNLOAD",
        reason: "UNAUTHENTICATED",
      },
    });
    return new Response("Unauthorized", { status: 401 });
  }

  const documento = await prisma.documento.findUnique({
    where: { id },
    select: {
      id: true,
      enteId: true,
      nome: true,
      mimeType: true,
      originalName: true,
      storagePath: true,
      storageKey: true,
      storageProvider: true,
      storageBucket: true,
      publicUrl: true,
      url: true,
      statoDocumento: true,
      concessioneId: true,
      concessione: {
        select: {
          enteId: true,
        },
      },
    },
  });

  if (!documento) {
    await auditFailure({
      azione: "DOCUMENT_DOWNLOAD",
      entita: "Documento",
      entitaId: id,
      actor: { userRole: role },
      metadata: { reason: "NOT_FOUND" },
    });
    return new Response("Not found", { status: 404 });
  }

  if (role === "VIEWER_ADSP" && documento.statoDocumento === "ARCHIVIATO") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Documento",
      entitaId: id,
      concessioneId: documento.concessioneId,
      actor: { userRole: role },
      metadata: {
        actionType: "DOCUMENT_DOWNLOAD",
        reason: "ARCHIVED_DOCUMENT_VIEWER_BLOCKED",
      },
    });
    return new Response("Forbidden", { status: 403 });
  }

  const tenantContext = await getCurrentTenantContext();
  const resourceEnteId = documento.enteId ?? documento.concessione?.enteId ?? null;
  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, resourceEnteId, {
        mode: "read",
        allowWhenEnteMissing: true,
      });
    } catch {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Documento",
        entitaId: documento.id,
        concessioneId: documento.concessioneId,
        enteId: resourceEnteId,
        actor: { userRole: role },
        metadata: {
          actionType: "DOCUMENT_DOWNLOAD",
          reason: "CROSS_TENANT_BLOCKED",
        },
      });
      return new Response("Forbidden", { status: 403 });
    }
  }

  const requestedPreview = new URL(request.url).searchParams.get("preview") === "1";
  const canInlinePreview = (documento.mimeType ?? "").startsWith("application/pdf") || (documento.mimeType ?? "").startsWith("image/");
  const disposition = requestedPreview && canInlinePreview ? "inline" : "attachment";

  const storageKey = documento.storageKey ?? documento.storagePath;
  if (storageKey) {
    let exists = false;
    try {
      exists = await storedDocumentExists(storageKey);
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
        azione: "DOCUMENT_DOWNLOAD",
        entita: "Documento",
        entitaId: documento.id,
        concessioneId: documento.concessioneId,
        actor: { userRole: role },
        metadata: {
          reason: "STORAGE_CHECK_FAILED",
          storageKey,
          storageProvider: documento.storageProvider ?? "local",
          storageDiagnostics,
        },
      });

      return new Response("Errore storage documento", { status: 502 });
    }

    if (!exists) {
      await auditFailure({
        azione: "DOCUMENT_DOWNLOAD",
        entita: "Documento",
        entitaId: documento.id,
        concessioneId: documento.concessioneId,
        actor: { userRole: role },
        metadata: {
          reason: "STORAGE_OBJECT_NOT_FOUND",
          storageKey,
          storageProvider: documento.storageProvider ?? "local",
        },
      });

      return new Response("File non disponibile", { status: 404 });
    }

    let stored;
    try {
      stored = await readStoredDocumentWithProvider(storageKey);
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
        azione: "DOCUMENT_DOWNLOAD",
        entita: "Documento",
        entitaId: documento.id,
        concessioneId: documento.concessioneId,
        actor: { userRole: role },
        metadata: {
          reason: "STORAGE_READ_FAILED",
          storageKey,
          storageProvider: documento.storageProvider ?? "local",
          storageDiagnostics,
        },
      });

      return new Response("Errore storage documento", { status: 502 });
    }

    await auditSuccess({
      azione: "DOCUMENT_DOWNLOAD",
      entita: "Documento",
      entitaId: documento.id,
      concessioneId: documento.concessioneId,
      actor: { userRole: role },
      metadata: {
        source: stored.storageProvider,
        storageProvider: stored.storageProvider,
        storageBucket: documento.storageBucket,
        storageKey,
        mimeType: documento.mimeType,
        statoDocumento: documento.statoDocumento,
      },
      enteId: resourceEnteId,
    });

    return new Response(new Uint8Array(stored.body), {
      status: 200,
      headers: {
        "Content-Type": documento.mimeType ?? "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${documento.originalName ?? documento.nome}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (documento.publicUrl || documento.url) {
    const redirectUrl = documento.publicUrl ?? documento.url;

    await auditSuccess({
      azione: "DOCUMENT_DOWNLOAD",
      entita: "Documento",
      entitaId: documento.id,
      concessioneId: documento.concessioneId,
      actor: { userRole: role },
      metadata: {
        source: "external-url",
        redirectUrl,
        statoDocumento: documento.statoDocumento,
      },
      enteId: resourceEnteId,
    });

    return Response.redirect(redirectUrl as string, 302);
  }

  await auditFailure({
    azione: "DOCUMENT_DOWNLOAD",
    entita: "Documento",
    entitaId: documento.id,
    concessioneId: documento.concessioneId,
    actor: { userRole: role },
    metadata: {
      reason: "NO_STORAGE_SOURCE",
      statoDocumento: documento.statoDocumento,
    },
  });

  return new Response("File non disponibile", { status: 404 });
}
