import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  buildFascicoloReevaluationAdmission,
  createFascicoloReevaluationHandler,
  FASCICOLO_REEVALUATE_OPERATION,
  parseFascicoloReevaluationReference,
} from "@/server/fascicolo-lifecycle/fascicoloReevaluationJob";

const provenance = {
  tenantId: "ente-1",
  admissionType: "AUTHENTICATED_USER" as const,
  initiatingUserId: "user-1",
  actorId: "user-1",
  actorEmail: "user@example.test",
  actorRole: "GIURIDICO",
  policyDecisionRef: null,
  correlationId: "correlation-1",
};

function documentChange(triggeredAt = "2026-03-01T10:00:00.000Z", stateFingerprint = "a".repeat(64)) {
  return {
    kind: "DOCUMENT_CHANGED" as const,
    triggeredAt,
    origin: "USER_ACTION" as const,
    stateFingerprint,
    procedimentoId: "procedimento-1",
    documentId: "document-1",
    documentVersionId: "document-version-1",
    changeType: "VERSION_CHANGED" as const,
    legalEvidenceKind: "LEGAL_SOURCE" as const,
    legalAssessmentTarget: { kind: "UNDETERMINED" as const },
  };
}

function normalizedDocumentAdmission(triggeredAt?: string, stateFingerprint?: string) {
  return normalizeAsyncJobAdmission(buildFascicoloReevaluationAdmission({
    procedimentoId: "procedimento-1",
    change: documentChange(triggeredAt, stateFingerprint),
  }, provenance));
}

describe("Fase 2B Patch B fascicolo reevaluation job", () => {
  it("registers the planner handler on the existing application worker", () => {
    expect(applicationAsyncJobRegistry.resolve(FASCICOLO_REEVALUATE_OPERATION)).not.toBeNull();
  });

  it("builds a valid bounded admission for the existing AsyncJob core", () => {
    const admission = normalizedDocumentAdmission();

    expect(admission.operation).toBe(FASCICOLO_REEVALUATE_OPERATION);
    expect(admission.availableAt).toEqual(new Date(0));
    expect(admission.inputReference).toMatchObject({
      referenceType: "FASCICOLO_REEVALUATION",
      referenceId: "procedimento-1",
      referenceVersion: "V1",
      metadata: {
        changeContractVersion: "FASCICOLO_CHANGE_V1",
        changeFingerprintHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  it("reuses the same logical work and request for a different technical trigger time", () => {
    const first = normalizedDocumentAdmission("2026-03-01T10:00:00.000Z");
    const detectedLater = normalizedDocumentAdmission("2026-03-02T15:30:00.000Z");

    expect(first.idempotencyKey).toBe(detectedLater.idempotencyKey);
    expect(first.requestFingerprint).toBe(detectedLater.requestFingerprint);
    expect(first.inputReference).toEqual(detectedLater.inputReference);
  });

  it("creates different work for a different causal state", () => {
    const first = normalizedDocumentAdmission(undefined, "a".repeat(64));
    const changed = normalizedDocumentAdmission(undefined, "b".repeat(64));

    expect(first.idempotencyKey).not.toBe(changed.idempotencyKey);
    expect(first.requestFingerprint).not.toBe(changed.requestFingerprint);
  });

  it("rejects invalid changes and procedimento target mismatches before admission", () => {
    expect(() => buildFascicoloReevaluationAdmission({
      procedimentoId: "procedimento-1",
      change: { kind: "DOCUMENT_CHANGED" },
    }, provenance)).toThrow("INVALID_FASCICOLO_CHANGE");
    expect(() => buildFascicoloReevaluationAdmission({
      procedimentoId: "procedimento-2",
      change: documentChange(),
    }, provenance)).toThrow("PROCEDIMENTO_TARGET_MISMATCH");
  });

  it("fails closed when the queued causal state or fingerprint is tampered with", () => {
    const admission = normalizedDocumentAdmission();
    const reference = admission.inputReference;
    const wrongFingerprint = {
      ...reference,
      metadata: { ...reference.metadata, changeFingerprintHash: "b".repeat(64) },
    };
    const chunkKey = Object.keys(reference.metadata).find((key) => key.startsWith("changeChunk"))!;
    const invalidJson = {
      ...reference,
      metadata: { ...reference.metadata, [chunkKey]: "{" },
    };

    expect(() => parseFascicoloReevaluationReference(wrongFingerprint))
      .toThrow("CHANGE_FINGERPRINT_MISMATCH");
    expect(() => parseFascicoloReevaluationReference(invalidJson))
      .toThrow("INVALID_CHANGE_REFERENCE");
  });

  it("invokes the pure planner and emits only bounded technical result metadata", async () => {
    const handler = createFascicoloReevaluationHandler();
    const admission = normalizedDocumentAdmission();
    const parsed = handler.parseInput(admission.inputReference);
    const result = await handler.execute(parsed, {} as never);

    expect(parsed.change.triggeredAt).toBe(new Date(0).toISOString());
    expect(result).toEqual({
      referenceType: "FASCICOLO_REEVALUATION_PLAN",
      referenceId: "procedimento-1",
      referenceVersion: "V1",
      metadata: {
        changeFingerprintHash: admission.inputReference.metadata.changeFingerprintHash,
        planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        planItemCount: 6,
        planFamilyCodesRef: "REQUIREMENTS,OBSERVATIONS,LEGAL_APPLICABILITY,TEMPORAL_ASSESSMENT,TRUSTED_REVIEW_FRESHNESS,REPORT_FRESHNESS",
        requiresTargetResolutionEnabled: true,
      },
    });
  });

  it("keeps a case-law decision date separate from an undetermined legal target", () => {
    const change = {
      kind: "CASE_LAW_CHANGED" as const,
      triggeredAt: "2026-03-01T10:00:00.000Z",
      origin: "CASE_LAW_MONITOR" as const,
      stateFingerprint: "c".repeat(64),
      legalSourceId: "case-law-1",
      linkedProcedimentoIds: ["procedimento-1"],
      decisionDate: "2024-06-15T00:00:00.000Z",
      changeType: "NEW_DECISION" as const,
      requiresFurtherResearch: false,
      legalAssessmentTarget: { kind: "UNDETERMINED" as const },
    };
    const admission = normalizeAsyncJobAdmission(buildFascicoloReevaluationAdmission({
      procedimentoId: "procedimento-1",
      change,
    }, provenance));
    const parsed = parseFascicoloReevaluationReference(admission.inputReference);

    expect(parsed.change).toMatchObject({
      decisionDate: "2024-06-15T00:00:00.000Z",
      legalAssessmentTarget: { kind: "UNDETERMINED" },
    });
  });

  it("does not import execution, provider, research, AI, MCP, or notification surfaces", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "src/server/fascicolo-lifecycle/fascicoloReevaluationJob.ts",
    ), "utf8");

    expect(source).not.toMatch(/legal-research|providers?|\/ai\/|mcp|notification/i);
    expect(source).not.toMatch(/admitAsyncJob|prisma|scheduler|watchdog/i);
  });
});