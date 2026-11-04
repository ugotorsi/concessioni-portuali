import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../../src/lib/prisma";
import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
  type ResearchMission,
} from "../../src/server/legal-research/bridge";
import { createAutomaticResearchProviderAdapters } from "../../src/server/legal-research/automatic-research-providers";
import { createLocalTrustedResearchClient } from "../../src/server/legal-research/local-trusted-research-client";
import {
  createResearchMissionRecord,
  RESEARCH_MISSION_EXECUTION_OPERATION,
} from "../../src/server/legal-research/persistence";
import { createTrustedMissionExecutor } from "../../src/server/legal-research/trusted-mission-executor";
import { withRuntimeCostGate } from "../../src/server/runtime/cost";

type AcceptanceProvider = "MOONLIT" | "SIMPLICITER" | "LEGAL_DATA_HUNTER";

const QUESTION =
  "Nel fascicolo CP-058/2019, quali fonti giuridiche verificabili disciplinano i requisiti della polizza assicurativa collegata a una concessione demaniale o portuale, la prova della sua tempestiva acquisizione e le conseguenze dell'eventuale mancanza?";
const LDH_CITATION = "Cons. Stato, sez. AP, n. 18/2021";
const UNIT_COST_EUR = 0.02;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name.slice(2).toUpperCase().replaceAll("-", "_")}_REQUIRED`);
  return value;
}

function providerArgument(value: string): AcceptanceProvider {
  const provider = value.trim().toUpperCase();
  if (provider === "MOONLIT" || provider === "SIMPLICITER" || provider === "LEGAL_DATA_HUNTER") {
    return provider;
  }
  throw new Error("PROVIDER_INVALID");
}

function budget(provider: AcceptanceProvider) {
  return {
    maxTotalResearchCalls: provider === "LEGAL_DATA_HUNTER" ? 3 : provider === "SIMPLICITER" ? 2 : 1,
    maxMoonlitCalls: provider === "MOONLIT" ? 1 : 0,
    maxSimpliciterCalls: provider === "SIMPLICITER" ? 2 : 0,
    maxLegalDataHunterCalls: provider === "LEGAL_DATA_HUNTER" ? 3 : 0,
  };
}

function mission(input: Readonly<{
  provider: AcceptanceProvider;
  procedimentoId: string;
  fascicoloReference: string;
  referenceDate: string;
}>): ResearchMission {
  const provider = input.provider;
  return createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    executionChannel: "SERVER_AUTONOMOUS",
    caseReference: {
      caseId: input.procedimentoId,
      fascicoloReference: input.fascicoloReference,
    },
    legalIssueIds: [`ACCEPTANCE_${provider}_CP_058_2019`],
    legalPropositionIds: ["INSURANCE_REQUIREMENTS_AND_TIMELINESS"],
    referenceDate: input.referenceDate,
    mode: provider === "SIMPLICITER" ? "CROSS_JURISDICTION_CHECK" : "DISCOVER_AUTHORITIES",
    researchQuestion: QUESTION,
    knownAuthorities: provider === "LEGAL_DATA_HUNTER"
      ? [{
          authorityReferenceId: "CONSIGLIO_STATO_AP_18_2021",
          citation: LDH_CITATION,
          officialIdentifier: "CONSIGLIO_STATO:18:2021:AP",
        }]
      : [],
    excludedAuthorities: [],
    preferredSourceFamilies: provider === "SIMPLICITER"
      ? ["GIUSTIZIA_AMMINISTRATIVA", "EU_LEGISLATION"]
      : ["GIUSTIZIA_AMMINISTRATIVA", "ITALIAN_LEGISLATION", "EU_LEGISLATION"],
    missingSourceFamilies: provider === "SIMPLICITER"
      ? ["GIUSTIZIA_AMMINISTRATIVA", "EU_LEGISLATION"]
      : ["GIUSTIZIA_AMMINISTRATIVA", "ITALIAN_LEGISLATION", "EU_LEGISLATION"],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: false,
      legalResearchSuggestions: false,
      evidenceGaps: true,
      fullTextRequired: false,
    },
    budget: budget(provider),
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: provider === "SIMPLICITER"
        ? ["CROSS_JURISDICTION_DISCOVERY"]
        : provider === "MOONLIT"
          ? ["SEMANTIC_DISCOVERY"]
          : [],
      preferredToolIds: [provider],
    },
  });
}

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV?.toLowerCase() === "production") {
    throw new Error("PRODUCTION_ENVIRONMENT_FORBIDDEN");
  }
  if (process.env.AUTOMATIC_RESEARCH_ACCEPTANCE_APPROVED !== "1") {
    throw new Error("ACCEPTANCE_APPROVAL_REQUIRED");
  }
  const provider = providerArgument(requiredArgument("--provider"));
  const tenantId = requiredArgument("--tenant-id");
  const procedimentoId = requiredArgument("--procedimento-id");
  const actorId = requiredArgument("--actor-id");
  const workerActorId = requiredArgument("--worker-actor-id");
  const referenceDate = requiredArgument("--reference-date");
  const fascicoloReference = requiredArgument("--fascicolo-reference");
  const acceptanceMission = mission({
    provider,
    procedimentoId,
    fascicoloReference,
    referenceDate,
  });
  const persisted = await createResearchMissionRecord({
    mission: acceptanceMission,
    actor: { actorId, tenantId },
    assignedActorId: workerActorId,
  });
  const allAdapters = await createAutomaticResearchProviderAdapters({
    requestTimeoutMs: Number(process.env.AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS ?? "120000"),
  });
  const providerAdapters = provider === "LEGAL_DATA_HUNTER"
    ? []
    : allAdapters.filter((adapter) => adapter.provider === provider);
  if (provider !== "LEGAL_DATA_HUNTER" && providerAdapters.length === 0) {
    throw new Error(`${provider}_ADAPTER_UNAVAILABLE`);
  }
  const executionMarker = randomUUID();
  const executor = createTrustedMissionExecutor({
    client: createLocalTrustedResearchClient({
      actor: { actorId: workerActorId, tenantId },
      claimantId: workerActorId,
    }),
    legalDataHunterApiKey: process.env.LEGAL_DATA_HUNTER_API_KEY ?? null,
    legalDataHunterTimeoutMs: Number(process.env.AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS ?? "120000"),
    providerAdapters,
    executionId: () => `provider-acceptance:${provider}:${executionMarker}`,
  });
  const maximumCalls = acceptanceMission.budget.maxTotalResearchCalls;
  const result = await withRuntimeCostGate({
    tenantId,
    procedimentoId,
    jobId: null,
    provider: `ACCEPTANCE_${provider}`,
    operationType: RESEARCH_MISSION_EXECUTION_OPERATION,
    estimatedAmount: maximumCalls * UNIT_COST_EUR,
    idempotencyKey: `provider-acceptance:${acceptanceMission.missionId}`,
  }, async () => {
    const value = await executor.execute(acceptanceMission.missionId);
    return { value, actualAmount: value.callsConsumed * UNIT_COST_EUR };
  });
  const bundle = result.bundleId
    ? await prisma.researchEvidenceBundleRecord.findUnique({
        where: { id: result.bundleId },
        select: {
          id: true,
          completionState: true,
          totalCalls: true,
          moonlitCalls: true,
          simpliciterCalls: true,
          legalDataHunterCalls: true,
          payload: true,
        },
      })
    : null;
  const payload = bundle?.payload as {
    researchToolExecutions?: readonly {
      toolId?: string;
      providerId?: string;
      resultCount?: number;
      resultIdentifiersUsed?: readonly string[];
      errorState?: { code?: string };
    }[];
    authorityCandidates?: readonly unknown[];
    evidenceGaps?: readonly unknown[];
  } | undefined;
  console.log(JSON.stringify({
    provider,
    missionId: acceptanceMission.missionId,
    persistenceOutcome: persisted.outcome,
    resultStatus: result.status,
    callsConsumed: result.callsConsumed,
    blockerCodes: result.blockerCodes,
    bundle: bundle
      ? {
          id: bundle.id,
          completionState: bundle.completionState,
          totalCalls: bundle.totalCalls,
          moonlitCalls: bundle.moonlitCalls,
          simpliciterCalls: bundle.simpliciterCalls,
          legalDataHunterCalls: bundle.legalDataHunterCalls,
          authorityCandidateCount: payload?.authorityCandidates?.length ?? 0,
          evidenceGapCount: payload?.evidenceGaps?.length ?? 0,
          executions: (payload?.researchToolExecutions ?? []).map((execution) => ({
            toolId: execution.toolId,
            providerId: execution.providerId,
            resultCount: execution.resultCount,
            resultIdentifierCount: execution.resultIdentifiersUsed?.length ?? 0,
            errorCode: execution.errorState?.code ?? null,
          })),
        }
      : null,
    maximumAuthorizedCostEur: maximumCalls * UNIT_COST_EUR,
    actualCostEur: result.callsConsumed * UNIT_COST_EUR,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : "PROVIDER_ACCEPTANCE_FAILED",
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
