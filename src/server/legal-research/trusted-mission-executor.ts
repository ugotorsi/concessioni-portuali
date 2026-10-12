import { createHash, randomUUID } from "node:crypto";

import {
  RESEARCH_BRIDGE_VERSION,
  assessResearchBudget,
  createAuthorityCandidate,
  validateResearchEvidenceBundle,
  validateResearchMission,
  type AuthorityCandidate,
  type ResearchCapability,
  type ResearchEvidenceBundle,
  type ResearchGap,
  type ResearchMission,
  type ResearchSourceFamily,
  type ResearchToolExecution,
} from "@/server/legal-research/bridge";
import { discoverItalianLegalReferences } from "@/server/intake/legal-reference-discovery/parser";
import {
  createLegalDataHunterProvider,
  LegalDataHunterProviderError,
} from "@/server/intake/official-source-lookup/legalDataHunter";
import type {
  OfficialLegalReference,
  OfficialLegalReferenceCaseLawHit,
  OfficialLegalReferenceProvider,
} from "@/server/intake/official-source-lookup/providers";
import type { TrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";
import type { AssistedVerificationResult } from "@/server/legal-research/assisted-verification";
import { verifyResearchEvidence } from "@/server/legal-research/assisted-verification";
import {
  ProviderResearchAdapterError,
  providerRequestSourceFamilies,
  type ResearchProviderAdapter,
  type ProviderToolRequest,
} from "@/server/legal-research/provider-research-adapters";

const LEGAL_DATA_HUNTER_TOOL_ID = "LEGAL_DATA_HUNTER";
const EXECUTOR_NATIVE_CAPABILITIES = new Set<ResearchCapability>(["KEYWORD_DISCOVERY"]);
const DEFAULT_LEASE_DURATION_MS = 15 * 60_000;
const DEFAULT_MINIMUM_LEASE_REMAINING_MS = 5_000;

type LegalDataHunterTransport = NonNullable<
  NonNullable<Parameters<typeof createLegalDataHunterProvider>[0]>["transport"]
>;
type LegalDataHunterFactory = typeof createLegalDataHunterProvider;

type PlannedReference = Readonly<{
  authorityReferenceId: string;
  citation: string;
  reference: OfficialLegalReference;
  sourceFamily: ResearchSourceFamily;
}>;

export type TrustedMissionExecutorResult = Readonly<{
  status: "BLOCKED" | "LEASE_EXPIRED" | "COMPLETED" | "BUDGET_EXHAUSTED" | "DEFERRED" | "RECOVERY_REQUIRED";
  missionId: string;
  executionId?: string;
  bundleId?: string;
  callsConsumed: number;
  blockerCodes: readonly string[];
}>;

export type TrustedMissionExecutorOptions = Readonly<{
  client: TrustedResearchHttpClient;
  legalDataHunterApiKey?: string | null;
  legalDataHunterTransport?: LegalDataHunterTransport;
  legalDataHunterFactory?: LegalDataHunterFactory;
  providerAdapters?: readonly ResearchProviderAdapter[];
  leaseDurationMs?: number;
  minimumLeaseRemainingMs?: number;
  now?: () => Date;
  executionId?: () => string;
  assistedVerificationReader?: (mission: ResearchMission) => Promise<AssistedVerificationResult | null>;
}>;

export class TrustedMissionExecutorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TrustedMissionExecutorError";
  }
}

class ResearchCallBudgetExhaustedError extends LegalDataHunterProviderError {
  constructor() {
    super("BUDGET_EXHAUSTED", false);
  }
}

