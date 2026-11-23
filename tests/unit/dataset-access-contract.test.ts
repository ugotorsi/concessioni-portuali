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
      "where: { id, ...buildDatasetProcedimentoWhere(tenantContext?.datasetScope) }",
    );
    expect(technicalApi).toContain(
      "...buildDatasetProcedimentoWhere(tenantContext.datasetScope)",
    );
    expect(structuredExport).toContain(
      "procedimento: { is: buildDatasetProcedimentoWhere(tenantContext.datasetScope) }",
    );
    expect(reportExport).toContain(
      "...buildDatasetProcedimentoWhere(tenantContext.datasetScope)",
    );
    expect(actExport).toContain(
      "...buildDatasetProcedimentoWhere(tenantContext.datasetScope)",
    );
  });

  it("applies dataset visibility to downloads, CSV exports and tenant access", () => {
    const byteReader = source(
      "src/server/documents/authorizedVerifiedByteReader.ts",
    );
    const procedureExport = source("src/app/export/procedimenti/route.ts");
    const reportExport = source("src/app/export/report/route.ts");
    const tenantAuth = source("src/lib/tenant-auth.ts");

    expect(byteReader).toContain(
      "...buildDatasetDocumentoWhere(tenantContext.datasetScope)",
    );
    expect(procedureExport).toContain(
      "...buildDatasetProcedimentoWhere(tenantContext?.datasetScope)",
    );
    expect(reportExport).toContain(
      "buildDatasetConcessioneWhere(tenantContext?.datasetScope)",
    );
    expect(tenantAuth).toContain(
      "...buildDatasetConcessioneWhere(context.datasetScope)",
    );
  });
});
