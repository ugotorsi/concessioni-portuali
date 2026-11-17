import { describe, expect, it, vi } from "vitest";

import type { CurrentTenantContext } from "@/lib/tenant-auth";
import { sanitizeMetadata } from "@/server/audit/hash";
import {
  issueDocumentOcrAuthorization,
  verifyDocumentOcrAuthorization,
  type DocumentOcrAuthorizationDependencies,
} from "@/server/documents/documentOcrAuthorization";

const actor = {
  id: "user-1",
  email: "tecnico@example.test",
  name: "Tecnico",
  role: "TECNICO" as const,
};

function tenantContext(): CurrentTenantContext {
  return {
    userId: actor.id,
    role: actor.role,
    isAdmin: false,
    tenantMemberships: [{
      id: "membership-1",
      userId: actor.id,
      enteId: "tenant-1",
      role: actor.role,
      isDefault: true,
    }],
    defaultTenantId: "tenant-1",
    accessibleTenantIds: ["tenant-1"],
  };
}

function attempt(failureCode = "OCR_REQUIRED") {
  return {
    id: "attempt-direct-failed",
    outcome: "FAILED" as const,
    failureCode,
    documentoId: "document-1",
    documentFileVersionId: "version-1",
    tenantId: "tenant-1",
    procedimentoId: "procedure-1",
    policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
    documento: {
      enteId: "tenant-1",
      procedimentoId: "procedure-1",
      currentFileVersionId: "version-1",
    },
  };
}

function record(
  reference: string,
  source = attempt(),
  format: "current" | "historical" = "current",
) {
  return {
    entitaId: reference,
    userId: actor.id,
    userRole: actor.role,
    enteId: source.tenantId,
    metadata: {
      ...(format === "current"
        ? { permitVersion: "DOCUMENT_OCR_BATCH_AUTHORIZATION_V2" }
        : {}),
      failedAttemptId: source.id,
      documentoId: source.documentoId,
      documentFileVersionId: source.documentFileVersionId,
      procedimentoId: source.procedimentoId,
      sourcePolicyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
      targetPolicyVersion: "DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2",
      failureCode: source.failureCode,
    },
    createdAt: new Date("2026-10-12T12:00:00.000Z"),
  };
}

