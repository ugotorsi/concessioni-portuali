import PDFDocument from "pdfkit/js/pdfkit.standalone";

import type { ReportDetail } from "@/server/queries/report";

interface NormaReportItem {
  codice: string;
  titolo: string;
  ambito: string;
  severita: string;
  descrizione: string;
}

interface PdfContext {
  doc: any;
  margin: number;
  writableWidth: number;
  lineGap: number;
  generatedAt: Date;
  reportId: string;
}

const COVER_DISCLAIMER =
  "Documento istruttorio generato a supporto dell attivita amministrativa. Non costituisce provvedimento finale ne valutazione vincolante.";

const ART47_NOTE =
  "La rilevanza ex art. 47 e rappresentata come elemento istruttorio e richiede valutazione dell autorita competente.";

const REGOLARIZZAZIONE_NOTE =
  "La regolarizzazione costituisce elemento istruttorio da valutare prima di eventuali determinazioni finali.";

const PREAVVISO_NOTE =
  "La gestione del preavviso di rigetto ex art. 10-bis L. 241/1990 e tracciata a fini istruttori e deve essere valutata secondo il caso concreto.";

const CHECKLIST_NOTE =
  "La checklist non sostituisce la valutazione del responsabile del procedimento.";

function textOrNA(value: string | null | undefined): string {
  if (!value) {
    return "Non disponibile";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Non disponibile";
}

function enumLabel(value: string | null | undefined): string {
  if (!value) {
    return "Non disponibile";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dateIT(value: Date | null | undefined): string {
  if (!value) {
    return "Non disponibile";
  }

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function euro(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Non disponibile";
  }

  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function addRiskBadgeText(detail: ReportDetail): string {
  const hasCritico = detail.criticitaAperte.some((item) => item.rischioDecadenza === "CRITICO");
  if (hasCritico) {
    return "Critico";
  }

  const hasAlto = detail.criticitaAperte.some(
    (item) => item.rischioDecadenza === "ALTO" || item.gravita === "URGENTE",
  );
  if (hasAlto) {
    return "Alto";
  }

  const hasMedio = detail.criticitaAperte.some(
    (item) => item.rischioDecadenza === "MEDIO" || item.gravita === "ALTA",
  );
  if (hasMedio) {
    return "Medio";
  }

  if (detail.criticitaAperte.length > 0) {
    return "Basso";
  }

  return "Non disponibile";
}

function drawHeader(ctx: PdfContext) {
  const pageTop = ctx.margin - 18;

  ctx.doc.save();
  ctx.doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a");
  ctx.doc.text("Concessioni Portuali", ctx.margin, pageTop, {
    width: ctx.writableWidth,
    align: "left",
    lineBreak: false,
  });

  ctx.doc.font("Helvetica").fontSize(9).fillColor("#334155");
  ctx.doc.text(`Report istituzionale | ${dateIT(ctx.generatedAt)}`, ctx.margin, pageTop, {
    width: ctx.writableWidth,
    align: "right",
    lineBreak: false,
  });

  ctx.doc.moveTo(ctx.margin, ctx.margin - 4).lineTo(ctx.margin + ctx.writableWidth, ctx.margin - 4).lineWidth(0.8).stroke("#cbd5e1");
  ctx.doc.restore();

  if (ctx.doc.y < ctx.margin + 6) {
    ctx.doc.y = ctx.margin + 6;
  }
}

function drawFooter(ctx: PdfContext, pageNumber: number, totalPages: number) {
  const footerY = ctx.doc.page.height - ctx.margin + 10;

  ctx.doc.save();
  ctx.doc.moveTo(ctx.margin, footerY - 6).lineTo(ctx.margin + ctx.writableWidth, footerY - 6).lineWidth(0.7).stroke("#cbd5e1");

  ctx.doc.font("Helvetica").fontSize(8).fillColor("#64748b");
  ctx.doc.text("Uso interno / istruttorio", ctx.margin, footerY, {
    width: ctx.writableWidth,
    align: "left",
    lineBreak: false,
  });

  ctx.doc.text(`Report ID: ${ctx.reportId}`, ctx.margin, footerY, {
    width: ctx.writableWidth,
    align: "center",
    lineBreak: false,
  });

  ctx.doc.text(`Pagina ${pageNumber} di ${totalPages}`, ctx.margin, footerY, {
    width: ctx.writableWidth,
    align: "right",
    lineBreak: false,
  });
  ctx.doc.restore();
}

function maybeAddPage(ctx: PdfContext, minHeight = 120) {
  const threshold = ctx.doc.page.height - ctx.margin - minHeight;
  if (ctx.doc.y > threshold) {
    ctx.doc.addPage();
    drawHeader(ctx);
  }
}

function ensureSpace(ctx: PdfContext, minHeight = 120) {
  maybeAddPage(ctx, minHeight);
}

function addSectionTitle(ctx: PdfContext, title: string) {
  ensureSpace(ctx, 56);
  ctx.doc.moveDown(0.35);
  ctx.doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(title, {
    width: ctx.writableWidth,
  });
  ctx.doc.moveTo(ctx.margin, ctx.doc.y + 3).lineTo(ctx.margin + ctx.writableWidth, ctx.doc.y + 3).lineWidth(0.6).stroke("#e2e8f0");
  ctx.doc.moveDown(0.45);
}

function addParagraph(ctx: PdfContext, value: string) {
  ensureSpace(ctx, 34);
  ctx.doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(value, {
    width: ctx.writableWidth,
    lineGap: ctx.lineGap,
  });
}

function addBullet(ctx: PdfContext, value: string) {
  addParagraph(ctx, `- ${value}`);
}

function addInfoBox(ctx: PdfContext, title: string, lines: string[]) {
  const lineHeight = 14;
  const boxHeight = 28 + lines.length * lineHeight;
  ensureSpace(ctx, boxHeight + 24);

  const x = ctx.margin;
  const y = ctx.doc.y;

  ctx.doc.save();
  ctx.doc.roundedRect(x, y, ctx.writableWidth, boxHeight, 6).fillAndStroke("#f8fafc", "#cbd5e1");

  ctx.doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10.5).text(title, x + 12, y + 9, {
    width: ctx.writableWidth - 24,
  });

  ctx.doc.font("Helvetica").fontSize(10).fillColor("#334155");
  let currentY = y + 24;
  for (const line of lines) {
    ctx.doc.text(line, x + 12, currentY, {
      width: ctx.writableWidth - 24,
      lineGap: 1,
    });
    currentY += lineHeight;
  }

  ctx.doc.restore();
  ctx.doc.y = y + boxHeight + 10;
}

function addKeyValueTable(ctx: PdfContext, rows: Array<{ key: string; value: string }>) {
  for (const row of rows) {
    ensureSpace(ctx, 24);
    ctx.doc.font("Helvetica-Bold").fontSize(10.2).fillColor("#0f172a").text(`${row.key}: `, {
      continued: true,
    });
    ctx.doc.font("Helvetica").fontSize(10.2).fillColor("#1e293b").text(row.value, {
      width: ctx.writableWidth,
      lineGap: 1,
    });
  }
}

function addCoverPage(ctx: PdfContext, detail: ReportDetail) {
  drawHeader(ctx);

  ctx.doc.moveDown(1.2);
  ctx.doc.font("Helvetica-Bold").fontSize(22).fillColor("#0f172a").text("Report istituzionale", {
    width: ctx.writableWidth,
  });

  ctx.doc.moveDown(0.2);
  ctx.doc.font("Helvetica").fontSize(12).fillColor("#334155").text(textOrNA(detail.report.titolo), {
    width: ctx.writableWidth,
  });

  ctx.doc.moveDown(0.8);
  addInfoBox(ctx, "Frontespizio", [
    `Concessione: ${detail.concessione?.numeroAtto ?? "Non disponibile"}`,
    `Concessionario: ${detail.concessionario?.denominazione ?? "Non disponibile"}`,
    `Data generazione: ${dateIT(ctx.generatedAt)}`,
    `Stato report: ${detail.report.validato ? "Validato" : "Bozza"}`,
    `Livello rischio complessivo: ${addRiskBadgeText(detail)}`,
  ]);

  addInfoBox(ctx, "Disclaimer istruttorio", [COVER_DISCLAIMER]);
}

function addSummarySection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Sommario sezioni");

  const rows = [
    "Sintesi",
    "Concessione",
    "Criticita",
    "Procedimenti",
    "Pagamenti",
    "Scadenze",
    "Sopralluoghi",
    "Documenti collegati",
    "Evidenze istruttorie",
    "Disclaimer finale",
  ];

  for (const row of rows) {
    addBullet(ctx, row);
  }

  addSectionTitle(ctx, "Sintesi");
  addInfoBox(ctx, "Indicatori chiave", [
    `Criticita aperte: ${detail.criticitaAperte.length}`,
    `Procedimenti in corso: ${detail.procedimentiInCorso.length}`,
    `Pagamenti critici: ${detail.pagamentiCritici.length}`,
    `Scadenze rilevanti: ${detail.scadenzeRilevanti.length}`,
    `Sopralluoghi recenti: ${detail.sopralluoghiRecenti.length}`,
    `Documenti collegati: ${detail.documentiPrincipali.length}`,
  ]);
}

function addConcessioneSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Concessione");

  if (!detail.concessione) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  addKeyValueTable(ctx, [
    { key: "Numero atto", value: textOrNA(detail.concessione.numeroAtto) },
    { key: "Concessionario", value: textOrNA(detail.concessionario?.denominazione) },
    { key: "Stato concessione", value: enumLabel(detail.concessione.stato) },
    { key: "Data rilascio", value: dateIT(detail.concessione.dataRilascio) },
    { key: "Data scadenza", value: dateIT(detail.concessione.dataScadenza) },
    { key: "Tipologia bene", value: enumLabel(detail.concessione.tipologiaBene) },
    { key: "Attivita", value: enumLabel(detail.concessione.attivita) },
    { key: "Ubicazione", value: textOrNA(detail.concessione.ubicazione) },
    { key: "Canone annuo", value: euro(detail.concessione.canoneAnnuo) },
  ]);
}

function addCriticitaSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Criticita");

  if (detail.criticitaAperte.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  for (const item of detail.criticitaAperte) {
    addInfoBox(ctx, `Titolo: Criticita ${enumLabel(item.tipologia)}`, [
      `Stato: ${enumLabel(item.stato)}`,
      `Livello rischio: ${enumLabel(item.rischioDecadenza)}`,
      `Ipotesi art. 47: ${enumLabel(item.letteraArt47)}`,
      `Gravita: ${enumLabel(item.gravita)}`,
      `Regolarizzata: ${item.regolarizzata ? "Si" : "No"}`,
      `Data regolarizzazione: ${dateIT(item.dataRegolarizzazione)}`,
      `Esito regolarizzazione: ${enumLabel(item.esitoRegolarizzazione)}`,
      `Verifica regolarizzazione: ${item.verificataRegolarizzazione ? "Si" : "No"}`,
      `Nota istruttoria: ${textOrNA(item.noteVerificaRegolarizzazione ?? item.descrizioneRegolarizzazione)}`,
    ]);

    addParagraph(ctx, `Descrizione: ${textOrNA(item.descrizione)}`);

    addParagraph(
      ctx,
      `Art. 47 rilevante: ${item.rilevanzaArt47 ? "Si" : "No"}${item.riferimentoNormativo ? ` | Riferimento: ${item.riferimentoNormativo}` : ""}`,
    );

    if (item.rilevanzaArt47) {
      addParagraph(ctx, ART47_NOTE);
    }

    if (item.regolarizzata) {
      addParagraph(ctx, REGOLARIZZAZIONE_NOTE);
    }
  }
}

function addProcedimentiSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Procedimenti");

  if (detail.procedimentiInCorso.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    addParagraph(ctx, PREAVVISO_NOTE);
    addParagraph(ctx, CHECKLIST_NOTE);
    return;
  }

  for (const item of detail.procedimentiInCorso) {
    addInfoBox(ctx, `Procedimento ${enumLabel(item.tipologia)}`, [
      `Stato: ${enumLabel(item.stato)}`,
      `Origine procedimento: ${enumLabel(item.origineProcedimento)}${item.procedimentoUfficio ? " (ufficio)" : ""}`,
      `Checklist contraddittorio: ${item.checklistContraddittorioCompleta ? "Completa" : "Incompleta"}`,
      `Comunicazione avvio: ${item.comunicazioneAvvioInviata ? "Si" : "No"} (${dateIT(item.dataComunicazioneAvvio)})`,
      `Contestazione formale: ${item.contestazioneFormaleInviata ? "Si" : "No"} (${dateIT(item.dataContestazioneFormale)})`,
      `Memorie/controdeduzioni: memorie ${item.memorieRicevute ? "ricevute" : "non ricevute"}, valutazione ${item.controdeduzioniValutate ? "presente" : "non presente"}`,
      `Audizione: richiesta ${item.audizioneRichiesta ? "Si" : "No"}, svolta ${item.audizioneSvolta ? "Si" : "No"} (${dateIT(item.dataAudizione)})`,
      `Art. 10-bis applicabile: ${item.preavvisoRigettoApplicabile ? "Si" : "No"}`,
      `Stato preavviso: ${enumLabel(item.statoPreavvisoRigetto)} | Data: ${dateIT(item.dataPreavvisoRigetto)}`,
      `Osservazioni preavviso: ${item.osservazioniPreavvisoRicevute ? "Ricevute" : "Non ricevute"} | Termine: ${dateIT(item.termineOsservazioniPreavviso)}`,
      `Valutazione osservazioni: ${textOrNA(item.valutazioneOsservazioniPreavviso)}`,
      `Proposta esito istruttorio: ${enumLabel(item.propostaEsitoIstruttorio)}`,
    ]);

    addParagraph(ctx, `Riferimento normativo: ${textOrNA(item.riferimentoNormativo)}`);
    addParagraph(ctx, `Data avvio: ${dateIT(item.dataAvvio)} | Scadenza contraddittorio: ${dateIT(item.dataScadenzaContraddittorio)}`);
    addParagraph(ctx, `Note checklist: ${textOrNA(item.noteChecklistContraddittorio)}`);
  }

  addParagraph(ctx, PREAVVISO_NOTE);
  addParagraph(ctx, CHECKLIST_NOTE);
}

function addPagamentiSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Pagamenti");

  if (detail.pagamentiCritici.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  const now = new Date();
  const morosi = detail.pagamentiCritici.filter(
    (item) => item.stato === "SCADUTO" || item.stato === "NON_PAGATO" || item.residuo > 0,
  ).length;

  addInfoBox(ctx, "Quadro economico", [
    `Posizioni critiche: ${detail.pagamentiCritici.length}`,
    `Posizioni scadute/morose: ${morosi}`,
    `Residuo complessivo: ${euro(detail.pagamentiCritici.reduce((sum, item) => sum + item.residuo, 0))}`,
  ]);

  for (const item of detail.pagamentiCritici) {
    const isScaduto = item.dataScadenza < now;
    addKeyValueTable(ctx, [
      {
        key: `Pagamento ${item.annoRiferimento}`,
        value: `${enumLabel(item.stato)} | Scadenza ${dateIT(item.dataScadenza)}${isScaduto ? " (scaduto)" : ""}`,
      },
      { key: "Importo dovuto", value: euro(item.importoDovuto) },
      { key: "Importo versato", value: euro(item.importoVersato) },
      { key: "Residuo", value: euro(item.residuo) },
      { key: "Interessi mora", value: euro(item.interessiMora) },
      { key: "Data versamento", value: dateIT(item.dataVersamento) },
      { key: "Note", value: textOrNA(item.note) },
    ]);
    ctx.doc.moveDown(0.3);
  }
}

function addScadenzeSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Scadenze");

  if (detail.scadenzeRilevanti.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  const now = new Date();
  const threshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const prossime = detail.scadenzeRilevanti.filter(
    (item) => item.dataScadenza >= now && item.dataScadenza <= threshold,
  ).length;

  addInfoBox(ctx, "Agenda scadenze", [
    `Scadenze nel perimetro: ${detail.scadenzeRilevanti.length}`,
    `Scadenze prossime (30 giorni): ${prossime}`,
  ]);

  for (const item of detail.scadenzeRilevanti) {
    addBullet(
      ctx,
      `${enumLabel(item.tipologia)} | ${dateIT(item.dataScadenza)} | ${enumLabel(item.stato)} | ${textOrNA(item.descrizione)}`,
    );
  }
}

function addSopralluoghiSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Sopralluoghi");

  if (detail.sopralluoghiRecenti.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  for (const item of detail.sopralluoghiRecenti) {
    addInfoBox(ctx, `Sopralluogo del ${dateIT(item.data)}`, [
      `Esito: ${enumLabel(item.esito)}`,
      `Operatori: ${textOrNA(item.operatori)}`,
      `Conformita planimetrica: ${item.conformitaPlanimetrica ? "Si" : "No"}`,
      `Stato manutentivo: ${textOrNA(item.statoManutentivo)}`,
      `Sicurezza: ${textOrNA(item.sicurezza)}`,
      `Occupazione: ${textOrNA(item.occupazione)}`,
      `Interferenze: ${textOrNA(item.interferenze)}`,
      `Prescrizioni/descrizione: ${textOrNA(item.descrizione)}`,
    ]);
  }
}

