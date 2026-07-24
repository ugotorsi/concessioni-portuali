import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, isTenantContextConstrained } from "@/lib/tenant-auth";
import {
  ORCHESTRATION_DISCLAIMER,
  type ApplicableGapResult,
  type ApplicableRuleResult,
  type RuleResolutionInput,
  type RuleResolutionResult,
} from "@/server/legal-rules/types";

interface RuleLike {
  id: string;
  ruleCode: string;
  title: string;
  summary: string;
  category: string;
  priority: number;
  outputSeverity: string;
  outcomeTitle: string;
  outcomeSummary: string;
  disclaimer: string | null;
  humanReviewRequired: boolean;
  matchConcessionVertical: string | null;
  matchObjectType: string | null;
  matchAttivita: string | null;
  matchAwardingProcedure: string | null;
  matchFeeRegime: string | null;
  matchComparativeStatus: string | null;
  requiresRilevanzaArt47: boolean | null;
  matchArt47Letter: string | null;
  requiresMorosita: boolean | null;
  requiresPolizzaValida: boolean | null;
  source: {
    id: string;
    sourceKey: string;
    title: string;
    sourceType: string;
    filePath: string | null;
  };
}

export function evaluateRuleMatch(rule: RuleLike, input: RuleResolutionInput): { applicable: boolean; matchedCriteria: string[] } {
  const matchedCriteria: string[] = [];

  const checks: Array<{ expected: string | null; actual: string | undefined; label: string }> = [
    { expected: rule.matchConcessionVertical, actual: input.concessionVertical, label: "concessionVertical" },
    { expected: rule.matchObjectType, actual: input.concessionObjectType, label: "concessionObjectType" },
    { expected: rule.matchAttivita, actual: input.attivita, label: "attivita" },
    { expected: rule.matchAwardingProcedure, actual: input.awardingProcedureType, label: "awardingProcedureType" },
    { expected: rule.matchFeeRegime, actual: input.feeRegime, label: "feeRegime" },
    { expected: rule.matchComparativeStatus, actual: input.comparativeProcedureStatus, label: "comparativeProcedureStatus" },
    { expected: rule.matchArt47Letter, actual: input.letteraArt47, label: "letteraArt47" },
  ];

  for (const check of checks) {
    if (!check.expected) {
      continue;
    }

    if (!check.actual || check.actual !== check.expected) {
      return { applicable: false, matchedCriteria: [] };
    }

    matchedCriteria.push(`${check.label}=${check.actual}`);
  }

  const booleanChecks: Array<{
    expected: boolean | null;
    actual: boolean | undefined;
    label: string;
  }> = [
    { expected: rule.requiresRilevanzaArt47, actual: input.rilevanzaArt47, label: "rilevanzaArt47" },
    { expected: rule.requiresMorosita, actual: input.hasMorosita, label: "hasMorosita" },
    { expected: rule.requiresPolizzaValida, actual: input.polizzaValida, label: "polizzaValida" },
  ];

  for (const check of booleanChecks) {
    if (check.expected === null) {
      continue;
    }

    if (typeof check.actual !== "boolean" || check.actual !== check.expected) {
      return { applicable: false, matchedCriteria: [] };
    }

    matchedCriteria.push(`${check.label}=${String(check.actual)}`);
  }

  return {
    applicable: true,
    matchedCriteria,
  };
}

function buildTenantWhere(
  tenantContext: Awaited<ReturnType<typeof getCurrentTenantContext>>,
): Prisma.LegalRuleWhereInput {
  if (!tenantContext || !isTenantContextConstrained(tenantContext)) {
    return {};
  }

  if (tenantContext.accessibleTenantIds.length === 0) {
    return { enteId: null };
  }

  return {
    OR: [{ enteId: { in: tenantContext.accessibleTenantIds } }, { enteId: null }],
  };
}

export async function resolveApplicableLegalRules(input: RuleResolutionInput): Promise<RuleResolutionResult> {
  const tenantContext = await getCurrentTenantContext();
  const tenantWhere = buildTenantWhere(tenantContext);

  const andConditions: Prisma.LegalRuleWhereInput[] = [{ status: "ATTIVA" }];

  if (Object.keys(tenantWhere).length > 0) {
    andConditions.push(tenantWhere);
  }

  if (input.enteId) {
    andConditions.push({ OR: [{ enteId: input.enteId }, { enteId: null }] });
  }

  if (input.portCode) {
    andConditions.push({
      port: {
        is: {
          code: input.portCode,
        },
      },
    });
  }

  const rules = await prisma.legalRule.findMany({
    where: {
      AND: andConditions,
    },
    select: {
      id: true,
      ruleCode: true,
      title: true,
      summary: true,
      category: true,
      priority: true,
      outputSeverity: true,
      outcomeTitle: true,
      outcomeSummary: true,
      disclaimer: true,
      humanReviewRequired: true,
      matchConcessionVertical: true,
      matchObjectType: true,
      matchAttivita: true,
      matchAwardingProcedure: true,
      matchFeeRegime: true,
      matchComparativeStatus: true,
      requiresRilevanzaArt47: true,
      matchArt47Letter: true,
      requiresMorosita: true,
      requiresPolizzaValida: true,
      source: {
        select: {
          id: true,
          sourceKey: true,
          title: true,
          sourceType: true,
          filePath: true,
        },
      },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  const matchedRules: ApplicableRuleResult[] = [];

  for (const rule of rules) {
    const evaluation = evaluateRuleMatch(rule, input);
    if (!evaluation.applicable) {
      continue;
    }

    matchedRules.push({
      id: rule.id,
      ruleCode: rule.ruleCode,
      title: rule.title,
      summary: rule.summary,
      category: rule.category,
      priority: rule.priority,
      outputSeverity: rule.outputSeverity,
      outcomeTitle: rule.outcomeTitle,
      outcomeSummary: rule.outcomeSummary,
      source: {
        id: rule.source.id,
        sourceKey: rule.source.sourceKey,
        title: rule.source.title,
        sourceType: rule.source.sourceType,
        filePath: rule.source.filePath,
      },
      matchedCriteria: evaluation.matchedCriteria,
      disclaimer: rule.disclaimer ?? ORCHESTRATION_DISCLAIMER,
      humanReviewRequired: true,
    });
  }

  const matchedRuleIds = matchedRules.map((rule) => rule.id);

  const gaps = matchedRuleIds.length
    ? await prisma.documentGap.findMany({
        where: {
          ruleId: { in: matchedRuleIds },
          status: { in: ["APERTA", "IN_GESTIONE"] },
        },
        select: {
          id: true,
          gapKey: true,
          title: true,
          description: true,
          severity: true,
          status: true,
          requiredDocumentTypes: true,
          humanReviewRequired: true,
          rule: {
            select: {
              ruleCode: true,
            },
          },
        },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      })
    : [];

  const relatedDocumentGaps: ApplicableGapResult[] = gaps.map((gap) => ({
    id: gap.id,
    gapKey: gap.gapKey,
    title: gap.title,
    description: gap.description,
    severity: gap.severity,
    status: gap.status,
    requiredDocumentTypes: Array.isArray(gap.requiredDocumentTypes)
      ? gap.requiredDocumentTypes.filter((item): item is string => typeof item === "string")
      : [],
    linkedRuleCode: gap.rule?.ruleCode ?? null,
    humanReviewRequired: true,
  }));

  return {
    disclaimer: ORCHESTRATION_DISCLAIMER,
    humanReviewRequired: true,
    evaluatedAt: new Date().toISOString(),
    totalRulesEvaluated: rules.length,
    matchedRules,
    relatedDocumentGaps,
  };
}
