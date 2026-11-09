import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";
import type { StructuredFascicoloReportPayload, StructuredReportQuestion } from "@/server/fascicolo-report";
import type { JsonValue } from "@/server/fascicolo-knowledge";

import {
  FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION,
  operationalProposalCandidateSchema,
  type OperationalProposalCandidate,
  type OperationalProposalType,
} from "./contracts";

type RecordValue = Readonly<Record<string, JsonValue>>;

function record(value: JsonValue): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function buildCandidate(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  structuredReportId: string | null;
  structuredReportFingerprint: string;
  proposalType: OperationalProposalType;
  title: string;
  description: string;
  proposedPayload: JsonValue;
  originatingKnowledgeItemIds?: readonly string[];
  originatingIssueSemanticKeys?: readonly string[];
  originatingQuestionSemanticKeys?: readonly string[];
  relevantResultIds?: readonly string[];
  rationale: string;
  confidence?: number | null;
  warningCodes?: readonly string[];
}): OperationalProposalCandidate {
  const identity = {
    proposalType: input.proposalType,
    title: input.title,
    description: input.description,
    proposedPayload: input.proposedPayload,
    originatingKnowledgeItemIds: unique(input.originatingKnowledgeItemIds ?? []),
    originatingIssueSemanticKeys: unique(input.originatingIssueSemanticKeys ?? []),
    originatingQuestionSemanticKeys: unique(input.originatingQuestionSemanticKeys ?? []),
    relevantResultIds: unique(input.relevantResultIds ?? []),
    rationale: input.rationale,
    confidence: input.confidence ?? null,
    warningCodes: unique(input.warningCodes ?? []),
    structuredReportFingerprint: input.structuredReportFingerprint,
    knowledgeRevisionId: input.knowledgeRevisionId,
    policyVersion: FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION,
  };
  return operationalProposalCandidateSchema.parse({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    knowledgeRevisionId: input.knowledgeRevisionId,
    structuredReportId: input.structuredReportId,
    structuredReportFingerprint: input.structuredReportFingerprint,
    policyVersion: FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION,
    proposalType: input.proposalType,
    title: input.title,
    description: input.description,
    proposedPayload: input.proposedPayload,
    originatingKnowledgeItemIds: identity.originatingKnowledgeItemIds,
    originatingIssueSemanticKeys: identity.originatingIssueSemanticKeys,
    originatingQuestionSemanticKeys: identity.originatingQuestionSemanticKeys,
    relevantResultIds: identity.relevantResultIds,
    rationale: input.rationale,
    confidence: input.confidence ?? null,
    warningCodes: unique(input.warningCodes ?? []),
    proposalFingerprint: hash(identity),
  });
}

function issueKeysForItem(report: StructuredFascicoloReportPayload, itemId: string): string[] {
  return report.legalIssues.filter((issue) => issue.originatingItemIds.includes(itemId)).map((issue) => issue.semanticKey);
}

function deadlineCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  return input.report.deadlineCandidates.map((item) => {
    const payload = record(item.payload);
    const resultingDate = record(payload.resultingDate ?? null);
    const dueDate = text(resultingDate.from);
    const dueDatePrecision = text(resultingDate.precision) ?? "UNKNOWN";
    return buildCandidate({
      ...input,
      knowledgeRevisionId: input.report.knowledgeRevisionId,
      proposalType: "DEADLINE",
      title: item.normalizedText,
      description: item.normalizedText,
      proposedPayload: {
        title: item.normalizedText,
        dueDate,
        dueDatePrecision,
        sourceDeadlineCandidateId: item.id,
        ruleText: text(payload.ruleText),
        calculationExplanation: text(payload.calculationExplanation),
        certainty: dueDatePrecision === "EXACT" ? "EXACT" : "REVIEW_REQUIRED",
        relatedSubjectIds: strings(payload.subjectIds),
        relatedIssueSemanticKeys: issueKeysForItem(input.report, item.id),
        evidence: item.evidence.map((evidence) => ({ ...evidence })),
        tipologia: "TERMINE_PROCEDIMENTALE",
        preavvisoGiorni: 30,
      },
      originatingKnowledgeItemIds: [item.id],
      originatingIssueSemanticKeys: issueKeysForItem(input.report, item.id),
      rationale: "Candidato scadenza presente nella Knowledge CURRENT; nessuna Scadenza viene creata prima della review.",
      confidence: item.confidence,
      warningCodes: dueDate && dueDatePrecision === "EXACT" ? [] : ["DEADLINE_DATE_REVIEW_REQUIRED"],
    });
  });
}

