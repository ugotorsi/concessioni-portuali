import { beforeEach, describe, expect, it, vi } from "vitest";

const auditMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const txMock = vi.hoisted(() => ({
  fascicoloSignal: { findUnique: vi.fn(), updateMany: vi.fn() },
  criticita: { create: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  canManageCriticita: (role: string) => role !== "VIEWER_ADSP",
  canManageProcedimenti: (role: string) => ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"].includes(role),
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditMock }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn(async (callback) => callback(txMock)),
}));
vi.mock("@/server/fascicolo-lifecycle/fascicoloSignal", () => ({
  fascicoloSignalTemporalFingerprint: vi.fn(() => "current-fingerprint"),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { reviewFascicoloSignalAction } from "@/server/actions/fascicolo-signals";

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: "signal-1",
    enteId: "ente-1",
    concessioneId: "concessione-1",
    procedimentoId: "procedimento-1",
    subjectType: "CONCESSIONE",
    subjectId: "concessione-1",
    generationFingerprint: "current-fingerprint",
    currentThreshold: "CONCESSION_90_DAYS",
    status: "OPEN",
    humanDisposition: "UNREVIEWED",
    dispositionThreshold: null,
    reviewNote: null,
    criticitaId: null,
    procedimento: {
      id: "procedimento-1",
      concessioneId: "concessione-1",
      concessione: { id: "concessione-1", enteId: "ente-1", dataScadenza: new Date("2027-01-01") },
    },
    ...overrides,
  };
}

function reviewForm(disposition: "ACKNOWLEDGED" | "DISMISSED", note?: string) {
  const formData = new FormData();
  formData.set("signalId", "signal-1");
  formData.set("expectedThreshold", "CONCESSION_90_DAYS");
  formData.set("disposition", disposition);
  if (note !== undefined) formData.set("reviewNote", note);
  return formData;
}

function tenantContext(role = "GIURIDICO", membershipRole = role) {
  return {
    userId: "user-1",
    role,
    isAdmin: role === "ADMIN",
    accessibleTenantIds: role === "ADMIN" ? [] : ["ente-1"],
    defaultTenantId: role === "ADMIN" ? null : "ente-1",
    tenantMemberships: role === "ADMIN" ? [] : [{
      id: "membership-1",
      userId: "user-1",
      enteId: "ente-1",
      role: membershipRole,
      isDefault: true,
    }],
  };
}

describe("FascicoloSignal human review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("GIURIDICO");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "user@example.test", role: "GIURIDICO" });
    getCurrentTenantContextMock.mockResolvedValue(tenantContext());
    requireTenantAccessMock.mockReturnValue(undefined);
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal());
    txMock.fascicoloSignal.updateMany.mockResolvedValue({ count: 1 });
    auditMock.mockResolvedValue({});
  });

  it("acknowledges an unreviewed open signal without creating a Criticita", async () => {
    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).resolves.toMatchObject({
      outcome: "ACKNOWLEDGED",
    });

    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "OPEN",
        currentThreshold: "CONCESSION_90_DAYS",
        humanDisposition: "UNREVIEWED",
      }),
      data: expect.objectContaining({
        humanDisposition: "ACKNOWLEDGED",
        dispositionThreshold: "CONCESSION_90_DAYS",
      }),
    }));
    expect(txMock.criticita.create).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("uses ADMIN as the effective role for an authorized admin", async () => {
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.test", role: "ADMIN" });
    getCurrentTenantContextMock.mockResolvedValue(tenantContext("ADMIN"));

    await reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"));

    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewedByRole: "ADMIN" }),
    }));
    expect(auditMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actor: expect.objectContaining({ userRole: "ADMIN" }),
    }));
  });

  it("allows a GIURIDICO tenant membership and persists the effective role", async () => {
    await reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"));

    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewedByRole: "GIURIDICO" }),
    }));
    expect(auditMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actor: expect.objectContaining({ userRole: "GIURIDICO" }),
    }));
  });

  it("denies review when the tenant membership role is TECNICO", async () => {
    getCurrentTenantContextMock.mockResolvedValue(tenantContext("GIURIDICO", "TECNICO"));

    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow("Tenant access denied");
    expect(txMock.fascicoloSignal.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical tenant membership is absent", async () => {
    getCurrentTenantContextMock.mockResolvedValue({ ...tenantContext(), tenantMemberships: [] });

    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow("Tenant access denied");
    expect(txMock.fascicoloSignal.updateMany).not.toHaveBeenCalled();
  });

  it("returns an idempotent no-op for a repeated acknowledge", async () => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({
      humanDisposition: "ACKNOWLEDGED",
      dispositionThreshold: "CONCESSION_90_DAYS",
    }));

    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).resolves.toMatchObject({
      outcome: "ALREADY_ACKNOWLEDGED",
    });
    expect(txMock.fascicoloSignal.updateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it.each(["UNREVIEWED", "ACKNOWLEDGED"])("dismisses from %s with a required note", async (humanDisposition) => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({ humanDisposition }));

    await expect(reviewFascicoloSignalAction(reviewForm("DISMISSED", "Nessuna azione richiesta"))).resolves.toMatchObject({
      outcome: "DISMISSED",
    });
    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ humanDisposition: "DISMISSED", reviewNote: "Nessuna azione richiesta" }),
    }));
  });

  it("returns an idempotent no-op for an identical repeated dismissal", async () => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({
      humanDisposition: "DISMISSED",
      dispositionThreshold: "CONCESSION_90_DAYS",
      reviewNote: "Nessuna azione richiesta",
    }));

    await expect(reviewFascicoloSignalAction(reviewForm("DISMISSED", "Nessuna azione richiesta"))).resolves.toMatchObject({
      outcome: "ALREADY_DISMISSED",
    });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("requires a non-blank dismissal note", async () => {
    await expect(reviewFascicoloSignalAction(reviewForm("DISMISSED", "  "))).rejects.toThrow("nota di review");
    expect(txMock.fascicoloSignal.updateMany).not.toHaveBeenCalled();
  });

  it("does not allow DISMISSED to transition implicitly to ACKNOWLEDGED", async () => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({
      humanDisposition: "DISMISSED",
      dispositionThreshold: "CONCESSION_90_DAYS",
      reviewNote: "Nessuna azione richiesta",
    }));
    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow("TRANSITION_NOT_ALLOWED");
  });

  it.each([
    ["superseded", { status: "SUPERSEDED" }, "NOT_OPEN"],
    ["stale generation", { generationFingerprint: "stale" }, "STALE_GENERATION"],
    ["old threshold", { currentThreshold: "CONCESSION_60_DAYS" }, "THRESHOLD_CHANGED"],
  ])("rejects a %s signal", async (_label, override, error) => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal(override));
    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow(error);
    expect(txMock.fascicoloSignal.updateMany).not.toHaveBeenCalled();
  });

  it("rejects canonical procedimento/concessione mismatch", async () => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({ concessioneId: "other" }));
    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow("CANONICAL_SCOPE_MISMATCH");
  });

  it("rejects tenant mismatch before mutation", async () => {
    requireTenantAccessMock.mockImplementation(() => { throw new Error("Tenant access denied."); });
    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow("Tenant access denied");
    expect(txMock.fascicoloSignal.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a review that loses a concurrent threshold race", async () => {
    txMock.fascicoloSignal.updateMany.mockResolvedValue({ count: 0 });
    await expect(reviewFascicoloSignalAction(reviewForm("ACKNOWLEDGED"))).rejects.toThrow("CONCURRENTLY_CHANGED");
    expect(auditMock).not.toHaveBeenCalled();
  });
});