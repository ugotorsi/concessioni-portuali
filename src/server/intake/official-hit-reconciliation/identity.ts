import { createHash } from "node:crypto";
import { z } from "zod";

export const LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION =
  "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2" as const;
export const LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION =
  "LEGAL_REFERENCE_OFFICIAL_POLICY_V2" as const;

export interface ReconciliationHitIdentityInput {
  documentKind: "LEGISLATION" | "CASE_LAW";
  denominazioneAtto: string | null;
  numeroProvvedimento: string | null;
  annoProvvedimento: number | null;
  authority: string | null;
  decisionNumber: string | null;
  decisionYear: number | null;
  chamberSection: string | null;
  court?: string | null;
  decisionType?: string | null;
  ecli?: string | null;
}

export interface ReconciliationEvidenceInput extends ReconciliationHitIdentityInput {
  provider: string;
  providerRecordId: string;
  providerSourceId: string;
  issuedAt: Date | null;
  title: string | null;
  sourceUrl: string | null;
}

export type NormalizedOfficialIdentity =
  | {
      kind: "LEGISLATION";
      jurisdiction: "IT";
      actType: string | null;
      actNumber: string | null;
      year: number | null;
    }
  | {
      kind: "CASE_LAW";
      jurisdiction: "IT";
      courtFamily: string | null;
      courtLocality: string | null;
      courtBranch: string | null;
      decisionType: string | null;
      decisionNumber: string | null;
      year: number | null;
      section: string | null;
      ecli: string | null;
    };

export interface BuiltOfficialIdentity {
  identityVersion: typeof LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION;
  normalizedIdentity: NormalizedOfficialIdentity;
  identityFingerprint: string | null;
  canonicalKey: string | null;
  identityConflict: boolean;
}

const normalizedOfficialIdentitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LEGISLATION"), jurisdiction: z.literal("IT"),
    actType: z.string().min(1), actNumber: z.string().min(1), year: z.number().int(),
  }).strict(),
  z.object({
    kind: z.literal("CASE_LAW"), jurisdiction: z.literal("IT"),
    courtFamily: z.string().min(1), courtLocality: z.string().nullable(),
    courtBranch: z.string().nullable(), decisionType: z.string().min(1),
    decisionNumber: z.string().min(1), year: z.number().int(),
    section: z.string().nullable(), ecli: z.string().nullable(),
  }).strict(),
]);

const legislationTypeAliases = new Map([
  ["LEGGE", "LEGGE"],
  ["DECRETO LEGGE", "DECRETO_LEGGE"],
  ["DECRETO LEGISLATIVO", "DECRETO_LEGISLATIVO"],
  ["DECRETO DEL PRESIDENTE DELLA REPUBBLICA", "DECRETO_PRESIDENTE_REPUBBLICA"],
  ["DECRETO PRESIDENTE REPUBBLICA", "DECRETO_PRESIDENTE_REPUBBLICA"],
]);

function normalizedText(value: string | null): string | null {
  const normalized = value?.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toUpperCase();
  return normalized || null;
}

function normalizedNumber(value: string | null): string | null {
  const normalized = normalizedText(value)?.replace(/\s+/g, "") ?? null;
  return normalized?.replace(/^0+(?=\d)/, "") ?? null;
}

function compactText(value: string | null): string | null {
  return normalizedText(value)?.replace(/\s+/g, "") ?? null;
}

function normalizedDecisionType(value: string | null | undefined): string | null {
  const compact = compactText(value ?? null);
  if (!compact) return null;
  if (compact.startsWith("SENTENZ")) return "SENTENZA";
  if (compact.startsWith("ORDINANZ")) return "ORDINANZA";
  if (compact.startsWith("DECRET")) return "DECRETO";
  if (compact.startsWith("PARER")) return "PARERE";
  return null;
}

function normalizedEcli(value: string | null | undefined, year: number | null): string | null {
  const normalized = value?.normalize("NFKC").replace(/\s+/g, "").toUpperCase() ?? "";
  const match = /^ECLI:([A-Z]{2}):([A-Z0-9.]+):(\d{4}):([A-Z0-9.-]+)$/.exec(normalized);
  if (!match || match[1] !== "IT" || (year !== null && Number(match[3]) !== year)) return null;
  return normalized;
}