class ResearchLeaseWindowError extends LegalDataHunterProviderError {
  constructor() {
    super("LEASE_WINDOW_INSUFFICIENT", false);
  }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sourceFamily(reference: OfficialLegalReference): ResearchSourceFamily {
  const authority = reference.authorityHint?.toUpperCase() ?? "";
  if (authority.includes("CASSAZIONE")) return "CASSAZIONE";
  if (authority.includes("CORTE COST")) return "CORTE_COSTITUZIONALE";
  if (authority.includes("CONSIGLIO DI STATO") || authority.startsWith("TAR")) {
    return "GIUSTIZIA_AMMINISTRATIVA";
  }
  return "OTHER";
}

function planKnownAuthorities(mission: ResearchMission): Readonly<{
  references: readonly PlannedReference[];
  gaps: readonly ResearchGap[];
  blockerCodes: readonly string[];
}> {
  const references: PlannedReference[] = [];
  const gaps: ResearchGap[] = [];
  const blockerCodes: string[] = [];
  for (const authority of mission.knownAuthorities) {
    const citation = authority.citation?.trim();
    const parsed = citation
      ? discoverItalianLegalReferences(citation).filter((item) => item.kind === "CASE_LAW")
      : [];
    if (parsed.length !== 1) {
      blockerCodes.push("STRUCTURED_PROVIDER_REFERENCE_MISSING");
      gaps.push({
        gapId: stableId("research-gap", `${mission.missionId}:${authority.authorityReferenceId}:structured-reference`),
        kind: "OFFICIAL_IDENTITY_NOT_VERIFIED",
        targetId: authority.authorityReferenceId,
      });
      continue;
    }
    const item = parsed[0];
    const reference: OfficialLegalReference = {
      kind: item.kind,
      authorityHint: item.authorityHint,
      actType: item.actType,
      actNumber: item.actNumber,
      year: item.year,
      chamberSection: item.chamberSection,
    };
    references.push({
      authorityReferenceId: authority.authorityReferenceId,
      citation: citation!,
      reference,
      sourceFamily: sourceFamily(reference),
    });
  }
  return { references, gaps, blockerCodes };
}

function candidateFromHit(
  hit: OfficialLegalReferenceCaseLawHit,
  executionRecordId: string,
  source: ResearchSourceFamily,
): AuthorityCandidate {
  return createAuthorityCandidate({
    kind: "AUTHORITY_CANDIDATE",
    executionRecordId,
    toolId: LEGAL_DATA_HUNTER_TOOL_ID,
    providerId: hit.providerSourceId,
    courtOrBody: hit.authority,
    documentType: hit.decisionType ?? "CASE_LAW",
    number: hit.decisionNumber,
    year: hit.decisionYear,
    ...(hit.decidedAt ? { documentDate: hit.decidedAt.toISOString() } : {}),
    ...(hit.ecli ? { ecli: hit.ecli } : {}),
    ...(hit.title ? { title: hit.title } : {}),
    ...(hit.sourceUrl ? { sourceUrl: hit.sourceUrl } : {}),
    providerDocumentId: hit.providerRecordId,
    supportDirection: "UNKNOWN",
    sourceFamily: source,
    retrievalMethod: "KEYWORD_SEARCH",
    fullTextAvailable: false,
    verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
  });
}

function leaseExpiry(value: string): number {
  const expiresAt = Date.parse(value);
  if (Number.isNaN(expiresAt)) throw new TrustedMissionExecutorError("CLAIM_LEASE_INVALID");
  return expiresAt;
}

function errorState(error: unknown): Readonly<{ code: string; retryable: boolean }> {
  if (error instanceof LegalDataHunterProviderError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof ProviderResearchAdapterError) {
    return { code: error.code, retryable: error.retryable };
  }
  return { code: "PROVIDER_ERROR", retryable: false };
}

function uniqueGaps(gaps: readonly ResearchGap[]): readonly ResearchGap[] {
  return [...new Map(gaps.map((gap) => [gap.gapId, gap])).values()];
}

export function projectAssistedVerificationEvidence(
  mission: ResearchMission,
  verification: AssistedVerificationResult | null,
) {
  const authorityCandidates = verification?.authorityCandidates ?? [];
  const executionIds = [...new Set(authorityCandidates.map((candidate) => (
    candidate.executionRecordId
  )))];
  const researchToolExecutions: ResearchToolExecution[] = executionIds.map((executionRecordId) => {
    const candidates = authorityCandidates.filter((candidate) => (
      candidate.executionRecordId === executionRecordId
    ));
    return {
      executionRecordId,
      toolId: "ASSISTED_VERIFICATION",
      role: "OTHER",
      operationType: "FULL_TEXT_RETRIEVAL",
      researchQuery: mission.researchQuestion,
      sourceFamiliesRequested: [...new Set(candidates.map((candidate) => candidate.sourceFamily))],
      resultIdentifiersUsed: candidates.flatMap((candidate) => [
        candidate.officialIdentifier,
        candidate.verifiedEvidence?.evidenceSourceId,
      ].filter((value): value is string => Boolean(value))),
      resultCount: candidates.length,
      callsConsumed: 0,
    };
  });
  return {
    researchToolExecutions,
    assistedVerificationFingerprint: verification?.assistedVerificationFingerprint,
    authorityCandidates,
    citationObservations: verification?.citationObservations ?? [],
    legalResearchSuggestions: verification?.legalResearchSuggestions ?? [],
    evidenceGaps: verification?.evidenceGaps ?? mission.knownEvidenceGaps,
  };
}

function evidenceSatisfiedCapabilities(
  verification: AssistedVerificationResult | null,
): ReadonlySet<ResearchCapability> {
  const capabilities = new Set<ResearchCapability>();
  if ((verification?.verifiedFullTexts.length ?? 0) > 0) capabilities.add("FULL_TEXT_RETRIEVAL");
  if ((verification?.citationObservations.length ?? 0) > 0) capabilities.add("CITATION_NETWORK");
  if (verification?.adverseSearchCompleted ?? verification?.adverseAuthorityVerified) capabilities.add("ADVERSE_AUTHORITY_DISCOVERY");
  return capabilities;
}

function unsupportedOutputBlockers(
  mission: ResearchMission,
  verification: AssistedVerificationResult | null,
): string[] {
  return [
    ...(mission.requiredOutput.citationObservations
      && (verification?.citationObservations.length ?? 0) === 0
      ? ["CITATION_OBSERVATIONS_UNSUPPORTED"] : []),
    ...(mission.requiredOutput.legalResearchSuggestions
      && (verification?.legalResearchSuggestions.length ?? 0) === 0
      ? ["LEGAL_RESEARCH_SUGGESTIONS_UNSUPPORTED"] : []),
    ...(mission.requiredOutput.fullTextRequired
      && (verification?.verifiedFullTexts.length ?? 0) === 0
      ? ["FULL_TEXT_UNSUPPORTED"] : []),
  ];
}

async function observeMissionAfterUncertainMutation(
  client: TrustedResearchHttpClient,
  missionId: string,
): Promise<void> {
  try {
    await client.readMission(missionId);
  } catch {
    // Recovery remains required whether or not the diagnostic read succeeds.
  }
}

function completionBlockers(
  mission: ResearchMission,
  executions: readonly ResearchToolExecution[],
  candidates: readonly AuthorityCandidate[],
  gaps: readonly ResearchGap[],
  providerIncomplete: boolean,
  supportedCapabilities: ReadonlySet<ResearchCapability>,
  verification: AssistedVerificationResult | null,
): string[] {
  const blockers: string[] = [];
  const requiredCapabilities = mission.executionPlan?.requiredCapabilities ?? [];
  const verifiedCapabilities = evidenceSatisfiedCapabilities(verification);
  if (requiredCapabilities.some((capability) => (
    !supportedCapabilities.has(capability) && !verifiedCapabilities.has(capability)
  ))) {
    blockers.push("REQUIRED_CAPABILITY_UNAVAILABLE");
  }
  if (mission.requiredOutput.authorityCandidates && candidates.length === 0) {
    blockers.push("AUTHORITY_CANDIDATES_MISSING");
  }
  if (mission.requiredOutput.citationObservations
    && (verification?.citationObservations.length ?? 0) === 0) blockers.push("CITATION_CLIENT_UNAVAILABLE");
  if (mission.requiredOutput.legalResearchSuggestions
    && (verification?.legalResearchSuggestions.length ?? 0) === 0) blockers.push("STRATEGIST_CLIENT_UNAVAILABLE");
  if (mission.requiredOutput.fullTextRequired
    && (verification?.verifiedFullTexts.length ?? 0) === 0) blockers.push("FULL_TEXT_CLIENT_UNAVAILABLE");
  if (gaps.length > 0) blockers.push("EVIDENCE_GAPS_REMAIN");
  if (providerIncomplete || executions.some((execution) => execution.errorState)) {
    blockers.push("PROVIDER_RESULTS_INCOMPLETE");
  }
  return [...new Set(blockers)];
}

function selectProviderAdapter(
  mission: ResearchMission,
  adapters: readonly ResearchProviderAdapter[],
  capability: ResearchCapability,
): ResearchProviderAdapter | undefined {
  const capableAdapters = adapters.filter((adapter) => adapter.capability === capability);
  const preferred = mission.executionPlan?.preferredToolIds ?? [];
  for (const toolId of preferred) {
    const adapter = capableAdapters.find((candidate) => candidate.provider === toolId.toUpperCase());
    if (adapter) return adapter;
  }
  return capableAdapters[0];
}

function orderedExactAdapters(mission: ResearchMission, adapters: readonly ResearchProviderAdapter[]) {
  const remaining = adapters.filter((adapter) => adapter.capability === "EXACT_RETRIEVAL");
  const ordered: ResearchProviderAdapter[] = [];
  while (remaining.length > 0) {
    const selected = selectProviderAdapter(mission, remaining, "EXACT_RETRIEVAL")!;
    ordered.push(selected);
    remaining.splice(remaining.indexOf(selected), 1);
  }
  return ordered;
}

function providerPlanFits(
  mission: ResearchMission,
  providers: readonly ResearchProviderAdapter["provider"][],
  callsConsumed = 0,
  providerCalls: Readonly<Record<string, number>> = {},
): boolean {
  return callsConsumed + providers.length <= mission.budget.maxTotalResearchCalls
    && ["MOONLIT", "SIMPLICITER"].every((provider) => (
      (providerCalls[provider] ?? 0) + providers.filter((item) => item === provider).length
      <= (provider === "MOONLIT" ? mission.budget.maxMoonlitCalls : mission.budget.maxSimpliciterCalls)
    ));
}

function providerRequestKey(adapter: ResearchProviderAdapter, request: ProviderToolRequest): string {
  return stableId("provider-request", JSON.stringify([adapter.provider, request.name, request.arguments]));
}

export function createTrustedMissionExecutor(options: TrustedMissionExecutorOptions): Readonly<{
  execute(missionId: string): Promise<TrustedMissionExecutorResult>;
}> {
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const minimumLeaseRemainingMs = options.minimumLeaseRemainingMs ?? DEFAULT_MINIMUM_LEASE_REMAINING_MS;
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 86_400_000) {
    throw new TrustedMissionExecutorError("LEASE_DURATION_INVALID");
  }
  if (!Number.isInteger(minimumLeaseRemainingMs) || minimumLeaseRemainingMs < 0) {
    throw new TrustedMissionExecutorError("LEASE_WINDOW_INVALID");
  }
  const now = options.now ?? (() => new Date());
  const executionId = options.executionId ?? (() => `local-executor:${randomUUID()}`);
  const providerFactory = options.legalDataHunterFactory ?? createLegalDataHunterProvider;
  const baseProviderTransport = options.legalDataHunterTransport ?? fetch;

