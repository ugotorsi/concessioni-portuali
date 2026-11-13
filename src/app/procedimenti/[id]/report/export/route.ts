import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { listActAttachmentOptions } from "@/server/fascicolo-acts/repository";
import {
  buildProfessionalReportDocument,
  buildProfessionalReportFileName,
  renderProfessionalReportPdf,
  renderProfessionalReportRtf,
} from "@/server/fascicolo-report/professional-export";
import { listStructuredFascicoloReportSnapshots } from "@/server/fascicolo-report/repository";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: procedimentoId } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "rtf") {
    return new Response("Unsupported format", { status: 400 });
  }
  const role = await getCurrentRole();
  if (!role) return new Response("Unauthorized", { status: 401 });
  if (!canExportOperationalData(role)) return new Response("Forbidden", { status: 403 });

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, enteId: true },
  });
  if (!procedimento) return new Response("Not found", { status: 404 });

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return new Response("Unauthorized", { status: 401 });
  try {
    requireTenantAccess(tenantContext, procedimento.enteId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  } catch {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      entitaId: procedimentoId,
      enteId: procedimento.enteId,
      actor: { userRole: role },
      metadata: { actionType: "STRUCTURED_REPORT_EXPORT", reason: "CROSS_TENANT_BLOCKED", format },
    });
    return new Response("Forbidden", { status: 403 });
  }

  const snapshots = await listStructuredFascicoloReportSnapshots({
    tenantId: procedimento.enteId,
    procedimentoId,
  });
  const snapshotId = new URL(request.url).searchParams.get("snapshotId");
  const snapshot = snapshotId
    ? snapshots.find((candidate) => candidate.id === snapshotId)
    : snapshots.find((candidate) => candidate.status === "CURRENT");
  if (!snapshot) return new Response("Current report not found", { status: 404 });

  const document = buildProfessionalReportDocument(snapshot, await listActAttachmentOptions(procedimentoId));
  const body = format === "pdf"
    ? await renderProfessionalReportPdf(document)
    : renderProfessionalReportRtf(document);
  await auditSuccess({
    azione: "STRUCTURED_REPORT_EXPORT",
    entita: "StructuredFascicoloReportSnapshot",
    entitaId: snapshot.id,
    enteId: procedimento.enteId,
    actor: { userRole: role },
    metadata: { procedimentoId, format: format.toUpperCase(), status: snapshot.status },
  });
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/rtf; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildProfessionalReportFileName(procedimentoId, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}
