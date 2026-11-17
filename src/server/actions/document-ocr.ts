"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import {
  DocumentOcrAuthorizationError,
} from "@/server/documents/documentOcrAuthorization";
import {
  ensureAuthorizedDocumentOcrExtractionJob,
} from "@/server/documents/documentOcrJobAdmission";

const inputSchema = z.object({
  failedAttemptId: z.string().trim().min(1).max(256),
}).strict();

const ERROR_MESSAGES: Record<DocumentOcrAuthorizationError["code"], string> = {
  UNAUTHENTICATED: "Sessione non valida. Accedi nuovamente prima di avviare l'OCR.",
  ROLE_NOT_ALLOWED: "Il profilo corrente non puo autorizzare l'OCR.",
  TENANT_ACCESS_DENIED: "Il documento appartiene a un ente non accessibile.",
  FAILED_ATTEMPT_NOT_FOUND: "Il tentativo di estrazione non e piu disponibile.",
  FAILED_ATTEMPT_NOT_OCR_ELIGIBLE: "Il documento non richiede un'elaborazione OCR autorizzabile.",
  FAILED_ATTEMPT_SCOPE_MISMATCH: "Documento, procedimento o versione corrente non coincidono.",
  AUTHORIZATION_NOT_FOUND: "L'autorizzazione OCR non e stata registrata.",
  AUTHORIZATION_SCOPE_MISMATCH: "L'autorizzazione OCR non coincide con il documento corrente.",
};

function documentiOcrRedirect(status: "queued" | "error", message?: string): string {
  const params = new URLSearchParams({ ocr: status });
  if (message) params.set("ocrMessage", message);
  return `/documenti?${params.toString()}`;
}

export async function startDocumentoOcrAction(formData: FormData): Promise<never> {
  await requireRole(["ADMIN", "TECNICO"]);
  const parsed = inputSchema.safeParse({
    failedAttemptId: formData.get("failedAttemptId"),
  });
  if (!parsed.success) {
    redirect(documentiOcrRedirect("error", "Richiesta OCR non valida."));
  }

  try {
    await ensureAuthorizedDocumentOcrExtractionJob(parsed.data.failedAttemptId);
  } catch (error) {
    if (error instanceof DocumentOcrAuthorizationError) {
      redirect(documentiOcrRedirect("error", ERROR_MESSAGES[error.code]));
    }
    throw error;
  }

  revalidatePath("/documenti");
  redirect(documentiOcrRedirect("queued"));
}
