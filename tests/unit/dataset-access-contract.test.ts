import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("dataset access boundaries", () => {
  it("applies dataset visibility to direct procedure URLs and API routes", () => {
    const procedureQuery = source("src/server/queries/procedimenti.ts");
    const technicalApi = source(
      "src/app/api/procedimenti/[id]/technical-research/route.ts",
    );
    const structuredExport = source(
      "src/app/api/procedimenti/[id]/reports/[snapshotId]/export/route.ts",
    );
    const reportExport = source("src/app/procedimenti/[id]/report/export/route.ts");
    const actExport = source(
      "src/app/procedimenti/[id]/atti/[draftKey]/export/route.ts",
    );

    expect(procedureQuery).toContain(
      "where: { id, ...buildDatasetProcedimentoWhere() }",
    );
    expect(technicalApi).toContain(
      "where: { id: procedimentoId, ...buildDatasetProcedimentoWhere() }",
    );
    expect(structuredExport).toContain(
      "procedimento: { is: buildDatasetProcedimentoWhere() }",
    );
    expect(reportExport).toContain(
      "where: { id: procedimentoId, ...buildDatasetProcedimentoWhere() }",
    );
    expect(actExport).toContain(
      "where: { id: procedimentoId, ...buildDatasetProcedimentoWhere() }",
    );
  });

  it("applies dataset visibility to downloads, CSV exports and tenant access", () => {
    const byteReader = source(
      "src/server/documents/authorizedVerifiedByteReader.ts",
    );
    const procedureExport = source("src/app/export/procedimenti/route.ts");
    const reportExport = source("src/app/export/report/route.ts");
    const tenantAuth = source("src/lib/tenant-auth.ts");

    expect(byteReader).toContain("...buildDatasetDocumentoWhere()");
    expect(procedureExport).toContain("...buildDatasetProcedimentoWhere()");
    expect(reportExport).toContain("buildDatasetConcessioneWhere()");
    expect(tenantAuth).toContain(
      "where: { id: concessioneId, ...buildDatasetConcessioneWhere() }",
    );
  });
});
