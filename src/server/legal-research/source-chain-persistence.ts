import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import type { AuthorityCandidate } from "./bridge";
import {
  ADVERSE_POLICY_VERSION,
  SOURCE_CHAIN_VERIFICATION_VERSION,
  evaluateAdverseRequirement,
  evaluateUsableSourceGate,
  sourceChainFingerprint,
  type SourceChainSnapshot,
} from "./source-chain";

export interface SourceChainSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface SourceChainPersistenceContext {
  read: SourceChainSqlExecutor;
  transaction<T>(operation: (tx: SourceChainSqlExecutor) => Promise<T>): Promise<T>;
}

function executor(client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">): SourceChainSqlExecutor {
  return { async query<T>(sql: string, params: readonly unknown[] = []) { return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) }; } };
}

const defaultContext: SourceChainPersistenceContext = {
  read: executor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(executor(tx))),
};

function id(prefix: string, fingerprint: string): string {
  return `${prefix}_${fingerprint}`.slice(0, 96);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export interface PersistedSourceAssessment extends SourceChainSnapshot {
  id: string;
  chainFingerprint: string;
  blockingReasons: readonly string[];
  usable: boolean;
  isCurrent: boolean;
  outcome: "CREATED" | "REUSED";
}

export async function persistSourceChainAssessment(input: SourceChainSnapshot & {
  sourceFamilyId?: string | null;
  sourceVersionId?: string | null;
  acquisitionId?: string | null;
  temporalAssessmentId?: string | null;
}, overrides: Partial<SourceChainPersistenceContext> = {}): Promise<PersistedSourceAssessment> {
  const context = { ...defaultContext, ...overrides };
  return context.transaction(async (tx) => {
    const owner = await tx.query<{
      tenantId: string; caseId: string; missionId: string; researchQuestionSemanticKey: string;
      missionFingerprint: string; referenceDate: Date; referenceDateBasis: unknown; lifecycleStatus: string;
    }>(`
      SELECT r."tenantId", r."caseId", r."missionId", r."researchQuestionSemanticKey", r."missionFingerprint",
             m."referenceDate", m."referenceDateBasis", m."lifecycleStatus"
      FROM "ResearchQuestionResultRecord" r
      JOIN "ResearchMissionRecord" m ON m."id" = r."missionId" AND m."tenantId" = r."tenantId"
      WHERE r."id" = $1 AND r."tenantId" = $2 AND r."caseId" = $3
      FOR UPDATE OF r, m
    `, [input.resultId, input.tenantId, input.caseId]);
    const row = owner.rows[0];
    if (!row) throw new Error("RESEARCH_RESULT_NOT_FOUND");
    const referenceDate = row.referenceDate.toISOString().slice(0, 10);
    if (row.missionId !== input.missionId || row.researchQuestionSemanticKey !== input.researchQuestionSemanticKey
      || row.missionFingerprint !== input.missionFingerprint || referenceDate !== input.referenceDate) {
      throw new Error("SOURCE_CHAIN_SCOPE_MISMATCH");
    }
    const authoritative: SourceChainSnapshot = { ...input, referenceDateBasis: row.referenceDateBasis as Record<string, unknown>, currentMission: row.lifecycleStatus === "CURRENT" };
    const gate = evaluateUsableSourceGate(authoritative);
    const fingerprint = sourceChainFingerprint(authoritative);
    const assessmentId = id("source_assessment", fingerprint);
    const persistedReferenceDate = /^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)
      ? `${input.referenceDate}T00:00:00.000Z`
      : input.referenceDate;
    await tx.query(`UPDATE "ResearchSourceAssessmentRecord" SET "isCurrent" = false WHERE "resultId" = $1 AND "chainFingerprint" <> $2 AND "isCurrent" = true`, [input.resultId, fingerprint]);
    const inserted = await tx.query<{ id: string }>(`
      INSERT INTO "ResearchSourceAssessmentRecord" (
        "id", "tenantId", "caseId", "resultId", "missionId", "researchQuestionSemanticKey", "missionFingerprint",
        "referenceDate", "referenceDateBasis", "verificationVersion", "chainFingerprint", "sourceFamilyId",
        "sourceVersionId", "acquisitionId", "temporalAssessmentId", "sourceIdentityKey", "contentSha256",
        "retrievalState", "textState", "identityState", "contentState", "temporalState", "adverseState",
        "officiality", "citationAnchors", "blockingReasons", "manualReviewRequired", "manualReviewReason", "usable", "isCurrent"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,
        $18::"ResearchSourceRetrievalState",$19::"ResearchSourceTextState",$20::"ResearchSourceIdentityState",
        $21::"ResearchSourceContentState",$22::"ResearchSourceTemporalState",$23::"ResearchSourceAdverseState",
        $24::"ResearchSourceOfficiality",$25::jsonb,$26::text[],$27,$28,$29,true)
      ON CONFLICT ("chainFingerprint") DO NOTHING RETURNING "id"
    `, [assessmentId, row.tenantId, row.caseId, input.resultId, row.missionId, row.researchQuestionSemanticKey,
      row.missionFingerprint, persistedReferenceDate, JSON.stringify(row.referenceDateBasis ?? {}), input.verificationVersion,
      fingerprint, input.sourceFamilyId ?? null, input.sourceVersionId ?? null, input.acquisitionId ?? null,
      input.temporalAssessmentId ?? null, input.sourceIdentityKey, input.contentSha256, input.retrievalState,
      input.textState, input.identityState, input.contentState, input.temporalState, input.adverseState,
      input.officiality, JSON.stringify(input.citationAnchors), gate.blockingReasons, input.manualReviewRequired,
      input.manualReviewReason, gate.usable]);
    if (inserted.rows.length === 0) {
      await tx.query(`UPDATE "ResearchSourceAssessmentRecord" SET "isCurrent" = true WHERE "chainFingerprint" = $1`, [fingerprint]);
    }
    return { ...authoritative, id: assessmentId, chainFingerprint: fingerprint, blockingReasons: gate.blockingReasons, usable: gate.usable, isCurrent: true, outcome: inserted.rows.length ? "CREATED" : "REUSED" };
  });
}