type CourtIdentity = {
  courtFamily: string | null;
  courtLocality: string | null;
  courtBranch: string | null;
};

function parseCourtIdentity(value: string | null | undefined): CourtIdentity {
  const source = normalizedText(value ?? null);
  const compact = compactText(source);
  if (!compact) return { courtFamily: null, courtLocality: null, courtBranch: null };
  if (compact.includes("CASSAZIONE") || compact.includes("CORTESUPREMADICASSAZIONE")) {
    return {
      courtFamily: "CASSAZIONE",
      courtLocality: null,
      courtBranch: compact.includes("PENALE") ? "PENALE" : compact.includes("CIVILE") ? "CIVILE" : null,
    };
  }
  if (compact.includes("CONSIGLIODISTATO")) {
    return { courtFamily: "CONSIGLIO DI STATO", courtLocality: null, courtBranch: null };
  }
  if (compact.includes("CORTECOSTITUZIONALE")) {
    return { courtFamily: "CORTE COSTITUZIONALE", courtLocality: null, courtBranch: null };
  }
  if (compact.startsWith("TAR") || compact.includes("TRIBUNALEAMMINISTRATIVOREGIONALE")) {
    const locality = (source ?? "")
      .replace(/^(?:TAR|TRIBUNALE AMMINISTRATIVO REGIONALE)\s*/u, "")
      .replace(/^(?:PER IL|PER LA|DELLA|DEL)\s+/u, "")
      .replace(/\bSEDE DI\b/u, " ")
      .trim() || null;
    return { courtFamily: "TAR", courtLocality: locality, courtBranch: null };
  }
  return { courtFamily: source, courtLocality: null, courtBranch: null };
}

function compatibleSpecificity(left: string | null, right: string | null): string | null | undefined {
  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  const prefix = leftTokens.length < rightTokens.length ? leftTokens : rightTokens;
  const richer = leftTokens.length < rightTokens.length ? rightTokens : leftTokens;
  return prefix.every((token, index) => richer[index] === token) ? richer.join(" ") : undefined;
}

