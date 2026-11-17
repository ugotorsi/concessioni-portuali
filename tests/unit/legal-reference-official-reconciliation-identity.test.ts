import { describe, expect, it } from "vitest";

import {
  buildOfficialHitIdentityV1,
  fingerprintOfficialHitEvidenceV1,
} from "@/server/intake/official-hit-reconciliation/identity";
import {
  classifyOfficialEvidenceProvider,
  mergeIdentityFieldsByPrecedence,
  selectFieldByPrecedence,
  UnsupportedOfficialEvidenceProviderError,
} from "@/server/intake/official-hit-reconciliation/policy";
import { LEGAL_DATA_HUNTER_PROVIDER } from "@/server/intake/official-source-lookup/legalDataHunter";
import { NORMATTIVA_PROVIDER } from "@/server/intake/official-source-lookup/normattiva";
import { OPENGA_PROVIDER } from "@/server/intake/official-source-lookup/openga";

describe("Block 3B.8B official hit identity", () => {
  it("matches the legislation golden vector across formatting variants", () => {
    const identity = buildOfficialHitIdentityV1({
      documentKind: "LEGISLATION",
      denominazioneAtto: "decreto legislativo",
      numeroProvvedimento: "0036",
      annoProvvedimento: 2023,
      authority: null,
      decisionNumber: null,
      decisionYear: null,
      chamberSection: null,
    });

    expect(identity).toMatchObject({
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
      identityFingerprint: "6ffadcd6b88082f73f3752fbfd9f1d44449774975680ea32c3eef691a2d699c9",
    });
  });

  it("round-trips the canonical DPR act type", () => {
    expect(buildOfficialHitIdentityV1({
      documentKind: "LEGISLATION", denominazioneAtto: "DECRETO_PRESIDENTE_REPUBBLICA",
      numeroProvvedimento: "380", annoProvvedimento: 2001, authority: null,
      decisionNumber: null, decisionYear: null, chamberSection: null,
    }).identityFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the case-law golden vector and normalizes accents and separators", () => {
    const identity = buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW",
      denominazioneAtto: null,
      numeroProvvedimento: null,
      annoProvvedimento: null,
      authority: "  Consiglio di Stato ",
      decisionNumber: "009414",
      decisionYear: 2025,
      chamberSection: "iii",
      court: "Consiglio di Stato",
      decisionType: "sentenza",
      ecli: null,
    });

    expect(identity).toMatchObject({
      canonicalKey: "CONSIGLIO DI STATO:SENTENZA:9414:2025:III",
      identityFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      normalizedIdentity: expect.objectContaining({ decisionType: "SENTENZA", section: "III" }),
    });
  });

  it("never emits a shared fingerprint for incomplete identity", () => {
    expect(buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW",
      denominazioneAtto: null,
      numeroProvvedimento: null,
      annoProvvedimento: null,
      authority: "CASSAZIONE",
      decisionNumber: null,
      decisionYear: 2025,
      chamberSection: null,
    })).toMatchObject({ identityFingerprint: null, canonicalKey: null });
  });

  it("keeps evidence fingerprints provider-specific without changing canonical identity", () => {
    const base = {
      documentKind: "CASE_LAW" as const,
      denominazioneAtto: null,
      numeroProvvedimento: null,
      annoProvvedimento: null,
      authority: "CASSAZIONE",
      decisionNumber: "1234",
      decisionYear: 2024,
      chamberSection: null,
      providerRecordId: "record-1",
      providerSourceId: "IT/Cassazione",
      issuedAt: new Date("2024-03-15T00:00:00.000Z"),
      title: "Cassazione n. 1234/2024",
      sourceUrl: "https://example.test/1234",
    };
    const official = fingerprintOfficialHitEvidenceV1({ ...base, provider: "OFFICIAL" });
    const commercial = fingerprintOfficialHitEvidenceV1({ ...base, provider: "COMMERCIAL" });
    expect(official).toMatch(/^[0-9a-f]{64}$/);
    expect(commercial).toMatch(/^[0-9a-f]{64}$/);
    expect(official).not.toBe(commercial);
  });

  it("uses explicit field-level precedence and never provider voting", () => {
    expect(selectFieldByPrecedence([
      { classification: "COMMERCIAL_CORROBORATION", evidenceFingerprint: "a", value: "commercial-a" },
      { classification: "COMMERCIAL_CORROBORATION", evidenceFingerprint: "b", value: "commercial-b" },
      { classification: "OFFICIAL_AUTHORITY", evidenceFingerprint: "c", value: "official" },
    ])).toBe("official");
    expect(selectFieldByPrecedence([
      { classification: "COMMERCIAL_CORROBORATION", evidenceFingerprint: "b", value: "later" },
      { classification: "COMMERCIAL_CORROBORATION", evidenceFingerprint: "a", value: "deterministic" },
    ])).toBe("deterministic");
  });

  it("enriches missing identity fields but conflicts on explicit contradictions", () => {
    expect(mergeIdentityFieldsByPrecedence(
      { courtFamily: "TAR", courtLocality: "NAPOLI", section: null },
      { courtFamily: "TAR", courtLocality: "NAPOLI", section: "III" },
      "COMMERCIAL_CORROBORATION",
      "OFFICIAL_AUTHORITY",
    )).toEqual({
      outcome: "MERGED",
      identity: { courtFamily: "TAR", courtLocality: "NAPOLI", section: "III" },
    });
    expect(mergeIdentityFieldsByPrecedence(
      { courtFamily: "TAR", courtLocality: "NAPOLI" },
      { courtFamily: "TAR", courtLocality: "SALERNO" },
      "COMMERCIAL_CORROBORATION",
      "OFFICIAL_AUTHORITY",
    )).toEqual({ outcome: "CONFLICT" });
  });

  it("classifies allowlisted providers and fails closed for unknown providers", () => {
    expect(classifyOfficialEvidenceProvider(NORMATTIVA_PROVIDER)).toBe("OFFICIAL_AUTHORITY");
    expect(classifyOfficialEvidenceProvider(OPENGA_PROVIDER)).toBe("OFFICIAL_AUTHORITY");
    expect(classifyOfficialEvidenceProvider(LEGAL_DATA_HUNTER_PROVIDER)).toBe("COMMERCIAL_CORROBORATION");
    expect(() => classifyOfficialEvidenceProvider("UNKNOWN"))
      .toThrow(UnsupportedOfficialEvidenceProviderError);
  });

  it.each([
    ["TAR Campania Napoli", "TAR Campania Salerno"],
    ["TAR Lombardia Milano", "TAR Lombardia Brescia"],
  ])("keeps territorial courts distinct: %s != %s", (left, right) => {
    const build = (court: string) => buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW", denominazioneAtto: null, numeroProvvedimento: null,
      annoProvvedimento: null, authority: court, court, decisionType: "SENTENZA",
      decisionNumber: "123", decisionYear: 2025, chamberSection: null, ecli: null,
    });
    expect(build(left).identityFingerprint).not.toBe(build(right).identityFingerprint);
  });

  it("keeps generic TAR and missing decision type incomplete", () => {
    const build = (decisionType: string | null) => buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW", denominazioneAtto: null, numeroProvvedimento: null,
      annoProvvedimento: null, authority: "TAR", court: "TAR", decisionType,
      decisionNumber: "123", decisionYear: 2025, chamberSection: null, ecli: null,
    });
    expect(build("SENTENZA").identityFingerprint).toBeNull();
    expect(build(null).identityFingerprint).toBeNull();
  });

  it("preserves compatible validated ECLI without replacing structural identity", () => {
    const identity = buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW", denominazioneAtto: null, numeroProvvedimento: null,
      annoProvvedimento: null, authority: "Consiglio di Stato", court: "Consiglio di Stato",
      decisionType: "SENTENZA", decisionNumber: "9414", decisionYear: 2025,
      chamberSection: "III", ecli: "ecli:it:cds:2025:9414",
    });
    expect(identity.normalizedIdentity).toMatchObject({ ecli: "ECLI:IT:CDS:2025:9414" });
    expect(identity.identityFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["wrong country", "ECLI:FR:CDS:2025:9414"],
    ["wrong year", "ECLI:IT:CDS:2024:9414"],
    ["extra component", "ECLI:IT:CDS:2025:9414:EXTRA"],
    ["missing court code", "ECLI:IT::2025:9414"],
  ])("fails closed for %s in an Italian ECLI", (_label, ecli) => {
    const identity = buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW", denominazioneAtto: null, numeroProvvedimento: null,
      annoProvvedimento: null, authority: "Consiglio di Stato", court: "Consiglio di Stato",
      decisionType: "SENTENZA", decisionNumber: "9414", decisionYear: 2025,
      chamberSection: "III", ecli,
    });
    expect(identity).toMatchObject({ identityConflict: true, identityFingerprint: null });
  });

  it("normalizes deterministic ECLI whitespace", () => {
    const build = (ecli: string) => buildOfficialHitIdentityV1({
      documentKind: "CASE_LAW", denominazioneAtto: null, numeroProvvedimento: null,
      annoProvvedimento: null, authority: "Consiglio di Stato", court: "Consiglio di Stato",
      decisionType: "SENTENZA", decisionNumber: "9414", decisionYear: 2025,
      chamberSection: "III", ecli,
    });
    expect(build(" ECLI:IT:CDS:2025:9414 ").identityFingerprint)
      .toBe(build("ecli:it:cds:2025:9414").identityFingerprint);
  });
});