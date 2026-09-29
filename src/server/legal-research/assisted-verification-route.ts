import { isDeepStrictEqual } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";
import { adverseSearchSchema } from "./adverse-search";

import { canValidateReport } from "@/lib/auth";
import {
  canReadTenantResource,
  canWriteTenantResource,
  getCurrentTenantContext,
} from "@/lib/tenant-auth";
import { createAssistedVerificationSnapshot } from "@/server/legal-research/assisted-verification";
import {
  ResearchPersistenceError,
  getLatestAssistedVerification,
  persistAssistedVerification,
  type ResearchServiceActor,
} from "@/server/legal-research/persistence";

const missionIdSchema = z.string().trim().min(1).max(96);
const identifierSchema = z.string().trim().min(1).max(256);
const rationaleSchema = z.string().trim().min(20).max(8_000);
const httpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
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
const locatorSchema = z.object({
  page: z.number().int().positive().optional(),
  section: identifierSchema.optional(),
  paragraph: identifierSchema.optional(),
  span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).strict().refine((value) => value.end >= value.start).optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined));
const initialSourceSchema = z.object({
  evidenceSourceId: identifierSchema,
  authorityId: identifierSchema,
  legalSourceId: identifierSchema,
  legalExpressionVersionId: identifierSchema,
  officialIdentifier: identifierSchema,
  sourceUrl: httpsUrlSchema,
  sourceFamily: sourceFamilySchema.optional(),
  courtOrBody: identifierSchema.optional(),
  documentType: identifierSchema.optional(),
  contentSha256: sha256Schema,
  documentId: identifierSchema.or(z.literal("")).optional(),
  fileVersionId: identifierSchema.or(z.literal("")).optional(),
  termsOfUseBasis: rationaleSchema,
  verificationRationale: rationaleSchema,
}).strict();
const initialSnapshotInputSchema = z.object({
  missionId: missionIdSchema,
  recordId: identifierSchema.nullable().default(null),
  gapResolutions: z.array(z.object({ gapId: identifierSchema, evidenceSourceId: identifierSchema, targetId: identifierSchema }).strict()).optional(),
  sources: z.array(initialSourceSchema).max(10),
  citationRelation: z.object({
    sourceAuthorityId: identifierSchema,
    targetAuthorityId: identifierSchema,
    evidenceSourceId: identifierSchema,
    locator: locatorSchema,
  }).strict().optional(),
}).strict();
const reviewInputSchema = z.object({
  missionId: missionIdSchema,
  recordId: identifierSchema,
  legalPropositionId: identifierSchema,
  rationale: rationaleSchema,
  evidenceSourceId: identifierSchema,
  decision: z.enum(["ADVERSE", "NOT_ADVERSE", "INCONCLUSIVE"]),
}).strict();
const suggestionInputSchema = z.object({
  missionId: missionIdSchema,
  recordId: identifierSchema,
  kind: z.enum([
    "MISSING_LEGAL_PROPOSITION",
    "MISSING_FACTUAL_EVIDENCE",
    "MISSING_ADMINISTRATIVE_DOCUMENT",
    "MISSING_SOURCE_FAMILY",
    "ALTERNATIVE_LEGAL_QUALIFICATION",
    "POSSIBLE_COUNTERARGUMENT",
    "HUMAN_LEGAL_JUDGMENT_QUESTION",
  ]),
  targetId: identifierSchema.optional(),
  description: rationaleSchema,
  rationale: rationaleSchema,
  originatingGapId: identifierSchema,
  evidenceSourceId: identifierSchema,
}).strict();

const adverseSearchCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_ADVERSE_SEARCH"), missionId: missionIdSchema, recordId: identifierSchema, search: adverseSearchSchema }).strict(),
  z.object({ action: z.literal("REVIEW_ADVERSE_SEARCH"), missionId: missionIdSchema, recordId: identifierSchema }).strict(),
]);

export type AssistedVerificationRouteDependencies = Readonly<{
  getCurrentTenantContext: typeof getCurrentTenantContext;
  getLatestAssistedVerification: typeof getLatestAssistedVerification;
  persistAssistedVerification: typeof persistAssistedVerification;
  now(): Date;
}>;

