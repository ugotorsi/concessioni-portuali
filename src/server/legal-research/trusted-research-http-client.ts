import { z } from "zod";
import { trustedAssistedEvidenceSchema } from "./assisted-verification";

import {
  RESEARCH_BRIDGE_VERSION,
  type ResearchEvidenceBundle,
  type ResearchMission,
} from "@/server/legal-research/bridge";
import { storedWorkosMcpAccessToken } from "@/server/legal-research/workos-mcp-oauth";

const TRUSTED_MISSION_PATH = "/api/legal-research/trusted/mission";
const TRUSTED_MISSION_ACTION_PATH = "/api/legal-research/trusted/mission/action";
const MAX_RESPONSE_BYTES = 4_194_304;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const missionIdSchema = z.string().min(1).max(96);
const executionIdSchema = z.string().min(1).max(256);
const claimTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const claimInputSchema = z.object({
  missionId: missionIdSchema,
  executionId: executionIdSchema,
  leaseDurationMs: z.number().int().min(1_000).max(86_400_000),
}).strict();
const submitInputSchema = z.object({
  missionId: missionIdSchema,
  bundle: z.object({
    missionId: missionIdSchema,
    executionId: executionIdSchema,
  }).passthrough(),
  claimToken: claimTokenSchema,
}).strict().refine(
  ({ missionId, bundle }) => missionId === bundle.missionId,
  { path: ["missionId"] },
);
const completeInputSchema = z.object({
  missionId: missionIdSchema,
  executionId: executionIdSchema,
  bundleId: z.string().min(1).max(96),
  claimToken: claimTokenSchema,
}).strict();
const deferInputSchema = z.object({
  missionId: missionIdSchema,
  executionId: executionIdSchema,
  claimToken: claimTokenSchema,
  disposition: z.enum(["DEFER", "RELEASE"]),
  reasonCode: z.string().min(1).max(256),
}).strict();
const sourceFamilySchema = z.enum([
  "ITALIAN_LEGISLATION",
  "EU_LEGISLATION",
  "CASSAZIONE",
  "CORTE_COSTITUZIONALE",
  "GIURISPRUDENZA_DI_MERITO",
  "GIUSTIZIA_AMMINISTRATIVA",
  "CJEU",
  "CNF",
  "ECHR",
  "OTHER",
]);
const missionSchema = z.object({
  kind: z.literal("RESEARCH_MISSION"),
  version: z.literal(RESEARCH_BRIDGE_VERSION),
  missionId: missionIdSchema,
  caseReference: z.object({
    caseId: z.string().min(1),
    fascicoloReference: z.string().min(1).optional(),
  }).strict(),
  legalIssueIds: z.array(z.string()),
  legalPropositionIds: z.array(z.string()),
  conclusionIds: z.array(z.string()).optional(),
  referenceDate: z.string(),
  mode: z.enum([
    "DISCOVER_AUTHORITIES",
    "SUPPORT_SEARCH",
    "ADVERSE_SEARCH",
    "DISTINGUISHING_SEARCH",
    "CROSS_JURISDICTION_CHECK",
    "CITATION_EXPANSION",
    "SUBSEQUENT_TREATMENT_SEARCH",
    "EXACT_SOURCE_RECOVERY",
    "LEGAL_GAP_ANALYSIS",
    "FACT_INVESTIGATION_SUGGESTION",
    "STRATEGY_RESEARCH",
  ]),
  researchQuestion: z.string(),
  knownAuthorities: z.array(z.object({
    authorityReferenceId: z.string(),
    citation: z.string().optional(),
    officialIdentifier: z.string().optional(),
  }).strict()),
  excludedAuthorities: z.array(z.object({
    authorityReferenceId: z.string(),
    citation: z.string().optional(),
    officialIdentifier: z.string().optional(),
  }).strict()),
  preferredSourceFamilies: z.array(sourceFamilySchema),
  missingSourceFamilies: z.array(sourceFamilySchema),
  knownCounterArguments: z.array(z.string()),
  knownEvidenceGaps: z.array(z.object({
    gapId: z.string(),
    kind: z.enum([
      "NO_ADVERSE_AUTHORITY_CHECK",
      "NO_CASSATION_CHECK",
      "NO_EU_CHECK",
      "FULL_TEXT_NOT_VERIFIED",
      "OFFICIAL_IDENTITY_NOT_VERIFIED",
      "TEMPORAL_VALIDITY_NOT_RESOLVED",
      "OPEN_COUNTERARGUMENT",
      "INSUFFICIENT_SOURCE_FAMILY_DIVERSITY",
      "MISSING_FACT_EVIDENCE",
      "MISSING_DOCUMENT",
      "UNRESOLVED_AUTHORITY_TREATMENT",
    ]),
    targetId: z.string().optional(),
    sourceFamily: sourceFamilySchema.optional(),
  }).strict()),
  requiredOutput: z.object({
    authorityCandidates: z.boolean(),
    citationObservations: z.boolean(),
    legalResearchSuggestions: z.boolean(),
    evidenceGaps: z.boolean(),
    fullTextRequired: z.boolean(),
  }).strict(),
  budget: z.object({
    maxTotalResearchCalls: z.number().int().nonnegative(),
    maxMoonlitCalls: z.number().int().nonnegative(),
    maxSimpliciterCalls: z.number().int().nonnegative(),
    maxLegalDataHunterCalls: z.number().int().nonnegative(),
  }).strict(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BUDGET_EXHAUSTED", "DEFERRED", "REJECTED"]),
  executionPlan: z.object({
    requiredCapabilities: z.array(z.enum([
      "SEMANTIC_DISCOVERY",
      "KEYWORD_DISCOVERY",
      "EXACT_RETRIEVAL",
      "FULL_TEXT_RETRIEVAL",
      "CITATION_NETWORK",
      "CROSS_JURISDICTION_DISCOVERY",
      "ADVERSE_AUTHORITY_DISCOVERY",
    ])),
    preferredToolIds: z.array(z.string()).optional(),
  }).strict().optional(),
}).strict();

const operationalSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BUDGET_EXHAUSTED", "DEFERRED", "REJECTED"]),
  stateVersion: z.number().int(),
  claimExpiresAt: z.string().nullable(),
  activeExecutionId: z.string().nullable(),
  completedAt: z.string().nullable(),
  deferredAt: z.string().nullable(),
}).strict();

