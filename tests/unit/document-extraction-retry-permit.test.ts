import { describe, expect, it, vi } from "vitest";

import type { CurrentTenantContext } from "@/lib/tenant-auth";
import {
  issueDocumentExtractionRetryPermit,
  verifyDocumentExtractionRetryPermit,
  type DocumentExtractionRetryPermitDependencies,
} from "@/server/documents/documentExtractionRetryPermit";

const actor = {
  id: "user-1",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN" as const,
};

function tenantContext(overrides: Partial<CurrentTenantContext> = {}): CurrentTenantContext {
  return {
    userId: actor.id,
    role: actor.role,
    isAdmin: true,
    tenantMemberships: [],
    defaultTenantId: null,
    accessibleTenantIds: [],
    ...overrides,
  };
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-failed",
    outcome: "FAILED" as const,
    failureCode: "STORAGE_READ_FAILURE",
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
    ...overrides,
  };
}

function permitRecord(input: {
  permitRef: string;
  attempt: ReturnType<typeof attempt>;
  actorUserId?: string;
  actorRole?: string;
}) {
  return {
    entitaId: input.permitRef,
    userId: input.actorUserId ?? actor.id,
    userRole: input.actorRole ?? actor.role,
    enteId: input.attempt.tenantId,
    metadata: {
      permitVersion: "DOCUMENT_EXTRACTION_RETRY_PERMIT_V1",
      failedAttemptId: input.attempt.id,
      documentoId: input.attempt.documentoId,
      documentFileVersionId: input.attempt.documentFileVersionId,
      procedimentoId: input.attempt.procedimentoId,
      policyVersion: input.attempt.policyVersion,
      failureCode: input.attempt.failureCode,
    },
    createdAt: new Date("2026-10-09T17:00:00.000Z"),
  };
}

function dependencies(
  overrides: Partial<DocumentExtractionRetryPermitDependencies> = {},
): DocumentExtractionRetryPermitDependencies {
  const source = attempt();
  return {
    getCurrentUser: vi.fn().mockResolvedValue(actor),
    getCurrentTenantContext: vi.fn().mockResolvedValue(tenantContext()),
    loadAttempt: vi.fn().mockResolvedValue(source),
    persistPermit: vi.fn(async (input) => permitRecord(input)),
    loadPermit: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("document extraction retry permits", () => {
  it("rejects an unauthenticated actor", async () => {
    const harness = dependencies({
      getCurrentUser: vi.fn().mockResolvedValue(null),
    });
    await expect(issueDocumentExtractionRetryPermit("attempt-failed", harness))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(harness.persistPermit).not.toHaveBeenCalled();
  });

  it("rejects an insufficient role", async () => {
    const viewer = { ...actor, role: "VIEWER_ADSP" as const };
    const harness = dependencies({
      getCurrentUser: vi.fn().mockResolvedValue(viewer),
      getCurrentTenantContext: vi.fn().mockResolvedValue(tenantContext({
        role: viewer.role,
        isAdmin: false,
      })),
    });
    await expect(issueDocumentExtractionRetryPermit("attempt-failed", harness))
      .rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    expect(harness.persistPermit).not.toHaveBeenCalled();
  });

  it("rejects a tenant outside a technical user's memberships", async () => {
    const technician = { ...actor, role: "TECNICO" as const };
    const harness = dependencies({
      getCurrentUser: vi.fn().mockResolvedValue(technician),
      getCurrentTenantContext: vi.fn().mockResolvedValue(tenantContext({
        role: technician.role,
        isAdmin: false,
        accessibleTenantIds: ["tenant-2"],
      })),
    });
    await expect(issueDocumentExtractionRetryPermit("attempt-failed", harness))
      .rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
    expect(harness.persistPermit).not.toHaveBeenCalled();
  });

  it("rejects a permanent failure", async () => {
    const harness = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(attempt({
        failureCode: "INTEGRITY_SHA256_MISMATCH",
      })),
    });
    await expect(issueDocumentExtractionRetryPermit("attempt-failed", harness))
      .rejects.toMatchObject({
        code: "FAILED_ATTEMPT_NOT_RETRYABLE",
      });
    expect(harness.persistPermit).not.toHaveBeenCalled();
  });

  it("issues the same audited permit for repeated authorization", async () => {
    const harness = dependencies();
    const first = await issueDocumentExtractionRetryPermit("attempt-failed", harness);
    const second = await issueDocumentExtractionRetryPermit("attempt-failed", harness);
    expect(first.permitRef).toMatch(/^[0-9a-f]{64}$/);
    expect(second.permitRef).toBe(first.permitRef);
    expect(harness.persistPermit).toHaveBeenCalledTimes(2);
    expect(harness.persistPermit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        permitRef: first.permitRef,
        actor,
        attempt: expect.objectContaining({ id: "attempt-failed" }),
      }),
    );
  });

  it("rejects an invented permit", async () => {
    const harness = dependencies();
    await expect(verifyDocumentExtractionRetryPermit({
      permitRef: "f".repeat(64),
      failedAttemptId: "attempt-failed",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      actorUserId: actor.id,
      actorRole: actor.role,
    }, harness)).rejects.toMatchObject({
      code: "PERMIT_NOT_FOUND",
    });
  });

  it("rejects a permit bound to another document or version", async () => {
    const source = attempt();
    const harness = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(source),
      loadPermit: vi.fn().mockResolvedValue(permitRecord({
        permitRef: "a".repeat(64),
        attempt: {
          ...source,
          documentoId: "other-document",
          documentFileVersionId: "other-version",
        },
      })),
    });
    await expect(verifyDocumentExtractionRetryPermit({
      permitRef: "a".repeat(64),
      failedAttemptId: source.id,
      documentoId: source.documentoId,
      documentFileVersionId: source.documentFileVersionId,
      tenantId: source.tenantId,
      procedimentoId: source.procedimentoId,
      actorUserId: actor.id,
      actorRole: actor.role,
    }, harness)).rejects.toMatchObject({
      code: "PERMIT_SCOPE_MISMATCH",
    });
  });
});
