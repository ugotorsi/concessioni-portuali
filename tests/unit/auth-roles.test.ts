import { describe, expect, it } from "vitest";

import {
  BACKOFFICE_ROLES,
  canDownloadReportPdf,
  canManageCriticita,
  canManagePagamenti,
  canManageProcedimenti,
  canUseAI,
  canValidateReport,
  isAdspViewer,
  isBackofficeRole,
} from "@/lib/auth";

describe("auth role capabilities", () => {
  it("ADMIN ha accesso operativo completo nei moduli principali", () => {
    expect(canManageCriticita("ADMIN")).toBe(true);
    expect(canManagePagamenti("ADMIN")).toBe(true);
    expect(canManageProcedimenti("ADMIN")).toBe(true);
    expect(canValidateReport("ADMIN")).toBe(true);
    expect(canUseAI("ADMIN")).toBe(true);
    expect(isBackofficeRole("ADMIN")).toBe(true);
  });

  it("VIEWER_ADSP rimane consultivo", () => {
    expect(isAdspViewer("VIEWER_ADSP")).toBe(true);
    expect(canManageCriticita("VIEWER_ADSP")).toBe(false);
    expect(canManagePagamenti("VIEWER_ADSP")).toBe(false);
    expect(canManageProcedimenti("VIEWER_ADSP")).toBe(false);
    expect(canValidateReport("VIEWER_ADSP")).toBe(false);
    expect(canUseAI("VIEWER_ADSP")).toBe(false);
  });

  it("download PDF per VIEWER_ADSP dipende da validazione", () => {
    expect(canDownloadReportPdf("VIEWER_ADSP", true)).toBe(true);
    expect(canDownloadReportPdf("VIEWER_ADSP", false)).toBe(false);
  });

  it("BACKOFFICE_ROLES non include VIEWER_ADSP", () => {
    expect(BACKOFFICE_ROLES).not.toContain("VIEWER_ADSP");
    expect(BACKOFFICE_ROLES.every((role) => isBackofficeRole(role))).toBe(true);
  });
});