const missionResultSchema = z.object({
  mission: missionSchema,
  operational: operationalSchema,
  fascicoloContext: z.unknown(),
  assistedVerification: trustedAssistedEvidenceSchema.nullable().optional(),
}).strict();
const claimResultSchema = z.object({
  outcome: z.enum(["CLAIMED", "REUSED"]),
  missionId: missionIdSchema,
  fascicoloScopeId: z.string(),
  executionId: executionIdSchema,
  leaseExpiresAt: z.string(),
  claimToken: claimTokenSchema,
}).strict();
const submitResultSchema = z.object({
  outcome: z.enum(["CREATED", "DUPLICATE_OR_IDEMPOTENT_SUCCESS"]),
  bundleId: z.string().min(1).max(96),
  missionId: missionIdSchema,
  fascicoloScopeId: z.string(),
  executionId: executionIdSchema,
  completionState: z.enum(["COMPLETE", "PARTIAL", "BUDGET_EXHAUSTED", "FAILED", "HUMAN_DECISION_REQUIRED"]),
}).strict();
const dispositionResultSchema = z.object({
  missionId: missionIdSchema,
  fascicoloScopeId: z.string(),
  status: z.enum(["PENDING", "DEFERRED"]),
  stateVersion: z.number().int(),
}).strict();
const completeResultSchema = z.object({
  outcome: z.enum(["COMPLETED", "REUSED"]),
  missionId: missionIdSchema,
  fascicoloScopeId: z.string(),
  status: z.enum(["COMPLETED", "BUDGET_EXHAUSTED"]),
  stateVersion: z.number().int(),
}).strict();

