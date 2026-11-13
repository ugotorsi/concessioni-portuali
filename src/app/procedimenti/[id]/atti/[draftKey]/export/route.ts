import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { ACT_DRAFT_ENTITY, actDraftEntityId, buildActExportDocument, buildActFileName, projectActDrafts } from "@/server/fascicolo-acts/model";
import { listActDraftVersions } from "@/server/fascicolo-acts/repository";
import { renderProfessionalReportPdf, renderProfessionalReportRtf } from "@/server/fascicolo-report/professional-export";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; draftKey: string }> },
): Promise<Response> {
  const { id: procedimentoId, draftKey } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const format = searchParams.get("format");
  if (format !== "pdf" && format !== "rtf") return new Response("Unsupported format", { status: 400 });
  const requestedVersion = searchParams.get("version");
  const role = await getCurrentRole();
  if (!role) return new Response("Unauthorized", { status: 401 });
  if (!canExportOperationalData(role)) return new Response("Forbidden", { status: 403 });

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, enteId: true },
  });
  if (!procedimento?.enteId) return new Response("Not found", { status: 404 });
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return new Response("Unauthorized", { status: 401 });
  try {
    requireTenantAccess(tenantContext, procedimento.enteId, { mode: "read", allowWhenEnteMissing: false });
  } catch {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: ACT_DRAFT_ENTITY,
      entitaId: actDraftEntityId(procedimentoId, draftKey),
      enteId: procedimento.enteId,
      actor: { userRole: role },
      metadata: { actionType: "FASCICOLO_ACT_EXPORT", reason: "CROSS_TENANT_BLOCKED", format },
    });
    return new Response("Forbidden", { status: 403 });
  }

  const drafts = projectActDrafts(await listActDraftVersions({ tenantId: procedimento.enteId, procedimentoId }));
  const draft = drafts.find((candidate) => candidate.draftKey === draftKey);
  const version = requestedVersion
    ? draft?.history.find((candidate) => String(candidate.version) === requestedVersion)
    : draft?.current;
  if (!draft || !version) return new Response("Act draft not found", { status: 404 });

  const attachments = version.attachments.length
    ? await prisma.documento.findMany({
        where: { procedimentoId, id: { in: [...version.attachments] } },
        select: { id: true, nome: true },
      })
    : [];
  const document = buildActExportDocument({
    version,
    procedimentoLabel: `Procedimento ${procedimentoId}`,
    attachmentNames: new Map(attachments.map((attachment) => [attachment.id, attachment.nome])),
    dependencyTitles: new Map(drafts.map((candidate) => [candidate.draftKey, candidate.current.title])),
  });
  const body = format === "pdf" ? await renderProfessionalReportPdf(document) : renderProfessionalReportRtf(document);
  await auditSuccess({
    azione: "FASCICOLO_ACT_EXPORT",
    entita: ACT_DRAFT_ENTITY,
    entitaId: actDraftEntityId(procedimentoId, draftKey),
    enteId: procedimento.enteId,
    actor: { userRole: role },
    metadata: { procedimentoId, draftKey, version: version.version, format: format.toUpperCase(), bodySha256: version.bodySha256 },
  });
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/rtf; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildActFileName(draftKey, version.version, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}
