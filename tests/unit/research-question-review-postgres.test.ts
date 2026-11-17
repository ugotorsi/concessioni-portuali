import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-auth")>(),
  getCurrentTenantContext: vi.fn(async () => null),
}));

import { prisma } from "@/lib/prisma";
import {
  CLASSIFICATION_REVIEW_ACTION,
  classificationReviewFingerprint,
} from "@/server/legal-research/question-result-attestation";
import { reviewResearchQuestionResult } from "@/server/legal-research/question-results";
import { getFascicoloAutomaticWorkflowReadModelForTenant } from "@/server/queries/fascicolo-automatic-workflow";

const databaseUrl = process.env.NOETRA_GUIDED_E2E_PG_URL;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!databaseUrl)("audited source review on isolated migrated PostgreSQL", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let prismaConfigured = false;
  afterAll(async () => {
    if (prismaConfigured) await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("persists the reviewer and recognizes only an audit matching the current classification", async () => {
    if (!databaseUrl) throw new Error("A dedicated database URL is required.");
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55432"
      || url.username !== "noetra_test" || url.pathname !== "/noetra_test_workflow"
      || process.env.NOETRA_GUIDED_E2E !== "1" || process.env.AI_REAL_DATA_ENABLED !== "false"
      || process.env.ASYNC_PROVIDER_EXECUTION_ENABLED !== "false"
      || process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED !== "false") {
      throw new Error("Refusing to write a source review outside the dedicated local test environment.");
    }
    process.env.DATABASE_URL = databaseUrl;
    prismaConfigured = true;
    const identity = await prisma.$queryRaw<Array<{ database: string; username: string; port: number }>>`
      SELECT current_database() AS database, current_user AS username, inet_server_port() AS port
    `;
    expect(identity[0]).toEqual({ database: "noetra_test_workflow", username: "noetra_test", port: 55432 });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo.local" },
      select: { id: true, tenantMemberships: { where: { isDefault: true }, select: { enteId: true } } },
    });
    const tenantId = admin.tenantMemberships[0]?.enteId;
    if (!tenantId) throw new Error("The isolated administrator has no tenant.");
    const suffix = randomUUID();
    const caseId = `e2e-source-review-${suffix}`;
    const missionId = `mission-${suffix}`;
    const attemptId = `attempt-${suffix}`;
    const bundleId = `bundle-${suffix}`;
    const resultId = `result-${suffix}`;
    const questionKey = sha(`question-${suffix}`);
    const missionFingerprint = sha(`mission-${suffix}`);
    const now = new Date();
    await prisma.procedimento.create({ data: { id: caseId, enteId: tenantId, tipologia: "ALTRO", stato: "IN_CORSO" } });
    await prisma.researchMissionRecord.create({ data: {
      id: missionId, tenantId, contractVersion: "ISOLATED_TEST", caseId, referenceDate: now,
      mode: "DISCOVER_AUTHORITIES", payload: { researchQuestion: "Quesito sintetico" },
      payloadFingerprint: sha(`payload-${suffix}`), missionFingerprint,
      legalIssueSemanticKey: sha(`issue-${suffix}`), researchQuestionSemanticKey: questionKey, status: "COMPLETED", completedAt: now,
    } });
    await prisma.researchExecutionAttempt.create({ data: {
      id: attemptId, missionId, executorKind: "TEST", claimantId: "test",
      claimToken: sha(`claim-${suffix}`), startedAt: now, leaseExpiresAt: now,
    } });
    await prisma.researchEvidenceBundleRecord.create({ data: {
      id: bundleId, missionId, executionId: attemptId, contractVersion: "ISOLATED_TEST",
      fingerprint: sha(`bundle-${suffix}`), payload: {}, completionState: "COMPLETE",
      totalCalls: 0, moonlitCalls: 0, simpliciterCalls: 0, legalDataHunterCalls: 0, submittedByActorId: admin.id,
    } });
    await prisma.researchQuestionResultRecord.create({ data: {
      id: resultId, tenantId, caseId, missionId, bundleId, candidateId: `candidate-${suffix}`,
      legalIssueSemanticKey: sha(`issue-${suffix}`), researchQuestionSemanticKey: questionKey,
      missionFingerprint, toolId: "isolated-test",
      candidateSnapshot: {
        kind: "AUTHORITY_CANDIDATE", candidateId: `candidate-${suffix}`, executionRecordId: attemptId,
        toolId: "isolated-test", title: "Fonte sintetica", supportDirection: "SUPPORT",
        sourceFamily: "OTHER", retrievalMethod: "SEMANTIC_SEARCH", fullTextAvailable: false,
        verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
      },
    } });
    const values = {
      tenantId, missionId, resultId, direction: "SUPPORTS" as const, reviewStatus: "HUMAN_CONFIRMED" as const,
      confidence: null, rationale: "La fonte sintetica affronta il quesito con limiti esplicitati.",
    };
    await reviewResearchQuestionResult({ ...values, actor: { userId: admin.id, role: "ADMIN" } });
    const events = await prisma.activityLog.findMany({
      where: { enteId: tenantId, entitaId: resultId, azione: CLASSIFICATION_REVIEW_ACTION },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: admin.id, userRole: "ADMIN", esito: "SUCCESS",
      metadata: {
        missionId, direction: values.direction, reviewStatus: values.reviewStatus, confidence: null,
        rationale: values.rationale, classificationFingerprint: classificationReviewFingerprint(values),
      },
    });
    const first = await getFascicoloAutomaticWorkflowReadModelForTenant({ tenantId, procedimentoId: caseId });
    expect(first?.missions[0].results[0].classificationReviewAuditId).toBe(events[0].id);
    await prisma.researchQuestionResultRecord.update({ where: { id: resultId }, data: { supportDirection: "OPPOSES" } });
    const changed = await getFascicoloAutomaticWorkflowReadModelForTenant({ tenantId, procedimentoId: caseId });
    expect(changed?.missions[0].results[0].classificationReviewAuditId).toBeNull();
    await expect(reviewResearchQuestionResult({
      ...values, actor: { userId: admin.id, role: "OPERATORE_SOCIETA" },
    })).rejects.toThrow("RESEARCH_REVIEW_FORBIDDEN");
  }, 30_000);
});
