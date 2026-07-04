import { getCurrentRole } from "@/lib/auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { readStoredDocument } from "@/server/documents/storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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
      nome: true,
      mimeType: true,
      storagePath: true,
      url: true,
      statoDocumento: true,
      concessioneId: true,
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

  if (documento.storagePath) {
    const buffer = await readStoredDocument(documento.storagePath);

    await auditSuccess({
      azione: "DOCUMENT_DOWNLOAD",
      entita: "Documento",
      entitaId: documento.id,
      concessioneId: documento.concessioneId,
      actor: { userRole: role },
      metadata: {
        source: "local-storage",
        mimeType: documento.mimeType,
        statoDocumento: documento.statoDocumento,
      },
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": documento.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${documento.nome}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (documento.url) {
    await auditSuccess({
      azione: "DOCUMENT_DOWNLOAD",
      entita: "Documento",
      entitaId: documento.id,
      concessioneId: documento.concessioneId,
      actor: { userRole: role },
      metadata: {
        source: "external-url",
        redirectUrl: documento.url,
        statoDocumento: documento.statoDocumento,
      },
    });

    return Response.redirect(documento.url, 302);
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
