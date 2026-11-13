import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCurrentUser: vi.fn(),
  canManage: vi.fn(),
  tenant: vi.fn(),
  requireTenantAccess: vi.fn(),
  procedure: vi.fn(),
  documents: vi.fn(),
  workflow: vi.fn(),
  list: vi.fn(),
  append: vi.fn(),
  readFile: vi.fn(),
  auditFailure: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireRole: mocks.requireRole, getCurrentUser: mocks.getCurrentUser, canManageProcedimenti: mocks.canManage,
}));
vi.mock("@/lib/tenant-auth", () => ({ getCurrentTenantContext: mocks.tenant, requireTenantAccess: mocks.requireTenantAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: { procedimento: { findUnique: mocks.procedure }, documento: { findMany: mocks.documents } },
}));
vi.mock("@/server/audit/auditLog", () => ({ auditFailure: mocks.auditFailure }));
vi.mock("@/server/queries/fascicolo-automatic-workflow", () => ({ getFascicoloAutomaticWorkflowReadModel: mocks.workflow }));
vi.mock("@/server/fascicolo-operational-activities/repository", () => ({
  listOperationalActivities: mocks.list, appendActivityCommand: mocks.append,
}));
vi.mock("@/server/documents/authorizedVerifiedByteReader", async () => {
  const actual = await vi.importActual<typeof import("@/server/documents/authorizedVerifiedByteReader")>(
    "@/server/documents/authorizedVerifiedByteReader",
  );
  return { ...actual, readAuthorizedVerifiedDocumentBytes: mocks.readFile };
});

import { updateOperationalActivityAction } from "@/server/actions/fascicolo-operational-activities";

const activityKey = `activity_${"a".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";

function form() {
  const values = {
    procedimentoId: "procedure-a", activityKey, expectedVersion: "2",
    expectedSpecFingerprint: "a".repeat(64), expectedReportFingerprint: "b".repeat(64),
    expectedCorpusFingerprint: "c".repeat(64),
    requestId, kind: "RECORD_EXECUTION", note: "Comunicazione inviata.",
    date: "2026-11-01", documentIds: "document-a",
  };
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe("activity evidence server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue("ADMIN");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a", email: "user@example.test" });
    mocks.canManage.mockReturnValue(true);
    mocks.tenant.mockResolvedValue({ userId: "user-a", enteId: "tenant-a" });
    mocks.procedure.mockResolvedValue({ enteId: "tenant-a", concessioneId: null });
    mocks.documents.mockResolvedValue([{ id: "document-a" }]);
    mocks.workflow.mockResolvedValue({
      analysisUpdate: { status: "CURRENT", corpusFingerprint: "c".repeat(64) },
      structuredReport: {
        reportFingerprint: "b".repeat(64),
        payload: { tenantId: "tenant-a", knowledgeRevisionId: "revision-a", operationalPlans: [] },
      },
    });
    mocks.list.mockResolvedValue([]);
    mocks.readFile.mockResolvedValue({
      status: "AVAILABLE_VERIFIED", fileVersionId: "version-a", sha256: "c".repeat(64),
    });
  });

  it("verifies ownership and the actual file before passing its version to persistence", async () => {
    await updateOperationalActivityAction(form());
    expect(mocks.documents).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ procedimentoId: "procedure-a", enteId: "tenant-a" }),
    }));
    expect(mocks.readFile).toHaveBeenCalledWith({ documentoId: "document-a" });
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({
      verifiedDocuments: [{ documentId: "document-a", fileVersionId: "version-a", sha256: "c".repeat(64) }],
    }));
  });

  it("does not register missing files or documents belonging to a different case", async () => {
    mocks.readFile.mockResolvedValue({ status: "SOURCE_MISSING" });
    await updateOperationalActivityAction(form());
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.auditFailure).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: "EVIDENCE_UNAVAILABLE" }),
    }));
    mocks.documents.mockResolvedValue([]);
    mocks.readFile.mockClear();
    await updateOperationalActivityAction(form());
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.auditFailure).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: "UNKNOWN_DOCUMENT" }),
    }));
  });

  it("lets a retry reach the idempotency check without rereading a file that may have disappeared", async () => {
    mocks.list.mockResolvedValue([{
      activityKey, current: { sharedActivities: [] }, history: [{ requestId }],
    }]);
    await updateOperationalActivityAction(form());
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ verifiedDocuments: [] }));
  });
});
