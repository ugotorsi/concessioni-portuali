import path from "node:path";

import { canViewNormativa, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { readStoredDocumentWithProvider, storedDocumentExists } from "@/server/documents/storage";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";

export const runtime = "nodejs";

function sanitizeFileName(value: string): string {
  const base = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base.length > 0 ? base : "documento";
}

function resolveDownloadFileName(input: {
  fileName: string | null;
  title: string;
  filePath: string;
}): string {
  if (input.fileName && input.fileName.trim().length > 0) {
    return sanitizeFileName(input.fileName);
  }

  const inferredFromPath = path.posix.basename(input.filePath);
  if (inferredFromPath && inferredFromPath !== "." && inferredFromPath !== "/") {
    return sanitizeFileName(inferredFromPath);
  }

  return `${sanitizeFileName(input.title)}.bin`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const role = await getCurrentRole();
  if (!role) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!canViewNormativa(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await context.params;
  const source = await prisma.legalSource.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      fileName: true,
      fileMimeType: true,
      filePath: true,
      enteId: true,
    },
  });

  if (!source) {
    return new Response("Not found", { status: 404 });
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, source.enteId, {
        mode: "read",
        allowWhenEnteMissing: true,
      });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const filePath = source.filePath?.trim() ?? "";
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const exists = await storedDocumentExists(filePath);
    if (!exists) {
      return new Response("Not found", { status: 404 });
    }

    const stored = await readStoredDocumentWithProvider(filePath);
    const fileName = resolveDownloadFileName({
      fileName: source.fileName,
      title: source.title,
      filePath,
    });

    return new Response(new Uint8Array(stored.body), {
      status: 200,
      headers: {
        "Content-Type": source.fileMimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DocumentStorageS3Error) {
      return new Response("Errore storage documento", { status: 500 });
    }

    return new Response("Errore download documento", { status: 500 });
  }
}