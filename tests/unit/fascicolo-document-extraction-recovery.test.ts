import { describe, expect, it, vi } from "vitest";

import {
  ensureFascicoloDocumentExtractionJobs,
  FascicoloDocumentExtractionRecoveryError,
} from "@/server/documents/fascicoloDocumentExtractionRecovery";

describe("existing fascicolo document extraction recovery", () => {
  it("admits every current PDF version with stable system authority and activates one worker", async () => {
    const createdAt = new Date("2026-11-17T10:00:00.000Z");
    const admit = vi.fn()
      .mockResolvedValueOnce({ outcome: "CREATED", job: { id: "job-1" } })
      .mockResolvedValueOnce({ outcome: "REUSED", job: { id: "job-2" } });
    const activate = vi.fn(async () => ({
      outcome: "REQUESTED" as const,
      renderJobId: "render-job-1",
    }));

    const result = await ensureFascicoloDocumentExtractionJobs({
      tenantId: "ente-1",
      procedimentoId: "procedimento-1",
    }, {
      loadTargets: vi.fn(async () => [
        {
          documentoId: "documento-1",
          documentFileVersionId: "versione-1",
          createdAt,
        },
        {
          documentoId: "documento-2",
          documentFileVersionId: "versione-2",
          createdAt,
        },
      ]),
      admit,
      activate,
    });

    expect(admit).toHaveBeenCalledTimes(2);
    expect(admit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      documentoId: "documento-1",
      documentFileVersionId: "versione-1",
      procedimentoId: "procedimento-1",
      correlationId: "existing-document-extraction:documento-1:versione-1",
      availableAt: createdAt,
      authority: {
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId: "ente-1",
        initiatingUserId: null,
        actorId: "fascicolo-existing-document-extraction",
        actorEmail: null,
        actorRole: "SYSTEM",
        policyDecisionRef: "FASCICOLO_EXISTING_DOCUMENT_EXTRACTION_ADMISSION_V1",
      },
    }));
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith({
      kind: "DOCUMENT_EXTRACTION",
      procedimentoId: "procedimento-1",
    });
    expect(result).toEqual({
      targetCount: 2,
      createdJobCount: 1,
      reusedJobCount: 1,
      activation: {
        outcome: "REQUESTED",
        renderJobId: "render-job-1",
      },
    });
  });

  it("does not activate a worker when the fascicolo has no eligible PDF", async () => {
    const activate = vi.fn();
    const result = await ensureFascicoloDocumentExtractionJobs({
      tenantId: "ente-1",
      procedimentoId: "procedimento-1",
    }, {
      loadTargets: vi.fn(async () => []),
      admit: vi.fn(),
      activate,
    });

    expect(result).toMatchObject({
      targetCount: 0,
      createdJobCount: 0,
      reusedJobCount: 0,
      activation: { outcome: "NOT_REQUIRED" },
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it("fails closed when the tenant-scoped fascicolo does not exist", async () => {
    await expect(ensureFascicoloDocumentExtractionJobs({
      tenantId: "ente-1",
      procedimentoId: "procedimento-1",
    }, {
      loadTargets: vi.fn(async () => null),
      admit: vi.fn(),
      activate: vi.fn(),
    })).rejects.toEqual(new FascicoloDocumentExtractionRecoveryError("FASCICOLO_NOT_FOUND"));
  });
});
