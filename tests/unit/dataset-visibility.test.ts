import { describe, expect, it } from "vitest";

import {
  buildDatasetConcessioneWhere,
  buildDatasetDocumentoWhere,
  buildDatasetFascicoloIntakeWhere,
  buildDatasetProcedimentoWhere,
  getDatasetScope,
  isDatasetClassVisible,
} from "@/lib/dataset-visibility";

describe("dataset visibility", () => {
  it("defaults to the professional dataset on missing or invalid configuration", () => {
    expect(getDatasetScope({})).toBe("PROFESSIONAL");
    expect(getDatasetScope({ NOETRA_DATASET_SCOPE: "unexpected" })).toBe("PROFESSIONAL");
    expect(buildDatasetConcessioneWhere()).toEqual({ datasetClass: "PROFESSIONAL" });
    expect(buildDatasetProcedimentoWhere()).toEqual({ datasetClass: "PROFESSIONAL" });
    expect(buildDatasetFascicoloIntakeWhere()).toEqual({ datasetClass: "PROFESSIONAL" });
    expect(buildDatasetConcessioneWhere("PROFESSIONAL")).not.toEqual({
      datasetClass: "UNCLASSIFIED",
    });
  });

  it("requires an explicit synthetic scope to expose demo and E2E roots", () => {
    expect(getDatasetScope({ NOETRA_DATASET_SCOPE: "synthetic" })).toBe("SYNTHETIC");
    expect(buildDatasetConcessioneWhere("SYNTHETIC")).toEqual({
      datasetClass: { in: ["DEMO", "E2E"] },
    });
    expect(buildDatasetProcedimentoWhere("SYNTHETIC")).toEqual({
      datasetClass: { in: ["DEMO", "E2E"] },
    });
  });

  it("requires every linked document root to be inside the selected dataset", () => {
    expect(buildDatasetDocumentoWhere("PROFESSIONAL")).toEqual({
      AND: [
        {
          OR: [
            { concessione: { is: { datasetClass: "PROFESSIONAL" } } },
            { procedimento: { is: { datasetClass: "PROFESSIONAL" } } },
            { fascicoloIntake: { is: { datasetClass: "PROFESSIONAL" } } },
          ],
        },
        {
          OR: [
            { concessioneId: null },
            { concessione: { is: { datasetClass: "PROFESSIONAL" } } },
          ],
        },
        {
          OR: [
            { procedimentoId: null },
            { procedimento: { is: { datasetClass: "PROFESSIONAL" } } },
          ],
        },
        {
          OR: [
            { fascicoloIntakeId: null },
            { fascicoloIntake: { is: { datasetClass: "PROFESSIONAL" } } },
          ],
        },
      ],
    });
  });

  it("allows an explicit all-datasets administrative deployment", () => {
    expect(buildDatasetConcessioneWhere("ALL")).toEqual({});
    expect(buildDatasetDocumentoWhere("ALL")).toEqual({});
  });

  it("keeps professional, demo and E2E resources in disjoint selectable workspaces", () => {
    expect(isDatasetClassVisible("PROFESSIONAL", "PROFESSIONAL")).toBe(true);
    expect(isDatasetClassVisible("DEMO", "PROFESSIONAL")).toBe(false);
    expect(isDatasetClassVisible("E2E", "PROFESSIONAL")).toBe(false);
    expect(isDatasetClassVisible("PROFESSIONAL", "SYNTHETIC")).toBe(false);
    expect(isDatasetClassVisible("DEMO", "SYNTHETIC")).toBe(true);
    expect(isDatasetClassVisible("E2E", "SYNTHETIC")).toBe(true);
    expect(isDatasetClassVisible("UNCLASSIFIED", "ALL")).toBe(true);
  });
});