export async function initializeDiscoveredSourceAssessment(input: {
  resultId: string;
  candidate: AuthorityCandidate;
}, overrides: Partial<SourceChainPersistenceContext> = {}): Promise<PersistedSourceAssessment> {
  const context = { ...defaultContext, ...overrides };
  const owner = await context.read.query<{
    tenantId: string; caseId: string; missionId: string; researchQuestionSemanticKey: string;
    missionFingerprint: string; referenceDate: Date; referenceDateBasis: Record<string, unknown>;
  }>(`
    SELECT r."tenantId", r."caseId", r."missionId", r."researchQuestionSemanticKey", r."missionFingerprint",
           m."referenceDate", m."referenceDateBasis"
    FROM "ResearchQuestionResultRecord" r JOIN "ResearchMissionRecord" m ON m."id"=r."missionId"
    WHERE r."id"=$1
  `, [input.resultId]);
  const row = owner.rows[0];
  if (!row) throw new Error("RESEARCH_RESULT_NOT_FOUND");
  const identity = input.candidate.officialIdentifier ?? input.candidate.ecli ?? input.candidate.celex ?? input.candidate.providerDocumentId ?? null;
  const retrievalState = input.candidate.exactReferenceMatch === false
    ? "BLOCKED"
    : input.candidate.exactReferenceMatch === true || input.candidate.verificationState === "OFFICIALLY_VERIFIED"
      ? "RESOLVED"
      : "RETRIEVAL_REQUIRED";
  const identityState = input.candidate.verificationState === "OFFICIALLY_VERIFIED"
    ? "VERIFIED"
    : input.candidate.verificationState === "OFFICIAL_VERIFICATION_FAILED"
        || input.candidate.exactReferenceMatch === false
      ? "MISMATCH"
      : retrievalState === "RESOLVED" ? "INCOMPLETE" : "NOT_ASSESSED";
  const manualReviewRequired = retrievalState === "BLOCKED"
    || identityState === "MISMATCH"
    || identityState === "INCOMPLETE";
  return persistSourceChainAssessment({
    resultId: input.resultId, tenantId: row.tenantId, caseId: row.caseId, missionId: row.missionId,
    researchQuestionSemanticKey: row.researchQuestionSemanticKey, missionFingerprint: row.missionFingerprint,
    referenceDate: row.referenceDate.toISOString().slice(0, 10), referenceDateBasis: row.referenceDateBasis ?? {},
    verificationVersion: SOURCE_CHAIN_VERIFICATION_VERSION,
    sourceIdentityKey: identity,
    contentSha256: input.candidate.verifiedEvidence?.contentSha256 ?? null,
    retrievalState,
    textState: input.candidate.verifiedEvidence ? "FULL_TEXT"
      : input.candidate.relevantPassage ? "SNIPPET_ONLY" : "METADATA_ONLY",
    identityState,
    contentState: input.candidate.verifiedEvidence ? "VERIFIED" : "INCOMPLETE",
    temporalState: "NOT_ASSESSED",
    adverseState: input.candidate.supportDirection === "SUPPORT" ? "REQUIRED" : "NOT_REQUIRED",
    officiality: input.candidate.verifiedEvidence ? "OFFICIAL" : "UNKNOWN",
    citationAnchors: [],
    manualReviewRequired,
    manualReviewReason: manualReviewRequired ? "SOURCE_VERIFICATION_INCOMPLETE" : null,
    currentMission: true,
  }, context);
}

