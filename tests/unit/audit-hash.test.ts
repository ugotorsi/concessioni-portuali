import { describe, expect, it } from "vitest";

import { computeAuditHash, sanitizeMetadata, stableStringify } from "@/server/audit/hash";

describe("audit hash helpers", () => {
  it("filtra metadata sensibili", () => {
    const metadata = sanitizeMetadata({
      ok: "yes",
      password: "secret",
      token: "abc",
      nested: {
        apiKey: "hidden",
        value: "kept",
      },
    });

    expect(metadata).toEqual({
      nested: {
        value: "kept",
      },
      ok: "yes",
    });
  });

  it("produce stringify stabile su chiavi in ordine diverso", () => {
    const a = stableStringify({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = stableStringify({ nested: { x: 1, y: 2 }, a: 1, b: 2 });

    expect(a).toBe(b);
  });

  it("hash cambia se cambia payload", () => {
    const common = {
      previousHash: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      azione: "REPORT_VALIDATE",
      entita: "Report",
      entitaId: "rep-1",
      concessioneId: "con-1",
      esito: "SUCCESS" as const,
      actor: {
        userId: "u-1",
        userEmail: "admin@demo.local",
        userRole: "ADMIN",
      },
      metadata: { changedFields: ["validato"] },
    };

    const first = computeAuditHash(common);
    const second = computeAuditHash({ ...common, azione: "REPORT_UNVALIDATE" });

    expect(first).not.toBe(second);
  });

  it("hash resta uguale per payload equivalente con ordine metadata differente", () => {
    const baseInput = {
      previousHash: "abc",
      createdAt: new Date("2026-01-02T10:00:00.000Z"),
      azione: "CRITICITA_UPDATE",
      entita: "Criticita",
      entitaId: "crit-1",
      concessioneId: "con-7",
      esito: "SUCCESS" as const,
      actor: {
        userId: "u-2",
        userEmail: "giuridico@demo.local",
        userRole: "GIURIDICO",
      },
    };

    const left = computeAuditHash({
      ...baseInput,
      metadata: { b: 2, a: 1 },
    });

    const right = computeAuditHash({
      ...baseInput,
      metadata: { a: 1, b: 2 },
    });

    expect(left).toBe(right);
  });
});
