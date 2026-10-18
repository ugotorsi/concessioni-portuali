import type { FascicoloAnalysisQuestion } from "@/components/procedimenti/FascicoloAnalysis";

function mergeEvidence(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])])];
  return merged.length > 0 ? merged : undefined;
}

function mergeStatus(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null | undefined {
  if (!left || left === right) return right ?? left;
  if (!right) return left;
  return `${left} · ${right}`;
}

export function mergeFascicoloAnalysisQuestions(
  questions: readonly FascicoloAnalysisQuestion[],
): FascicoloAnalysisQuestion[] {
  const merged = new Map<string, FascicoloAnalysisQuestion>();
  for (const question of questions) {
    const key = question.semanticKey
      ? `semantic:${question.semanticKey}`
      : `id:${question.id}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, question);
      continue;
    }
    merged.set(key, {
      ...question,
      ...previous,
      description: previous.description ?? question.description,
      status: mergeStatus(previous.status, question.status),
      knowledgeStatus: previous.knowledgeStatus ?? question.knowledgeStatus,
      operationalStatuses: mergeEvidence(previous.operationalStatuses, question.operationalStatuses),
      area: previous.area ?? question.area,
      relevance: previous.relevance ?? question.relevance,
      href: previous.href ?? question.href,
      evidence: mergeEvidence(previous.evidence, question.evidence),
    });
  }
  return [...merged.values()];
}
