import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createAssistedVerificationRouteHandlers } from "@/server/legal-research/assisted-verification-route";
import {
  buildInitialVerificationCommand,
  canSubmitLegalReview,
  type ReviewerVerification,
} from "@/components/legal-research/reviewer-view-model";
import type { CurrentTenantContext } from "@/lib/tenant-auth";
import { RESEARCH_BRIDGE_VERSION, createResearchMission } from "@/server/legal-research/bridge";
import {
  claimResearchMission,
  createAssistedVerificationReader,
  createResearchMissionRecord,
  getLatestAssistedVerification,
  getResearchMission,
  persistAssistedVerification,
  type ResearchPersistenceClient,
  type ResearchPersistenceContext,
  type ResearchServiceActor,
} from "@/server/legal-research/persistence";
import {
  createTrustedMissionExecutor,
  projectAssistedVerificationEvidence,
} from "@/server/legal-research/trusted-mission-executor";
import type { TrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";
import { readAssistedDocumentEvidence } from "@/server/legal-research/assisted-document-evidence";

const root = process.cwd();
const researchMigration = readFileSync(path.join(
  root,
  "prisma",
  "migrations",
  "20260917_block3b13b_research_persistence",
  "migration.sql",
), "utf8");
const assistedMigration = readFileSync(path.join(
  root,
  "prisma",
  "migrations",
  "20260926_assisted_verification_persistence",
  "migration.sql",
), "utf8");
const now = new Date("2026-09-26T12:00:00.000Z");
const actor = { actorId: "legal-user-a", tenantId: "tenant-a" } as const;

type SqlExecutor = Readonly<{
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}>;

async function one<T>(
  executor: SqlExecutor,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const result = await executor.query<T>(sql, params);
  return result.rows[0] ?? null;
}

function pglitePersistenceClient(executor: SqlExecutor): ResearchPersistenceClient {
  const researchMissionRecord = {
    findUnique: async ({ where }: { where: { id?: string; payloadFingerprint?: string } }) => {
      if (where.id) {
        return one(executor, 'SELECT * FROM "ResearchMissionRecord" WHERE "id" = $1', [where.id]);
      }
      return one(
        executor,
        'SELECT * FROM "ResearchMissionRecord" WHERE "payloadFingerprint" = $1',
        [where.payloadFingerprint],
      );
    },
    create: async ({ data }: { data: Record<string, unknown> }) => one(executor, `
      INSERT INTO "ResearchMissionRecord" (
        "id", "tenantId", "contractVersion", "caseId", "fascicoloReference",
        "referenceDate", "mode", "payload", "payloadFingerprint", "status",
        "stateVersion", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'PENDING', 0, $10)
      RETURNING *
    `, [
      data.id,
      data.tenantId,
      data.contractVersion,
      data.caseId,
      data.fascicoloReference ?? null,
      data.referenceDate,
      data.mode,
      JSON.stringify(data.payload),
      data.payloadFingerprint,
      now,
    ]),
  };
  const researchAssistedVerificationRecord = {
    findUnique: async ({ where }: { where: { fingerprint: string } }) => one(executor, `
      SELECT * FROM "ResearchAssistedVerificationRecord" WHERE "fingerprint" = $1
    `, [where.fingerprint]),
    findFirst: async ({ where }: { where: { missionId: string; tenantId: string } }) => one(executor, `
      SELECT * FROM "ResearchAssistedVerificationRecord"
      WHERE "missionId" = $1 AND "tenantId" = $2
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1
    `, [where.missionId, where.tenantId]),
    create: async ({ data }: { data: Record<string, unknown> }) => one(executor, `
      INSERT INTO "ResearchAssistedVerificationRecord" (
        "id", "missionId", "tenantId", "contractVersion",
        "fingerprint", "payload", "recordedByActorId"
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING *
    `, [
      data.id,
      data.missionId,
      data.tenantId,
      data.contractVersion,
      data.fingerprint,
      JSON.stringify(data.payload),
      data.recordedByActorId,
    ]),
  };
  return {
    researchMissionRecord,
    researchAssistedVerificationRecord,
    researchExecutionAttempt: {},
    researchEvidenceBundleRecord: {},
  } as unknown as ResearchPersistenceClient;
}

function pglitePersistenceContext(database: PGlite): ResearchPersistenceContext {
  let activeSql = database as unknown as SqlExecutor;
  return {
    persistQuestionResults: async () => [],
    readAssistedDocuments: (mission, tenantId, sources) => readAssistedDocumentEvidence(mission, tenantId, sources, {
      client: {
        documentFileVersion: { findFirst: async ({ where }: { where: { id: string; documentId: string; canonicalEnteId: string; document: { OR: [{ procedimentoId: { in: string[] } }] } } }) => one(activeSql,
          'SELECT "fileVersionId" AS "id", "documentId", "tenantId" AS "canonicalEnteId", \'local\' AS "storageProvider", "fileVersionId" AS "storageKey", NULL AS "storageBucket", octet_length("body") AS "sizeBytes", "sha256" FROM "SyntheticDocument" WHERE "fileVersionId"=$1 AND "documentId"=$2 AND "tenantId"=$3 AND "caseId"=ANY($4::text[])',
          [where.id, where.documentId, where.canonicalEnteId, where.document.OR[0].procedimentoId.in]) },
        legalSourceVersion: { findFirst: async ({ where }: { where: { sourceFamilyId: string; legalExpressionVersionId: string; observedSha256: string; observedSizeBytes: number; sourceFamily: { enteId: string; identityAssertions: { some: { normalizedValue: string } } } } }) => one(activeSql,
          'SELECT "fileVersionId" AS "id" FROM "SyntheticDocument" WHERE "legalSourceId"=$1 AND "expressionId"=$2 AND "sha256"=$3 AND octet_length("body")=$4 AND "tenantId"=$5 AND "officialIdentifier"=$6',
          [where.sourceFamilyId, where.legalExpressionVersionId, where.observedSha256, where.observedSizeBytes, where.sourceFamily.enteId, where.sourceFamily.identityAssertions.some.normalizedValue]) },
      } as unknown as NonNullable<Parameters<typeof readAssistedDocumentEvidence>[3]>["client"],
      read: async ({ storageKey }) => {
        const document = await one<{ body: string }>(activeSql, 'SELECT "body" FROM "SyntheticDocument" WHERE "fileVersionId"=$1 AND "available"=true', [storageKey]);
        return document ? { disposition: "FOUND", body: Buffer.from(document.body) } : { disposition: "MISSING" };
      },
    }),
    client: pglitePersistenceClient(database as unknown as SqlExecutor),
    transaction: <T>(operation: (client: ResearchPersistenceClient) => Promise<T>) => (
      database.transaction(async (transaction) => {
        activeSql = transaction as unknown as SqlExecutor;
        try { return await operation(pglitePersistenceClient(activeSql)); }
        finally { activeSql = database as unknown as SqlExecutor; }
      })
    ),
    clock: { now: () => now },
    claimToken: () => "f".repeat(64),
  };
}

function tenantContext(
  role: CurrentTenantContext["role"],
  tenantId: string,
): CurrentTenantContext {
  return {
    userId: "legal-user-a",
    role,
    isAdmin: role === "ADMIN",
    tenantMemberships: [],
    defaultTenantId: tenantId,
    accessibleTenantIds: [tenantId],
  };
}

function request(method: "PUT" | "PATCH" | "POST", body: unknown): Request {
  return new Request("https://app.example.test/api/legal-research/assisted-verification", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sourceDraft = {
  evidenceSourceId: "source-a",
  authorityId: "authority-a",
  legalSourceId: "legal-source-a",
  legalExpressionVersionId: "expression-a",
  officialIdentifier: "ECLI:EU:C:2024:1",
  sourceUrl: "https://official.example.test/authority-a",
  sourceFamily: "CJEU" as const,
  courtOrBody: "Court of Justice of the European Union",
  documentType: "Judgment",
  contentSha256: createHash("sha256").update("Synthetic authority A").digest("hex"),
  documentId: "document-a",
  fileVersionId: "file-a",
  termsOfUseBasis: "Official public-access terms checked by the reviewer.",
  verificationRationale: "Identity and full text match the official publication.",
};

function mission(question: string, overrides: Partial<Parameters<typeof createResearchMission>[0]> = {}) {
  return createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-a" },
    legalIssueIds: ["issue-a"],
    legalPropositionIds: ["proposition-a"],
    referenceDate: "2026-09-26T00:00:00.000Z",
    mode: "ADVERSE_SEARCH",
    researchQuestion: question,
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["CJEU"],
    missingSourceFamilies: ["CASSAZIONE"],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: true,
    },
    budget: {
      maxTotalResearchCalls: 1,
      maxMoonlitCalls: 1,
      maxSimpliciterCalls: 1,
      maxLegalDataHunterCalls: 1,
    },
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: [
        "FULL_TEXT_RETRIEVAL",
        "CITATION_NETWORK",
        "ADVERSE_AUTHORITY_DISCOVERY",
      ],
    },
    ...overrides,
  });
}

