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

function documentRequirementCandidates(input: GenerationInput): OperationalProposalCandidate[] {
  return input.report.gaps.flatMap((item) => {
    const payload = record(item.payload);
    const gapType = text(payload.gapType) ?? "UNSPECIFIED_GAP";
    if (!gapType.includes("DOCUMENT") && !gapType.includes("EVIDENCE")) return [];
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
  });
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
  return (input.report.operationalPlans ?? []).flatMap((plan) => plan.steps.map((step, index) => buildCandidate({
    ...input,
    knowledgeRevisionId: input.report.knowledgeRevisionId,
    proposalType: "ACTIVITY",
    title: step.title,
    description: step.action,
    proposedPayload: {
      state: "PROPOSED",
      classification: "PROFESSIONAL_RECOMMENDATION",
      priority: index === 0 ? "HIGH" : "MEDIUM",
      responsibleOffice: step.office,
      dueDate: null,
      dependencies: index === 0 ? [] : [plan.steps[index - 1].title],
      requiredDocuments: [...step.requiredDocuments],
      completionCriterion: step.completionGate,
      expectedResult: step.completionGate,
      draft: step.draftTemplate ? {
        title: step.draftTitle ?? "Atto operativo",
        template: step.draftTemplate,
        approvalRequired: true,
      } : null,
    },
    originatingKnowledgeItemIds: input.report.legalIssues
      .find((issue) => issue.semanticKey === plan.issueSemanticKey)?.originatingItemIds ?? [],
    originatingIssueSemanticKeys: [plan.issueSemanticKey],
    rationale: "Attività derivata dal percorso operativo phase-aware del rapporto strutturato corrente.",
    warningCodes: ["MANUAL_ACTION_REQUIRED", "PROFESSIONAL_REVIEW_REQUIRED"],
  })));
}

function exactDate(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  const candidate = record(value);
  return text(candidate.precision) === "EXACT" ? text(candidate.from) : null;
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
    const evidence = item.evidence.map((entry) => ({ ...entry }));
    const candidates: OperationalProposalCandidate[] = [];
    const isConcession = /concession|titolo demanial|atto demanial/i.test(`${actType} ${title}`);
    if (isConcession && number && context.concessione?.numeroAtto !== number) {
      const before = context.concessione;
      candidates.push(buildCandidate({
        ...input,
        knowledgeRevisionId: input.report.knowledgeRevisionId,
        proposalType: "NOTE",
        title: `Riconciliare il titolo amministrativo ${number}`,
        description: "Il titolo documentato non coincide con la relazione Concessione attualmente rappresentata nel fascicolo.",
        proposedPayload: {
          reconciliationType: "CONCESSIONE_LINK_OR_CREATE",
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
        warningCodes: ["MANUAL_ACTION_REQUIRED", "AUTHORITATIVE_DATA_CHANGE_PREVIEW"],
      }));
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
  ].sort((left, right) => left.proposalFingerprint.localeCompare(right.proposalFingerprint));
}