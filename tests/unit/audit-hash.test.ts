import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeAuditHash,
  createHistoricalAuditHashVerificationState,
  sanitizeMetadata,
  stableStringify,
  verifyAuditHashRecords,
  verifyHistoricalAuditHashRecords,
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

  it("verifica una catena storica mista senza riscrivere gli eventi legacy", () => {
    const common = {
      azione: "CREAZIONE_CONCESSIONE",
      entita: "Concessione",
      entitaId: "con-1",
      enteId: "tenant-1",
      concessioneId: "con-1",
      esito: "SUCCESS" as const,
      userId: null,
      userEmail: "seed@system.local",
      userRole: "SYSTEM",
    };
    const legacySeedInput = {
      previousHash: null,
      userId: common.userId,
      userEmail: common.userEmail,
      userRole: common.userRole,
      azione: common.azione,
      entita: common.entita,
      entitaId: common.entitaId,
      concessioneId: common.concessioneId,
      esito: common.esito,
      metadata: { seed: "true", message: "Initial concession" },
      createdAt: "2026-07-24T19:55:15.831Z",
    };
    const legacySeed: AuditHashRecord = {
      id: "seed-1",
      ...common,
      createdAt: new Date(legacySeedInput.createdAt),
      metadata: { seed: true, message: "Initial concession" },
      previousHash: null,
      currentHash: createHash("sha256").update(JSON.stringify(legacySeedInput)).digest("hex"),
    };
    const withoutEnteIdBase = {
      ...common,
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      metadata: { source: "legacy-writer" },
      previousHash: legacySeed.currentHash,
    };
    const withoutEnteIdPayload = {
      previousHash: withoutEnteIdBase.previousHash,
      userId: withoutEnteIdBase.userId,
      userEmail: withoutEnteIdBase.userEmail,
      userRole: withoutEnteIdBase.userRole,
      azione: withoutEnteIdBase.azione,
      entita: withoutEnteIdBase.entita,
      entitaId: withoutEnteIdBase.entitaId,
      concessioneId: withoutEnteIdBase.concessioneId,
      esito: withoutEnteIdBase.esito,
      metadata: withoutEnteIdBase.metadata,
      createdAt: withoutEnteIdBase.createdAt.toISOString(),
    };
    const withoutEnteId: AuditHashRecord = {
      id: "audit-v1",
      ...withoutEnteIdBase,
      currentHash: createHash("sha256")
        .update(stableStringify(withoutEnteIdPayload))
        .digest("hex"),
    };
    const currentBase = {
      ...common,
      createdAt: new Date("2026-09-21T21:33:00.374Z"),
      metadata: { source: "current-writer" },
      previousHash: withoutEnteId.currentHash,
    };
    const current: AuditHashRecord = {
      id: "audit-v2",
      ...currentBase,
      currentHash: computeAuditHash({
        ...currentBase,
        actor: {
          userId: currentBase.userId,
          userEmail: currentBase.userEmail,
          userRole: currentBase.userRole,
        },
      }),
    };

    const firstPage = verifyHistoricalAuditHashRecords(
      [legacySeed, withoutEnteId],
      createHistoricalAuditHashVerificationState(),
    );
    expect(firstPage).toMatchObject({
      valid: true,
      verifiedCount: 2,
      algorithmCounts: {
        LEGACY_SEED_STRING_METADATA: 1,
        CANONICAL_WITHOUT_ENTE_ID: 1,
        CANONICAL_WITH_ENTE_ID: 0,
      },
    });
    expect(verifyHistoricalAuditHashRecords([current], firstPage.state)).toMatchObject({
      valid: true,
      verifiedCount: 1,
      finalHash: current.currentHash,
      algorithmCounts: {
        LEGACY_SEED_STRING_METADATA: 0,
        CANONICAL_WITHOUT_ENTE_ID: 0,
        CANONICAL_WITH_ENTE_ID: 1,
      },
    });
  });

  it("rifiuta il riutilizzo di algoritmi storici dopo l'avvio del formato corrente", () => {
    const currentBase = {
      createdAt: new Date("2026-09-21T21:33:00.374Z"),
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
      previousHash: null,
    };
    const current: AuditHashRecord = {
      id: "current",
      ...currentBase,
      currentHash: computeAuditHash({
        ...currentBase,
        actor: {
          userId: currentBase.userId,
          userEmail: currentBase.userEmail,
          userRole: currentBase.userRole,
        },
      }),
    };
    const legacyBase = {
      ...currentBase,
      createdAt: new Date("2026-09-21T21:34:00.000Z"),
      previousHash: current.currentHash,
      metadata: { value: 2 },
    };
    const legacyPayload = {
      previousHash: legacyBase.previousHash,
      userId: legacyBase.userId,
      userEmail: legacyBase.userEmail,
      userRole: legacyBase.userRole,
      azione: legacyBase.azione,
      entita: legacyBase.entita,
      entitaId: legacyBase.entitaId,
      concessioneId: legacyBase.concessioneId,
      esito: legacyBase.esito,
      metadata: legacyBase.metadata,
      createdAt: legacyBase.createdAt.toISOString(),
    };
    const downgraded: AuditHashRecord = {
      id: "downgraded",
      ...legacyBase,
      currentHash: createHash("sha256").update(stableStringify(legacyPayload)).digest("hex"),
    };

    expect(verifyHistoricalAuditHashRecords([current, downgraded])).toMatchObject({
      valid: false,
      verifiedCount: 1,
      issue: { recordId: "downgraded", code: "HASH_ALGORITHM_DOWNGRADE" },
    });
  });
});