function fullBootstrapCommand(missionId: string): unknown {
  return buildInitialVerificationCommand({
    missionId,
    source: sourceDraft,
    includeCitationRelation: true,
    targetSource: {
      ...sourceDraft,
      evidenceSourceId: "source-b",
      authorityId: "authority-b",
      legalSourceId: "legal-source-b",
      legalExpressionVersionId: "expression-b",
      officialIdentifier: "ECLI:EU:C:2020:2",
      sourceUrl: "https://official.example.test/authority-b",
      contentSha256: createHash("sha256").update("Synthetic authority B").digest("hex"),
      documentId: "document-b",
      fileVersionId: "file-b",
    },
    citationParagraph: "42",
  });
}

function sourceOnlyCommand(missionId: string): unknown {
  return buildInitialVerificationCommand({
    missionId,
    source: sourceDraft,
    includeCitationRelation: false,
    targetSource: sourceDraft,
    citationParagraph: "",
  });
}

function incompleteCandidateCommand(missionId: string): unknown {
  const command = structuredClone(fullBootstrapCommand(missionId)) as {
    sources: Array<Record<string, unknown>>;
  };
  delete command.sources[0].documentType;
  return command;
}

function reviewCommand(missionId: string) {
  return {
    missionId,
    legalPropositionId: "proposition-a",
    rationale: "The documented authority is adverse to the identified legal proposition.",
    evidenceSourceId: "source-a",
    decision: "ADVERSE" as const,
  };
}

