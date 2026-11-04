import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

import type { JsonValue } from "./contracts";
import { getCurrentKnowledgeRevision, type KnowledgeRevisionSnapshot } from "./repository";
import {
  buildKnowledgeResearchMissionPlans,
  type KnowledgeReferenceDateConfirmation,
} from "./researchMissionPlanning";

export const REFERENCE_DATE_CONFIRMATION_ACTION = "FASCICOLO_REFERENCE_DATE_CONFIRM";
export const REFERENCE_DATE_CONFIRMATION_ENTITY = "FascicoloResearchQuestion";
export const REFERENCE_DATE_CONFIRMATION_SOURCE_VERSION = "REFERENCE_DATE_CONFIRMATION_V1";

const SEMANTIC_KEY_PATTERN = /^[a-f0-9]{64}$/;

export class ReferenceDateConfirmationError extends Error {
  constructor(readonly code:
    | "INVALID_REFERENCE_DATE"
    | "INVALID_RESEARCH_QUESTION"
    | "INVALID_CONFIRMATION_RATIONALE"
    | "CURRENT_KNOWLEDGE_NOT_FOUND"
    | "REFERENCE_DATE_REVIEW_NOT_REQUIRED") {
    super(code);
    this.name = "ReferenceDateConfirmationError";
  }
}

export function parseConfirmedReferenceDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new ReferenceDateConfirmationError("INVALID_REFERENCE_DATE");
  }
  const normalized = value.trim();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  const year = Number(normalized.slice(0, 4));
  if (Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized
    || year < 1900
    || year > 2100) {
    throw new ReferenceDateConfirmationError("INVALID_REFERENCE_DATE");
  }
  return normalized;
}

export interface ReferenceDateDocumentaryHint {
  semanticKey: string;
  kind: string;
  date: string;
  originalText: string | null;
}

export interface ReferenceDateReviewQuestion {
  questionSemanticKey: string;
  question: string;
  documentaryHints: readonly ReferenceDateDocumentaryHint[];
}

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Questions whose evidence does not establish a valid legal reference date. */
export function listReferenceDateReviewQuestions(
  revision: KnowledgeRevisionSnapshot,
): readonly ReferenceDateReviewQuestion[] {
  const blocked = buildKnowledgeResearchMissionPlans(revision, {
    maxQuestionsPerWave: Number.MAX_SAFE_INTEGER,
  }).filter((plan) => plan.blockReason === "REFERENCE_DATE_REVIEW_REQUIRED");
  const itemById = new Map(revision.items.map((item) => [item.id, item]));
  const datedKinds = new Set(["EVENT", "MEASURE", "LEGAL_ACT"]);
  return blocked.map((plan) => {
    const question = itemById.get(plan.questionItemId);
    const originating = new Set(plan.originatingItemIds);
    // Dates already present in the fascicolo are shown as suggestions; the user still chooses and confirms.
    const documentaryHints = [...revision.items]
      .filter((item) => datedKinds.has(item.kind))
      .sort((left, right) => Number(originating.has(right.id)) - Number(originating.has(left.id)))
      .flatMap((item) => {
        const date = object(object(item.structuredPayload).date);
        const from = text(date.from);
        if (date.precision !== "EXACT" || !from) return [];
        return [{
          semanticKey: item.semanticKey,
          kind: item.kind,
          date: from,
          originalText: text(date.originalText),
        }];
      });
    return {
      questionSemanticKey: plan.questionSemanticKey,
      question: text(object(question?.structuredPayload).canonicalQuestion) ?? question?.normalizedText ?? "",
      documentaryHints,
    };
  });
}

