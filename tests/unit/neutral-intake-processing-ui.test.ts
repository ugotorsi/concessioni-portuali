import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const procedimentoFindUniqueMock = vi.hoisted(() => vi.fn());
const destinationFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findUnique: procedimentoFindUniqueMock },
    neutralIntakeDestination: { findMany: destinationFindManyMock },
  },
}));

import { getFascicoloProcessingItems } from "@/server/queries/neutral-intake-processing";
import {
  getClassificationNatureLabel,
  getProcessingStatusPresentation,
} from "@/components/documents/NeutralIntakeProcessingPanel";

describe("Fascicolo NeutralIntake processing projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      accessibleTenantIds: ["ente-1"],
    });
    procedimentoFindUniqueMock.mockResolvedValue({ concessione: { enteId: "ente-1" } });
    destinationFindManyMock.mockResolvedValue([{
      neutralIntake: {
        id: "intake-1",
        originalName: "istanza.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1200,
        receivedAt: new Date("2026-09-14T10:00:00.000Z"),
        status: "RECEIVED",
        classificationAttempts: [],
      },
    }]);
  });

  it("returns pending metadata only for the current Fascicolo and excludes routed intakes", async () => {
    const result = await getFascicoloProcessingItems("procedimento-1");

    expect(result).toEqual([expect.objectContaining({
      id: "intake-1",
      originalName: "istanza.pdf",
      status: "RECEIVED",
      classification: null,
    })]);
    expect(destinationFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        procedimentoId: "procedimento-1",
        neutralIntake: { enteId: "ente-1", status: { not: "ROUTED" } },
      },
    }));
  });

  it("returns no processing metadata when tenant access is denied", async () => {
    requireTenantAccessMock.mockImplementationOnce(() => {
      throw new Error("Tenant access denied.");
    });

    await expect(getFascicoloProcessingItems("procedimento-1")).resolves.toEqual([]);
    expect(destinationFindManyMock).not.toHaveBeenCalled();
  });

  it("returns the latest persisted classification decision for presentation", async () => {
    const classification = {
      outcome: "LEGAL_SOURCE_CANDIDATE",
      confidence: "HIGH",
      reviewRequired: false,
      classifiedAt: new Date("2026-09-14T10:01:00.000Z"),
    };
    destinationFindManyMock.mockResolvedValueOnce([{
      neutralIntake: {
        id: "intake-1",
        originalName: "ordinanza.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2400,
        receivedAt: new Date("2026-09-14T10:00:00.000Z"),
        status: "EVIDENCE_READY",
        classificationAttempts: [classification],
      },
    }]);

    const [item] = await getFascicoloProcessingItems("procedimento-1");

    expect(item.classification).toEqual(classification);
    expect(getClassificationNatureLabel(item.classification!.outcome, item.classification!.reviewRequired))
      .toBe("Possibile fonte giuridica");
  });

  it("fails closed without authenticated tenant context", async () => {
    getCurrentTenantContextMock.mockResolvedValueOnce(null);

    await expect(getFascicoloProcessingItems("procedimento-1")).resolves.toEqual([]);
    expect(procedimentoFindUniqueMock).not.toHaveBeenCalled();
    expect(destinationFindManyMock).not.toHaveBeenCalled();
  });

  it("selects no extracted text, provider payload, storage data, or internal failure details", async () => {
    await getFascicoloProcessingItems("procedimento-1");

    const query = destinationFindManyMock.mock.calls[0]?.[0];
    const serialized = JSON.stringify(query);
    expect(serialized).not.toMatch(/pages|text|normalizedText|provider|storage|failureMessage|technicalMetadata|warnings/i);
    expect(query.select.neutralIntake.select.classificationAttempts.select).toEqual({
      outcome: true,
      confidence: true,
      reviewRequired: true,
      classifiedAt: true,
    });
  });

  it("maps persisted lifecycle states to bounded lawyer-facing status labels", () => {
    expect(getProcessingStatusPresentation("RECEIVED", false).label).toBe("Caricato - lettura in corso");
    expect(getProcessingStatusPresentation("EVIDENCE_READY", false).label).toBe("Documento letto - classificazione in corso");
    expect(getProcessingStatusPresentation("EVIDENCE_READY", true).label).toBe("Classificazione completata - acquisizione in corso");
    expect(getProcessingStatusPresentation("REVIEW_REQUIRED", true).label).toBe("Da verificare");
    expect(getProcessingStatusPresentation("FAILED_EXTRACTION", false).label).toBe("Elaborazione non completata");
    expect(getProcessingStatusPresentation("FAILED_CLASSIFICATION", false).label).toBe("Elaborazione non completata");
    expect(getProcessingStatusPresentation("FAILED_HANDOFF", true).label).toBe("Elaborazione non completata");
    expect(getProcessingStatusPresentation("ROUTED", true).label).toBe("Documento acquisito");
  });

  it("shows nature only from persisted classification outcomes without legal conclusions", () => {
    expect(getClassificationNatureLabel("CASE_DOCUMENT", false)).toBe("Documento del fascicolo");
    expect(getClassificationNatureLabel("LEGAL_SOURCE_CANDIDATE", false)).toBe("Possibile fonte giuridica");
    expect(getClassificationNatureLabel("UNCERTAIN_REVIEW_REQUIRED", true)).toBe("Da verificare");
    expect(getClassificationNatureLabel("CASE_DOCUMENT", true)).toBe("Da verificare");
  });

  it("keeps the existing Fascicolo upload and duplicate UX beside the processing panel", () => {
    const detailSource = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const documentsSource = readFileSync("src/components/documents/EntityDocumentsPanel.tsx", "utf8");

    expect(detailSource).toContain("<NeutralIntakeProcessingPanel items={processingItems} />");
    expect(detailSource).toContain("Documento già presente nel fascicolo.");
    expect(documentsSource).toContain("Allega documento");
  });
});