import { describe, expect, it, vi } from "vitest";

import { previewDatasetClassificationRepair } from "@/server/dataset-classification/repair";
import {
  buildDatasetClassificationRepairPlan,
  DatasetClassificationRepairError,
} from "@/server/dataset-classification/repair-plan";

describe("dataset classification repair plan", () => {
  it("aligns every root in a standalone synthetic fascicolo to its tenant class", () => {
    const plan = buildDatasetClassificationRepairPlan({
      tenantId: "tenant-demo",
      tenantCode: "DEMO-ENTE-ADSP",
      selectedProcedureId: "procedure-1",
      roots: [
        {
          kind: "FASCICOLO_INTAKE",
          id: "intake-1",
          tenantId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        },
        {
          kind: "PROCEDIMENTO",
          id: "procedure-1",
          tenantId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        },
      ],
    });

    expect(plan).toMatchObject({
      targetClass: "DEMO",
      targetScope: "SYNTHETIC",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(plan.changes.map((root) => `${root.kind}:${root.id}`)).toEqual([
      "FASCICOLO_INTAKE:intake-1",
      "PROCEDIMENTO:procedure-1",
    ]);
  });

  it("repairs a whole concession aggregate instead of creating cross-dataset links", () => {
    const plan = buildDatasetClassificationRepairPlan({
      tenantId: "tenant-e2e",
      tenantCode: "E2E-CANARY",
      selectedProcedureId: "procedure-2",
      roots: [
        {
          kind: "CONCESSIONE",
          id: "concession-1",
          tenantId: "tenant-e2e",
          datasetClass: "PROFESSIONAL",
        },
        {
          kind: "PROCEDIMENTO",
          id: "procedure-1",
          tenantId: "tenant-e2e",
          datasetClass: "PROFESSIONAL",
        },
        {
          kind: "PROCEDIMENTO",
          id: "procedure-2",
          tenantId: "tenant-e2e",
          datasetClass: "E2E",
        },
        {
          kind: "FASCICOLO_INTAKE",
          id: "intake-2",
          tenantId: "tenant-e2e",
          datasetClass: "PROFESSIONAL",
        },
      ],
    });

    expect(plan.targetClass).toBe("E2E");
    expect(plan.changes.map((root) => root.id)).toEqual([
      "concession-1",
      "intake-2",
      "procedure-1",
    ]);
  });

  it("includes concession-linked intakes even before they have a proceeding", async () => {
    const client = {
      procedimento: {
        findUnique: vi.fn(async () => ({
          id: "procedure-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
          concessioneId: "concession-1",
          ente: { codice: "DEMO-ENTE-ADSP" },
          fascicoloIntake: null,
        })),
        findMany: vi.fn(async () => [{
          id: "procedure-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        }]),
      },
      concessione: {
        findUnique: vi.fn(async () => ({
          id: "concession-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        })),
      },
      fascicoloIntake: {
        findMany: vi.fn(async () => [{
          id: "intake-before-activation",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
          concessioneId: null,
          procedimento: { concessioneId: "concession-1" },
        }]),
      },
    } as unknown as NonNullable<Parameters<typeof previewDatasetClassificationRepair>[1]>;

    const plan = await previewDatasetClassificationRepair("procedure-1", client);

    expect(plan.changes.map((root) => `${root.kind}:${root.id}`)).toEqual([
      "CONCESSIONE:concession-1",
      "FASCICOLO_INTAKE:intake-before-activation",
      "PROCEDIMENTO:procedure-1",
    ]);
    expect(client.fascicoloIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { concessioneId: "concession-1" },
            { procedimento: { concessioneId: "concession-1" } },
          ],
        },
      }),
    );
  });

  it("refuses intakes whose direct and proceeding aggregates disagree", async () => {
    const client = {
      procedimento: {
        findUnique: vi.fn(async () => ({
          id: "procedure-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
          concessioneId: "concession-1",
          ente: { codice: "DEMO-ENTE-ADSP" },
          fascicoloIntake: null,
        })),
        findMany: vi.fn(async () => [{
          id: "procedure-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        }]),
      },
      concessione: {
        findUnique: vi.fn(async () => ({
          id: "concession-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        })),
      },
      fascicoloIntake: {
        findMany: vi.fn(async () => [{
          id: "intake-cross-aggregate",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
          concessioneId: "concession-2",
          procedimento: { concessioneId: "concession-1" },
        }]),
      },
    } as unknown as NonNullable<Parameters<typeof previewDatasetClassificationRepair>[1]>;

    await expect(
      previewDatasetClassificationRepair("procedure-1", client),
    ).rejects.toThrow("DATASET_CLASSIFICATION_INTAKE_AGGREGATE_MISMATCH");
  });

  it("refuses direct concession intakes linked to an unassigned proceeding", async () => {
    const client = {
      procedimento: {
        findUnique: vi.fn(async () => ({
          id: "procedure-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
          concessioneId: "concession-1",
          ente: { codice: "DEMO-ENTE-ADSP" },
          fascicoloIntake: null,
        })),
        findMany: vi.fn(async () => [{
          id: "procedure-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        }]),
      },
      concessione: {
        findUnique: vi.fn(async () => ({
          id: "concession-1",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        })),
      },
      fascicoloIntake: {
        findMany: vi.fn(async () => [{
          id: "intake-unassigned-procedure",
          enteId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
          concessioneId: "concession-1",
          procedimento: { concessioneId: null },
        }]),
      },
    } as unknown as NonNullable<Parameters<typeof previewDatasetClassificationRepair>[1]>;

    await expect(
      previewDatasetClassificationRepair("procedure-1", client),
    ).rejects.toThrow("DATASET_CLASSIFICATION_INTAKE_AGGREGATE_MISMATCH");
  });

  it("refuses roots crossing tenant boundaries", () => {
    expect(() => buildDatasetClassificationRepairPlan({
      tenantId: "tenant-demo",
      tenantCode: "DEMO-ENTE-ADSP",
      selectedProcedureId: "procedure-1",
      roots: [
        {
          kind: "PROCEDIMENTO",
          id: "procedure-1",
          tenantId: "tenant-demo",
          datasetClass: "PROFESSIONAL",
        },
        {
          kind: "FASCICOLO_INTAKE",
          id: "intake-1",
          tenantId: "tenant-other",
          datasetClass: "PROFESSIONAL",
        },
      ],
    })).toThrowError(new DatasetClassificationRepairError(
      "DATASET_CLASSIFICATION_ROOT_TENANT_MISMATCH",
    ));
  });

  it("does not plan writes for already aligned roots", () => {
    const plan = buildDatasetClassificationRepairPlan({
      tenantId: "tenant-professional",
      tenantCode: "ENTE-PROFESSIONALE",
      selectedProcedureId: "procedure-1",
      roots: [{
        kind: "PROCEDIMENTO",
        id: "procedure-1",
        tenantId: "tenant-professional",
        datasetClass: "PROFESSIONAL",
      }],
    });

    expect(plan.targetScope).toBe("PROFESSIONAL");
    expect(plan.changes).toEqual([]);
  });
});
