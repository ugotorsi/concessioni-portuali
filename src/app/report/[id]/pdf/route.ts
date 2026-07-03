import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { canDownloadReportPdf, getCurrentRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getReportDetail } from "@/server/queries/report";
import { getNormeForReport } from "@/server/queries/normativa";

export const runtime = "nodejs";

function buildPdfLines(
  detail: NonNullable<Awaited<ReturnType<typeof getReportDetail>>>,
  norme: Awaited<ReturnType<typeof getNormeForReport>>,
): string[] {
  const lines: string[] = [
    "Concessioni Portuali - Report",
    "",
    `Titolo: ${detail.report.titolo}`,
    `Tipologia: ${formatEnumLabel(detail.report.tipologia)}`,
    `Validato: ${detail.report.validato ? "Si" : "No"}`,
    `Creato il: ${formatDateIT(detail.report.createdAt)}`,
    `Aggiornato il: ${formatDateIT(detail.report.updatedAt)}`,
  ];

  if (detail.concessione) {
    lines.push(
      "",
      "Contesto concessorio",
      `Numero atto: ${detail.concessione.numeroAtto}`,
      `Stato: ${formatEnumLabel(detail.concessione.stato)}`,
      `Scadenza: ${formatDateIT(detail.concessione.dataScadenza)}`,
      `Concessionario: ${detail.concessionario?.denominazione ?? "-"}`,
    );
  }

  lines.push("", "Contenuto", detail.report.contenuto, "", "Riferimenti normativi collegati");

  if (norme.length === 0) {
    lines.push("Nessun riferimento normativo esplicito collegato al report.");
  } else {
    for (const norma of norme) {
      lines.push(`- ${norma.codice}: ${norma.titolo} (${formatEnumLabel(norma.ambito)})`);
    }
  }

  lines.push(
    "",
    "Output istruttorio interno della societa a supporto dell Autorita, non provvedimento amministrativo.",
  );

  return lines;
}

async function generatePdfBuffer(
  detail: NonNullable<Awaited<ReturnType<typeof getReportDetail>>>,
  norme: Awaited<ReturnType<typeof getNormeForReport>>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let page = pdfDoc.addPage([595.28, 841.89]);

  let y = 800;
  const marginX = 50;
  const lineHeight = 14;

  for (const line of buildPdfLines(detail, norme)) {
    if (y < 60) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 800;
    }

    page.drawText(line, {
      x: marginX,
      y,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: 495,
      lineHeight,
    });

    y -= lineHeight;
  }

  return await pdfDoc.save();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const role = await getCurrentRole();

  if (!role) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;
  const detail = await getReportDetail(id);

  if (!detail) {
    return new Response("Not found", { status: 404 });
  }

  if (!canDownloadReportPdf(role, detail.report.validato)) {
    return new Response("Forbidden", { status: 403 });
  }

  const norme = await getNormeForReport(id);
  const pdfBytes = await generatePdfBuffer(detail, norme);
  const pdfArrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength,
  ) as ArrayBuffer;
  const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });

  return new Response(pdfBlob, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