const defaultDependencies: AssistedVerificationRouteDependencies = {
  getCurrentTenantContext,
  getLatestAssistedVerification,
  persistAssistedVerification,
  now: () => new Date(),
};

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorizedActor(
  mode: "read" | "write",
  dependencies: AssistedVerificationRouteDependencies,
): Promise<
  | Readonly<{ actor: ResearchServiceActor }>
  | Readonly<{ response: Response }>
> {
  const context = await dependencies.getCurrentTenantContext();
  if (!context) return { response: jsonError("AUTH_REQUIRED", 401) };
  if (!canValidateReport(context.role) || !context.defaultTenantId) {
    return { response: jsonError("FORBIDDEN", 403) };
  }
  const allowed = mode === "write"
    ? canWriteTenantResource(context, context.defaultTenantId, { allowWhenEnteMissing: false })
    : canReadTenantResource(context, context.defaultTenantId, { allowWhenEnteMissing: false });
  if (!allowed) return { response: jsonError("FORBIDDEN", 403) };
  return {
    actor: {
      actorId: context.userId,
      tenantId: context.defaultTenantId,
    },
  };
}
function persistenceError(error: unknown): Response {
  if (error instanceof ResearchPersistenceError) {
    if (error.code === "AUTHORIZATION_REQUIRED") return jsonError("FORBIDDEN", 403);
    if (error.code === "MISSION_NOT_FOUND") return jsonError("NOT_FOUND", 404);
    if (error.code === "ASSISTED_VERIFICATION_CONFLICT") {
      return jsonError("ASSISTED_VERIFICATION_CONFLICT", 409);
    }
    if (error.code === "INVALID_ASSISTED_VERIFICATION") return jsonError("INVALID_REQUEST", 400);
  }
  return jsonError("ASSISTED_VERIFICATION_UNAVAILABLE", 500);
}

