import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const procedimentoFindUniqueMock = vi.hoisted(() => vi.fn());
const admissionFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findUnique: procedimentoFindUniqueMock },
    legalSourceCandidateAdmission: { findMany: admissionFindManyMock },
  },
}));

import { LegalSourceCandidatesPanel } from "@/components/documents/LegalSourceCandidatesPanel";
import { getFascicoloLegalSourceCandidates } from "@/server/queries/fascicolo-legal-source-candidates";

describe("Fascicolo legal-source candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      accessibleTenantIds: ["ente-1"],
    });
    procedimentoFindUniqueMock.mockResolvedValue({ concessione: { enteId: "ente-1" } });
    admissionFindManyMock.mockResolvedValue([{
      id: "admission-1",
      admittedAt: new Date("2026-09-14T10:02:00.000Z"),
      classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
      neutralIntake: {
        originalName: "ordinanza.pdf",
        mimeType: "application/pdf",
      },
      classificationAttempt: {
        reviewRequired: true,
      },
      resolution: null,
    }]);
  });

  it("returns admitted routed candidates for the current Fascicolo through the durable destination", async () => {
    await expect(getFascicoloLegalSourceCandidates("procedimento-1")).resolves.toEqual([{
      id: "admission-1",
      originalName: "ordinanza.pdf",
      mimeType: "application/pdf",
      admittedAt: new Date("2026-09-14T10:02:00.000Z"),
      classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
      reviewRequired: true,
      resolution: null,
    }]);
    expect(admissionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        enteId: "ente-1",
        classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
        neutralIntake: {
          enteId: "ente-1",
          status: "ROUTED",
          destination: { is: { procedimentoId: "procedimento-1" } },
        },
      },
    }));
  });

  it("excludes candidates for another Fascicolo through the exact destination filter", async () => {
    admissionFindManyMock.mockResolvedValueOnce([]);

    await expect(getFascicoloLegalSourceCandidates("procedimento-x")).resolves.toEqual([]);
    expect(admissionFindManyMock.mock.calls[0]?.[0].where.neutralIntake.destination)
      .toEqual({ is: { procedimentoId: "procedimento-x" } });
  });

  it("fails closed without authenticated tenant context or authorized tenant access", async () => {
    getCurrentTenantContextMock.mockResolvedValueOnce(null);
    await expect(getFascicoloLegalSourceCandidates("procedimento-1")).resolves.toEqual([]);
    expect(admissionFindManyMock).not.toHaveBeenCalled();

    getCurrentTenantContextMock.mockResolvedValueOnce({ accessibleTenantIds: ["ente-2"] });
    requireTenantAccessMock.mockImplementationOnce(() => {
      throw new Error("Tenant access denied.");
    });
    await expect(getFascicoloLegalSourceCandidates("procedimento-1")).resolves.toEqual([]);
    expect(admissionFindManyMock).not.toHaveBeenCalled();
  });

  it("uses the existing admission as authority and selects only bounded persisted metadata", async () => {
    await getFascicoloLegalSourceCandidates("procedimento-1");

    expect(admissionFindManyMock).toHaveBeenCalledOnce();
    const query = admissionFindManyMock.mock.calls[0]?.[0];
    expect(query.select).toEqual({
      id: true,
      admittedAt: true,
      classificationOutcome: true,
      neutralIntake: { select: { originalName: true, mimeType: true } },
      classificationAttempt: { select: { reviewRequired: true } },
      resolution: {
        select: {
          outcome: true,
          resolvedAt: true,
          reviewNote: true,
          reviewedByEmail: true,
          reviewedByRole: true,
          legalSource: {
            select: {
              id: true,
              enteId: true,
              sourceKey: true,
              title: true,
              issuingBody: true,
              sourceNumber: true,
            },
          },
        },
      },
    });
    expect(JSON.stringify(query)).not.toMatch(
      /pages|text|normalizedText|provider|storage|failureMessage|technicalMetadata|warnings|reasonCodes|evidenceMarkers/i,
    );
  });

  it("returns a bounded linked-source verification receipt", async () => {
    admissionFindManyMock.mockResolvedValueOnce([{
      id: "admission-1",
      admittedAt: new Date("2026-09-14T10:02:00.000Z"),
      classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
      neutralIntake: { originalName: "ordinanza.pdf", mimeType: "application/pdf" },
      classificationAttempt: { reviewRequired: true },
      resolution: {
        outcome: "LINKED",
        resolvedAt: new Date("2026-09-14T14:00:00.000Z"),
        reviewNote: "Identita verificata",
        reviewedByEmail: "lawyer@example.test",
        reviewedByRole: "GIURIDICO",
        legalSource: {
          id: "source-1",
          enteId: null,
          sourceKey: "source-key-1",
          title: "Ordinanza 1/2026",
          issuingBody: "Autorita portuale",
          sourceNumber: "1/2026",
        },
      },
    }]);

    const [candidate] = await getFascicoloLegalSourceCandidates("procedimento-1");
    expect(candidate.resolution).toMatchObject({
      outcome: "LINKED",
      legalSource: {
        id: "source-1",
        stableKey: "source-key-1",
        title: "Ordinanza 1/2026",
      },
    });
  });

  it("redacts linked-source identity when persisted data is inconsistent with the candidate tenant", async () => {
    admissionFindManyMock.mockResolvedValueOnce([{
      id: "admission-1",
      admittedAt: new Date("2026-09-14T10:02:00.000Z"),
      classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
      neutralIntake: { originalName: "ordinanza.pdf", mimeType: "application/pdf" },
      classificationAttempt: { reviewRequired: true },
      resolution: {
        outcome: "LINKED",
        resolvedAt: new Date("2026-09-14T14:00:00.000Z"),
        reviewNote: null,
        reviewedByEmail: "lawyer@example.test",
        reviewedByRole: "GIURIDICO",
        legalSource: {
          id: "source-other",
          enteId: "ente-2",
          sourceKey: "private-other-tenant",
          title: "Fonte riservata",
          issuingBody: null,
          sourceNumber: null,
        },
      },
    }]);

    const [candidate] = await getFascicoloLegalSourceCandidates("procedimento-1");
    expect(candidate.resolution?.legalSource).toBeNull();
    expect(JSON.stringify(candidate)).not.toContain("Fonte riservata");
  });

  it("omits the section when no candidate admission exists", () => {
    expect(LegalSourceCandidatesPanel({ items: [] })).toBeNull();
  });

  it("uses bounded candidate wording without canonical legal claims", () => {
    const panelSource = readFileSync("src/components/documents/LegalSourceCandidatesPanel.tsx", "utf8");

    expect(panelSource).toContain("Fonti giuridiche candidate");
    expect(panelSource).toContain("Possibile fonte giuridica");
    expect(panelSource).toContain("Da verificare");
    expect(panelSource).not.toMatch(/fonte canonica|autorità stabilita|applicabile|vincolante|giurisdizione/i);
  });

  it("offers only explicit catalog-link and no-match identity decisions", () => {
    const panelSource = readFileSync("src/components/documents/LegalSourceCandidatesPanel.tsx", "utf8");
    const actionSource = readFileSync("src/server/actions/legal-source-candidate-resolution.ts", "utf8");

    expect(panelSource).toContain("Verifica fonte");
    expect(panelSource).toContain("/api/legal-sources?search=");
    expect(panelSource).toContain("Collega fonte");
    expect(panelSource).toContain("Nessuna fonte esistente trovata");
    expect(panelSource).toContain('submitResolution("LINKED")');
    expect(panelSource).toContain('submitResolution("NO_MATCH")');
    expect(actionSource).not.toMatch(/legalSource\.(create|upsert)/);
    expect(actionSource).not.toMatch(/provider|openai|anthropic|generateText/i);
  });

  it("presents immutable LINKED and NO_MATCH verification receipts", () => {
    const panelSource = readFileSync("src/components/documents/LegalSourceCandidatesPanel.tsx", "utf8");

    expect(panelSource).toContain("Fonte collegata");
    expect(panelSource).toContain("Nessuna corrispondenza");
    expect(panelSource).toContain("Verificata da");
    expect(panelSource).toContain("resolution.reviewNote");
    expect(panelSource).toContain("!item.resolution && activeAdmissionId === item.id");
  });

  it("presents a redacted LINKED resolution as requiring verification without implying NO_MATCH", () => {
    const panelSource = readFileSync("src/components/documents/LegalSourceCandidatesPanel.tsx", "utf8");

    expect(panelSource).toContain(
      'const linkedSourceUnavailable = resolution.outcome === "LINKED" && resolution.legalSource === null',
    );
    expect(panelSource).toMatch(/linkedSourceUnavailable\s*\?\s*"Verifica richiesta"/);
    expect(panelSource).toContain("Collegamento non disponibile.");
    expect(panelSource).toContain("non è disponibile nel contesto autorizzato corrente");
    expect(panelSource).not.toContain('resolution.outcome === "LINKED" ? "Fonte collegata"');
  });

  it("keeps routed candidates out of processing without fabricating a Documento", () => {
    const querySource = readFileSync("src/server/queries/fascicolo-legal-source-candidates.ts", "utf8");
    const processingSource = readFileSync("src/server/queries/neutral-intake-processing.ts", "utf8");

    expect(querySource).toContain('status: "ROUTED"');
    expect(querySource).toContain("prisma.legalSourceCandidateAdmission.findMany");
    expect(querySource).not.toContain("prisma.documento");
    expect(processingSource).toContain('status: { not: "ROUTED" }');
  });

  it("retains the document and processing surfaces beside the current Fascicolo candidate panel", () => {
    const detailSource = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");

    expect(detailSource).toContain('title="Documenti del Fascicolo"');
    expect(detailSource).toContain("<NeutralIntakeProcessingPanel items={processingItems} />");
    expect(detailSource).toContain("<LegalSourceCandidatesPanel");
    expect(detailSource).toContain("items={legalSourceCandidates}");
    expect(detailSource).toContain("procedimentoId={detail.procedimento.id}");
    expect(detailSource).toContain("canVerify={canReview && hasCanonicalTenant}");
    expect(detailSource).toContain("getFascicoloLegalSourceCandidates(detail.procedimento.id)");
  });
});