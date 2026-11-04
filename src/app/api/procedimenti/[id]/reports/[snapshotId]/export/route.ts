import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  renderStructuredReportPdf,
  renderStructuredReportRtf,
} from "@/server/pdf/structuredReportExport";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; snapshotId: string }> },
): Promise<Response> {
  const { id, snapshotId } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "rtf") return new Response("Unsupported format", { status: 400 });
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!["ADMIN", "GIURIDICO"].includes(user.role) || !user.mfaVerified) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "StructuredFascicoloReportSnapshot",
      entitaId: snapshotId,
      actor: { userId: user.id, userEmail: user.email, userRole: user.role },
      metadata: { actionType: "STRUCTURED_REPORT_EXPORT", reason: "ROLE_OR_MFA_BLOCKED", format },
    });
    return new Response("Forbidden", { status: 403 });
  }
  const snapshot = await prisma.structuredFascicoloReportSnapshot.findFirst({
    where: { id: snapshotId, procedimentoId: id },
  });
  if (!snapshot) return new Response("Not found", { status: 404 });
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return new Response("Unauthorized", { status: 401 });
  try {
    requireTenantAccess(tenantContext, snapshot.tenantId, { mode: "read", allowWhenEnteMissing: false });
  } catch {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "StructuredFascicoloReportSnapshot",
      entitaId: snapshotId,
      enteId: snapshot.tenantId,
      actor: { userId: user.id, userEmail: user.email, userRole: user.role },
      metadata: { actionType: "STRUCTURED_REPORT_EXPORT", reason: "CROSS_TENANT_BLOCKED", format },
    });
    return new Response("Forbidden", { status: 403 });
  }
  const exportInput = {
    snapshotId: snapshot.id,
    status: snapshot.status,
    generatedAt: snapshot.generatedAt,
    payload: snapshot.payload as unknown as StructuredFascicoloReportPayload,
  };
  const body = format === "pdf"
    ? await renderStructuredReportPdf(exportInput)
    : renderStructuredReportRtf(exportInput);
  await auditSuccess({
    azione: "STRUCTURED_REPORT_EXPORTED",
    entita: "StructuredFascicoloReportSnapshot",
    entitaId: snapshot.id,
    enteId: snapshot.tenantId,
    actor: { userId: user.id, userEmail: user.email, userRole: user.role },
    metadata: {
      procedimentoId: id,
      format: format.toUpperCase(),
      contractVersion: snapshot.contractVersion,
      status: snapshot.status,
    },
  });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/rtf",
      "Content-Disposition": `attachment; filename="noetra-${snapshot.id}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
