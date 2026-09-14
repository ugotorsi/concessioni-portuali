import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

const admission = {
  id: "admission-1",
  enteId: "ente-1",
  classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
  resolution: null,
  neutralIntake: {
    enteId: "ente-1",
    status: "ROUTED",
    destination: {
      procedimentoId: "procedimento-1",
      procedimento: {
        concessioneId: "concessione-1",
        concessione: { enteId: "ente-1" },
      },
    },
  },
};

const resolution = {
  id: "resolution-1",
  admissionId: "admission-1",
  outcome: "LINKED",
  legalSourceId: "source-1",
  reviewedByUserId: "user-1",
  reviewedByActorId: "user-1",
  reviewedByEmail: "lawyer@example.test",
  reviewedByRole: "GIURIDICO",
  resolvedAt: new Date("2026-09-14T14:00:00.000Z"),
  reviewNote: "Identita verificata",
};

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  legalSourceCandidateAdmission: { findUnique: vi.fn() },
  legalSourceCandidateResolution: { create: vi.fn() },
  legalSource: { findUnique: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  legalSourceCandidateAdmission: { findUnique: vi.fn() },
  legalSourceCandidateResolution: { findUnique: vi.fn() },
  legalSource: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  user: { create: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
  canManageProcedimenti: canManageProcedimentiMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditInTransactionMock }));

import { resolveLegalSourceCandidate } from "@/server/actions/legal-source-candidate-resolution";