export type TrustedMissionSnapshot = Readonly<{
  mission: ResearchMission;
  operational: z.infer<typeof operationalSchema>;
  fascicoloContext: unknown;
  assistedVerification?: z.infer<typeof trustedAssistedEvidenceSchema> | null;
}>;
export type TrustedMissionClaim = z.infer<typeof claimResultSchema>;
export type TrustedMissionSubmission = z.infer<typeof submitResultSchema>;
export type TrustedMissionDisposition = z.infer<typeof dispositionResultSchema>;
export type TrustedMissionCompletion = z.infer<typeof completeResultSchema>;

export class TrustedResearchHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "TrustedResearchHttpError";
  }
}

export class TrustedResearchMcpError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TrustedResearchMcpError";
  }
}

export class TrustedResearchClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TrustedResearchClientError";
  }
}

type BearerSupplier = (config: Readonly<{ issuer: string; resource: string }>) => Promise<string>;
type Transport = (input: string, init: RequestInit) => Promise<Response>;

export type TrustedResearchHttpClientOptions = Readonly<{
  stagingOrigin: string;
  issuer: string;
  resource: string;
  requestTimeoutMs?: number;
  bearerSupplier?: BearerSupplier;
  transport?: Transport;
}>;

export interface TrustedResearchHttpClient {
  readMission(missionId: string): Promise<TrustedMissionSnapshot>;
  claimMission(input: Readonly<{
    missionId: string;
    executionId: string;
    leaseDurationMs: number;
  }>): Promise<TrustedMissionClaim>;
  submitEvidenceBundle(input: Readonly<{
    missionId: string;
    bundle: ResearchEvidenceBundle;
    claimToken: string;
  }>): Promise<TrustedMissionSubmission>;
  completeMission(input: Readonly<{
    missionId: string;
    executionId: string;
    bundleId: string;
    claimToken: string;
  }>): Promise<TrustedMissionCompletion>;
  deferMission(input: Readonly<{
    missionId: string;
    executionId: string;
    claimToken: string;
    disposition: "DEFER" | "RELEASE";
    reasonCode: string;
  }>): Promise<TrustedMissionDisposition>;
}

function validatedUrl(value: string, expectedPath: string, code: string): URL {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== expectedPath
    ) throw new Error(code);
    return url;
  } catch {
    throw new TrustedResearchClientError(code);
  }
}

function validatedIssuer(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("WORKOS_ISSUER_INVALID");
    }
    return url;
  } catch {
    throw new TrustedResearchClientError("WORKOS_ISSUER_INVALID");
  }
}

function responseErrorCode(value: unknown, fallback: string): string {
  return value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new TrustedResearchClientError("TRUSTED_RESPONSE_TOO_LARGE");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new TrustedResearchClientError("TRUSTED_RESPONSE_TOO_LARGE");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TrustedResearchClientError("TRUSTED_RESPONSE_INVALID_JSON");
  }
}

async function structuredResult<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body = await responseJson(response);
  if (!response.ok) {
    throw new TrustedResearchHttpError(response.status, responseErrorCode(body, "TRUSTED_HTTP_ERROR"));
  }
  if (!body || typeof body !== "object") {
    throw new TrustedResearchClientError("TRUSTED_MCP_RESPONSE_INVALID");
  }
  const envelope = body as {
    error?: { code?: unknown };
    result?: { isError?: unknown; structuredContent?: unknown };
  };
  if (envelope.error) {
    throw new TrustedResearchMcpError(String(envelope.error.code ?? "MCP_PROTOCOL_ERROR"));
  }
  const structured = envelope.result?.structuredContent;
  const mcpError = responseErrorCode(structured, "MCP_TOOL_ERROR");
  if (envelope.result?.isError === true || (
    structured && typeof structured === "object" && "error" in structured
  )) {
    throw new TrustedResearchMcpError(mcpError);
  }
  const parsed = schema.safeParse(structured);
  if (!parsed.success) throw new TrustedResearchClientError("TRUSTED_MCP_RESPONSE_INVALID");
  return parsed.data;
}