  return {
    async execute(missionId): Promise<TrustedMissionExecutorResult> {
      if (!missionId.trim() || missionId.length > 96) {
        throw new TrustedMissionExecutorError("MISSION_ID_REQUIRED");
      }

      const snapshot = await options.client.readMission(missionId);
      const missionErrors = validateResearchMission(snapshot.mission);
      if (missionErrors.length > 0 || snapshot.mission.missionId !== missionId) {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: ["MISSION_CONTRACT_INVALID"],
        };
      }
      if (snapshot.operational.status !== "PENDING" && snapshot.operational.status !== "DEFERRED") {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: ["MISSION_NOT_CLAIMABLE"],
        };
      }

      let assistedVerification: AssistedVerificationResult | null = null;
      if (snapshot.assistedVerification) {
        if (snapshot.assistedVerification.snapshot.missionId !== missionId) {
          return { status: "BLOCKED", missionId, callsConsumed: 0, blockerCodes: ["MISSION_CONTRACT_INVALID"] };
        }
        assistedVerification = verifyResearchEvidence({
          mission: snapshot.mission,
          ...snapshot.assistedVerification.snapshot,
          verifiedDocuments: snapshot.assistedVerification.verifiedDocuments,
        });
      }
      if (options.assistedVerificationReader) {
        try {
          assistedVerification = await options.assistedVerificationReader(snapshot.mission);
        } catch {
          return {
            status: "BLOCKED",
            missionId,
            callsConsumed: 0,
            blockerCodes: ["ASSISTED_VERIFICATION_UNAVAILABLE"],
          };
        }
      }
      const assistedEvidence = projectAssistedVerificationEvidence(
        snapshot.mission,
        assistedVerification,
      );