async function getHandler(
  request: Request,
  dependencies: AssistedVerificationRouteDependencies,
): Promise<Response> {
  const authorization = await authorizedActor("read", dependencies);
  if ("response" in authorization) return authorization.response;
  const missionId = missionIdSchema.safeParse(new URL(request.url).searchParams.get("missionId"));
  if (!missionId.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const verification = await dependencies.getLatestAssistedVerification(
      missionId.data,
      authorization.actor,
    );
    if (!verification) return jsonError("NOT_FOUND", 404);
    return NextResponse.json({ verification }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return persistenceError(error);
  }
}

async function putHandler(
  request: Request,
  dependencies: AssistedVerificationRouteDependencies,
): Promise<Response> {
  const authorization = await authorizedActor("write", dependencies);
  if ("response" in authorization) return authorization.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_REQUEST", 400);
  }
  const input = initialSnapshotInputSchema.safeParse(body);
  if (!input.success) return jsonError("INVALID_REQUEST", 400);
  const sourceIds = new Set(input.data.sources.map((source) => source.evidenceSourceId));
  if (sourceIds.size !== input.data.sources.length) return jsonError("INVALID_REQUEST", 400);
  const relation = input.data.citationRelation;
  const reviewedAt = dependencies.now().toISOString();
  try {
    const current = await dependencies.getLatestAssistedVerification(input.data.missionId, authorization.actor);
    if ((current?.recordId ?? null) !== input.data.recordId) return jsonError("ASSISTED_VERIFICATION_CONFLICT", 409);
    if (!current && input.data.sources.length === 0) return jsonError("INVALID_REQUEST", 400);
    const combinedSources = [...(current?.snapshot.sources ?? []).filter((source) => !sourceIds.has(source.evidenceSourceId)), ...input.data.sources];
    if (relation && (!combinedSources.some((source) => source.authorityId === relation.sourceAuthorityId && source.evidenceSourceId === relation.evidenceSourceId)
      || !combinedSources.some((source) => source.authorityId === relation.targetAuthorityId)
      || relation.sourceAuthorityId === relation.targetAuthorityId)) return jsonError("INVALID_REQUEST", 400);
    const retainedRelation = current?.snapshot.citationRelation
      && !input.data.sources.some((source) => [current.snapshot.citationRelation!.sourceAuthorityId, current.snapshot.citationRelation!.targetAuthorityId].includes(source.authorityId))
      ? current.snapshot.citationRelation : undefined;
    const snapshot = createAssistedVerificationSnapshot({
      ...current?.snapshot,
      adverseSearchReview: input.data.sources.length ? undefined : current?.snapshot.adverseSearchReview,
      citationRelation: retainedRelation,
      adverseReview: retainedRelation && (!relation || isDeepStrictEqual(
        { ...relation, documented: true }, retainedRelation,
      )) ? current?.snapshot.adverseReview : undefined,
      researchSuggestions: current?.snapshot.researchSuggestions?.filter((suggestion) => !sourceIds.has(suggestion.evidenceSourceId)),
      missionId: input.data.missionId,
      sources: [...(current?.snapshot.sources ?? []).filter((source) => !sourceIds.has(source.evidenceSourceId)), ...input.data.sources.map((source) => ({
        evidenceSourceId: source.evidenceSourceId,
        authorityId: source.authorityId,
        legalSourceId: source.legalSourceId,
        legalExpressionVersionId: source.legalExpressionVersionId,
        officialIdentifier: source.officialIdentifier,
        sourceUrl: source.sourceUrl,
        ...(source.sourceFamily ? { sourceFamily: source.sourceFamily } : {}),
        ...(source.courtOrBody ? { courtOrBody: source.courtOrBody } : {}),
        ...(source.documentType ? { documentType: source.documentType } : {}),
        providerId: "HUMAN_REVIEWED_OFFICIAL_SOURCE",
        accessStatus: "CONSULTABLE" as const,
        identityVerificationStatus: "VERIFIED" as const,
        reviewerAttestation: {
          reviewedByActorId: authorization.actor.actorId,
          reviewedAt,
          rationale: source.verificationRationale,
        },
        termsOfUse: {
          status: "PERMITTED" as const,
          basis: source.termsOfUseBasis,
          checkedAt: reviewedAt,
        },
        fullText: {
          available: Boolean(source.documentId && source.fileVersionId),
          contentSha256: source.contentSha256.toLowerCase(),
          ...(source.documentId ? { documentId: source.documentId } : {}),
          ...(source.fileVersionId ? { fileVersionId: source.fileVersionId } : {}),
        },
      }))],
      ...(relation ? { citationRelation: { ...relation, documented: true } } : {}),
      gapResolutions: [...(current?.snapshot.gapResolutions ?? []), ...(input.data.gapResolutions ?? [])],
    });
    const persisted = await dependencies.persistAssistedVerification({
      snapshot,
      actor: authorization.actor,
      expectedPreviousRecordId: input.data.recordId,
    });
    return NextResponse.json(persisted, {
      status: persisted.outcome === "CREATED" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return persistenceError(error);
  }
}

async function patchHandler(
  request: Request,
  dependencies: AssistedVerificationRouteDependencies,
): Promise<Response> {
  const authorization = await authorizedActor("write", dependencies);
  if ("response" in authorization) return authorization.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_REQUEST", 400);
  }
  const input = suggestionInputSchema.safeParse(body);
  if (!input.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const current = await dependencies.getLatestAssistedVerification(
      input.data.missionId,
      authorization.actor,
    );
    if (current && current.recordId !== input.data.recordId) {
      return jsonError("ASSISTED_VERIFICATION_CONFLICT", 409);
    }
    const evidence = current?.result.verifiedFullTexts.find((source) => (
      source.evidenceSourceId === input.data.evidenceSourceId
    ));
    const originatingGap = current?.result.evidenceGaps.find((item) => (
      item.gapId === input.data.originatingGapId
    ));
    if (!current || !evidence || !originatingGap) {
      return jsonError("VERIFICATION_EVIDENCE_INCOMPLETE", 422);
    }
    const snapshot = createAssistedVerificationSnapshot({
      ...current.snapshot,
      missionId: current.snapshot.missionId,
      sources: current.snapshot.sources,
      ...(current.snapshot.citationRelation
        ? { citationRelation: current.snapshot.citationRelation }
        : {}),
      ...(current.snapshot.adverseReview ? { adverseReview: current.snapshot.adverseReview } : {}),
      researchSuggestions: [
        ...(current.snapshot.researchSuggestions ?? []),
        {
          kind: input.data.kind,
          ...(input.data.targetId ? { targetId: input.data.targetId } : {}),
          description: input.data.description,
          rationale: input.data.rationale,
          originatingGapId: originatingGap.gapId,
          evidenceSourceId: evidence.evidenceSourceId,
          reviewedByActorId: authorization.actor.actorId,
          reviewedAt: dependencies.now().toISOString(),
        },
      ],
    });
    const persisted = await dependencies.persistAssistedVerification({
      snapshot,
      actor: authorization.actor,
      expectedPreviousRecordId: current.recordId,
    });
    return NextResponse.json(persisted, {
      status: persisted.outcome === "CREATED" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return persistenceError(error);
  }
}

async function postHandler(
  request: Request,
  dependencies: AssistedVerificationRouteDependencies,
): Promise<Response> {
  const authorization = await authorizedActor("write", dependencies);
  if ("response" in authorization) return authorization.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_REQUEST", 400);
  }
  const input = z.union([reviewInputSchema, adverseSearchCommandSchema]).safeParse(body);
  if (!input.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const current = await dependencies.getLatestAssistedVerification(
      input.data.missionId,
      authorization.actor,
    );
    if (current && current.recordId !== input.data.recordId) {
      return jsonError("ASSISTED_VERIFICATION_CONFLICT", 409);
    }
    if ("action" in input.data) {
      if (!current) return jsonError("NOT_FOUND", 404);
      const command = input.data;
      if (command.action === "SAVE_ADVERSE_SEARCH" && command.search.missionId !== current.snapshot.missionId) {
        return jsonError("INVALID_REQUEST", 400);
      }
      const persisted = await dependencies.persistAssistedVerification({
        snapshot: createAssistedVerificationSnapshot({
          ...current.snapshot,
          ...(command.action === "SAVE_ADVERSE_SEARCH" ? { adverseSearch: command.search, adverseSearchReview: undefined } : {}),
        }),
        actor: authorization.actor,
        expectedPreviousRecordId: current.recordId,
        ...(command.action === "REVIEW_ADVERSE_SEARCH" ? { approveAdverseSearch: true } : {}),
      });
      return NextResponse.json(persisted, { status: persisted.outcome === "CREATED" ? 201 : 200, headers: { "Cache-Control": "no-store" } });
    }
    const reviewEvidenceSourceId = input.data.evidenceSourceId;
    const relation = current?.snapshot.citationRelation;
    const evidence = current?.result.verifiedFullTexts.find((source) => (
      source.evidenceSourceId === reviewEvidenceSourceId
    ));
    if (!current || !relation?.documented || !relation.locator || !evidence) {
      return jsonError("VERIFICATION_EVIDENCE_INCOMPLETE", 422);
    }
    const snapshot = createAssistedVerificationSnapshot({
      ...current.snapshot,
      missionId: current.snapshot.missionId,
      sources: current.snapshot.sources,
      citationRelation: relation,
      ...(current.snapshot.researchSuggestions
        ? { researchSuggestions: current.snapshot.researchSuggestions }
        : {}),
      adverseReview: {
        observationSourceAuthorityId: relation.sourceAuthorityId,
        observationTargetAuthorityId: relation.targetAuthorityId,
        legalPropositionId: input.data.legalPropositionId,
        reviewedByActorId: authorization.actor.actorId,
        reviewedAt: dependencies.now().toISOString(),
        evidenceSourceId: input.data.evidenceSourceId,
        rationale: input.data.rationale,
        decision: input.data.decision,
      },
    });
    const persisted = await dependencies.persistAssistedVerification({
      snapshot,
      actor: authorization.actor,
      expectedPreviousRecordId: current.recordId,
    });
    return NextResponse.json(persisted, {
      status: persisted.outcome === "CREATED" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return persistenceError(error);
  }
}

export function createAssistedVerificationRouteHandlers(
  dependencies: AssistedVerificationRouteDependencies = defaultDependencies,
) {
  return {
    GET: (request: Request) => getHandler(request, dependencies),
    PUT: (request: Request) => putHandler(request, dependencies),
    PATCH: (request: Request) => patchHandler(request, dependencies),
    POST: (request: Request) => postHandler(request, dependencies),
  };
}