export async function ensureAdverseResearchMission(input: {
  tenantId: string;
  caseId: string;
  primaryMissionId: string;
}, overrides: Partial<SourceChainPersistenceContext> = {}): Promise<{
  outcome: "NOT_REQUIRED" | "CREATED" | "REUSED";
  requirementId: string | null;
  adverseMissionId: string | null;
}> {
  const context = { ...defaultContext, ...overrides };
  return context.transaction(async (tx) => {
    const primary = await tx.query<{
      id: string; tenantId: string; caseId: string; contractVersion: string; referenceDate: Date; payload: Record<string, unknown>;
      payloadFingerprint: string; missionFingerprint: string; knowledgeRevisionId: string; firstKnowledgeRevisionId: string;
      legalIssueSemanticKey: string; researchQuestionSemanticKey: string; referenceDateBasis: unknown; lifecycleStatus: string; mode: string;
    }>(`SELECT * FROM "ResearchMissionRecord" WHERE "id"=$1 AND "tenantId"=$2 AND "caseId"=$3 FOR UPDATE`, [input.primaryMissionId, input.tenantId, input.caseId]);
    const mission = primary.rows[0];
    if (!mission || mission.lifecycleStatus !== "CURRENT" || mission.mode === "ADVERSE_SEARCH") return { outcome: "NOT_REQUIRED", requirementId: null, adverseMissionId: null };
    const resultRows = await tx.query<{ supportDirection: "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED"; usable: boolean; blockingReasons: string[] }>(`
      SELECT r."supportDirection", a."usable", a."blockingReasons" FROM "ResearchQuestionResultRecord" r
      JOIN "ResearchSourceAssessmentRecord" a ON a."resultId"=r."id" AND a."isCurrent"=true
      WHERE r."missionId"=$1 AND r."tenantId"=$2
    `, [mission.id, mission.tenantId]);
    const policy = evaluateAdverseRequirement({
      primaryMissionFingerprint: mission.missionFingerprint,
      researchQuestionSemanticKey: mission.researchQuestionSemanticKey,
      results: resultRows.rows.map((result) => ({
        direction: result.supportDirection,
        usable: result.usable || (result.blockingReasons.length > 0
          && result.blockingReasons.every((reason) => reason === "ADVERSE_NOT_COMPLETED")),
      })),
    });
    if (!policy.required) return { outcome: "NOT_REQUIRED", requirementId: null, adverseMissionId: null };
    await tx.query(`
      UPDATE "ResearchMissionRecord" SET "lifecycleStatus"='HISTORICAL'
      WHERE "id" IN (
        SELECT "adverseMissionId" FROM "ResearchAdverseRequirement"
        WHERE "tenantId"=$1 AND "caseId"=$2 AND "researchQuestionSemanticKey"=$3
          AND "status"<>'HISTORICAL' AND "primaryMissionFingerprint"<>$4 AND "adverseMissionId" IS NOT NULL
      )
    `, [mission.tenantId, mission.caseId, mission.researchQuestionSemanticKey, mission.missionFingerprint]);
    await tx.query(`
      UPDATE "ResearchAdverseRequirement" SET "status"='HISTORICAL'
      WHERE "tenantId"=$1 AND "caseId"=$2 AND "researchQuestionSemanticKey"=$3
        AND "status"<>'HISTORICAL' AND "primaryMissionFingerprint"<>$4
    `, [mission.tenantId, mission.caseId, mission.researchQuestionSemanticKey, mission.missionFingerprint]);
    const adverseMissionId = id("adverse_mission", policy.fingerprint);
    const requirementId = id("adverse_requirement", policy.fingerprint);
    const adversePayload = {
      ...mission.payload,
      missionId: adverseMissionId,
      mode: "ADVERSE_SEARCH",
      status: "PENDING",
      assumptionsFingerprint: policy.fingerprint,
      executionPlan: { requiredCapabilities: ["ADVERSE_AUTHORITY_DISCOVERY"] },
    };
    const adverseFingerprint = hash({ primaryMissionFingerprint: mission.missionFingerprint, policyVersion: ADVERSE_POLICY_VERSION, mode: "ADVERSE_SEARCH" });
    const inserted = await tx.query<{ id: string }>(`
      INSERT INTO "ResearchMissionRecord" (
        "id","tenantId","contractVersion","caseId","referenceDate","mode","payload","payloadFingerprint",
        "missionFingerprint","knowledgeRevisionId","firstKnowledgeRevisionId","legalIssueSemanticKey",
        "researchQuestionSemanticKey","referenceDateBasis","lifecycleStatus","status"
      ) VALUES ($1,$2,$3,$4,$5,'ADVERSE_SEARCH',$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,'CURRENT','PENDING')
      ON CONFLICT ("tenantId","caseId","missionFingerprint") DO NOTHING RETURNING "id"
    `, [adverseMissionId, mission.tenantId, mission.contractVersion, mission.caseId, mission.referenceDate,
      JSON.stringify(adversePayload), hash(adversePayload), adverseFingerprint, mission.knowledgeRevisionId,
      mission.firstKnowledgeRevisionId, mission.legalIssueSemanticKey, mission.researchQuestionSemanticKey,
      JSON.stringify(mission.referenceDateBasis ?? {})]);
    await tx.query(`
      INSERT INTO "ResearchAdverseRequirement" (
        "id","tenantId","caseId","researchQuestionSemanticKey","primaryMissionId","adverseMissionId",
        "primaryMissionFingerprint","policyVersion","requirementFingerprint","rationale"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT ("requirementFingerprint") DO UPDATE SET "adverseMissionId"=EXCLUDED."adverseMissionId"
    `, [requirementId, mission.tenantId, mission.caseId, mission.researchQuestionSemanticKey, mission.id,
      adverseMissionId, mission.missionFingerprint, policy.policyVersion, policy.fingerprint, policy.rationale]);
    return { outcome: inserted.rows.length ? "CREATED" : "REUSED", requirementId, adverseMissionId };
  });
}

