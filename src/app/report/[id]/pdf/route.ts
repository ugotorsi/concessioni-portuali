import { canDownloadReportPdf, getCurrentRole } from "@/lib/auth";
import { renderInstitutionalReportPdf, buildReportPdfFileName } from "@/server/pdf/reportPdf";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { getReportDetail } from "@/server/queries/report";
import { getNormeForReport } from "@/server/queries/normativa";

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
      entita: "Report",
      entitaId: id,
      actor: { userRole: null },
      metadata: {
        actionType: "REPORT_PDF_DOWNLOAD",
        reason: "UNAUTHENTICATED",
      },
    });
    return new Response("Unauthorized", { status: 401 });
  }

  const detail = await getReportDetail(id);

  if (!detail) {
    await auditFailure({
      azione: "REPORT_PDF_DOWNLOAD",
      entita: "Report",
      entitaId: id,
      actor: { userRole: role },
      metadata: {
        reason: "NOT_FOUND",
      },
    });
    return new Response("Not found", { status: 404 });
  }

  if (!canDownloadReportPdf(role, detail.report.validato)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Report",
      entitaId: id,
      concessioneId: detail.concessione?.id,
      actor: { userRole: role },
      metadata: {
        actionType: "REPORT_PDF_DOWNLOAD",
        reason: "ROLE_OR_VALIDATION_POLICY_BLOCKED",
        reportValidated: detail.report.validato,
      },
    });
    return new Response("Forbidden", { status: 403 });
  }

  const norme = await getNormeForReport(id);
  const pdfBuffer = await renderInstitutionalReportPdf({ detail, norme });

  await auditSuccess({
    azione: "REPORT_PDF_DOWNLOAD",
    entita: "Report",
    entitaId: id,
    concessioneId: detail.concessione?.id,
    actor: { userRole: role },
    metadata: {
      reportValidated: detail.report.validato,
      tipologia: detail.report.tipologia,
      format: "PDF",
      normeCollegateCount: norme.length,
    },
  });

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${buildReportPdfFileName(id)}"`,
      "Cache-Control": "no-store",
    },
  });
}
