import PDFDocument from "pdfkit/js/pdfkit.standalone";

import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

interface ExportLine {
  kind: "title" | "heading" | "body" | "bullet";
  text: string;
}

function itemText(item: { normalizedText: string }): string {
  return item.normalizedText;
}

function reportLines(input: {
  snapshotId: string;
  status: string;
  generatedAt: Date;
  payload: StructuredFascicoloReportPayload;
}): ExportLine[] {
  const { payload } = input;
  const lines: ExportLine[] = [
    { kind: "title", text: "NOETRA - Rapporto strutturato del fascicolo" },
    { kind: "body", text: `Versione: ${input.snapshotId}` },
    { kind: "body", text: `Contratto: ${payload.contractVersion}` },
    { kind: "body", text: `Stato snapshot: ${input.status}` },
    { kind: "body", text: `Generato il: ${input.generatedAt.toISOString()}` },
    { kind: "body", text: "Stato professionale: bozza istruttoria da verificare e validare dall'avvocato." },
    { kind: "heading", text: "Ricostruzione documentale" },
    ...payload.documentedFramework.facts.map((item) => ({ kind: "bullet" as const, text: itemText(item) })),
    { kind: "heading", text: "Cronologia" },
    ...payload.documentedFramework.timeline.map((item) => ({ kind: "bullet" as const, text: itemText(item) })),
    { kind: "heading", text: "Atti e provvedimenti" },
    ...[...payload.documentedFramework.legalActs, ...payload.documentedFramework.measures]
      .map((item) => ({ kind: "bullet" as const, text: itemText(item) })),
    { kind: "heading", text: "Questioni giuridiche e fonti" },
  ];
  const questions = [
    ...payload.legalIssues.flatMap((issue) => issue.questions.map((question) => ({
      issue: issue.text,
      question,
    }))),
    ...payload.unassignedQuestions.map((question) => ({ issue: "Quesito professionale non assegnato a una questione documentale", question })),
  ];
  for (const { issue, question } of questions) {
    lines.push(
      { kind: "body", text: `Questione: ${issue}` },
      { kind: "body", text: `Quesito: ${question.text}` },
      { kind: "body", text: `Missione: ${question.missionId ?? "non avviata"} - stato ${question.missionStatus} - copertura ${question.coverageStatus}` },
    );
    for (const authority of question.favorableAuthorities) {
      lines.push({
        kind: "bullet",
        text: `Fonte favorevole [${authority.provider ?? "provider non indicato"}]: ${authority.title}${authority.sourceUrl ? ` - ${authority.sourceUrl}` : ""}${authority.rationale ? ` - ${authority.rationale}` : ""}`,
      });
    }
    for (const authority of question.contraryAuthorities) {
      lines.push({
        kind: "bullet",
        text: `Fonte contraria [${authority.provider ?? "provider non indicato"}]: ${authority.title}${authority.sourceUrl ? ` - ${authority.sourceUrl}` : ""}${authority.rationale ? ` - ${authority.rationale}` : ""}`,
      });
    }
    for (const candidate of question.nonUsableResults) {
      lines.push({
        kind: "bullet",
        text: `Fonte non utilizzabile allo stato: ${candidate.title}${candidate.sourceUrl ? ` - ${candidate.sourceUrl}` : ""}. Motivi: ${candidate.reasons.join(", ") || "verifica non completata"}.`,
      });
    }
    for (const limitation of question.limitations) lines.push({ kind: "bullet", text: `Limite: ${limitation}` });
  }
  lines.push(
    { kind: "heading", text: "Lacune documentali e limitazioni" },
    ...payload.gaps.map((gap) => ({ kind: "bullet" as const, text: itemText(gap) })),
    ...payload.limitations.map((limitation) => ({ kind: "bullet" as const, text: limitation })),
  );
  if (payload.legalApplicability) {
    lines.push({ kind: "heading", text: "Stato delle verifiche di applicabilità" });
    for (const application of payload.legalApplicability.applications) {
      lines.push({
        kind: "bullet",
        text: `${application.resultId}: ${application.status}, esito ${application.outcome}, revisione professionale richiesta. Motivi: ${application.reasonCodes.join(", ") || "nessuno registrato"}.`,
      });
    }
  }
  return lines;
}

export async function renderStructuredReportPdf(input: {
  snapshotId: string;
  status: string;
  generatedAt: Date;
  payload: StructuredFascicoloReportPayload;
}): Promise<Buffer> {
  const lines = reportLines(input);
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 54, right: 54, bottom: 54, left: 54 },
      info: {
        Title: "NOETRA - Rapporto strutturato del fascicolo",
        Subject: input.payload.contractVersion,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const line of lines) {
      if (line.kind === "title") {
        doc.font("Helvetica-Bold").fontSize(18).fillColor("#173d4f").text(line.text).moveDown(0.8);
      } else if (line.kind === "heading") {
        doc.moveDown(0.5).font("Helvetica-Bold").fontSize(13).fillColor("#173d4f").text(line.text).moveDown(0.35);
      } else {
        doc.font(line.kind === "bullet" ? "Helvetica" : "Helvetica")
          .fontSize(9.5)
          .fillColor("#1f2937")
          .text(`${line.kind === "bullet" ? "- " : ""}${line.text}`, { lineGap: 2 })
          .moveDown(0.25);
      }
    }
    doc.end();
  });
}

function rtfEscape(value: string): string {
  let output = "";
  for (const character of value) {
    if (character === "\\" || character === "{" || character === "}") {
      output += `\\${character}`;
    } else if (character === "\n") {
      output += "\\line ";
    } else {
      const codePoint = character.codePointAt(0)!;
      if (codePoint >= 32 && codePoint <= 126) {
        output += character;
      } else if (codePoint <= 0xffff) {
        output += `\\u${codePoint > 32767 ? codePoint - 65536 : codePoint}?`;
      } else {
        const adjusted = codePoint - 0x10000;
        const high = 0xd800 + (adjusted >> 10);
        const low = 0xdc00 + (adjusted & 0x3ff);
        output += `\\u${high - 65536}?\\u${low - 65536}?`;
      }
    }
  }
  return output;
}

export function renderStructuredReportRtf(input: {
  snapshotId: string;
  status: string;
  generatedAt: Date;
  payload: StructuredFascicoloReportPayload;
}): Buffer {
  const body = reportLines(input).map((line) => {
    const prefix = line.kind === "title"
      ? "\\fs36\\b "
      : line.kind === "heading"
        ? "\\fs26\\b "
        : "\\fs20 ";
    const bullet = line.kind === "bullet" ? "\\bullet\\tab " : "";
    return `${prefix}${bullet}${rtfEscape(line.text)}\\b0\\par`;
  }).join("\n");
  return Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\n${body}\n}`, "utf8");
}