export async function completeAdverseResearchRequirement(input: {
  tenantId: string;
  caseId: string;
  adverseMissionId: string;
}, overrides: Partial<SourceChainPersistenceContext> = {}): Promise<number> {
  const context = { ...defaultContext, ...overrides };
  const primaryMissionId = await context.transaction(async (tx) => {
    const completed = await tx.query<{ primaryMissionId: string }>(`
      UPDATE "ResearchAdverseRequirement" r SET "status"='COMPLETED', "completedAt"=CURRENT_TIMESTAMP
      FROM "ResearchMissionRecord" m
      WHERE r."adverseMissionId"=$1 AND r."tenantId"=$2 AND r."caseId"=$3
        AND m."id"=r."adverseMissionId" AND m."mode"='ADVERSE_SEARCH'
        AND m."lifecycleStatus"='CURRENT' AND m."status"='COMPLETED'
      RETURNING r."primaryMissionId"
    `, [input.adverseMissionId, input.tenantId, input.caseId]);
    return completed.rows[0]?.primaryMissionId ?? null;
  });
  if (!primaryMissionId) return 0;
  const assessments = await context.read.query<SourceChainSnapshot & { referenceDate: Date }>(`
    SELECT a."resultId",a."tenantId",a."caseId",a."missionId",a."researchQuestionSemanticKey",a."missionFingerprint",
      a."referenceDate",a."referenceDateBasis",a."verificationVersion",a."sourceIdentityKey",a."contentSha256",
      a."retrievalState",a."textState",a."identityState",a."contentState",a."temporalState",a."adverseState",
      a."officiality",a."citationAnchors",a."manualReviewRequired",a."manualReviewReason",true AS "currentMission"
    FROM "ResearchSourceAssessmentRecord" a
    JOIN "ResearchQuestionResultRecord" r ON r."id"=a."resultId"
    WHERE a."missionId"=$1 AND a."tenantId"=$2 AND a."caseId"=$3 AND a."isCurrent"=true
      AND a."adverseState"='REQUIRED' AND r."supportDirection"='SUPPORTS'
  `, [primaryMissionId, input.tenantId, input.caseId]);
  for (const assessment of assessments.rows) {
    await persistSourceChainAssessment({
      ...assessment,
      referenceDate: assessment.referenceDate.toISOString().slice(0, 10),
      adverseState: "COMPLETED",
    }, context);
  }
  return assessments.rows.length;
}