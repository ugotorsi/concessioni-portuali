import PDFDocument from "pdfkit/js/pdfkit.standalone";

import {
  documentCoverageSummaries,
  documentNamesByReference,
  humanizeProfessionalText,
  isInternalProfessionalDiagnostic,
  professionalGapSummaries,
} from "@/lib/professional-text";
import { projectProfessionalResearch } from "@/lib/professional-research-sources";
import { commonLegalContent, legalIssueNarrative, legalRuleKey } from "@/lib/legal-report-presentation";

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
  if (isInternalProfessionalDiagnostic(value)) return "";
  return humanizeProfessionalText(value)
    .replace(/\bPAGE_\d+\b/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(cleanProfessionalText).filter(Boolean))];
}

function professionalNotes(values: readonly string[]): string[] {
  return unique(values.filter((value) => !isInternalProfessionalDiagnostic(value)))
    .filter((value) => !/\b[A-Z][A-Z0-9]{4,}\b/.test(value));
}

const ELEMENT_STATUS_TEXT = {
  PROVEN: "provato",
  INDICATED: "risulta dai documenti, da confermare",
  NOT_PROVEN: "non provato",
  CONTRARY_EVIDENCE: "elementi contrari o giustificativi",
} as const;

export function buildProfessionalReportDocument(
  snapshot: StructuredReportSnapshotRecord,
  documents: ReadonlyArray<{ id: string; nome: string }> = [],
): ProfessionalReportDocument {
  const payload = snapshot.payload;
  const documentNames = documentNamesByReference([
    ...payload.gaps,
    ...payload.deadlineCandidates,
    ...Object.values(payload.documentedFramework).flat(),
  ], documents);
  const questions = [
    ...payload.legalIssues.flatMap((issue) => issue.questions),
    ...payload.unassignedQuestions,
  ];
  const research = projectProfessionalResearch(payload);
  const authorities = research.authoritiesAttested ? unique(questions.flatMap((question) => [
    ...question.favorableAuthorities.map((authority) =>
      `${authority.title}${authority.rationale ? ` — ${authority.rationale}` : ""}`),
    ...question.contraryAuthorities.map((authority) =>
      `${authority.title}${authority.rationale ? ` — ${authority.rationale}` : ""}`),
  ])) : [];
  const limitations = professionalNotes([
    ...(research.legacyWarning ? [research.legacyWarning] : []),
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
      title: "Coordinamento del regime concessorio portuale",
      paragraphs: payload.portRegime ? unique([
        ...[payload.portRegime.procedureStartDate, payload.portRegime.grantDate].map((entry) =>
          `${entry.label}: ${entry.date ? entry.date.split("-").reverse().join("/") : "da accertare"} — ${entry.basis}.`),
        ...payload.portRegime.sources.map((source) =>
          `${source.citation}. ${source.reasoning}${source.operativeConsequences.length ? ` Conseguenze: ${source.operativeConsequences.join(" ")}` : ""} Testo ufficiale: ${source.officialUrl}`),
        `Conclusione: ${payload.portRegime.conclusion}`,
        ...payload.portRegime.limits.map((limit) => `Limite: ${limit}`),
      ]) : [],
    },
    {
      title: "Analisi giuridica: applicazione delle norme ai fatti",
      paragraphs: (() => {
        const common = commonLegalContent(research.applications);
        const first = research.applications[0];
        const commonParagraphs = first ? [
          ...first.rules.filter((rule) => common.ruleKeys.has(legalRuleKey(rule))).map((rule) =>
            `Norma comune a tutte le questioni — ${rule.citation} — ${rule.subject}. Vigenza: ${rule.temporalReasoning} Applicazione: ${rule.applicationToFacts} Testo ufficiale: ${rule.officialUrl}`),
          ...[...common.arguments].map((argument) => `Avvertenza comune — ${argument}`),
          ...[...common.consequences].map((consequence) => `Conseguenza comune — ${consequence}`),
        ] : [];
        return unique([...commonParagraphs, ...research.applications.flatMap((item) => [
          `Questione: ${item.issueText}`,
          ...legalIssueNarrative(item),
          `Date rilevanti: ${item.relevantDates.map((date) => `${date.label} ${date.date.split("-").reverse().join("/")}`).join("; ")}.`,
          ...(item.elementAnalysis?.elements ?? []).map((element) =>
            `Elemento — ${element.requirement} (${element.legalBasis}): ${ELEMENT_STATUS_TEXT[element.status]}. ${element.reasoning}`),
          ...item.rules.filter((rule) => !common.ruleKeys.has(legalRuleKey(rule))).map((rule) =>
            `${rule.citation} — ${rule.subject}. Vigenza: ${rule.temporalReasoning} Applicazione: ${rule.applicationToFacts} Testo ufficiale: ${rule.officialUrl}`),
          ...item.favorableArguments.map((argument) => `Argomento a sostegno — ${argument}`),
          ...item.contraryArguments.filter((argument) => !common.arguments.has(argument)).map((argument) => `Argomento contrario — ${argument}`),
          ...item.consequences.filter((consequence) => !common.consequences.has(consequence)).map((consequence) => `Conseguenza: ${consequence}`),
        ])]);
      })(),
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
        ...professionalGapSummaries(payload.gaps, documentNames, payload.documentCoverage ?? []),
      ]),
    },
    {
      title: "Copertura documentale",
      paragraphs: documentCoverageSummaries(payload.documentCoverage ?? []),
    },
    {
      title: "Seguito operativo",
      paragraphs: payload.operationalPlans?.length
        ? ["Per le attività, gli atti e gli esiti si rinvia alla sezione Proposte del fascicolo."]
        : [],
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