function addDocumentiSection(ctx: PdfContext, detail: ReportDetail) {
  addSectionTitle(ctx, "Documenti collegati");

  if (detail.documentiPrincipali.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  for (const item of detail.documentiPrincipali) {
    addBullet(
      ctx,
      `${textOrNA(item.nome)} | Tipologia: ${enumLabel(item.tipologia)} | Data: ${dateIT(item.dataDocumento ?? item.createdAt)}`,
    );
  }
}

function addNormativaSection(ctx: PdfContext, norme: NormaReportItem[]) {
  addSectionTitle(ctx, "Evidenze istruttorie");

  if (norme.length === 0) {
    addParagraph(ctx, "Non risultano dati nel perimetro del report.");
    return;
  }

  for (const item of norme.slice(0, 12)) {
    addBullet(
      ctx,
      `${item.codice} - ${item.titolo} | Ambito: ${enumLabel(item.ambito)} | Severita: ${enumLabel(item.severita)} | ${textOrNA(item.descrizione)}`,
    );
  }
}

function addDisclaimerSection(ctx: PdfContext) {
  addSectionTitle(ctx, "Avvertenze e limiti");
  addBullet(ctx, "Report generato da dati presenti nella piattaforma.");
  addBullet(ctx, "Documento a uso istruttorio.");
  addBullet(ctx, "Non sostituisce verifica documentale/protocollare.");
  addBullet(ctx, "Non costituisce provvedimento.");
  addBullet(ctx, "Non determina automaticamente decadenza, archiviazione o sanzioni.");
  addBullet(ctx, "Richiede valutazione dell autorita competente.");
  addBullet(ctx, "Eventuali dati mancanti o non aggiornati incidono sull affidabilita.");
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
      compress: false,
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
      writableWidth,
      lineGap: 2,
      generatedAt,
      reportId: params.detail.report.id,
    };

    addCoverPage(ctx, params.detail);
    doc.addPage();
    drawHeader(ctx);

    addSummarySection(ctx, params.detail);
    addConcessioneSection(ctx, params.detail);
    addCriticitaSection(ctx, params.detail);
    addProcedimentiSection(ctx, params.detail);
    addPagamentiSection(ctx, params.detail);
    addScadenzeSection(ctx, params.detail);
    addSopralluoghiSection(ctx, params.detail);
    addDocumentiSection(ctx, params.detail);
    addNormativaSection(ctx, params.norme);
    addDisclaimerSection(ctx);

    const pageRange = doc.bufferedPageRange();
    for (let index = 0; index < pageRange.count; index += 1) {
      doc.switchToPage(index);
      drawFooter(ctx, index + 1, pageRange.count);
    }

    doc.end();
  });
}
