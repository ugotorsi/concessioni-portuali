import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, isTenantContextConstrained } from "@/lib/tenant-auth";
import {
  ORCHESTRATION_DISCLAIMER,
  type ApplicableGapResult,
  type ApplicableRuleResult,
  type EvaluatedSourceResult,
  type MissingSourceResult,
  type PotentialConflictResult,
  type RuleResolutionInput,
  type RuleResolutionResult,
  type SourceExclusionReason,
} from "@/server/legal-rules/types";

export class OrchestrationInputError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

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

export interface SourceLike {
  id: string;
  sourceKey: string;
  title: string;
  sourceType: string;
  status: string;
  role: string;
  legalRank: string;
  territorialScope: string;
  confidence: string;
  issuingBody: string | null;
  sourceNumber: string | null;
  sourceDate: Date | null;
  sourceOrigin: string | null;
  portAreaCode: string | null;
  tags: unknown;
  humanReviewRequired: boolean;
  isConformative: boolean;
  isExtractable: boolean;
  filePath: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  authorityId: string | null;
  authority: { code: string } | null;
  portId: string | null;
  port: { code: string; authorityId: string | null } | null;
}

export interface SourceEvaluationBuckets {
  applicableSources: EvaluatedSourceResult[];
  excludedByTerritory: EvaluatedSourceResult[];
  excludedByDate: EvaluatedSourceResult[];
  historicalSources: EvaluatedSourceResult[];
  supersededSources: EvaluatedSourceResult[];
  partiallySupersededSources: EvaluatedSourceResult[];
  pendingValiditySources: EvaluatedSourceResult[];
  draftOrOngoingSources: EvaluatedSourceResult[];
  caseSpecificSources: EvaluatedSourceResult[];
  missingSources: MissingSourceResult[];
  potentialConflicts: PotentialConflictResult[];
  reasoningTrace: string[];
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

function parseReferenceDate(referenceDate: string | undefined): Date {
  if (!referenceDate) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  const parsed = new Date(referenceDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new OrchestrationInputError("referenceDate must be a valid ISO date.", 400);
  }

  return parsed;
}

function sanitizeRelativePath(pathValue: string | null): string | null {
  if (!pathValue) {
    return null;
  }

  const normalized = pathValue.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes(":/")) {
    return null;
  }

  return normalized;
}

function toEvaluatedSource(source: SourceLike, exclusionReasons: SourceExclusionReason[]): EvaluatedSourceResult {
  return {
    id: source.id,
    stableKey: source.sourceKey,
    title: source.title,
    documentType: source.sourceType,
    legalRank: source.legalRank,
    territorialScope: source.territorialScope,
    sourceNumber: source.sourceNumber,
    sourceDate: source.sourceDate ? source.sourceDate.toISOString() : null,
    issuingBody: source.issuingBody,
    status: source.status,
    role: source.role,
    confidence: ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"].includes(source.confidence)
      ? (source.confidence as EvaluatedSourceResult["confidence"])
      : "LOW",
    humanReviewRequired: true,
    isConformative: source.isConformative,
    isExtractable: source.isExtractable,
    relativePath: sanitizeRelativePath(source.filePath),
    effectiveFrom: source.effectiveFrom ? source.effectiveFrom.toISOString() : null,
    effectiveTo: source.effectiveTo ? source.effectiveTo.toISOString() : null,
    applicable: exclusionReasons.length === 0,
    exclusionReasons,
  };
}