describe("B2C9 Block 3B.5B candidate resolution action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("GIURIDICO");
    canManageProcedimentiMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "lawyer@example.test" });
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      accessibleTenantIds: ["ente-1"],
    });
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.legalSourceCandidateAdmission.findUnique.mockResolvedValue(admission);
    prismaMock.legalSourceCandidateResolution.findUnique.mockResolvedValue(null);
    prismaMock.legalSource.findUnique.mockResolvedValue({ id: "source-1", enteId: null });
    txMock.$queryRaw.mockResolvedValue([{ id: "admission-1" }]);
    txMock.legalSourceCandidateAdmission.findUnique.mockResolvedValue(admission);
    txMock.legalSourceCandidateResolution.create.mockResolvedValue(resolution);
    txMock.legalSource.findUnique.mockResolvedValue({ id: "source-1", enteId: null });
    auditInTransactionMock.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
  });

  it("derives the candidate tenant from its durable Fascicolo destination and enforces write access", async () => {
    await resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    });

    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "ente-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
  });

  it("accepts a global source and persists the trusted reviewer snapshot with its audit atomically", async () => {
    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
      reviewNote: "Identita verificata",
    })).resolves.toMatchObject({ status: "CREATED", resolution });

    expect(txMock.legalSourceCandidateResolution.create).toHaveBeenCalledWith({
      data: {
        admissionId: "admission-1",
        outcome: "LINKED",
        legalSourceId: "source-1",
        reviewedByUserId: "user-1",
        reviewedByActorId: "user-1",
        reviewedByEmail: "lawyer@example.test",
        reviewedByRole: "GIURIDICO",
        reviewNote: "Identita verificata",
      },
    });
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        azione: "LEGAL_SOURCE_CANDIDATE_RESOLUTION_CREATE",
        entita: "LegalSourceCandidateResolution",
        enteId: "ente-1",
        concessioneId: "concessione-1",
      }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(txMock.legalSource.findUnique).toHaveBeenCalledWith({
      where: { id: "source-1" },
      select: { id: true, enteId: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
  });

  it("rejects a source owned by another tenant", async () => {
    prismaMock.legalSource.findUnique.mockResolvedValue({ id: "source-1", enteId: "ente-2" });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).rejects.toThrow("Fonte giuridica non disponibile");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a source owned by the candidate tenant", async () => {
    prismaMock.legalSource.findUnique.mockResolvedValue({ id: "source-1", enteId: "ente-1" });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).resolves.toMatchObject({ status: "CREATED" });
  });

  it("locks the selected source before its transactional authorization recheck", async () => {
    await resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    });

    const lockingQueries = txMock.$queryRaw.mock.calls.map(([query]) => Array.from(query).join(""));
    expect(lockingQueries).toContainEqual(expect.stringMatching(/FROM "LegalSource"[\s\S]*FOR SHARE/));
    expect(txMock.legalSource.findUnique).toHaveBeenCalledWith({
      where: { id: "source-1" },
      select: { id: true, enteId: true },
    });
  });

  it("rejects tenant drift detected by the transactional source recheck", async () => {
    prismaMock.legalSource.findUnique.mockResolvedValue({ id: "source-1", enteId: "ente-1" });
    txMock.legalSource.findUnique.mockResolvedValue({ id: "source-1", enteId: "ente-2" });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).rejects.toThrow("Fonte giuridica non disponibile");
    expect(txMock.legalSourceCandidateResolution.create).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("persists NO_MATCH without accepting or querying a source", async () => {
    await resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
      reviewNote: "Catalogo verificato",
    });

    expect(prismaMock.legalSource.findUnique).not.toHaveBeenCalled();
    expect(txMock.legalSourceCandidateResolution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: "NO_MATCH", legalSourceId: null }),
    });
  });

  it.each([
    { outcome: "LINKED" as const },
    { outcome: "NO_MATCH" as const, legalSourceId: "source-1" },
  ])("rejects an incoherent outcome/source pair before any lookup", async (input) => {
    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      ...input,
    })).rejects.toThrow();
    expect(prismaMock.legalSourceCandidateAdmission.findUnique).not.toHaveBeenCalled();
  });

  it.each(["enteId", "reviewedByActorId", "reviewedByEmail", "reviewedByRole"])(
    "rejects client-authoritative %s",
    async (field) => {
      await expect(resolveLegalSourceCandidate({
        admissionId: "admission-1",
        procedimentoId: "procedimento-1",
        outcome: "NO_MATCH",
        [field]: "forged",
      } as never)).rejects.toThrow();
      expect(prismaMock.legalSourceCandidateAdmission.findUnique).not.toHaveBeenCalled();
    },
  );

  it("rejects a review note over the persisted 2000-character limit", async () => {
    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
      reviewNote: "x".repeat(2001),
    })).rejects.toThrow();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a role that cannot manage procedimenti", async () => {
    canManageProcedimentiMock.mockReturnValue(false);

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
    })).rejects.toThrow("non autorizzato");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("fails closed without a trusted tenant context", async () => {
    getCurrentTenantContextMock.mockResolvedValue(null);

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
    })).rejects.toThrow("non autenticato");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a candidate routed to a different Fascicolo", async () => {
    prismaMock.legalSourceCandidateAdmission.findUnique.mockResolvedValue({
      ...admission,
      neutralIntake: {
        ...admission.neutralIntake,
        destination: {
          ...admission.neutralIntake.destination,
          procedimentoId: "procedimento-2",
        },
      },
    });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
    })).rejects.toThrow("non coerente con il Fascicolo");
    expect(requireTenantAccessMock).not.toHaveBeenCalled();
  });

  it("stores a null reviewer User FK for the technical preview actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
    });

    expect(txMock.legalSourceCandidateResolution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewedByUserId: null,
        reviewedByActorId: "staging-preview-admin",
        reviewedByEmail: "preview@example.test",
      }),
    });
  });

  it("returns an idempotent result for the same persisted decision", async () => {
    txMock.legalSourceCandidateAdmission.findUnique.mockResolvedValue({
      ...admission,
      resolution,
    });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).resolves.toEqual({ status: "UNCHANGED", resolution });
    expect(txMock.legalSourceCandidateResolution.create).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("returns a controlled conflict for a different persisted decision", async () => {
    txMock.legalSourceCandidateAdmission.findUnique.mockResolvedValue({
      ...admission,
      resolution: { ...resolution, outcome: "NO_MATCH", legalSourceId: null },
    });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).resolves.toEqual({
      status: "CONFLICT",
      message: "La verifica e gia stata registrata con un esito diverso.",
    });
    expect(txMock.legalSourceCandidateResolution.create).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("reconciles a concurrent unique conflict as an idempotent replay", async () => {
    prismaMock.$transaction.mockRejectedValueOnce({ code: "P2002" });
    prismaMock.legalSourceCandidateResolution.findUnique.mockResolvedValue(resolution);

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).resolves.toEqual({ status: "UNCHANGED", resolution });
    expect(revalidatePathMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
  });

  it("reconciles a concurrent unique conflict as a different-decision conflict", async () => {
    prismaMock.$transaction.mockRejectedValueOnce({ code: "P2002" });
    prismaMock.legalSourceCandidateResolution.findUnique.mockResolvedValue({
      ...resolution,
      outcome: "NO_MATCH",
      legalSourceId: null,
    });

    await expect(resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "LINKED",
      legalSourceId: "source-1",
    })).resolves.toEqual({
      status: "CONFLICT",
      message: "La verifica e gia stata registrata con un esito diverso.",
    });
  });

  it("never creates a LegalSource or a synthetic User", async () => {
    await resolveLegalSourceCandidate({
      admissionId: "admission-1",
      procedimentoId: "procedimento-1",
      outcome: "NO_MATCH",
    });

    expect(prismaMock.legalSource.create).not.toHaveBeenCalled();
    expect(prismaMock.legalSource.upsert).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });
});