function dependencies(
  overrides: Partial<DocumentOcrAuthorizationDependencies> = {},
): DocumentOcrAuthorizationDependencies {
  const source = attempt();
  return {
    getCurrentUser: vi.fn().mockResolvedValue(actor),
    getCurrentTenantContext: vi.fn().mockResolvedValue(tenantContext()),
    loadAttempt: vi.fn().mockResolvedValue(source),
    persistAuthorization: vi.fn(async ({ authorizationRef }) => record(authorizationRef, source)),
    loadAuthorization: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("document batch OCR authorization", () => {
  it("requires a real authenticated session with a matching tenant context", async () => {
    const harness = dependencies({
      getCurrentUser: vi.fn().mockResolvedValue(null),
    });
    await expect(issueDocumentOcrAuthorization("attempt-direct-failed", harness))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(harness.persistAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a role that cannot authorize OCR", async () => {
    const harness = dependencies({
      getCurrentUser: vi.fn().mockResolvedValue({ ...actor, role: "GIURIDICO" }),
      getCurrentTenantContext: vi.fn().mockResolvedValue({
        ...tenantContext(),
        role: "GIURIDICO",
      }),
    });
    await expect(issueDocumentOcrAuthorization("attempt-direct-failed", harness))
      .rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    expect(harness.persistAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a current-version attempt belonging to another tenant", async () => {
    const harness = dependencies({
      getCurrentTenantContext: vi.fn().mockResolvedValue({
        ...tenantContext(),
        accessibleTenantIds: ["tenant-2"],
        defaultTenantId: "tenant-2",
      }),
    });
    await expect(issueDocumentOcrAuthorization("attempt-direct-failed", harness))
      .rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
    expect(harness.persistAuthorization).not.toHaveBeenCalled();
  });

  it("issues one deterministic, auditable authorization for OCR_REQUIRED", async () => {
    const harness = dependencies();
    const first = await issueDocumentOcrAuthorization("attempt-direct-failed", harness);
    const second = await issueDocumentOcrAuthorization("attempt-direct-failed", harness);
    expect(first.authorizationRef).toBe(second.authorizationRef);
    expect(first).toMatchObject({
      failedAttemptId: "attempt-direct-failed",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
    });
  });

  it("emits and verifies the new permitVersion metadata format", async () => {
      const harness = dependencies();
      const authorization = await issueDocumentOcrAuthorization(
        "attempt-direct-failed",
        harness,
      );
      const persisted = vi.mocked(harness.persistAuthorization).mock.results[0];
      expect(persisted).toBeDefined();
      const savedRecord = await persisted!.value;
      expect(savedRecord.metadata).toMatchObject({
        permitVersion: "DOCUMENT_OCR_BATCH_AUTHORIZATION_V2",
      });
      expect(sanitizeMetadata(savedRecord.metadata)).toMatchObject({
        permitVersion: "DOCUMENT_OCR_BATCH_AUTHORIZATION_V2",
      });

      await expect(verifyDocumentOcrAuthorization({
        authorizationRef: authorization.authorizationRef,
        failedAttemptId: authorization.failedAttemptId,
        documentoId: authorization.documentoId,
        documentFileVersionId: authorization.documentFileVersionId,
        tenantId: authorization.tenantId,
        procedimentoId: authorization.procedimentoId,
        actorUserId: authorization.actor.userId,
        actorRole: authorization.actor.userRole,
      }, {
        loadAttempt: vi.fn().mockResolvedValue(attempt()),
        loadAuthorization: vi.fn().mockResolvedValue(savedRecord),
      })).resolves.toBeUndefined();
  });

  it("accepts the historical sanitized record only with its deterministic reference and full scope", async () => {
      const source = attempt();
      const harness = dependencies({
        persistAuthorization: vi.fn(async ({ authorizationRef }) =>
          record(authorizationRef, source, "historical")),
      });
      const authorization = await issueDocumentOcrAuthorization(source.id, harness);
      const historicalRecord = await vi.mocked(harness.persistAuthorization).mock.results[0]!.value;

      await expect(verifyDocumentOcrAuthorization({
        authorizationRef: authorization.authorizationRef,
        failedAttemptId: source.id,
        documentoId: source.documentoId,
        documentFileVersionId: source.documentFileVersionId,
        tenantId: source.tenantId,
        procedimentoId: source.procedimentoId,
        actorUserId: actor.id,
        actorRole: actor.role,
      }, {
        loadAttempt: vi.fn().mockResolvedValue(source),
        loadAuthorization: vi.fn().mockResolvedValue(historicalRecord),
      })).resolves.toBeUndefined();
  });

  it("rejects a historical record with a forged non-deterministic reference", async () => {
      const source = attempt();
      await expect(verifyDocumentOcrAuthorization({
        authorizationRef: "forged-reference",
        failedAttemptId: source.id,
        documentoId: source.documentoId,
        documentFileVersionId: source.documentFileVersionId,
        tenantId: source.tenantId,
        procedimentoId: source.procedimentoId,
        actorUserId: actor.id,
        actorRole: actor.role,
      }, {
        loadAttempt: vi.fn().mockResolvedValue(source),
        loadAuthorization: vi.fn().mockResolvedValue(
          record("forged-reference", source, "historical"),
        ),
      })).rejects.toMatchObject({ code: "AUTHORIZATION_SCOPE_MISMATCH" });
  });

  it("rejects a counterfeit version instead of treating it as historical", async () => {
      const source = attempt();
      const harness = dependencies();
      const authorization = await issueDocumentOcrAuthorization(source.id, harness);
      const counterfeit = record(authorization.authorizationRef, source);
      counterfeit.metadata.permitVersion = "DOCUMENT_OCR_BATCH_AUTHORIZATION_V1";

      await expect(verifyDocumentOcrAuthorization({
        authorizationRef: authorization.authorizationRef,
        failedAttemptId: source.id,
        documentoId: source.documentoId,
        documentFileVersionId: source.documentFileVersionId,
        tenantId: source.tenantId,
        procedimentoId: source.procedimentoId,
        actorUserId: actor.id,
        actorRole: actor.role,
      }, {
        loadAttempt: vi.fn().mockResolvedValue(source),
        loadAuthorization: vi.fn().mockResolvedValue(counterfeit),
      })).rejects.toMatchObject({ code: "AUTHORIZATION_SCOPE_MISMATCH" });
  });

  it("rejects a deterministic authorization presented for another document or version", async () => {
      const source = attempt();
      const harness = dependencies();
      const authorization = await issueDocumentOcrAuthorization(source.id, harness);
      const savedRecord = await vi.mocked(harness.persistAuthorization).mock.results[0]!.value;

      await expect(verifyDocumentOcrAuthorization({
        authorizationRef: authorization.authorizationRef,
        failedAttemptId: source.id,
        documentoId: "other-document",
        documentFileVersionId: "other-version",
        tenantId: source.tenantId,
        procedimentoId: source.procedimentoId,
        actorUserId: actor.id,
        actorRole: actor.role,
      }, {
        loadAttempt: vi.fn().mockResolvedValue(source),
        loadAuthorization: vi.fn().mockResolvedValue(savedRecord),
      })).rejects.toMatchObject({ code: "AUTHORIZATION_SCOPE_MISMATCH" });
  });

  it("authorizes the V2 path for a DIRECT_TEXT_V1 file rejected between 25 and 30 MB", async () => {
    const source = attempt("ARTIFACT_TOO_LARGE");
    const harness = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(source),
      persistAuthorization: vi.fn(async ({ authorizationRef }) => record(authorizationRef, source)),
    });
    await expect(issueDocumentOcrAuthorization(source.id, harness)).resolves.toMatchObject({
      failedAttemptId: source.id,
      documentFileVersionId: source.documentFileVersionId,
    });
  });

  it("does not authorize another V1 failure category", async () => {
    const harness = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(attempt("STORAGE_READ_FAILURE")),
    });
    await expect(issueDocumentOcrAuthorization("attempt-direct-failed", harness))
      .rejects.toMatchObject({ code: "FAILED_ATTEMPT_NOT_OCR_ELIGIBLE" });
    expect(harness.persistAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a permit whose actor or immutable scope does not match", async () => {
    const source = attempt();
    await expect(verifyDocumentOcrAuthorization({
      authorizationRef: "authorization-1",
      failedAttemptId: source.id,
      documentoId: source.documentoId,
      documentFileVersionId: source.documentFileVersionId,
      tenantId: source.tenantId,
      procedimentoId: source.procedimentoId,
      actorUserId: "different-user",
      actorRole: actor.role,
    }, {
      loadAttempt: vi.fn().mockResolvedValue(source),
      loadAuthorization: vi.fn().mockResolvedValue(record("authorization-1", source)),
    })).rejects.toMatchObject({ code: "AUTHORIZATION_SCOPE_MISMATCH" });
  });
});
