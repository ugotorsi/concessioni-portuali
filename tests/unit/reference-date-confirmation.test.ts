import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: vi.fn() }));

import {
  loadReferenceDateConfirmations,
  parseConfirmedReferenceDate,
  REFERENCE_DATE_CONFIRMATION_SOURCE_VERSION,
} from "@/server/fascicolo-knowledge/referenceDateConfirmation";

const questionKey = "b".repeat(64);

describe("reference date confirmation", () => {
  it("accepts only real ISO calendar dates", () => {
    expect(parseConfirmedReferenceDate("2026-10-15")).toBe("2026-10-15");
    for (const invalid of ["2026-02-30", "15/10/2026", "2026-10-15T00:00:00Z", "", null, "1800-01-01"]) {
      expect(() => parseConfirmedReferenceDate(invalid)).toThrow("INVALID_REFERENCE_DATE");
    }
  });

  it("uses the latest valid confirmation per question of the same fascicolo", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "log-3", entitaId: `procedure-1:${questionKey}`, metadata: { procedimentoId: "procedure-1", questionSemanticKey: questionKey, confirmedDate: "not-a-date" } },
      { id: "log-2", entitaId: `procedure-1:${questionKey}`, metadata: { procedimentoId: "procedure-1", questionSemanticKey: questionKey, confirmedDate: "2026-10-15" } },
      { id: "log-1", entitaId: `procedure-1:${questionKey}`, metadata: { procedimentoId: "procedure-1", questionSemanticKey: questionKey, confirmedDate: "2026-01-01" } },
      { id: "log-0", entitaId: `procedure-2:${questionKey}`, metadata: { procedimentoId: "procedure-2", questionSemanticKey: questionKey, confirmedDate: "2026-02-01" } },
    ]);

    const confirmations = await loadReferenceDateConfirmations(
      { tenantId: "tenant-1", procedimentoId: "procedure-1" },
      { activityLog: { findMany } } as never,
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ enteId: "tenant-1", esito: "SUCCESS" }),
    }));
    expect(confirmations).toEqual([{
      questionSemanticKey: questionKey,
      confirmedDate: "2026-10-15",
      sourceId: "log-2",
      sourceVersion: REFERENCE_DATE_CONFIRMATION_SOURCE_VERSION,
    }]);
  });
});