const EXTRACTION_COVERAGE_GAP_TYPE = /EXTRACT|COVERAGE|EMPTY_PAGE|UNREADABLE|NO_CONTENT|NO_INFORMATION/;
const EXTRACTION_COVERAGE_TEXT = new RegExp([
  String.raw`nessun[ao]?\s+(?:informazion[ei]|dat[oi]\b|contenut[oi])[^.]*?estratt`,
  String.raw`non\s+(?:[èe]|sono)\s+stat[aoie]\s+estratt[aeio]\s+(?:alcun|informazion|dat[oi]\b|contenut)`,
  String.raw`non\s+(?:[èe]\s+stato\s+)?possibile\s+estrarre`,
  String.raw`no\s+(?:verified\s+)?(?:\w+\s+)?(?:information|content|data)[^.]*?extracted`,
  String.raw`nothing\s+(?:was\s+)?extracted`,
].join("|"), "i");
const DOCUMENT_PAGE_REF = /\bDOCUMENT_(\d+)(?:\.PAGE_(\d+))?\b/g;

interface DocumentGap {
  item: StructuredFascicoloReportPayload["gaps"][number];
  gapType: string;
  description: string;
}

interface CoverageReference {
  documentNumber: number | null;
  pageNumbers: number[];
}

function coverageReference(gap: DocumentGap): CoverageReference {
  const refs = [...`${gap.description} ${gap.item.normalizedText}`.matchAll(DOCUMENT_PAGE_REF)];
  const evidenceRefs = gap.item.evidence.flatMap((entry) => [...(entry.basisRef ?? "").matchAll(DOCUMENT_PAGE_REF)]);
  const source = refs.length > 0 ? refs : evidenceRefs;
  const documentNumber = source.length > 0 ? Number(source[0][1]) : null;
  const pageNumbers = source
    .filter((match) => Number(match[1]) === documentNumber && match[2] !== undefined)
    .map((match) => Number(match[2]));
  return { documentNumber, pageNumbers };
}

// Page-level "nothing was extracted" gaps describe the reading of a document already in the
// fascicolo, not a missing document: they must not become requests for new documentation.
function isExtractionCoverageGap(gap: DocumentGap): boolean {
  if (EXTRACTION_COVERAGE_GAP_TYPE.test(gap.gapType)) return true;
  return EXTRACTION_COVERAGE_TEXT.test(`${gap.description} ${gap.item.normalizedText}`)
    && /\bDOCUMENT_\d+/.test(`${gap.description} ${gap.item.normalizedText} ${gap.item.evidence.map((entry) => entry.basisRef ?? "").join(" ")}`);
}

function pageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    while (index + 1 < sorted.length && sorted[index + 1] === sorted[index] + 1) index += 1;
    ranges.push(start === sorted[index] ? `${start}` : `${start}-${sorted[index]}`);
  }
  return ranges.join(", ");
}