export function evaluateSources(input: RuleResolutionInput, sources: SourceLike[], referenceDate: Date): SourceEvaluationBuckets {
  const applicableSources: EvaluatedSourceResult[] = [];
  const excludedByTerritory: EvaluatedSourceResult[] = [];
  const excludedByDate: EvaluatedSourceResult[] = [];
  const historicalSources: EvaluatedSourceResult[] = [];
  const supersededSources: EvaluatedSourceResult[] = [];
  const partiallySupersededSources: EvaluatedSourceResult[] = [];
  const pendingValiditySources: EvaluatedSourceResult[] = [];
  const draftOrOngoingSources: EvaluatedSourceResult[] = [];
  const caseSpecificSources: EvaluatedSourceResult[] = [];
  const missingSources: MissingSourceResult[] = [];
  const potentialConflicts: PotentialConflictResult[] = [];
  const reasoningTrace: string[] = [];

  for (const source of sources) {
    const exclusionReasons: SourceExclusionReason[] = [];

    const matchesAuthority = !input.authorityKey
      || source.territorialScope === "NATIONAL"
      || source.authority?.code === input.authorityKey;

    if (!matchesAuthority && source.territorialScope !== "NATIONAL") {
      exclusionReasons.push("AUTHORITY_MISMATCH");
    }

    if (input.portKey && source.territorialScope !== "NATIONAL") {
      const sourcePortCode = source.port?.code;
      if (source.territorialScope === "PORT" || source.territorialScope === "PORT_AREA") {
        if (!sourcePortCode || sourcePortCode !== input.portKey) {
          exclusionReasons.push("PORT_MISMATCH");
        }
      }
    }

    if (source.territorialScope === "PORT_AREA" && source.portAreaCode && input.portArea && source.portAreaCode !== input.portArea) {
      exclusionReasons.push("PORT_AREA_MISMATCH");
      missingSources.push({
        code: `PORT_AREA_${source.portAreaCode}`,
        message: `Manca copertura esplicita per area portuale ${input.portArea}.`,
        humanReviewRequired: true,
      });
    }

    if (source.effectiveFrom && source.effectiveFrom > referenceDate) {
      exclusionReasons.push("EFFECTIVE_FROM_FUTURE");
    }
    if (source.effectiveTo && source.effectiveTo < referenceDate) {
      exclusionReasons.push("EFFECTIVE_TO_EXPIRED");
    }

    if (!source.isConformative) {
      exclusionReasons.push("NOT_CONFORMATIVE_SUPPORT");
    }

    const tags = Array.isArray(source.tags)
      ? source.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toUpperCase())
      : [];

    if (tags.includes("POT")) {
      potentialConflicts.push({
        code: "POT_NOT_EQUIVALENT_TO_PRP",
        message: `La fonte ${source.sourceKey} e programmatoria e non sostituisce il PRP.`,
        sourceStableKeys: [source.sourceKey],
      });
    }

    if (tags.includes("DPSS")) {
      potentialConflicts.push({
        code: "DPSS_NOT_EQUIVALENT_TO_PRP",
        message: `La fonte ${source.sourceKey} e strategica e non sostituisce il PRP analitico.`,
        sourceStableKeys: [source.sourceKey],
      });
    }

    if (tags.includes("DEASP")) {
      potentialConflicts.push({
        code: "DEASP_NOT_URBAN_CONFORMATIVE",
        message: `La fonte ${source.sourceKey} ha ruolo energetico-ambientale e non sostituisce il PRP.`,
        sourceStableKeys: [source.sourceKey],
      });
    }

    if (source.role === "SUPPORTING_MAP") {
      potentialConflicts.push({
        code: "MAP_SUPPORT_NOT_AUTONOMOUS",
        message: `Il supporto cartografico ${source.sourceKey} non e fonte conformativa autonoma.`,
        sourceStableKeys: [source.sourceKey],
      });
    }

    if (source.status === "HISTORICAL") {
      exclusionReasons.push("STATUS_HISTORICAL");
    }
    if (source.status === "SUPERSEDED") {
      exclusionReasons.push("STATUS_SUPERSEDED");
    }
    if (source.status === "PARTIALLY_SUPERSEDED") {
      exclusionReasons.push("STATUS_PARTIALLY_SUPERSEDED");
      potentialConflicts.push({
        code: "PARTIAL_SUPERSESSION",
        message: `Fonte ${source.sourceKey} parzialmente superata: richiede coordinamento professionale.`,
        sourceStableKeys: [source.sourceKey],
      });
    }
    if (source.status === "PENDING_VALIDITY_CHECK") {
      exclusionReasons.push("STATUS_PENDING_VALIDITY");
    }
    if (source.status === "DRAFT_OR_ONGOING_PROCEDURE") {
      exclusionReasons.push("STATUS_DRAFT_OR_ONGOING");
    }
    if (source.status === "CASE_SPECIFIC") {
      exclusionReasons.push("STATUS_CASE_SPECIFIC");
    }
    if (source.status === "MISSING_SOURCE") {
      exclusionReasons.push("STATUS_MISSING_SOURCE");
      missingSources.push({
        code: source.sourceKey,
        message: `Fonte segnalata come mancante: ${source.title}`,
        humanReviewRequired: true,
      });
    }

    const evaluated = toEvaluatedSource(source, exclusionReasons);

    if (exclusionReasons.length === 0 && source.status === "CURRENT") {
      applicableSources.push(evaluated);
    } else if (exclusionReasons.length === 0 && source.status === "CURRENT_SUBJECT_TO_REVIEW") {
      if (input.includePending) {
        applicableSources.push(evaluated);
      } else {
        exclusionReasons.push("NOT_CURRENT");
        pendingValiditySources.push(toEvaluatedSource(source, exclusionReasons));
      }
    }

    if (source.status === "HISTORICAL") {
      historicalSources.push(evaluated);
    }
    if (source.status === "SUPERSEDED") {
      supersededSources.push(evaluated);
    }
    if (source.status === "PARTIALLY_SUPERSEDED") {
      partiallySupersededSources.push(evaluated);
    }
    if (source.status === "PENDING_VALIDITY_CHECK" || source.status === "CURRENT_SUBJECT_TO_REVIEW") {
      pendingValiditySources.push(evaluated);
    }
    if (source.status === "DRAFT_OR_ONGOING_PROCEDURE") {
      draftOrOngoingSources.push(evaluated);
    }
    if (source.status === "CASE_SPECIFIC") {
      caseSpecificSources.push(evaluated);
    }

    if (exclusionReasons.some((reason) => ["AUTHORITY_MISMATCH", "PORT_MISMATCH", "PORT_AREA_MISMATCH"].includes(reason))) {
      excludedByTerritory.push(evaluated);
    }
    if (exclusionReasons.some((reason) => ["EFFECTIVE_FROM_FUTURE", "EFFECTIVE_TO_EXPIRED"].includes(reason))) {
      excludedByDate.push(evaluated);
    }
  }

  const hasPrpLikeSource = sources.some((source) => {
    const tags = Array.isArray(source.tags) ? source.tags : [];
    const normalized = tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toUpperCase());
    return normalized.includes("PRP") || normalized.includes("NTA") || normalized.includes("ATF");
  });

  if ((input.domain || input.titleType || input.procedureType) && !hasPrpLikeSource) {
    missingSources.push({
      code: "MISSING_PRP_NTA_ATF",
      message: "Fonti essenziali PRP/NTA/ATF non presenti nel corpus selezionato.",
      humanReviewRequired: true,
    });
  }

  reasoningTrace.push(`referenceDate=${referenceDate.toISOString().slice(0, 10)}`);
  reasoningTrace.push(`sourcesEvaluated=${sources.length}`);
  reasoningTrace.push(`applicableSources=${applicableSources.length}`);
  reasoningTrace.push(`excludedByTerritory=${excludedByTerritory.length}`);
  reasoningTrace.push(`excludedByDate=${excludedByDate.length}`);
  reasoningTrace.push(`historical=${historicalSources.length}`);
  reasoningTrace.push(`pending=${pendingValiditySources.length}`);
  reasoningTrace.push(`conflicts=${potentialConflicts.length}`);
  reasoningTrace.push(`missingSources=${missingSources.length}`);

  return {
    applicableSources,
    excludedByTerritory,
    excludedByDate,
    historicalSources,
    supersededSources,
    partiallySupersededSources,
    pendingValiditySources,
    draftOrOngoingSources,
    caseSpecificSources,
    missingSources,
    potentialConflicts,
    reasoningTrace,
  };
}