describe("assisted verification route with disposable PGlite persistence", () => {
  it("persists the complete reviewer journey and keeps missing evidence pre-claim", async () => {
    const database = new PGlite();
    try {
      await database.exec('CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY)');
      await database.exec("INSERT INTO \"Ente\" (\"id\") VALUES ('tenant-a'), ('tenant-b')");
      await database.exec(researchMigration);
      await database.exec(assistedMigration);
      await database.exec('CREATE TABLE "SyntheticDocument" ("documentId" TEXT, "fileVersionId" TEXT PRIMARY KEY, "tenantId" TEXT, "caseId" TEXT, "legalSourceId" TEXT, "expressionId" TEXT, "officialIdentifier" TEXT, "sha256" TEXT, "body" TEXT, "available" BOOLEAN DEFAULT true)');
      for (const suffix of ["a", "b"]) {
        const body = `Synthetic authority ${suffix.toUpperCase()}`;
        await database.query('INSERT INTO "SyntheticDocument" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)', [
          `document-${suffix}`, `file-${suffix}`, "tenant-a", "case-a", `legal-source-${suffix}`, `expression-${suffix}`,
          suffix === "a" ? "ECLI:EU:C:2024:1" : "ECLI:EU:C:2020:2", createHash("sha256").update(body).digest("hex"), body,
        ]);
      }

      const persistence = pglitePersistenceContext(database);
      const primaryMission = mission("PGlite complete reviewer journey");
      const sourceOnlyMission = mission("PGlite source-only pre-claim gate");
      const incompleteCandidateMission = mission("PGlite incomplete authority candidate");
      const gapMission = mission("PGlite individual documentary gaps", {
        missingSourceFamilies: [],
        knownEvidenceGaps: [
          { gapId: "gap-a", kind: "MISSING_DOCUMENT", targetId: "document-a" },
          { gapId: "gap-b", kind: "MISSING_DOCUMENT", targetId: "document-b" },
        ],
        requiredOutput: { authorityCandidates: false, citationObservations: false, legalResearchSuggestions: false, evidenceGaps: true, fullTextRequired: true },
        executionPlan: { requiredCapabilities: ["FULL_TEXT_RETRIEVAL"] },
      });
      await createResearchMissionRecord({ mission: gapMission, actor }, persistence);
      await createResearchMissionRecord({ mission: primaryMission, actor }, persistence);
      await createResearchMissionRecord({ mission: sourceOnlyMission, actor }, persistence);
      await createResearchMissionRecord({ mission: incompleteCandidateMission, actor }, persistence);

      let session: CurrentTenantContext | null = tenantContext("GIURIDICO", "tenant-a");
      const dependencies = {
        getCurrentTenantContext: async () => session,
        getLatestAssistedVerification: (
          missionId: string,
          currentActor: ResearchServiceActor,
        ) => getLatestAssistedVerification(missionId, currentActor, persistence),
        persistAssistedVerification: (
          input: Parameters<typeof persistAssistedVerification>[0],
        ) => persistAssistedVerification(input, persistence),
        now: () => now,
      };
      const handlers = createAssistedVerificationRouteHandlers(dependencies);
      const url = (missionId: string) => (
        `https://app.example.test/api/legal-research/assisted-verification?missionId=${missionId}`
      );

      expect(await getLatestAssistedVerification(primaryMission.missionId, actor, persistence)).toBeNull();
      expect((await handlers.GET(new Request(url(primaryMission.missionId)))).status).toBe(404);

      session = tenantContext("TECNICO", "tenant-a");
      expect((await handlers.PUT(request("PUT", fullBootstrapCommand(primaryMission.missionId)))).status)
        .toBe(403);
      session = tenantContext("GIURIDICO", "tenant-b");
      expect((await handlers.PUT(request("PUT", fullBootstrapCommand(primaryMission.missionId)))).status)
        .toBe(403);
      session = tenantContext("GIURIDICO", "tenant-a");
      expect((await handlers.PUT(request("PUT", {
        missionId: primaryMission.missionId,
        sources: [{ ...sourceDraft, contentSha256: "" }],
      }))).status).toBe(400);

      const bootstrapResponse = await handlers.PUT(request(
        "PUT",
        fullBootstrapCommand(primaryMission.missionId),
      ));
      expect(bootstrapResponse.status).toBe(201);
      const initial = await getLatestAssistedVerification(primaryMission.missionId, actor, persistence);
      expect(initial).not.toBeNull();
      expect(initial?.snapshot.sources).toHaveLength(2);
      expect(initial?.result.citationObservations).toHaveLength(1);
      expect(initial?.result.authorityCandidates).toEqual([
        expect.objectContaining({
          officialIdentifier: sourceDraft.officialIdentifier,
          verificationState: "OFFICIALLY_VERIFIED",
          supportDirection: "UNKNOWN",
          verifiedEvidence: expect.objectContaining({
            evidenceSourceId: "source-a",
            contentSha256: sourceDraft.contentSha256,
            locator: { paragraph: "42" },
            termsOfUseBasis: sourceDraft.termsOfUseBasis,
            reviewedByActorId: actor.actorId,
          }),
        }),
      ]);
      expect(initial?.result.adverseAuthorityVerified).toBe(false);
      expect(initial?.snapshot.sources[0].reviewerAttestation).toMatchObject({
        reviewedByActorId: actor.actorId,
        reviewedAt: now.toISOString(),
      });
      const initialReadResponse = await handlers.GET(new Request(url(primaryMission.missionId)));
      const initialReadPayload = await initialReadResponse.json() as {
        verification: ReviewerVerification;
      };
      expect(initialReadResponse.status).toBe(200);
      expect(initialReadPayload.verification.snapshot.sources[0]).toMatchObject({
        evidenceSourceId: "source-a",
        officialIdentifier: sourceDraft.officialIdentifier,
        sourceUrl: sourceDraft.sourceUrl,
        fullText: { contentSha256: sourceDraft.contentSha256 },
      });
      expect(canSubmitLegalReview(
        initialReadPayload.verification,
        reviewCommand(primaryMission.missionId),
      )).toBe(true);

      expect((await handlers.PUT(request(
        "PUT",
        fullBootstrapCommand(primaryMission.missionId),
      ))).status).toBe(409);

      const initialAdverseGap = initial!.result.evidenceGaps.find((item) => (
        item.kind === "NO_ADVERSE_AUTHORITY_CHECK"
      ))!;
      const suggestionCommand = {
        missionId: primaryMission.missionId,
        recordId: initial!.recordId,
        kind: "POSSIBLE_COUNTERARGUMENT",
        description: "Research the documented authority treatment before resolving the proposition.",
        rationale: "The verified citation leaves a legal-treatment gap requiring explicit reviewer research.",
        originatingGapId: initialAdverseGap.gapId,
        evidenceSourceId: "source-a",
      } as const;
      expect((await handlers.PATCH(request("PATCH", {
        ...suggestionCommand,
        evidenceSourceId: "source-without-proof",
      }))).status).toBe(422);
      session = tenantContext("GIURIDICO", "tenant-b");
      expect((await handlers.PATCH(request("PATCH", suggestionCommand))).status).toBe(403);
      session = tenantContext("GIURIDICO", "tenant-a");
      expect((await handlers.PATCH(request("PATCH", suggestionCommand))).status).toBe(201);
      const suggested = await getLatestAssistedVerification(primaryMission.missionId, actor, persistence);
      expect(suggested?.result.legalResearchSuggestions).toEqual([
        expect.objectContaining({
          rationale: suggestionCommand.rationale,
          reviewedByActorId: actor.actorId,
          reviewedAt: now.toISOString(),
          evidenceSourceIds: ["source-a"],
        }),
      ]);

      session = { ...tenantContext("GIURIDICO", "tenant-a"), userId: "legal-user-b" };
      const reviewResponse = await handlers.POST(request("POST", { ...reviewCommand(primaryMission.missionId), recordId: suggested!.recordId }));
      expect(reviewResponse.status).toBe(201);
      const latestResponse = await handlers.GET(new Request(url(primaryMission.missionId)));
      const latestPayload = await latestResponse.json() as { verification: ReviewerVerification };
      expect(latestPayload.verification.snapshot.adverseReview).toMatchObject({
        reviewedByActorId: "legal-user-b",
        reviewedAt: now.toISOString(),
        rationale: reviewCommand(primaryMission.missionId).rationale,
      });
      expect(latestPayload.verification.result.adverseAuthorityVerified).toBe(true);
      expect(latestPayload.verification.result.authorityCandidates).toHaveLength(1);
      expect(latestPayload.verification.result.legalResearchSuggestions).toHaveLength(1);
      expect(latestPayload.verification.snapshot.sources[0].reviewerAttestation.reviewedByActorId).toBe(actor.actorId);
      expect(latestPayload.verification.snapshot.researchSuggestions?.[0].reviewedByActorId).toBe(actor.actorId);
      expect(latestPayload.verification.preClaimStatus.satisfied).toBe(false);
      expect(latestPayload.verification.result.evidenceGaps).toContainEqual(expect.objectContaining({ sourceFamily: "CASSAZIONE" }));
      const assistedProjection = projectAssistedVerificationEvidence(
        primaryMission,
        latestPayload.verification.result,
      );
      expect(assistedProjection.authorityCandidates).toHaveLength(1);
      expect(assistedProjection.legalResearchSuggestions).toHaveLength(1);
      expect(assistedProjection.researchToolExecutions).toEqual([
        expect.objectContaining({
          toolId: "ASSISTED_VERIFICATION",
          operationType: "FULL_TEXT_RETRIEVAL",
          callsConsumed: 0,
        }),
      ]);

      const staleHandlers = createAssistedVerificationRouteHandlers({
        ...dependencies,
        getLatestAssistedVerification: async () => initial,
      });
      expect((await staleHandlers.POST(request("POST", { ...reviewCommand(primaryMission.missionId), recordId: initial!.recordId }))).status)
        .toBe(409);

      const rows = await database.query<{
        id: string;
        payload: { adverseReview?: unknown };
      }>(`
        SELECT "id", "payload" FROM "ResearchAssistedVerificationRecord"
        WHERE "missionId" = $1 ORDER BY "createdAt" ASC, "id" ASC
      `, [primaryMission.missionId]);
      expect(rows.rows).toHaveLength(3);
      const originalRow = rows.rows.find((row) => row.id === initial?.recordId);
      expect(originalRow?.payload).toEqual(initial?.snapshot);
      expect(originalRow?.payload.adverseReview).toBeUndefined();
      await expect(database.query(`
        UPDATE "ResearchAssistedVerificationRecord" SET "recordedByActorId" = 'changed'
        WHERE "id" = $1
      `, [initial?.recordId])).rejects.toThrow(/append-only/i);

      const sourceOnlyResponse = await handlers.PUT(request(
        "PUT",
        sourceOnlyCommand(sourceOnlyMission.missionId),
      ));
      expect(sourceOnlyResponse.status).toBe(201);
      const sourceOnly = await getLatestAssistedVerification(sourceOnlyMission.missionId, actor, persistence);
      expect(sourceOnly?.result.citationObservations).toEqual([]);
      expect(sourceOnly?.result.evidenceGaps)
        .toContainEqual(expect.objectContaining({ kind: "UNRESOLVED_AUTHORITY_TREATMENT" }));
      expect(sourceOnly?.preClaimStatus.satisfied).toBe(false);
      const additionalSource = {
        ...sourceDraft, evidenceSourceId: "source-b", authorityId: "authority-b", legalSourceId: "legal-source-b",
        legalExpressionVersionId: "expression-b", officialIdentifier: "ECLI:EU:C:2020:2",
        documentId: "document-b", fileVersionId: "file-b",
        contentSha256: createHash("sha256").update("Synthetic authority B").digest("hex"),
      };
      session = { ...tenantContext("GIURIDICO", "tenant-a"), userId: "legal-user-c" };
      const appended = await handlers.PUT(request("PUT", {
        missionId: sourceOnlyMission.missionId, recordId: sourceOnly!.recordId, sources: [additionalSource],
        citationRelation: { sourceAuthorityId: "authority-a", targetAuthorityId: "authority-b", evidenceSourceId: "source-a", locator: { paragraph: "42" } },
      }));
      expect(appended.status).toBe(201);
      const appendedRecord = await getLatestAssistedVerification(sourceOnlyMission.missionId, actor, persistence);
      expect(appendedRecord?.snapshot.sources[0].reviewerAttestation.reviewedByActorId).toBe("legal-user-b");
      expect(appendedRecord?.snapshot.sources[1].reviewerAttestation.reviewedByActorId).toBe("legal-user-c");
      expect((await handlers.PUT(request("PUT", {
        missionId: sourceOnlyMission.missionId, recordId: sourceOnly!.recordId, sources: [additionalSource],
      }))).status).toBe(409);
      const correctedBody = "Synthetic corrected authority B";
      const correctedHash = createHash("sha256").update(correctedBody).digest("hex");
      await database.query('INSERT INTO "SyntheticDocument" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)', [
        "document-b", "file-b-v2", "tenant-a", "case-a", "legal-source-b", "expression-b-v2", "ECLI:EU:C:2020:2", correctedHash, correctedBody,
      ]);
      session = { ...tenantContext("GIURIDICO", "tenant-a"), userId: "legal-user-d" };
      expect((await handlers.PUT(request("PUT", {
        missionId: sourceOnlyMission.missionId, recordId: appendedRecord!.recordId,
        sources: [{ ...additionalSource, fileVersionId: "file-b-v2", legalExpressionVersionId: "expression-b-v2", contentSha256: correctedHash }],
      }))).status).toBe(201);
      const corrected = await getLatestAssistedVerification(sourceOnlyMission.missionId, actor, persistence);
      expect(corrected?.snapshot.sources[0].reviewerAttestation.reviewedByActorId).toBe("legal-user-b");
      expect(corrected?.snapshot.sources[1].reviewerAttestation.reviewedByActorId).toBe("legal-user-d");
      expect(corrected?.snapshot.citationRelation).toBeUndefined();
      expect(appendedRecord?.snapshot.sources[1].fullText.fileVersionId).toBe("file-b");
      expect((await handlers.PUT(request("PUT", sourceOnlyCommand(gapMission.missionId)))).status).toBe(201);
      const beforeResolution = await getLatestAssistedVerification(gapMission.missionId, actor, persistence);
      expect((await handlers.PUT(request("PUT", {
        missionId: gapMission.missionId, recordId: beforeResolution!.recordId, sources: [],
        gapResolutions: [{ gapId: "gap-b", evidenceSourceId: "source-a", targetId: "document-a" }],
      }))).status).toBe(400);
      expect((await handlers.PUT(request("PUT", {
        missionId: gapMission.missionId, recordId: beforeResolution!.recordId, sources: [],
        gapResolutions: [{ gapId: "gap-a", evidenceSourceId: "source-a", targetId: "document-a" }],
      }))).status).toBe(201);
      const partlyResolved = await getLatestAssistedVerification(gapMission.missionId, actor, persistence);
      expect(partlyResolved?.result.evidenceGaps.map((gap) => gap.gapId)).toEqual(["gap-b"]);
      await expect(claimResearchMission({ missionId: gapMission.missionId, executionId: "blocked-documentary", actor,
        executor: { kind: "AUTHORIZED_WORKER", claimantId: "local-test" }, leaseDurationMs: 60_000,
      }, persistence)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      expect((await getResearchMission(gapMission.missionId, actor, persistence))?.operational.status).toBe("PENDING");
      expect((await handlers.PUT(request("PUT", {
        missionId: gapMission.missionId, recordId: partlyResolved!.recordId, sources: [additionalSource],
        gapResolutions: [{ gapId: "gap-b", evidenceSourceId: "source-b", targetId: "document-b" }],
      }))).status).toBe(201);
      const resolved = await getLatestAssistedVerification(gapMission.missionId, actor, persistence);
      expect(resolved?.result.evidenceGaps).toEqual([]);
      expect(resolved?.preClaimStatus.satisfied).toBe(true);
      expect(await persistence.readAssistedDocuments!(primaryMission, "tenant-b", initial!.snapshot.sources)).toEqual([]);
      expect(await persistence.readAssistedDocuments!({ ...primaryMission, caseReference: { caseId: "other-case" } }, "tenant-a", initial!.snapshot.sources)).toEqual([]);
      const wrongExpression = initial!.snapshot.sources.map((source) => ({ ...source, legalExpressionVersionId: "wrong-expression" }));
      expect(await persistence.readAssistedDocuments!(primaryMission, "tenant-a", wrongExpression)).toEqual([]);
      await database.query('UPDATE "SyntheticDocument" SET "available"=false WHERE "fileVersionId"=$1', ["file-a"]);
      const reopened = await getLatestAssistedVerification(gapMission.missionId, actor, persistence);
      expect(reopened?.result.evidenceGaps).toContainEqual(expect.objectContaining({ gapId: "gap-a" }));
      expect(reopened?.result.evidenceGaps.some((gap) => gap.gapId === "gap-b")).toBe(false);
      expect(reopened?.preClaimStatus.satisfied).toBe(false);
      const missingFile = await getLatestAssistedVerification(primaryMission.missionId, actor, persistence);
      expect(missingFile?.result.verifiedFullTexts.some((source) => source.evidenceSourceId === "source-a")).toBe(false);
      expect(missingFile?.result.evidenceGaps).toContainEqual(expect.objectContaining({ kind: "FULL_TEXT_NOT_VERIFIED", targetId: "source-a" }));
      await database.query('UPDATE "SyntheticDocument" SET "available"=true, "body"=$1 WHERE "fileVersionId"=$2', ["Tampered authority A", "file-a"]);
      expect((await persistence.readAssistedDocuments!(primaryMission, "tenant-a", initial!.snapshot.sources)).some((source) => source.evidenceSourceId === "source-a")).toBe(false);
      await database.query('UPDATE "SyntheticDocument" SET "body"=$1 WHERE "fileVersionId"=$2', ["Synthetic authority A", "file-a"]);

      expect((await handlers.PUT(request(
        "PUT",
        incompleteCandidateCommand(incompleteCandidateMission.missionId),
      ))).status).toBe(201);
      const incompleteCandidate = await getLatestAssistedVerification(
        incompleteCandidateMission.missionId,
        actor,
        persistence,
      );
      expect(incompleteCandidate?.result.verifiedFullTexts).toHaveLength(2);
      expect(incompleteCandidate?.result.citationObservations).toHaveLength(1);
      expect(incompleteCandidate?.result.authorityCandidates).toEqual([]);
      expect(incompleteCandidate?.result.evidenceGaps).toContainEqual(expect.objectContaining({
        kind: "OFFICIAL_IDENTITY_NOT_VERIFIED",
        targetId: "source-a",
      }));
      expect(incompleteCandidate?.preClaimStatus.unmetRequirements)
        .toContain("AUTHORITY_CANDIDATES_MISSING");

      let claimCalls = 0;
      const localClient = {
        readMission: async (missionId: string) => {
          const stored = await getResearchMission(missionId, actor, persistence);
          if (!stored) throw new Error("MISSION_NOT_FOUND");
          return { ...stored, fascicoloContext: {} };
        },
        claimMission: async () => {
          claimCalls += 1;
          throw new Error("CLAIM_MUST_NOT_RUN");
        },
      } as unknown as TrustedResearchHttpClient;
      const blocked = await createTrustedMissionExecutor({
        client: localClient,
        providerAdapters: [],
        legalDataHunterApiKey: null,
        assistedVerificationReader: createAssistedVerificationReader(actor, persistence),
      }).execute(sourceOnlyMission.missionId);

      expect(blocked).toMatchObject({ status: "BLOCKED", callsConsumed: 0 });
      expect(blocked.blockerCodes).toContain("REQUIRED_CAPABILITY_UNAVAILABLE");
      expect(claimCalls).toBe(0);
    } finally {
      await database.close();
    }
  }, 15_000);
});