export function createTrustedResearchHttpClient(
  options: TrustedResearchHttpClientOptions,
): TrustedResearchHttpClient {
  const origin = validatedUrl(options.stagingOrigin, "/", "STAGING_ORIGIN_INVALID");
  const issuer = validatedIssuer(options.issuer);
  const resource = validatedUrl(options.resource, "/api/mcp", "MCP_RESOURCE_URI_INVALID");
  if (resource.origin !== origin.origin) {
    throw new TrustedResearchClientError("STAGING_RESOURCE_ORIGIN_MISMATCH");
  }
  const bearerSupplier = options.bearerSupplier ?? storedWorkosMcpAccessToken;
  const transport = options.transport ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new TrustedResearchClientError("TRUSTED_REQUEST_TIMEOUT_INVALID");
  }

  function validActionInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new TrustedResearchClientError("TRUSTED_ACTION_INPUT_INVALID");
    return parsed.data;
  }

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          let accessToken: string;
          try {
            accessToken = (await bearerSupplier({
              issuer: issuer.toString().replace(/\/$/, ""),
              resource: resource.toString(),
            })).trim();
          } catch {
            throw new TrustedResearchClientError("WORKOS_BEARER_UNAVAILABLE");
          }
          if (controller.signal.aborted) {
            throw new TrustedResearchClientError("TRUSTED_REQUEST_TIMEOUT");
          }
          if (!accessToken) throw new TrustedResearchClientError("WORKOS_BEARER_UNAVAILABLE");

          const response = await transport(new URL(path, origin).toString(), {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
          return structuredResult(response, schema);
        })(),
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new TrustedResearchClientError("TRUSTED_REQUEST_TIMEOUT"));
          }, requestTimeoutMs);
        }),
      ]);
    } catch (error) {
      if (
        error instanceof TrustedResearchClientError
        || error instanceof TrustedResearchHttpError
        || error instanceof TrustedResearchMcpError
      ) throw error;
      throw new TrustedResearchClientError("TRUSTED_TRANSPORT_FAILED");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  return {
    readMission: async (missionId) => {
      const parsedMissionId = missionIdSchema.safeParse(missionId);
      if (!parsedMissionId.success) throw new TrustedResearchClientError("MISSION_ID_INVALID");
      const result = await post(TRUSTED_MISSION_PATH, { missionId: parsedMissionId.data }, missionResultSchema);
      if (result.mission.missionId !== missionId
        || (result.assistedVerification && result.assistedVerification.snapshot.missionId !== missionId)) {
        throw new TrustedResearchClientError("TRUSTED_MISSION_MISMATCH");
      }
      return result as TrustedMissionSnapshot;
    },
    claimMission: async (input) => post(TRUSTED_MISSION_ACTION_PATH, {
      action: "research_claim_mission",
      ...validActionInput(claimInputSchema, input),
    }, claimResultSchema),
    submitEvidenceBundle: async (input) => post(TRUSTED_MISSION_ACTION_PATH, {
      action: "research_submit_evidence_bundle",
      ...validActionInput(submitInputSchema, input),
    }, submitResultSchema),
    completeMission: async (input) => post(TRUSTED_MISSION_ACTION_PATH, {
      action: "research_complete_mission",
      ...validActionInput(completeInputSchema, input),
    }, completeResultSchema),
    deferMission: async (input) => post(TRUSTED_MISSION_ACTION_PATH, {
      action: "research_defer_mission",
      ...validActionInput(deferInputSchema, input),
    }, dispositionResultSchema),
  };
}
