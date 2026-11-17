import type { FascicoloAnalysisModel } from "@/components/procedimenti/FascicoloAnalysis";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import type { JsonValue } from "@/server/fascicolo-knowledge";

import {
  loadCurrentStructuredKnowledge,
  type StructuredKnowledgeReadItem,
} from "./fascicolo-knowledge";

function record(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function evidenceLabels(item: StructuredKnowledgeReadItem): string[] {
  return item.evidence.map(
    (evidence) => `Documento ${evidence.documentoId}, pagina ${evidence.pageNumber}`,
  );
}

export async function getFascicoloAnalysisReadModel(
  procedimentoId: string,
): Promise<FascicoloAnalysisModel | null> {
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return null;
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { enteId: true },
  });
  if (!procedimento?.enteId) return null;
  try {
    requireTenantAccess(tenantContext, procedimento.enteId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  } catch {
    return null;
  }

  const knowledge = await loadCurrentStructuredKnowledge(
    procedimento.enteId,
    procedimentoId,
  );
  if (!knowledge) return null;

  const evidence = new Map<string, FascicoloAnalysisModel["evidence"][number]>();
  const allItems = [
    ...knowledge.partyRoles,
    ...(knowledge.partyPositions ?? []),
    ...knowledge.facts,
    ...knowledge.events,
    ...knowledge.legalActs,
    ...knowledge.measures,
    ...knowledge.contradictions,
    ...knowledge.gaps,
    ...knowledge.legalIssues,
    ...knowledge.researchQuestions,
  ];
  for (const item of allItems) {
    for (const itemEvidence of item.evidence) {
      const key = `${itemEvidence.documentoId}:${itemEvidence.pageNumber}`;
      evidence.set(key, {
        id: key,
        title: `Documento ${itemEvidence.documentoId}`,
        detail: `Pagina ${itemEvidence.pageNumber}`,
        href: `/documenti/${itemEvidence.documentoId}/download?preview=1`,
      });
    }
  }

  const questions = [
    ...knowledge.legalIssues.map((item) => {
      const payload = record(item.payload);
      return {
        id: item.id,
        semanticKey: item.semanticKey,
        title: text(payload.title) ?? item.normalizedText,
        description: text(payload.rationale),
        knowledgeStatus: "Questione giuridica",
        area: text(payload.areaOfLaw),
        relevance: text(payload.priority),
        evidence: evidenceLabels(item),
      };
    }),
    ...knowledge.researchQuestions.map((item) => {
      const payload = record(item.payload);
      return {
        id: item.id,
        semanticKey: item.semanticKey,
        title: text(payload.canonicalQuestion) ?? item.normalizedText,
        description: text(payload.rationale),
        knowledgeStatus: "Ricerca da pianificare",
        area: "Ricerca normativa e giurisprudenziale",
        relevance: text(payload.priority),
        evidence: evidenceLabels(item),
      };
    }),
  ];
  const relevantItems = [
    ...knowledge.subjects.map((subject) => ({
      id: subject.id,
      title: subject.canonicalName,
      detail: subject.subjectType,
    })),
    ...[
      ...knowledge.partyRoles,
      ...(knowledge.partyPositions ?? []),
      ...knowledge.facts,
      ...knowledge.timeline,
      ...knowledge.legalActs,
      ...knowledge.measures,
    ].map((item) => ({
      id: item.id,
      title: item.normalizedText,
      detail: item.kind,
      description: evidenceLabels(item).join("; ") || null,
    })),
  ];

  return {
    questions,
    evidence: [...evidence.values()],
    contradictions: knowledge.contradictions.map((item) => ({
      id: item.id,
      description: item.normalizedText,
      involved: item.contradictedItemIds,
      status: item.status,
    })),
    gaps: knowledge.gaps.map((item) => ({
      id: item.id,
      title: item.normalizedText,
      relevance: text(record(item.payload).relevance),
      requestedItem: text(record(item.payload).requestedItem),
      status: item.status,
    })),
    relevantItems,
    analysisStatus:
      `Revisione strutturata corrente del ${knowledge.revision.createdAt.toLocaleDateString("it-IT")}.`,
  };
}
