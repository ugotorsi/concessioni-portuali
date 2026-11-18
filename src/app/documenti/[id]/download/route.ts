import {
  DocumentReadAuditError,
  DocumentReadAuthorizationError,
  DocumentReadIntegrityError,
  readAuthorizedVerifiedDocumentBytes,
} from "@/server/documents/authorizedVerifiedByteReader";

export const runtime = "nodejs";

function escapeQuotedFileName(fileName: string): string {
  return fileName
    .replace(/[\x00-\x1f\x7f]/g, "_")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  try {
    const result = await readAuthorizedVerifiedDocumentBytes({ documentoId: id });

    switch (result.status) {
      case "AVAILABLE_VERIFIED": {
        const requestedPreview = new URL(request.url).searchParams.get("preview") === "1";
        const canInlinePreview = result.mimeType.startsWith("application/pdf") || result.mimeType.startsWith("image/");
        const disposition = requestedPreview && canInlinePreview ? "inline" : "attachment";
        const safeFileName = escapeQuotedFileName(result.fileName);

        return new Response(new Uint8Array(result.body), {
          status: 200,
          headers: {
            "Content-Type": result.mimeType,
            "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      case "NO_FILE_VERSION":
      case "SOURCE_MISSING":
        return new Response("File non disponibile", { status: 404 });
      case "LEGACY_UNVERIFIED":
        return new Response("Documento non disponibile in formato verificato", { status: 409 });
      case "SOURCE_UNAVAILABLE":
        return new Response("Servizio documento non disponibile", { status: 503 });
    }
  } catch (error) {
    if (error instanceof DocumentReadAuthorizationError) {
      switch (error.code) {
        case "UNAUTHENTICATED":
          return new Response("Unauthorized", { status: 401 });
        case "FORBIDDEN":
          return new Response("Forbidden", { status: 403 });
        case "NOT_FOUND_NON_OBSERVABLE":
          return new Response("File non disponibile", { status: 404 });
      }
    }

    if (error instanceof DocumentReadIntegrityError || error instanceof DocumentReadAuditError) {
      return new Response("Errore download documento", { status: 500 });
    }

    return new Response("Errore download documento", { status: 500 });
  }
}