export async function loadReferenceDateConfirmations(input: {
  tenantId: string;
  procedimentoId: string;
}, client: Pick<typeof prisma, "activityLog"> = prisma): Promise<readonly KnowledgeReferenceDateConfirmation[]> {
  const records = await client.activityLog.findMany({
    where: {
      azione: REFERENCE_DATE_CONFIRMATION_ACTION,
      entita: REFERENCE_DATE_CONFIRMATION_ENTITY,
      enteId: input.tenantId,
      esito: "SUCCESS",
      entitaId: { startsWith: `${input.procedimentoId}:` },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
    select: { id: true, entitaId: true, metadata: true },
  });
  const latestByQuestion = new Map<string, KnowledgeReferenceDateConfirmation>();
  for (const record of records) {
    const metadata = object(record.metadata as JsonValue);
    const questionSemanticKey = text(metadata.questionSemanticKey);
    if (!questionSemanticKey
      || record.entitaId !== `${input.procedimentoId}:${questionSemanticKey}`
      || text(metadata.procedimentoId) !== input.procedimentoId
      || latestByQuestion.has(questionSemanticKey)) {
      continue;
    }
    let confirmedDate: string;
    try {
      confirmedDate = parseConfirmedReferenceDate(metadata.confirmedDate);
    } catch {
      continue;
    }
    latestByQuestion.set(questionSemanticKey, {
      questionSemanticKey,
      confirmedDate,
      sourceId: record.id,
      sourceVersion: REFERENCE_DATE_CONFIRMATION_SOURCE_VERSION,
    });
  }
  return [...latestByQuestion.values()];
}

export async function confirmKnowledgeReferenceDate(input: {
  tenantId: string;
  procedimentoId: string;
  questionSemanticKey: string;
  confirmedDate: string;
  rationale: string;
  actor: { userId: string; userEmail: string; userRole: string };
}): Promise<KnowledgeReferenceDateConfirmation & { knowledgeRevisionId: string }> {
  const questionSemanticKey = input.questionSemanticKey.trim();
  if (!SEMANTIC_KEY_PATTERN.test(questionSemanticKey)) {
    throw new ReferenceDateConfirmationError("INVALID_RESEARCH_QUESTION");
  }
  const confirmedDate = parseConfirmedReferenceDate(input.confirmedDate);
  const rationale = input.rationale.trim();
  if (rationale.length < 5 || rationale.length > 500) {
    throw new ReferenceDateConfirmationError("INVALID_CONFIRMATION_RATIONALE");
  }
  const revision = await getCurrentKnowledgeRevision({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  if (!revision || revision.status !== "CURRENT") {
    throw new ReferenceDateConfirmationError("CURRENT_KNOWLEDGE_NOT_FOUND");
  }
  const reviewQuestion = listReferenceDateReviewQuestions(revision)
    .find((question) => question.questionSemanticKey === questionSemanticKey);
  if (!reviewQuestion) {
    throw new ReferenceDateConfirmationError("REFERENCE_DATE_REVIEW_NOT_REQUIRED");
  }
  const matchingHint = reviewQuestion.documentaryHints.find((hint) => hint.date === confirmedDate);
  const metadata: Prisma.InputJsonValue = {
    procedimentoId: input.procedimentoId,
    knowledgeRevisionId: revision.id,
    questionSemanticKey,
    confirmedDate,
    rationale,
    sourceVersion: REFERENCE_DATE_CONFIRMATION_SOURCE_VERSION,
    matchingDocumentaryItemSemanticKey: matchingHint?.semanticKey ?? null,
    providerCalled: false,
  };
  const audit = await prisma.$transaction((tx) => createAuditLogInTransaction(tx, {
    azione: REFERENCE_DATE_CONFIRMATION_ACTION,
    entita: REFERENCE_DATE_CONFIRMATION_ENTITY,
    entitaId: `${input.procedimentoId}:${questionSemanticKey}`,
    enteId: input.tenantId,
    esito: "SUCCESS",
    actor: input.actor,
    metadata,
  }));
  return {
    questionSemanticKey,
    confirmedDate,
    sourceId: audit.id,
    sourceVersion: REFERENCE_DATE_CONFIRMATION_SOURCE_VERSION,
    knowledgeRevisionId: revision.id,
  };
}