function courtIdentity(authorityValue: string | null, courtValue: string | null | undefined) {
  const authority = parseCourtIdentity(authorityValue);
  const court = parseCourtIdentity(courtValue);
  if (!court.courtFamily) return { identity: authority, conflict: false };
  if (!authority.courtFamily) return { identity: court, conflict: false };
  if (authority.courtFamily !== court.courtFamily) return { identity: court, conflict: true };
  const locality = compatibleSpecificity(authority.courtLocality, court.courtLocality);
  const branch = compatibleSpecificity(authority.courtBranch, court.courtBranch);
  return {
    identity: {
      courtFamily: court.courtFamily,
      courtLocality: locality === undefined ? court.courtLocality : locality,
      courtBranch: branch === undefined ? court.courtBranch : branch,
    },
    conflict: locality === undefined || branch === undefined,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function identityMaterial(fields: readonly string[]): string {
  return fields.join("\n");
}

export function buildOfficialHitIdentityV1(
  input: ReconciliationHitIdentityInput,
): BuiltOfficialIdentity {
  if (input.documentKind === "LEGISLATION") {
    const actType = legislationTypeAliases.get(normalizedText(input.denominazioneAtto) ?? "") ?? null;
    const actNumber = normalizedNumber(input.numeroProvvedimento);
    const year = input.annoProvvedimento;
    const normalizedIdentity: NormalizedOfficialIdentity = {
      kind: "LEGISLATION",
      jurisdiction: "IT",
      actType,
      actNumber,
      year,
    };
    if (!actType || !actNumber || year === null) {
      return {
        identityVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
        normalizedIdentity,
        identityFingerprint: null,
        canonicalKey: null,
        identityConflict: false,
      };
    }
    const canonicalKey = `${actType}:${actNumber}:${year}`;
    return {
      identityVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
      normalizedIdentity,
      identityFingerprint: sha256(identityMaterial([
        LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
        "LEGISLATION",
        "IT",
        actType,
        actNumber,
        String(year),
        "",
      ])),
      canonicalKey,
      identityConflict: false,
    };
  }

  const courtResult = courtIdentity(input.authority, input.court);
  const court = courtResult.identity;
  const decisionType = normalizedDecisionType(input.decisionType);
  const decisionNumber = normalizedNumber(input.decisionNumber);
  const year = input.decisionYear;
  const section = normalizedText(input.chamberSection);
  const ecli = normalizedEcli(input.ecli, year);
  const invalidExplicitEcli = Boolean(input.ecli?.trim()) && ecli === null;
  const normalizedIdentity: NormalizedOfficialIdentity = {
    kind: "CASE_LAW",
    jurisdiction: "IT",
    ...court,
    decisionType,
    decisionNumber,
    year,
    section,
    ecli,
  };
  if (
    courtResult.conflict
    || invalidExplicitEcli
    || !court.courtFamily
    || (court.courtFamily === "TAR" && !court.courtLocality)
    || !decisionType
    || !decisionNumber
    || year === null
  ) {
    return {
      identityVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
      normalizedIdentity,
      identityFingerprint: null,
      canonicalKey: null,
      identityConflict: courtResult.conflict || invalidExplicitEcli,
    };
  }
  const canonicalKey = [
    court.courtFamily,
    court.courtLocality,
    court.courtBranch,
    decisionType,
    decisionNumber,
    year,
    section,
    ecli,
  ].filter(Boolean).join(":");
  return {
    identityVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
    normalizedIdentity,
    identityFingerprint: sha256(identityMaterial([
      LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
      "CASE_LAW",
      "IT",
      court.courtFamily,
      court.courtLocality ?? "",
      court.courtBranch ?? "",
      decisionType,
      decisionNumber,
      String(year),
      section ?? "",
      ecli ?? "",
    ])),
    canonicalKey,
    identityConflict: false,
  };
}

export function verifiedAssertionsMatchIdentity(
  assertions: readonly { normalizedValue: string }[],
  expectedFingerprint: string,
): boolean {
  return assertions.length > 0
    && assertions.every((assertion) => assertion.normalizedValue === expectedFingerprint);
}

export function verifyPersistedOfficialIdentityV2(input: {
  identityVersion: string;
  normalizedIdentity: unknown;
  identityFingerprint: string | null;
}): BuiltOfficialIdentity | null {
  if (input.identityVersion !== LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION) return null;
  const parsed = normalizedOfficialIdentitySchema.safeParse(input.normalizedIdentity);
  if (!parsed.success) return null;
  const rebuilt = rebuildOfficialIdentityV2(parsed.data);
  if (rebuilt.identityConflict || !rebuilt.identityFingerprint || !rebuilt.canonicalKey) return null;
  if (rebuilt.identityFingerprint !== input.identityFingerprint) return null;
  const stable = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
  if (stable(rebuilt.normalizedIdentity) !== stable(parsed.data)) return null;
  return rebuilt;
}

export function fingerprintOfficialHitEvidenceV1(input: ReconciliationEvidenceInput): string {
  const identity = buildOfficialHitIdentityV1(input);
  return sha256(JSON.stringify({
    evidenceVersion: "LEGAL_REFERENCE_OFFICIAL_EVIDENCE_V1",
    provider: input.provider,
    providerRecordId: input.providerRecordId,
    providerSourceId: input.providerSourceId,
    identity: identity.normalizedIdentity,
    issuedAt: input.issuedAt?.toISOString() ?? null,
    title: normalizedText(input.title),
    sourceUrl: input.sourceUrl,
  }));
}

export function rebuildOfficialIdentityV2(
  identity: NormalizedOfficialIdentity,
): BuiltOfficialIdentity {
  if (identity.kind === "LEGISLATION") {
    return buildOfficialHitIdentityV1({
      documentKind: "LEGISLATION",
      denominazioneAtto: identity.actType,
      numeroProvvedimento: identity.actNumber,
      annoProvvedimento: identity.year,
      authority: null,
      decisionNumber: null,
      decisionYear: null,
      chamberSection: null,
    });
  }
  return buildOfficialHitIdentityV1({
    documentKind: "CASE_LAW",
    denominazioneAtto: null,
    numeroProvvedimento: null,
    annoProvvedimento: null,
    authority: [identity.courtFamily, identity.courtLocality, identity.courtBranch]
      .filter(Boolean).join(" "),
    court: [identity.courtFamily, identity.courtLocality, identity.courtBranch]
      .filter(Boolean).join(" "),
    decisionType: identity.decisionType,
    decisionNumber: identity.decisionNumber,
    decisionYear: identity.year,
    chamberSection: identity.section,
    ecli: identity.ecli,
  });
}