export function resolveOverallConfidence(input: RuleResolutionInput, buckets: SourceEvaluationBuckets): RuleResolutionResult["overallConfidence"] {
  if (buckets.missingSources.length > 0) {
    return "INSUFFICIENT";
  }

  if (buckets.pendingValiditySources.length > 0 || buckets.potentialConflicts.length > 0 || buckets.partiallySupersededSources.length > 0) {
    return "MEDIUM";
  }

  if (!input.referenceDate || !input.authorityKey || buckets.applicableSources.length === 0) {
    return "LOW";
  }

  if (buckets.excludedByDate.length === 0 && buckets.excludedByTerritory.length === 0) {
    return "HIGH";
  }

  return "LOW";
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

function buildTenantSourceWhere(
  tenantContext: Awaited<ReturnType<typeof getCurrentTenantContext>>,
): Prisma.LegalSourceWhereInput {
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
  const tenantSourceWhere = buildTenantSourceWhere(tenantContext);
  const referenceDate = parseReferenceDate(input.referenceDate);

  if (input.portKey && !input.authorityKey) {
    throw new OrchestrationInputError("authorityKey is required when portKey is provided.", 400);
  }

  if (input.portKey) {
    const requestedPort = await prisma.port.findUnique({
      where: { code: input.portKey },
      select: {
        id: true,
        authority: {
          select: {
            code: true,
          },
        },
      },
    });

    if (!requestedPort) {
      throw new OrchestrationInputError("Requested port not found.", 404);
    }

    if (input.authorityKey && requestedPort.authority?.code !== input.authorityKey) {
      throw new OrchestrationInputError("portKey does not belong to authorityKey.", 400);
    }
  }

  const andConditions: Prisma.LegalRuleWhereInput[] = [{ status: "ATTIVA" }];

  if (Object.keys(tenantWhere).length > 0) {
    andConditions.push(tenantWhere);
  }

  if (input.enteId) {
    andConditions.push({ OR: [{ enteId: input.enteId }, { enteId: null }] });
  }

  if (input.portKey) {
    andConditions.push({
      port: {
        is: {
          code: input.portKey,
        },
      },
    });
  }

  if (input.authorityKey) {
    andConditions.push({
      source: {
        is: {
          OR: [{ territorialScope: "NATIONAL" as never }, { authority: { is: { code: input.authorityKey } } }],
        },
      },
    });
  }

  const sourceWhere: Prisma.LegalSourceWhereInput[] = [];
  if (Object.keys(tenantSourceWhere).length > 0) {
    sourceWhere.push(tenantSourceWhere);
  }
  if (input.enteId) {
    sourceWhere.push({ OR: [{ enteId: input.enteId }, { enteId: null }] });
  }
  if (input.authorityKey) {
    sourceWhere.push({ OR: [{ territorialScope: "NATIONAL" as never }, { authority: { is: { code: input.authorityKey } } }] });
  }

  const legalSources = await prisma.legalSource.findMany({
    where: sourceWhere.length > 0 ? { AND: sourceWhere } : {},
    select: {
      id: true,
      sourceKey: true,
      title: true,
      sourceType: true,
      status: true,
      role: true,
      legalRank: true,
      territorialScope: true,
      confidence: true,
      issuingBody: true,
      sourceNumber: true,
      sourceDate: true,
      sourceOrigin: true,
      portAreaCode: true,
      tags: true,
      humanReviewRequired: true,
      isConformative: true,
      isExtractable: true,
      filePath: true,
      effectiveFrom: true,
      effectiveTo: true,
      authorityId: true,
      portId: true,
      authority: {
        select: { code: true },
      },
      port: {
        select: { code: true, authorityId: true },
      },
    },
  });

  const buckets = evaluateSources(input, legalSources, referenceDate);
  const applicableSourceIds = new Set(buckets.applicableSources.map((source) => source.id));

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
    if (!applicableSourceIds.has(rule.source.id)) {
      continue;
    }

    const evaluation = evaluateRuleMatch(rule, input);
    if (!evaluation.applicable) {
      continue;
    }

    matchedRules.push({
      id: rule.id,
      ruleId: rule.ruleCode,
      title: rule.title,
      summary: rule.summary,
      category: rule.category,
      priority: rule.priority,
      outputSeverity: rule.outputSeverity,
      outcomeTitle: rule.outcomeTitle,
      outcomeSummary: rule.outcomeSummary,
      source: {
        id: rule.source.id,
        stableKey: rule.source.sourceKey,
        title: rule.source.title,
        documentType: rule.source.sourceType,
        relativePath: sanitizeRelativePath(rule.source.filePath),
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

  const knownGaps: ApplicableGapResult[] = gaps.map((gap) => ({
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

  for (const missing of buckets.missingSources) {
    knownGaps.push({
      id: `synthetic-${missing.code}`,
      gapKey: missing.code,
      title: "Gap fonti essenziali",
      description: missing.message,
      severity: "ALTA",
      status: "APERTA",
      requiredDocumentTypes: [],
      linkedRuleCode: null,
      humanReviewRequired: true,
    });
  }

  const overallConfidence = resolveOverallConfidence(input, buckets);

  return {
    applicableSources: buckets.applicableSources,
    applicableRules: matchedRules,
    excludedByTerritory: buckets.excludedByTerritory,
    excludedByDate: buckets.excludedByDate,
    historicalSources: input.includeHistorical ? buckets.historicalSources : [],
    supersededSources: buckets.supersededSources,
    partiallySupersededSources: buckets.partiallySupersededSources,
    pendingValiditySources: input.includePending ? buckets.pendingValiditySources : buckets.pendingValiditySources,
    draftOrOngoingSources: buckets.draftOrOngoingSources,
    caseSpecificSources: buckets.caseSpecificSources,
    potentialConflicts: buckets.potentialConflicts,
    missingSources: buckets.missingSources,
    knownGaps,
    reasoningTrace: buckets.reasoningTrace,
    overallConfidence,
    disclaimer: ORCHESTRATION_DISCLAIMER,
    humanReviewRequired: true,
    professionalReviewBadge: "Verifica professionale richiesta",
    evaluatedAt: new Date().toISOString(),
    totalRulesEvaluated: rules.length,
  };
}
