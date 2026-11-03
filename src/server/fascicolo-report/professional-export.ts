import PDFDocument from "pdfkit/js/pdfkit.standalone";

import type { StructuredReportSnapshotRecord } from "./repository";

export interface ProfessionalReportSection {
  title: string;
  paragraphs: readonly string[];
}

export interface ProfessionalReportDocument {
  title: string;
  subtitle: string;
  generatedAt: Date;
  sections: readonly ProfessionalReportSection[];
}

function cleanProfessionalText(value: string): string {
  return value
    .replace(/\bDOCUMENT_\d+(?:\.PAGE_\d+)?\b/g, "")
    .replace(/\bPAGE_\d+\b/g, "")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(cleanProfessionalText).filter(Boolean))];
}

function professionalNotes(values: readonly string[]): string[] {
  return unique(values).filter((value) => !/\b[A-Z][A-Z0-9]{4,}\b/.test(value));
}

export function buildProfessionalReportDocument(
  snapshot: StructuredReportSnapshotRecord,
): ProfessionalReportDocument {
  const payload = snapshot.payload;
  const questions = [
    ...payload.legalIssues.flatMap((issue) => issue.questions),
    ...payload.unassignedQuestions,
  ];
  const authorities = unique(questions.flatMap((question) => [
    ...question.favorableAuthorities.map((authority) =>
      `${authority.title}${authority.rationale ? ` — ${authority.rationale}` : ""}`),
    ...question.contraryAuthorities.map((authority) =>
      `${authority.title}${authority.rationale ? ` — ${authority.rationale}` : ""}`),
  ]));
  const limitations = professionalNotes([
    ...payload.limitations,
    ...questions.flatMap((question) => [...question.gaps, ...question.limitations]),
  ]);
  const proceduralContext = payload.proceduralContext;
  const titleReference = proceduralContext?.concessione?.numeroAtto
    ?? proceduralContext?.finalAct?.numeroAtto
    ?? payload.procedimentoId;
  const sections: ProfessionalReportSection[] = [
    {
      title: "Sintesi della vicenda",
      paragraphs: unique([
        ...payload.documentedFramework.facts.map((item) => item.normalizedText),
        ...payload.documentedFramework.measures.map((item) => item.normalizedText),
      ]),
    },
    {
      title: "Ricostruzione documentale",
      paragraphs: unique([
        ...payload.documentedFramework.partyRoles.map((item) => item.normalizedText),
        ...payload.documentedFramework.legalActs.map((item) => item.normalizedText),
      ]),
    },
    {
      title: "Cronologia",
      paragraphs: unique(payload.documentedFramework.timeline.map((item) => item.normalizedText)),
    },
    {
      title: "Questioni giuridiche",
      paragraphs: unique([
        ...payload.legalIssues.flatMap((issue) => [
          issue.text,
          ...issue.questions.map((question) => question.text),
        ]),
        ...payload.unassignedQuestions.map((question) => question.text),
      ]),
    },
    {
      title: "Normativa e giurisprudenza pertinente",
      paragraphs: authorities,
    },
    {
      title: "Applicabilità temporale e adempimenti",
      paragraphs: unique((payload.regulatoryApplicability ?? []).map((row) =>
        `Misura ${row.measure}. ${row.applicability} Adempimento: ${row.authorityAction} Scadenza: ${row.deadline}`)),
    },
    {
      title: "Valutazione delle criticità",
      paragraphs: unique([
        ...payload.documentedFramework.contradictions.map((item) => item.normalizedText),
        ...payload.gaps.map((item) => item.normalizedText),
      ]),
    },
    {
      title: "Proposte operative",
      paragraphs: unique((payload.operationalPlans ?? []).flatMap((plan) => [
        `${plan.issueText}: ${plan.recommendedNextStep}`,
        ...plan.steps.map((step) =>
          `${step.title}. ${step.action} Ufficio competente: ${step.office}. Criterio di completamento: ${step.completionGate}`),
        ...plan.alternatives.map((alternative) =>
          `${alternative.title}. Quando: ${alternative.whenApplicable}. Percorso: ${alternative.practicalRoute}. Rischio: ${alternative.riskOrLimit}`),
      ])),
    },
    {
      title: "Conclusioni e limiti",
      paragraphs: limitations.length > 0
        ? limitations
        : ["Il rapporto deve essere verificato e approvato dal professionista competente prima di qualsiasi utilizzo autoritativo."],
    },
  ].filter((section) => section.paragraphs.length > 0);

  return {
    title: `Relazione giuridico-amministrativa — ${titleReference}`,
    subtitle: "Documento istruttorio versionato. Richiede verifica e approvazione professionale.",
    generatedAt: snapshot.generatedAt,
    sections,
  };
}

function rtfEscape(value: string): string {
  return [...value].map((character) => {
    if (character === "\\" || character === "{" || character === "}") return `\\${character}`;
    const code = character.charCodeAt(0);
    return code > 127 ? `\\u${code > 32767 ? code - 65536 : code}?` : character;
  }).join("");
}

export function renderProfessionalReportRtf(document: ProfessionalReportDocument): Buffer {
  const body = [
    "{\\rtf1\\ansi\\deff0",
    "{\\fonttbl{\\f0 Arial;}}",
    `\\f0\\fs32\\b ${rtfEscape(document.title)}\\b0\\par`,
    `\\fs20 ${rtfEscape(document.subtitle)}\\par`,
    `Generato il ${rtfEscape(document.generatedAt.toLocaleDateString("it-IT"))}\\par\\par`,
    ...document.sections.flatMap((section) => [
      `\\fs26\\b ${rtfEscape(section.title)}\\b0\\par`,
      ...section.paragraphs.map((paragraph) => `\\fs20 ${rtfEscape(paragraph)}\\par`),
      "\\par",
    ]),
    "}",
  ].join("\n");
  return Buffer.from(body, "utf8");
}

export async function renderProfessionalReportPdf(document: ProfessionalReportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 54, right: 54, bottom: 54, left: 54 } });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text(document.title);
    pdf.moveDown(0.5);
    pdf.font("Helvetica").fontSize(10).fillColor("#475569").text(document.subtitle);
    pdf.text(`Generato il ${document.generatedAt.toLocaleDateString("it-IT")}`);
    for (const section of document.sections) {
      pdf.moveDown(1);
      pdf.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(section.title);
      pdf.moveDown(0.35);
      for (const paragraph of section.paragraphs) {
        pdf.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(paragraph, { lineGap: 2 });
        pdf.moveDown(0.4);
      }
    }
    pdf.end();
  });
}

export function buildProfessionalReportFileName(procedimentoId: string, extension: "pdf" | "rtf"): string {
  const safeId = procedimentoId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 96);
  return `rapporto-${safeId}.${extension}`;
}