function extractionCoverageCandidates(input: GenerationInput, gaps: readonly DocumentGap[]): OperationalProposalCandidate[] {
  const groups = new Map<string, { documentNumber: number | null; pages: number[]; gaps: DocumentGap[] }>();
  for (const gap of gaps) {
    const reference = coverageReference(gap);
    const key = reference.documentNumber === null ? "UNIDENTIFIED" : `DOCUMENT_${reference.documentNumber}`;
    const group = groups.get(key) ?? { documentNumber: reference.documentNumber, pages: [], gaps: [] };
    group.pages.push(...reference.pageNumbers);
    group.gaps.push(gap);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const documentLabel = group.documentNumber === null ? "documenti del fascicolo" : `documento ${group.documentNumber}`;
    const pages = [...new Set(group.pages)].sort((left, right) => left - right);
    const pageText = pages.length > 0
      ? `${pages.length} ${pages.length === 1 ? "pagina" : "pagine"} (pag. ${pageRanges(pages)})`
      : `${group.gaps.length} ${group.gaps.length === 1 ? "segmento" : "segmenti"}`;
    const itemIds = unique(group.gaps.map((gap) => gap.item.id)).slice(0, 1_000);
    const issueKeys = unique(group.gaps.flatMap((gap) => issueKeysForItem(input.report, gap.item.id))).slice(0, 1_000);
    const confidences = group.gaps.map((gap) => gap.item.confidence).filter((value): value is number => typeof value === "number");
    return buildCandidate({
      ...input,
      knowledgeRevisionId: input.report.knowledgeRevisionId,
      proposalType: "NOTE",
      title: `Verificare la copertura della lettura: ${documentLabel}`,
      description: `Per ${pageText} del ${documentLabel}, già acquisito al fascicolo, non sono state estratte informazioni utilizzabili. `
        + "Verificare la leggibilità delle pagine (eventuale nuova acquisizione OCR) oppure confermare che non contengono elementi rilevanti. "
        + "Non è richiesta nuova documentazione.",
      proposedPayload: {
        reviewType: "EXTRACTION_COVERAGE",
        documentRef: key,
        pageNumbers: pages,
        gapTypes: unique(group.gaps.map((gap) => gap.gapType)),
        relatedKnowledgeItemIds: itemIds,
        relatedIssueSemanticKeys: issueKeys,
        suggestedActions: [
          "Verificare la leggibilità delle pagine indicate ed eventualmente ripetere l'OCR",
          "Confermare che le pagine non contengono elementi rilevanti per l'istruttoria",
        ],
        requestsNewDocumentation: false,
      },
      originatingKnowledgeItemIds: itemIds,
      originatingIssueSemanticKeys: issueKeys,
      rationale: "Lacune di lettura su pagine di un documento già presente: aggregate in un'unica verifica, senza richieste di nuova documentazione.",
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      warningCodes: ["MANUAL_ACTION_REQUIRED", "EXTRACTION_COVERAGE_REVIEW"],
    });
  });
}

function documentRequirementCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  const documentGaps: DocumentGap[] = input.report.gaps.flatMap((item) => {
    const payload = record(item.payload);
    const gapType = text(payload.gapType) ?? "UNSPECIFIED_GAP";
    const eligible = gapType.includes("DOCUMENT") || gapType.includes("EVIDENCE") || EXTRACTION_COVERAGE_GAP_TYPE.test(gapType);
    return eligible ? [{ item, gapType, description: text(payload.description) ?? item.normalizedText }] : [];
  });
  const coverageGaps = documentGaps.filter(isExtractionCoverageGap);
  const missingDocumentGaps = documentGaps.filter((gap) => !isExtractionCoverageGap(gap));
  return [
    ...extractionCoverageCandidates(input, coverageGaps),
    ...missingDocumentGaps.flatMap((gap) => missingDocumentCandidate(input, gap)),
  ];
}

function missingDocumentCandidate(input: GenerationInput, gap: DocumentGap): OperationalProposalCandidate[] {
  const { item, gapType } = gap;
  const payload = record(item.payload);
  const issueKeys = issueKeysForItem(input.report, item.id);
  return [buildCandidate({
    ...input,
    knowledgeRevisionId: input.report.knowledgeRevisionId,
    proposalType: "DOCUMENT_REQUIREMENT",
    title: `Acquisire documentazione: ${item.normalizedText}`,
    description: text(payload.description) ?? item.normalizedText,
    proposedPayload: {
      requestedDocumentType: gapType,
      description: text(payload.description) ?? item.normalizedText,
      reason: text(payload.impact) ?? "Gap documentale corrente",
      relatedIssueSemanticKeys: issueKeys,
      relatedKnowledgeItemIds: [item.id],
      urgency: "TO_REVIEW",
    },
    originatingKnowledgeItemIds: [item.id],
    originatingIssueSemanticKeys: issueKeys,
    rationale: "Gap documentale CURRENT; la proposta non invia richieste esterne.",
    confidence: item.confidence,
    warningCodes: ["MANUAL_ACTION_REQUIRED", "NO_SAFE_DOCUMENT_REQUIREMENT_TARGET"],
  })];
}

function contradictionCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  return input.report.documentedFramework.contradictions.map((item) => buildCandidate({
    ...input,
    knowledgeRevisionId: input.report.knowledgeRevisionId,
    proposalType: "CRITICALITY",
    title: `Contraddizione da risolvere: ${item.normalizedText}`,
    description: item.normalizedText,
    proposedPayload: {
      severity: "MEDIA",
      category: "GIURIDICA",
      description: item.normalizedText,
      rationale: "Contraddizione aperta nella Knowledge CURRENT",
      originatingKnowledgeItemIds: [item.id, ...item.contradictedItemIds],
      blockingEffect: "REVIEW_REQUIRED",
    },
    originatingKnowledgeItemIds: [item.id, ...item.contradictedItemIds],
    originatingIssueSemanticKeys: issueKeysForItem(input.report, item.id),
    rationale: "Policy conservativa: solo contraddizioni esplicite diventano candidate di criticità.",
    confidence: item.confidence,
  }));
}

const materialSourceGaps = new Set([
  "NO_USABLE_SOURCE",
  "ADVERSE_NOT_COMPLETED",
  "TEMPORAL_UNCERTAIN",
  "MANUAL_REVIEW_REQUIRED",
  "IDENTITY_UNVERIFIED",
  "CONTENT_UNVERIFIED",
]);

function questionCandidates(input: GenerationInput, question: StructuredReportQuestion, issueSemanticKey: string | null): OperationalProposalCandidate[] {
  const sourceGaps = question.gaps.filter((gap) => materialSourceGaps.has(gap));
  const hasAuthorityConflict = question.favorableAuthorities.length > 0 && question.contraryAuthorities.length > 0;
  if (sourceGaps.length === 0 && !hasAuthorityConflict) return [];
  const resultIds = [
    ...question.favorableAuthorities.map((authority) => authority.resultId),
    ...question.contraryAuthorities.map((authority) => authority.resultId),
    ...question.nonUsableResults.map((result) => result.resultId),
  ];
  return [buildCandidate({
    ...input,
    knowledgeRevisionId: input.report.knowledgeRevisionId,
    proposalType: "CRITICALITY",
    title: `Limite della ricerca: ${question.text}`,
    description: hasAuthorityConflict ? "Autorità utilizzabili favorevoli e contrarie in conflitto." : `Gap fonti: ${sourceGaps.join(", ")}`,
    proposedPayload: {
      severity: hasAuthorityConflict ? "ALTA" : "MEDIA",
      category: "GIURIDICA",
      description: question.text,
      rationale: hasAuthorityConflict ? "AUTHORITY_CONFLICT" : sourceGaps.join(","),
      originatingResultIds: unique(resultIds),
      blockingEffect: "PROFESSIONAL_REVIEW_REQUIRED",
    },
    originatingKnowledgeItemIds: [question.knowledgeItemId],
    originatingIssueSemanticKeys: issueSemanticKey ? [issueSemanticKey] : [],
    originatingQuestionSemanticKeys: [question.semanticKey],
    relevantResultIds: resultIds,
    rationale: "Gap o conflitto autoritativo CURRENT che può incidere sull'istruttoria.",
    warningCodes: ["PROFESSIONAL_REVIEW_REQUIRED"],
  })];
}

function sourceGapCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  return [
    ...input.report.legalIssues.flatMap((issue) => issue.questions.flatMap((question) => questionCandidates(input, question, issue.semanticKey))),
    ...input.report.unassignedQuestions.flatMap((question) => questionCandidates(input, question, null)),
  ];
}

function activityCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  // Initiatives judged not justified stay visible in the guided path but are not proposed for approval.
  return (input.report.operationalPlans ?? []).flatMap((plan) => {
    const actionable = plan.steps.filter((step) => step.necessity !== "NOT_JUSTIFIED");
    const firstRequired = actionable.find((step) => (step.necessity ?? "CONDITIONAL") === "REQUIRED") ?? actionable[0];
    return actionable.map((step) => buildCandidate({
    ...input,
    knowledgeRevisionId: input.report.knowledgeRevisionId,
    proposalType: "ACTIVITY",
    title: step.title,
    description: step.action,
    proposedPayload: {
      state: "PROPOSED",
      classification: "PROFESSIONAL_RECOMMENDATION",
      activityCode: step.activityCode ?? null,
      necessity: step.necessity ?? "CONDITIONAL",
      priority: step === firstRequired ? "HIGH" : "MEDIUM",
      responsibleOffice: step.office,
      dueDate: null,
      dependencies: [],
      requiredDocuments: [...step.requiredDocuments],
      completionCriterion: step.completionGate,
      expectedResult: step.completionGate,
      draft: step.draftTemplate ? {
        documentCode: step.documentCode ?? null,
        title: step.draftTitle ?? "Atto operativo",
        template: step.draftTemplate,
        approvalRequired: true,
      } : null,
      ...(step.additionalDrafts?.length ? {
        additionalDrafts: step.additionalDrafts.map((document) => ({
          documentCode: document.documentCode,
          title: document.title,
          template: document.template,
          approvalRequired: true,
        })),
      } : {}),
    },
    originatingKnowledgeItemIds: input.report.legalIssues
      .find((issue) => issue.semanticKey === plan.issueSemanticKey)?.originatingItemIds ?? [],
    originatingIssueSemanticKeys: [plan.issueSemanticKey],
    rationale: "Attività derivata dal percorso operativo phase-aware del rapporto strutturato corrente.",
    warningCodes: ["MANUAL_ACTION_REQUIRED", "PROFESSIONAL_REVIEW_REQUIRED"],
    }));
  });
}

function exactDate(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  const candidate = record(value);
  return text(candidate.precision) === "EXACT" ? text(candidate.from) : null;
}

function normalizedConcessionNumber(value: string | null | undefined): string | null {
  return value ? value.replace(/\s+/gu, "").toLocaleLowerCase("it-IT") : null;
}

function normalizedIsoDate(value: string | null | undefined): string | null {
  return value?.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] ?? null;
}

function metadataReconciliationCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  const context = input.report.proceduralContext;
  if (!context) return [];
  return input.report.documentedFramework.legalActs.flatMap((item) => {
    const payload = record(item.payload);
    const number = text(payload.number);
    const actType = text(payload.actType) ?? "";
    const title = text(payload.title) ?? item.normalizedText;
    const date = exactDate(payload.date);
    const proceduralRole = text(payload.proceduralRole);
    const evidence = item.evidence.flatMap((entry) =>
      entry.basisRef && entry.documentFileVersionId
        ? [{
            basisRef: entry.basisRef,
            documentFileVersionId: entry.documentFileVersionId,
            pageNumber: entry.pageNumber,
            textSha256: entry.textSha256,
          }]
        : []);
    const candidates: OperationalProposalCandidate[] = [];
    const isConcession = /concession|titolo demanial|atto demanial/i.test(`${actType} ${title}`);
    const documentedNumber = normalizedConcessionNumber(number);
    const currentNumber = normalizedConcessionNumber(context.concessione?.numeroAtto);
    const documentedDate = normalizedIsoDate(date);
    const currentDate = normalizedIsoDate(context.concessione?.dataRilascio);
    const concessionIdentityDiffers = currentNumber !== documentedNumber
      || documentedDate !== null && currentDate !== documentedDate;
    if (isConcession && number && concessionIdentityDiffers) {
      const before = context.concessione;
      if (evidence.length === 0) {
        candidates.push(buildCandidate({
          ...input,
          knowledgeRevisionId: input.report.knowledgeRevisionId,
          proposalType: "NOTE",
          title: `Verificare manualmente il titolo amministrativo ${number}`,
          description: "Il titolo documentato non dispone di una versione file e di un riferimento probatorio completi; non può aggiornare dati autoritativi.",
          proposedPayload: {
            action: "VERIFY_CONCESSION_EVIDENCE",
            numeroAtto: number,
            dataRilascio: date,
            targetEntity: "CONCESSIONE",
          },
          originatingKnowledgeItemIds: [item.id],
          originatingIssueSemanticKeys: issueKeysForItem(input.report, item.id),
          rationale: "La riconciliazione autoritativa è bloccata finché l'evidenza non identifica versione documentale, pagina e hash.",
          confidence: item.confidence,
          warningCodes: ["MANUAL_ACTION_REQUIRED", "DOCUMENT_EVIDENCE_INCOMPLETE"],
        }));
      } else {
        candidates.push(buildCandidate({
        ...input,
        knowledgeRevisionId: input.report.knowledgeRevisionId,
        proposalType: "CONCESSION_LINK_OR_CREATE",
        title: `Riconciliare il titolo amministrativo ${number}`,
        description: "Il titolo documentato non coincide con la relazione Concessione attualmente rappresentata nel fascicolo.",
        proposedPayload: {
          reconciliationType: "CONCESSIONE_LINK_OR_CREATE",
          materializationMode: "PROFESSIONAL_REVIEW_REQUIRED",
          targetEntity: "CONCESSIONE",
          before,
          after: { numeroAtto: number, dataRilascio: date, title },
          evidence,
          integrityChecks: [
            "TENANT_MATCH",
            "UNIQUE_CONCESSION_NUMBER_AND_RELEASE_DATE",
            "INTAKE_AND_PROCEDURE_CONCESSION_LINK_MATCH",
          ],
          rollback: { strategy: "RESTORE_AUTHORITATIVE_SNAPSHOT", value: before },
          previewOnly: true,
        },
        originatingKnowledgeItemIds: [item.id],
        originatingIssueSemanticKeys: issueKeysForItem(input.report, item.id),
        rationale: "Proposta documentale in sola anteprima; richiede verifica del titolo e conferma umana prima di ogni scrittura autoritativa.",
        confidence: item.confidence,
        warningCodes: ["PROFESSIONAL_REVIEW_REQUIRED", "AUTHORITATIVE_DATA_CHANGE_PREVIEW"],
        }));
      }
    }
    const isFinalAct = proceduralRole === "CHALLENGED_ACT"
      || /determinazione|decreto|provvedimento|decisione/i.test(`${actType} ${title}`)
        && /decaden|revoca|archivia|conclus/i.test(`${actType} ${title} ${item.normalizedText}`);
    if (isFinalAct && (context.finalAct?.numeroAtto !== number || context.stato !== "CONCLUSO")) {
      const before = {
        stato: context.stato,
        dataProvvedimentoFinale: context.dataProvvedimentoFinale,
        finalAct: context.finalAct,
      };
      candidates.push(buildCandidate({
        ...input,
        knowledgeRevisionId: input.report.knowledgeRevisionId,
        proposalType: "NOTE",
        title: `Riconciliare la fase conclusiva${number ? ` — atto ${number}` : ""}`,
        description: "La documentazione indica un possibile provvedimento conclusivo non allineato ai metadati autoritativi del procedimento.",
        proposedPayload: {
          reconciliationType: "PROCEDIMENTO_FINAL_ACT",
          targetEntity: "PROCEDIMENTO",
          targetId: input.procedimentoId,
          before,
          after: {
            stato: "CONCLUSO",
            dataProvvedimentoFinale: date,
            finalAct: { numeroAtto: number, dataAtto: date, title },
          },
          evidence,
          integrityChecks: [
            "TENANT_MATCH",
            "FINAL_ACT_DOCUMENT_AVAILABLE",
            "FINAL_DATE_NOT_BEFORE_PROCEDURE_START",
            "NO_CONFLICTING_CURRENT_FINAL_ACT",
          ],
          rollback: { strategy: "RESTORE_AUTHORITATIVE_SNAPSHOT", value: before },
          previewOnly: true,
        },
        originatingKnowledgeItemIds: [item.id],
        originatingIssueSemanticKeys: issueKeysForItem(input.report, item.id),
        rationale: "Proposta documentale in sola anteprima; stato e provvedimento finale restano invariati fino all'approvazione esplicita.",
        confidence: item.confidence,
        warningCodes: ["MANUAL_ACTION_REQUIRED", "AUTHORITATIVE_DATA_CHANGE_PREVIEW"],
      }));
    }
    return candidates;
  });
}

function technicalSourceCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  const sources = input.report.technicalSources ?? [];
  if (sources.length === 0) return [];
  const questions = new Map<string, { question: StructuredReportQuestion; issueSemanticKey: string | null }>();
  for (const issue of input.report.legalIssues) {
    for (const question of issue.questions) questions.set(question.semanticKey, { question, issueSemanticKey: issue.semanticKey });
  }
  for (const question of input.report.unassignedQuestions) {
    if (!questions.has(question.semanticKey)) questions.set(question.semanticKey, { question, issueSemanticKey: null });
  }
  const byQuestion = new Map<string, typeof sources[number][]>();
  for (const source of sources) {
    byQuestion.set(source.questionSemanticKey, [...(byQuestion.get(source.questionSemanticKey) ?? []), source]);
  }
  return [...byQuestion.entries()].flatMap(([questionSemanticKey, questionSources]) => {
    const owner = questions.get(questionSemanticKey);
    if (!owner) return [];
    const recordIds = unique(questionSources.map((source) => source.recordId));
    const statuses = unique(questionSources.map((source) => source.verificationStatus));
    return [buildCandidate({
      ...input,
      knowledgeRevisionId: input.report.knowledgeRevisionId,
      proposalType: "CRITICALITY",
      title: `Verifica tecnico-urbanistica da completare: ${owner.question.text}`,
      description: "Acquisizioni tecniche MCP non probatorie: verificare su fonte originale prima di ogni conclusione su vincoli o conformità.",
      proposedPayload: {
        severity: "MEDIA",
        category: "TECNICA",
        description: owner.question.text,
        rationale: `TECHNICAL_SOURCES_NOT_PROBATIVE:${statuses.join(",")}`,
        technicalSourceRecordIds: recordIds,
        blockingEffect: "PROFESSIONAL_REVIEW_REQUIRED",
      },
      originatingKnowledgeItemIds: [owner.question.knowledgeItemId],
      originatingIssueSemanticKeys: owner.issueSemanticKey ? [owner.issueSemanticKey] : [],
      originatingQuestionSemanticKeys: [questionSemanticKey],
      rationale: "Fonti tecnico-urbanistiche acquisite ma non verificate: richiedono riscontro sulla fonte originale.",
      warningCodes: ["PROFESSIONAL_REVIEW_REQUIRED", "TECHNICAL_SOURCE_NOT_PROBATIVE"],
    })];
  });
}

export interface GenerationInput {
  tenantId: string;
  procedimentoId: string;
  structuredReportId: string | null;
  structuredReportFingerprint: string;
  report: StructuredFascicoloReportPayload;
}

export function generateOperationalProposalCandidates(input: GenerationInput): readonly OperationalProposalCandidate[] {
  if (input.tenantId !== input.report.tenantId || input.procedimentoId !== input.report.procedimentoId) {
    throw new Error("OPERATIONAL_PROPOSAL_SCOPE_MISMATCH");
  }
  return [
    ...deadlineCandidates(input),
    ...documentRequirementCandidates(input),
    ...contradictionCandidates(input),
    ...sourceGapCandidates(input),
    ...activityCandidates(input),
    ...metadataReconciliationCandidates(input),
    ...technicalSourceCandidates(input),
  ].sort((left, right) => left.proposalFingerprint.localeCompare(right.proposalFingerprint));
}