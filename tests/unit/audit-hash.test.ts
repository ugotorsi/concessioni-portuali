import { describe, expect, it } from "vitest";

import {
  computeAuditHash,
  sanitizeMetadata,
  stableStringify,
  verifyAuditHashRecords,
  type AuditHashRecord,
} from "@/server/audit/hash";

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
      enteId: "ente-1",
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
      enteId: "ente-7",
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

  it("verifica puntatori e hash dell'intera sequenza senza accettare alterazioni", () => {
    const base = {
      createdAt: new Date("2026-01-03T10:00:00.000Z"),
      azione: "TEST",
      entita: "Entity",
      entitaId: "entity-1",
      enteId: "tenant-1",
      concessioneId: null,
      esito: "SUCCESS" as const,
      userId: "user-1",
      userEmail: "user@example.test",
      userRole: "ADMIN",
      metadata: { value: 1 },
    };
    const record = (id: string, previousHash: string | null, metadata = base.metadata): AuditHashRecord => {
      const input = {
        ...base,
        metadata,
        previousHash,
        actor: { userId: base.userId, userEmail: base.userEmail, userRole: base.userRole },
      };
      return { id, ...base, metadata, previousHash, currentHash: computeAuditHash(input) };
    };
    const first = record("audit-1", null);
    const second = record("audit-2", first.currentHash, { value: 2 });

    expect(verifyAuditHashRecords([first, second])).toEqual({
      valid: true,
      verifiedCount: 2,
      finalHash: second.currentHash,
      issue: null,
    });
    expect(verifyAuditHashRecords([{ ...first, metadata: { value: 99 } }, second])).toMatchObject({
      valid: false,
      verifiedCount: 0,
      issue: { recordId: "audit-1", code: "CURRENT_HASH_MISMATCH" },
    });
    expect(verifyAuditHashRecords([first, { ...second, previousHash: "fork" }])).toMatchObject({
      valid: false,
      verifiedCount: 1,
      issue: { recordId: "audit-2", code: "PREVIOUS_HASH_MISMATCH" },
    });
  });
});