      const requiredCapabilities = snapshot.mission.executionPlan?.requiredCapabilities ?? [];
      const verifiedCapabilities = evidenceSatisfiedCapabilities(assistedVerification);
      const availableAdapters = options.providerAdapters ?? [];
      const selectedAdapters = requiredCapabilities
        .filter((capability) => !verifiedCapabilities.has(capability)
          && !(capability === "KEYWORD_DISCOVERY"
            && requiredCapabilities.includes("SEMANTIC_DISCOVERY")
            && requiredCapabilities.includes("EXACT_RETRIEVAL"))
          && capability !== "EXACT_RETRIEVAL")
        .map((capability) => selectProviderAdapter(snapshot.mission, availableAdapters, capability))
        .filter((adapter): adapter is ResearchProviderAdapter => Boolean(adapter));
      const needsExact = requiredCapabilities.includes("EXACT_RETRIEVAL") && !verifiedCapabilities.has("EXACT_RETRIEVAL");
      const exactAdapters = needsExact ? orderedExactAdapters(snapshot.mission, availableAdapters) : [];
      const supportedCapabilities = new Set(EXECUTOR_NATIVE_CAPABILITIES);
      for (const adapter of availableAdapters) supportedCapabilities.add(adapter.capability);
      const unsupportedCapabilities = requiredCapabilities
        .filter((capability) => (
          !supportedCapabilities.has(capability) && !verifiedCapabilities.has(capability)
        ));
      if (unsupportedCapabilities.length > 0) {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: ["REQUIRED_CAPABILITY_UNAVAILABLE"],
        };
      }

      let providerRequests: readonly Readonly<{
        adapter: ResearchProviderAdapter;
        request: ProviderToolRequest;
      }>[];
      let exactPlans: readonly Readonly<{
        adapter: ResearchProviderAdapter;
        discovery: ResearchProviderAdapter;
        requests: readonly ProviderToolRequest[];
      }>[];
      try {
        providerRequests = selectedAdapters.flatMap((adapter) => (
          adapter.prepareRequests?.(snapshot.mission) ?? [adapter.prepare(snapshot.mission)]
        ).map((request) => ({ adapter, request })));
        exactPlans = exactAdapters.flatMap((adapter) => {
          const discovery = [...selectedAdapters, ...availableAdapters].find((candidate) => (
            candidate.provider === adapter.provider
            && ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"].includes(candidate.capability)
          ));
          return discovery ? [{ adapter, discovery,
            requests: selectedAdapters.includes(discovery) ? []
              : discovery.prepareRequests?.(snapshot.mission) ?? [discovery.prepare(snapshot.mission)],
          }] : [];
        });
      } catch {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: ["PROVIDER_INPUT_INVALID"],
        };
      }

      if (needsExact && exactPlans.length === 0) {
        return { status: "BLOCKED", missionId, callsConsumed: 0, blockerCodes: ["EXACT_DISCOVERY_DEPENDENCY_MISSING"] };
      }

      const unsupportedOutputs = unsupportedOutputBlockers(snapshot.mission, assistedVerification);
      const documentMission = snapshot.mission.requiredOutput.fullTextRequired
        || snapshot.mission.requiredOutput.citationObservations;
      if (documentMission && assistedEvidence.evidenceGaps.length > 0) unsupportedOutputs.push("EVIDENCE_GAPS_REMAIN");
      if (unsupportedOutputs.length > 0) {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: unsupportedOutputs,
        };
      }

      const plannedProviders = [...new Map(providerRequests.map(({ adapter, request }) => (
        [providerRequestKey(adapter, request), adapter.provider] as const
      ))).values()];
      if (!providerPlanFits(snapshot.mission, plannedProviders)
        || (needsExact && !exactPlans.some(({ adapter, discovery, requests }) => providerPlanFits(
          snapshot.mission, [...plannedProviders, ...requests.map(() => discovery.provider), adapter.provider],
        )))) {
        return { status: "BLOCKED", missionId, callsConsumed: 0, blockerCodes: ["PROVIDER_PLAN_BUDGET_INSUFFICIENT"] };
      }

      const keywordAdapterSelected = selectedAdapters
        .some((adapter) => adapter.capability === "KEYWORD_DISCOVERY");
      const requiresNativeReferencePlan = requiredCapabilities.length === 0
        || (requiredCapabilities.includes("KEYWORD_DISCOVERY") && !keywordAdapterSelected);
      const plan = requiresNativeReferencePlan
        ? planKnownAuthorities(snapshot.mission)
        : { references: [], gaps: [], blockerCodes: [] };
      const noResearchRequired = snapshot.mission.knownAuthorities.length === 0
        && !snapshot.mission.requiredOutput.authorityCandidates
        && !snapshot.mission.requiredOutput.citationObservations
        && !snapshot.mission.requiredOutput.legalResearchSuggestions
        && !snapshot.mission.requiredOutput.fullTextRequired
        && (snapshot.mission.executionPlan?.requiredCapabilities.length ?? 0) === 0
        && snapshot.mission.knownEvidenceGaps.length === 0;
      const evidenceOnlyReady = (
        !snapshot.mission.requiredOutput.authorityCandidates
        || assistedEvidence.authorityCandidates.length > 0
      )
        && requiredCapabilities.every((capability) => verifiedCapabilities.has(capability))
        && unsupportedOutputs.length === 0;
      if (plan.references.length === 0 && providerRequests.length === 0 && exactPlans.length === 0
        && !noResearchRequired && !evidenceOnlyReady) {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: [...new Set([...plan.blockerCodes, "NO_VERIFIED_PROVIDER_INPUT"])],
        };
      }

      const apiKey = options.legalDataHunterApiKey === undefined
        ? process.env.LEGAL_DATA_HUNTER_API_KEY?.trim() ?? null
        : options.legalDataHunterApiKey?.trim() || null;
      const runLegalDataHunter = plan.references.length > 0
        && (requiredCapabilities.length === 0
          || (requiredCapabilities.includes("KEYWORD_DISCOVERY") && !keywordAdapterSelected));
      if (runLegalDataHunter && !apiKey) {
        return {
          status: "BLOCKED",
          missionId,
          callsConsumed: 0,
          blockerCodes: ["LEGAL_DATA_HUNTER_UNAVAILABLE"],
        };
      }

      const currentExecutionId = executionId();
      let claimed;
      try {
        claimed = await options.client.claimMission({
          missionId,
          executionId: currentExecutionId,
          leaseDurationMs,
        });
      } catch {
        return {
          status: "RECOVERY_REQUIRED",
          missionId,
          executionId: currentExecutionId,
          callsConsumed: 0,
          blockerCodes: ["CLAIM_OUTCOME_UNCERTAIN"],
        };
      }
      if (claimed.missionId !== missionId || claimed.executionId !== currentExecutionId) {
        throw new TrustedMissionExecutorError("CLAIM_IDENTITY_MISMATCH");
      }
      const expiresAt = leaseExpiry(claimed.leaseExpiresAt);
      const leaseValid = () => now().getTime() < expiresAt;
      const leaseAllowsProviderCall = () => now().getTime() + minimumLeaseRemainingMs < expiresAt;
      if (!leaseValid()) {
        return {
          status: "LEASE_EXPIRED",
          missionId,
          executionId: currentExecutionId,
          callsConsumed: 0,
          blockerCodes: ["CLAIM_EXPIRED"],
        };
      }

      let callsConsumed = 0;
      const providerCalls: Record<"LEGAL_DATA_HUNTER" | "MOONLIT" | "SIMPLICITER", number> = {
        LEGAL_DATA_HUNTER: 0,
        MOONLIT: 0,
        SIMPLICITER: 0,
      };
      const consumeProviderCall = (provider: keyof typeof providerCalls) => {
        if (!leaseAllowsProviderCall()) throw new ResearchLeaseWindowError();
        const providerMaximum = provider === "MOONLIT"
          ? snapshot.mission.budget.maxMoonlitCalls
          : provider === "SIMPLICITER"
            ? snapshot.mission.budget.maxSimpliciterCalls
            : snapshot.mission.budget.maxLegalDataHunterCalls;
        if (callsConsumed >= snapshot.mission.budget.maxTotalResearchCalls
          || providerCalls[provider] >= providerMaximum) {
          throw new ResearchCallBudgetExhaustedError();
        }
        callsConsumed += 1;
        providerCalls[provider] += 1;
      };
      const budgetTransport: LegalDataHunterTransport = async (input, init) => {
        consumeProviderCall("LEGAL_DATA_HUNTER");
        return baseProviderTransport(input, init);
      };
      const provider: OfficialLegalReferenceProvider | undefined = runLegalDataHunter
        ? providerFactory({ apiKey: apiKey!, transport: budgetTransport })
        : undefined;
      const startedAt = now().toISOString();
      const executions: ResearchToolExecution[] = [...assistedEvidence.researchToolExecutions];
      const candidates: AuthorityCandidate[] = [...assistedEvidence.authorityCandidates];
      const gaps: ResearchGap[] = [
        ...assistedEvidence.evidenceGaps,
        ...plan.gaps,
      ];
      const unresolvedQuestions: string[] = [];
      let providerIncomplete = plan.gaps.length > 0;

      for (const [index, planned] of (runLegalDataHunter ? plan.references : []).entries()) {
        const callsBefore = callsConsumed;
        const executionRecordId = stableId(
          "research-execution",
          `${missionId}:${currentExecutionId}:${planned.authorityReferenceId}:${index}`,
        );
        let resultIdentifiersUsed: string[] = [];
        let resultCount = 0;
        let failure: Readonly<{ code: string; retryable: boolean }> | undefined;
        try {
          if (!provider!.supports(planned.reference)) {
            throw new LegalDataHunterProviderError("UNSUPPORTED_REFERENCE", false);
          }
          const result = await provider!.lookup(planned.reference);
          resultCount = result.resultCount;
          resultIdentifiersUsed = result.hits.map((hit) => `${hit.providerSourceId}:${hit.providerRecordId}`);
          for (const hit of result.hits) {
            if (hit.documentKind === "CASE_LAW") {
              candidates.push(candidateFromHit(hit, executionRecordId, planned.sourceFamily));
            }
          }
          if (result.status !== "FOUND_UNIQUE") {
            providerIncomplete = true;
            gaps.push({
              gapId: stableId("research-gap", `${missionId}:${planned.authorityReferenceId}:${result.status}`),
              kind: "OFFICIAL_IDENTITY_NOT_VERIFIED",
              targetId: planned.authorityReferenceId,
              sourceFamily: planned.sourceFamily,
            });
          }
        } catch (error) {
          failure = errorState(error);
          providerIncomplete = true;
          unresolvedQuestions.push(`${planned.authorityReferenceId}:${failure.code}`);
          gaps.push({
            gapId: stableId("research-gap", `${missionId}:${planned.authorityReferenceId}:${failure.code}`),
            kind: "OFFICIAL_IDENTITY_NOT_VERIFIED",
            targetId: planned.authorityReferenceId,
            sourceFamily: planned.sourceFamily,
          });
        }
        executions.push({
          executionRecordId,
          toolId: LEGAL_DATA_HUNTER_TOOL_ID,
          providerId: provider!.providerKey,
          role: "BROAD_DISCOVERY",
          operationType: "KEYWORD_SEARCH",
          researchQuery: planned.citation,
          sourceFamiliesRequested: [planned.sourceFamily],
          resultIdentifiersUsed,
          resultCount,
          callsConsumed: callsConsumed - callsBefore,
          ...(failure ? { errorState: failure } : {}),
        });
        if (failure?.code === "BUDGET_EXHAUSTED" || failure?.code === "LEASE_WINDOW_INSUFFICIENT") break;
      }

      const discovered: AuthorityCandidate[] = [];
      const completedRequests = new Map<string, Readonly<{ response: unknown; executionRecordId: string }>>();
      let providerAttemptIndex = 0;
      const runAdapter = async (
        adapter: ResearchProviderAdapter,
        request?: ProviderToolRequest,
        exactInput?: AuthorityCandidate,
        reservedProviders: readonly ResearchProviderAdapter["provider"][] = [adapter.provider],
        localFailure?: unknown,
      ): Promise<boolean> => {
        const callsBefore = callsConsumed;
        const reusable = adapter.capability === "SEMANTIC_DISCOVERY" || adapter.capability === "CROSS_JURISDICTION_DISCOVERY";
        const requestKey = request && reusable ? providerRequestKey(adapter, request) : undefined;
        const shared = requestKey ? completedRequests.get(requestKey) : undefined;
        const executionRecordId = shared ? `${shared.executionRecordId}:shared` : stableId(
          "research-execution",
          JSON.stringify([missionId, currentExecutionId, adapter.provider, adapter.capability, providerAttemptIndex++, request]),
        );
        let resultIdentifiersUsed: readonly string[] = [];
        let resultCount = 0;
        let complete = false;
        let failure: Readonly<{ code: string; retryable: boolean }> | undefined;
        try {
          if (localFailure) throw localFailure;
          const exactInputs = exactInput ? [exactInput] : [];
          const prepared = request ?? adapter.prepare(snapshot.mission, exactInputs);
          if (!shared && !providerPlanFits(snapshot.mission, reservedProviders, callsConsumed, providerCalls)) {
            throw new ResearchCallBudgetExhaustedError();
          }
          if (!shared) consumeProviderCall(adapter.provider);
          const response = shared ? shared.response : await adapter.callTool(prepared);
          const normalized = adapter.normalize(response, {
            mission: snapshot.mission,
            executionRecordId,
            request: prepared,
          });
          const exactResultMismatch = adapter.provider === "SIMPLICITER"
            ? !normalized.authorityCandidates.some((candidate) => candidate.exactReferenceMatch === true)
            : normalized.authorityCandidates.some((candidate) =>
              !exactInputs.some((input) => input.toolId === candidate.toolId
                && (input.providerDocumentId ?? input.officialIdentifier)
                  === (candidate.providerDocumentId ?? candidate.officialIdentifier)));
          if (adapter.capability === "EXACT_RETRIEVAL" && exactResultMismatch) {
            throw new ProviderResearchAdapterError("EXACT_RESULT_IDENTITY_MISMATCH");
          }
          if (["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY", "CROSS_JURISDICTION_DISCOVERY"].includes(adapter.capability)
            && !normalized.incomplete && normalized.evidenceGaps.length === 0) {
            discovered.push(...normalized.authorityCandidates);
          }
          resultIdentifiersUsed = normalized.resultIdentifiersUsed;
          resultCount = normalized.resultCount;
          candidates.push(...normalized.authorityCandidates);
          gaps.push(...normalized.evidenceGaps);
          providerIncomplete ||= normalized.incomplete;
          complete = !normalized.incomplete && normalized.evidenceGaps.length === 0;
          if (complete && requestKey && !shared) completedRequests.set(requestKey, { response, executionRecordId });
        } catch (error) {
          failure = errorState(error);
          providerIncomplete = true;
          unresolvedQuestions.push(`${adapter.provider}:${adapter.capability}:${failure.code}`);
          gaps.push({
            gapId: stableId("research-gap", `${executionRecordId}:${failure.code}`),
            kind: "OFFICIAL_IDENTITY_NOT_VERIFIED",
          });
        }
        executions.push({
          executionRecordId,
          toolId: adapter.provider,
          providerId: Array.isArray(request?.arguments.source_keys) && request.arguments.source_keys.length === 1
            ? String(request.arguments.source_keys[0]) : adapter.provider,
          role: adapter.role,
          operationType: adapter.operationType,
          researchQuery: snapshot.mission.researchQuestion,
          sourceFamiliesRequested: request ? providerRequestSourceFamilies(request, snapshot.mission) : snapshot.mission.preferredSourceFamilies,
          resultIdentifiersUsed,
          resultCount,
          callsConsumed: callsConsumed - callsBefore,
          ...(failure ? { errorState: failure } : {}),
        });
        return complete;
      };

      let providerPathReady = true;
      const discoveryProviders = new Set<ResearchProviderAdapter["provider"]>();
      for (const { adapter, request } of providerRequests) {
        if (!await runAdapter(adapter, request)) {
          providerPathReady = false;
          break;
        }
        if (["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"].includes(adapter.capability)) discoveryProviders.add(adapter.provider);
      }

      if (needsExact && providerPathReady) {
        let exactAttempted = false;
        for (const { adapter, discovery, requests } of exactPlans) {
          if (!discoveryProviders.has(adapter.provider)) {
            for (const [index, request] of requests.entries()) {
              if (!await runAdapter(discovery, request, undefined,
                [...requests.slice(index).map(() => discovery.provider), adapter.provider])) {
                providerPathReady = false;
                break;
              }
            }
            if (!providerPathReady) break;
            discoveryProviders.add(adapter.provider);
          }
          let exactInput: AuthorityCandidate | undefined;
          let prepared: ProviderToolRequest | undefined;
          try {
            for (const candidate of discovered.filter((item) => item.toolId === adapter.provider)) {
              try {
                prepared = adapter.prepare(snapshot.mission, [candidate]);
                exactInput = candidate;
                break;
              } catch (error) {
                if (!(error instanceof ProviderResearchAdapterError)
                  || !["PROVIDER_EXACT_IDENTIFIER_REQUIRED", "PROVIDER_EXACT_REFERENCE_REQUIRED"].includes(error.code)) throw error;
              }
            }
          } catch (error) {
            await runAdapter(adapter, undefined, undefined, [], error);
            providerPathReady = false;
            break;
          }
          if (!exactInput) continue;
          exactAttempted = true;
          await runAdapter(adapter, prepared, exactInput);
          break;
        }
        if (!exactAttempted && providerPathReady) {
          await runAdapter(exactPlans[0].adapter, undefined, undefined, [],
            new ProviderResearchAdapterError("PROVIDER_EXACT_NO_COMPATIBLE_CANDIDATE"));
        }
      }

      if (!leaseValid()) {
        return {
          status: "LEASE_EXPIRED",
          missionId,
          executionId: currentExecutionId,
          callsConsumed,
          blockerCodes: ["CLAIM_EXPIRED"],
        };
      }

      const budget = assessResearchBudget(snapshot.mission.budget, executions);
      const remainingGaps = uniqueGaps(gaps);
      const blockers = completionBlockers(
        snapshot.mission,
        executions,
        candidates,
        remainingGaps,
        providerIncomplete,
        supportedCapabilities,
        assistedVerification,
      );
      const completionState = budget.exhausted
        ? "BUDGET_EXHAUSTED"
        : blockers.length === 0
          ? "COMPLETE"
          : "PARTIAL";
      const bundle: ResearchEvidenceBundle = {
        kind: "RESEARCH_EVIDENCE_BUNDLE",
        version: RESEARCH_BRIDGE_VERSION,
        missionId,
        executionId: currentExecutionId,
        startedAt,
        completedAt: now().toISOString(),
        researchToolExecutions: executions,
        assistedVerificationFingerprint: assistedEvidence.assistedVerificationFingerprint,
        authorityCandidates: candidates,
        citationObservations: assistedEvidence.citationObservations,
        legalResearchSuggestions: assistedEvidence.legalResearchSuggestions,
        evidenceGaps: remainingGaps,
        conflicts: [],
        unresolvedQuestions,
        suggestedFollowUpMissions: [],
        humanDecisionEscalations: [],
        completionState,
      };
      if (validateResearchEvidenceBundle(snapshot.mission, bundle).length > 0) {
        throw new TrustedMissionExecutorError("EVIDENCE_BUNDLE_INVALID");
      }

      let submitted;
      try {
        submitted = await options.client.submitEvidenceBundle({
          missionId,
          bundle,
          claimToken: claimed.claimToken,
        });
      } catch {
        // A mission read cannot prove which idempotent bundle won, so never retry or finalize blindly.
        await options.client.readMission(missionId).catch(() => undefined);
        return {
          status: "RECOVERY_REQUIRED",
          missionId,
          executionId: currentExecutionId,
          callsConsumed,
          blockerCodes: ["SUBMIT_OUTCOME_UNCERTAIN"],
        };
      }
      if (
        submitted.missionId !== bundle.missionId
        || submitted.executionId !== bundle.executionId
        || submitted.completionState !== bundle.completionState
        || submitted.fascicoloScopeId !== claimed.fascicoloScopeId
      ) {
        throw new TrustedMissionExecutorError("SUBMISSION_RESULT_MISMATCH");
      }
      if (completionState === "COMPLETE" || completionState === "BUDGET_EXHAUSTED") {
        const expectedStatus = completionState === "COMPLETE" ? "COMPLETED" : "BUDGET_EXHAUSTED";
        try {
          const completed = await options.client.completeMission({
            missionId,
            executionId: currentExecutionId,
            bundleId: submitted.bundleId,
            claimToken: claimed.claimToken,
          });
          if (
            completed.missionId !== missionId
            || completed.fascicoloScopeId !== claimed.fascicoloScopeId
            || completed.status !== expectedStatus
          ) {
            throw new TrustedMissionExecutorError("FINAL_RESULT_MISMATCH");
          }
        } catch (error) {
          if (error instanceof TrustedMissionExecutorError) throw error;
          await observeMissionAfterUncertainMutation(options.client, missionId);
          return {
            status: "RECOVERY_REQUIRED",
            missionId,
            executionId: currentExecutionId,
            bundleId: submitted.bundleId,
            callsConsumed,
            blockerCodes: ["COMPLETE_OUTCOME_UNCERTAIN"],
          };
        }
        return {
          status: completionState === "COMPLETE" ? "COMPLETED" : "BUDGET_EXHAUSTED",
          missionId,
          executionId: currentExecutionId,
          bundleId: submitted.bundleId,
          callsConsumed,
          blockerCodes: blockers,
        };
      }

      try {
        const deferred = await options.client.deferMission({
          missionId,
          executionId: currentExecutionId,
          claimToken: claimed.claimToken,
          disposition: "DEFER",
          reasonCode: "RESEARCH_INCOMPLETE",
        });
        if (
          deferred.missionId !== missionId
          || deferred.fascicoloScopeId !== claimed.fascicoloScopeId
          || deferred.status !== "DEFERRED"
        ) {
          throw new TrustedMissionExecutorError("FINAL_RESULT_MISMATCH");
        }
      } catch (error) {
        if (error instanceof TrustedMissionExecutorError) throw error;
        await observeMissionAfterUncertainMutation(options.client, missionId);
        return {
          status: "RECOVERY_REQUIRED",
          missionId,
          executionId: currentExecutionId,
          bundleId: submitted.bundleId,
          callsConsumed,
          blockerCodes: ["DEFER_OUTCOME_UNCERTAIN"],
        };
      }
      return {
        status: "DEFERRED",
        missionId,
        executionId: currentExecutionId,
        bundleId: submitted.bundleId,
        callsConsumed,
        blockerCodes: blockers,
      };
    },
  };
}
