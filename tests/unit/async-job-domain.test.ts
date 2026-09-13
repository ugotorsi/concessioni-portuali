import { describe, expect, it } from "vitest";

import {
  AsyncJobInputError,
  normalizeAsyncJobAdmission,
  normalizeAsyncJobFailure,
  normalizeAsyncJobResultMetadata,
} from "@/server/async-jobs/domain";

function userAdmission(logicalOperationId = "operation-1", tenantId: string | null = "ente-1") {
  return {
    operation: "DOCUMENT.CLASSIFY",
    logicalOperationId,
    purpose: "DOCUMENT_CLASSIFICATION",
    correlationId: "correlation-1",
    policyDecisionRef: null,
    inputReference: { referenceType: "DOCUMENT", referenceId: "document-1" },
    maxAttempts: 3,
    availableAt: new Date("2026-09-13T10:00:00.000Z"),
    admission: {
      admissionType: "AUTHENTICATED_USER" as const,
      tenantId,
      initiatingUserId: "user-1",
      actor: { actorId: "user-1", actorEmail: "user@example.test", actorRole: "ADMIN" },
    },
  };
}

describe("B2C9 generic async job domain", () => {
  it("derives deterministic scoped idempotency independently from the row identity", () => {
    const first = normalizeAsyncJobAdmission(userAdmission());
    const repeated = normalizeAsyncJobAdmission(userAdmission());
    const independent = normalizeAsyncJobAdmission(userAdmission("operation-2"));
    const otherTenant = normalizeAsyncJobAdmission(userAdmission("operation-1", "ente-2"));
    expect(first.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.idempotencyKey).toBe(repeated.idempotencyKey);
    expect(first.requestFingerprint).toBe(repeated.requestFingerprint);
    expect(first.idempotencyKey).not.toBe(independent.idempotencyKey);
    expect(first.idempotencyKey).not.toBe(otherTenant.idempotencyKey);
  });

  it("preserves immutable authenticated actor and tenant snapshots", () => {
    const normalized = normalizeAsyncJobAdmission(userAdmission());
    expect(normalized.admission).toEqual({
      admissionType: "AUTHENTICATED_USER",
      tenantId: "ente-1",
      initiatingUserId: "user-1",
      actor: { actorId: "user-1", actorEmail: "user@example.test", actorRole: "ADMIN" },
    });
  });

  it("supports authorized system admission without inventing a user", () => {
    const normalized = normalizeAsyncJobAdmission({
      ...userAdmission(),
      policyDecisionRef: "authorization-decision-1",
      admission: {
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId: null,
        initiatingUserId: null,
        actor: { actorId: "scheduler:legal-refresh", actorEmail: null, actorRole: "SYSTEM" },
      },
    });
    expect(normalized.admission.initiatingUserId).toBeNull();
    expect(normalized.admission.actor.actorId).toBe("scheduler:legal-refresh");
  });

  it.each([
    "text", "rawText", "documentBody", "bytes", "prompt", "providerResponse", "payload",
    "message", "output", "data", "secret", "accessToken", "apiKey", "authorization",
    "bearer", "jwt", "cookie", "privateKey",
  ])(
    "rejects raw sensitive %s fields in generic references",
    (field) => {
      expect(() => normalizeAsyncJobAdmission({
        ...userAdmission(),
        inputReference: { referenceType: "DOCUMENT", referenceId: "document-1", metadata: { [field]: "raw" } },
      })).toThrowError(expect.objectContaining<Partial<AsyncJobInputError>>({
        code: "SENSITIVE_REFERENCE_FIELD",
      }));
    },
  );

  it("bounds generic input and result metadata", () => {
    expect(() => normalizeAsyncJobAdmission({
      ...userAdmission(),
      inputReference: {
        referenceType: "DOCUMENT",
        referenceId: "document-1",
        metadata: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}Hash`, "x".repeat(500)])),
      },
    })).toThrowError(expect.objectContaining<Partial<AsyncJobInputError>>({ code: "REFERENCE_TOO_LARGE" }));
    expect(() => normalizeAsyncJobResultMetadata({
      referenceType: "RESULT",
      referenceId: "result-1",
      metadata: { content: "not-an-output-archive" },
    }))
      .toThrowError(expect.objectContaining<Partial<AsyncJobInputError>>({ code: "SENSITIVE_REFERENCE_FIELD" }));
  });

  it("rejects contradictory authenticated actor provenance", () => {
    expect(() => normalizeAsyncJobAdmission({
      ...userAdmission(),
      admission: {
        ...userAdmission().admission,
        actor: { ...userAdmission().admission.actor, actorId: "different-user" },
      },
    })).toThrowError(expect.objectContaining<Partial<AsyncJobInputError>>({ code: "INVALID_ADMISSION" }));
  });

  it("requires an explicit authorization decision for system admission", () => {
    expect(() => normalizeAsyncJobAdmission({
      ...userAdmission(),
      policyDecisionRef: null,
      admission: {
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId: null,
        initiatingUserId: null,
        actor: { actorId: "scheduler:legal-refresh", actorEmail: null, actorRole: "SYSTEM" },
      },
    })).toThrowError(expect.objectContaining<Partial<AsyncJobInputError>>({ code: "INVALID_ADMISSION" }));
  });

  it("accepts only normalized bounded failure categories and codes", () => {
    expect(normalizeAsyncJobFailure({ retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" }))
      .toEqual({ retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" });
    expect(() => normalizeAsyncJobFailure({
      retryable: false,
      category: "INTERNAL",
      code: "raw provider response: secret",
    })).toThrow();
  });
});