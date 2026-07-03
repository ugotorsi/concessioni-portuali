import PDFDocument from "pdfkit/js/pdfkit.standalone";

import type { ReportDetail } from "@/server/queries/report";

interface NormaReportItem {
  codice: string;
  titolo: string;
  ambito: string;
  severita: string;
  descrizione: string;
}

const DISCLAIMER =
  "Documento istruttorio interno della societa a supporto dell Autorita. Non costituisce provvedimento amministrativo e non sostituisce la valutazione dell autorita competente.";

interface PdfContext {
  doc: any;
  margin: number;
  lineGap: number;
  writableWidth: number;
  generatedAt: Date;
}

function textOrDash(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "-";
}

function euro(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function dateIT(value: Date | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function enumLabel(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ensureSpace(ctx: PdfContext, minHeight: number) {
  const threshold = ctx.doc.page.height - ctx.margin - minHeight;
  if (ctx.doc.y > threshold) {
    ctx.doc.addPage();
    drawPageHeader(ctx);
  }
}

function drawPageHeader(ctx: PdfContext) {
  const { doc, margin, writableWidth, generatedAt } = ctx;
  const pageTop = margin - 18;

  doc.save();
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a");
  doc.text("Concessioni Portuali", margin, pageTop, {
    width: writableWidth,
    align: "left",
  });

  doc.font("Helvetica").fontSize(9).fillColor("#334155");
  doc.text(`Report istituzionale - Generato il ${dateIT(generatedAt)}`, margin, pageTop, {
    width: writableWidth,
    align: "right",
  });

  doc.moveTo(margin, margin - 4).lineTo(margin + writableWidth, margin - 4).lineWidth(0.8).stroke("#cbd5e1");
  doc.restore();

  if (doc.y < margin + 6) {
    doc.y = margin + 6;
  }
}

function drawPageFooter(ctx: PdfContext) {
  const { doc, margin, writableWidth } = ctx;
  const footerY = doc.page.height - margin + 8;

  doc.save();
  doc.font("Helvetica").fontSize(8).fillColor("#64748b");
  doc.text(DISCLAIMER, margin, footerY, {
    width: writableWidth,
    align: "left",
    lineBreak: false,
  });
  doc.restore();
}

function title(ctx: PdfContext, value: string) {
  ensureSpace(ctx, 56);
  ctx.doc.moveDown(0.2);
  ctx.doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text(value, {
    width: ctx.writableWidth,
  });
}

function section(ctx: PdfContext, value: string) {
  ensureSpace(ctx, 42);
  ctx.doc.moveDown(0.5);
  ctx.doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(value, {
    width: ctx.writableWidth,
  });
  ctx.doc.moveDown(0.15);
}

function body(ctx: PdfContext, value: string) {
  ensureSpace(ctx, 28);
  ctx.doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(value, {
    width: ctx.writableWidth,
    lineGap: ctx.lineGap,
  });
}

function bullet(ctx: PdfContext, value: string) {
  ensureSpace(ctx, 26);
  ctx.doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(`- ${value}`, {
    width: ctx.writableWidth,
    lineGap: ctx.lineGap,
  });
}

function keyValue(ctx: PdfContext, key: string, value: string) {
  ensureSpace(ctx, 24);
  ctx.doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text(`${key}: `, {
    continued: true,
  });
  ctx.doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(value, {
    width: ctx.writableWidth,
    lineGap: ctx.lineGap,
  });
}

function renderHeaderSection(ctx: PdfContext, detail: ReportDetail) {
  title(ctx, textOrDash(detail.report.titolo));

  body(
    ctx,
    `Tipologia: ${enumLabel(detail.report.tipologia)} | Stato validazione: ${detail.report.validato ? "VALIDATO" : "BOZZA"}`,
  );
  body(
    ctx,
    `Creato il ${dateIT(detail.report.createdAt)} - Aggiornato il ${dateIT(detail.report.updatedAt)} - Formato ${enumLabel(detail.report.formato)}`,
  );
}

function renderContextSection(ctx: PdfContext, detail: ReportDetail) {
  section(ctx, "1. Contesto concessorio");

  if (!detail.concessione) {
    body(ctx, "Report non collegato a una specifica concessione.");
    return;
  }

  keyValue(ctx, "Numero atto", detail.concessione.numeroAtto);
  keyValue(ctx, "Concessionario", detail.concessionario?.denominazione ?? "-");
  keyValue(ctx, "Stato concessione", enumLabel(detail.concessione.stato));
  keyValue(ctx, "Tipologia bene", enumLabel(detail.concessione.tipologiaBene));
  keyValue(ctx, "Attivita", enumLabel(detail.concessione.attivita));
  keyValue(ctx, "Ubicazione", textOrDash(detail.concessione.ubicazione));
  keyValue(ctx, "Canone annuo", euro(detail.concessione.canoneAnnuo));
  keyValue(ctx, "Data scadenza", dateIT(detail.concessione.dataScadenza));
}

function renderEvidenceSection(ctx: PdfContext, detail: ReportDetail) {
  section(ctx, "2. Evidenze istruttorie");

  keyValue(ctx, "Criticita aperte", String(detail.criticitaAperte.length));
  keyValue(ctx, "Scadenze aperte/scadute", String(detail.scadenzeRilevanti.length));
  keyValue(ctx, "Pagamenti critici", String(detail.pagamentiCritici.length));
  keyValue(ctx, "Procedimenti in corso", String(detail.procedimentiInCorso.length));

  if (detail.criticitaAperte.length > 0) {
    bullet(
      ctx,
      `Criticita prioritaria: ${enumLabel(detail.criticitaAperte[0]?.tipologia)} (${enumLabel(detail.criticitaAperte[0]?.gravita)}).`,
    );
  }

  if (detail.scadenzeRilevanti.length > 0) {
    const next = detail.scadenzeRilevanti[0];
    bullet(ctx, `Prima scadenza rilevante: ${enumLabel(next.tipologia)} - ${dateIT(next.dataScadenza)}.`);
  }

  if (detail.pagamentiCritici.length > 0) {
    const totalResidual = detail.pagamentiCritici.reduce((sum, item) => sum + item.residuo, 0);
    bullet(ctx, `Residuo economico aggregato su posizioni critiche: ${euro(totalResidual)}.`);
  }

  if (detail.procedimentiInCorso.length > 0) {
    const firstProcedimento = detail.procedimentiInCorso[0];
    bullet(
      ctx,
      `Procedimento attivo prioritario: ${enumLabel(firstProcedimento.tipologia)} (${enumLabel(firstProcedimento.stato)}).`,
    );
  }
}

function renderAnalysisSection(ctx: PdfContext, detail: ReportDetail) {
  section(ctx, "3. Analisi");
  body(ctx, textOrDash(detail.report.contenuto));

  const isValidated = detail.report.validato;
  const warning = isValidated
    ? "Il report e validato per consultazione istituzionale."
    : "Il report e in bozza: completare la revisione interna prima di diffusione esterna.";

  body(ctx, warning);
}

function renderNormativaSection(ctx: PdfContext, norme: NormaReportItem[]) {
  section(ctx, "4. Riferimenti normativi");

  if (norme.length === 0) {
    body(ctx, "Nessun riferimento normativo esplicito collegato al report.");
    return;
  }

  for (const norma of norme.slice(0, 12)) {
    bullet(ctx, `${norma.codice} - ${norma.titolo} (${enumLabel(norma.ambito)}, severita ${enumLabel(norma.severita)}).`);
  }
}

function renderProposalSection(ctx: PdfContext, detail: ReportDetail) {
  section(ctx, "5. Proposta operativa");

  const actions: string[] = [];

  if (detail.pagamentiCritici.length > 0) {
    actions.push("Prioritizzare azioni su morosita e monitoraggio dei piani di rientro.");
  }

  if (detail.scadenzeRilevanti.length > 0) {
    actions.push("Attivare presidio termini su scadenze aperte o gia scadute.");
  }

  if (detail.criticitaAperte.length > 0) {
    actions.push("Consolidare evidenze tecniche e giuridiche sulle criticita a gravita piu elevata.");
  }

  if (actions.length === 0) {
    actions.push("Mantenere monitoraggio ordinario e aggiornare il report al prossimo ciclo.");
  }

  for (const item of actions) {
    bullet(ctx, item);
  }

  body(ctx, DISCLAIMER);
}

export function buildReportPdfFileName(reportId: string): string {
  return `report-istituzionale-${reportId}.pdf`;
}

export async function renderInstitutionalReportPdf(params: {
  detail: ReportDetail;
  norme: NormaReportItem[];
  generatedAt?: Date;
}): Promise<Buffer> {
  const generatedAt = params.generatedAt ?? new Date();

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: {
        top: 72,
        right: 54,
        bottom: 72,
        left: 54,
      },
      info: {
        Title: params.detail.report.titolo,
        Subject: "Report istituzionale concessioni portuali",
        Author: "Concessioni Portuali",
        Producer: "Concessioni Portuali PDF Service",
        Creator: "Concessioni Portuali",
        CreationDate: generatedAt,
      },
      bufferPages: true,
      autoFirstPage: true,
      compress: true,
    });

    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
    });

    doc.on("error", (error: Error) => {
      reject(error);
    });

    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    const margin = doc.page.margins.left;
    const writableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const ctx: PdfContext = {
      doc,
      margin,
      lineGap: 2,
      writableWidth,
      generatedAt,
    };

    drawPageHeader(ctx);
    renderHeaderSection(ctx, params.detail);
    renderContextSection(ctx, params.detail);
    renderEvidenceSection(ctx, params.detail);
    renderAnalysisSection(ctx, params.detail);
    renderNormativaSection(ctx, params.norme);
    renderProposalSection(ctx, params.detail);

    const pageRange = doc.bufferedPageRange();

    for (let i = 0; i < pageRange.count; i += 1) {
      doc.switchToPage(i);
      drawPageFooter(ctx);
      doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Pagina ${i + 1} di ${pageRange.count}`, margin, doc.page.height - margin + 20, {
        width: writableWidth,
        align: "right",
        lineBreak: false,
      });
    }

    doc.end();
  });
}
