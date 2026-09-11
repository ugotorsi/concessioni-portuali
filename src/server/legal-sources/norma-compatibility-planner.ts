import { createHash } from "node:crypto";

export const REPORT_VERSION = "B2C9_BLOCK_2A_REPORT_V1";
export const FINGERPRINT_FORMAT_VERSION = "B2C9_BLOCK_2A_FINGERPRINT_V1";

export type FamilyResolutionOutcome =
  | "VERIFIED_EXISTING_BRIDGE"
  | "WOULD_MAP_EXISTING_FAMILY"
  | "UNRESOLVED_FAMILY"
  | "AMBIGUOUS_IDENTITY"
  | "BRIDGE_UNVERIFIED"
  | "BRIDGE_CONFLICT"
  | "CONFLICT"
  | "FAILED";

export type ExpressionResolutionOutcome =
  | "EXPRESSION_CANDIDATE"
  | "VERIFIED_CONTAINING_EXPRESSION"
  | "UNRESOLVED_EXPRESSION";

export type ArtifactResolutionOutcome =
  | "ARTIFACT_CANDIDATE"
  | "VERIFIED_ARTIFACT_EVIDENCE"
  | "UNRESOLVED_ARTIFACT";

export interface LegacyProvisionLocatorCandidate {
  article?: string;
  comma?: string;
  letter?: string;
  section?: string;
  annex?: string;
  legacyCode: string;
}

export interface NormaFamilyMappingRule {
  normaFonteCodice: string;
  target: {
    sourceKey: string;
    expectedTitle: string;
    expectedSourceType: string;
    expectedSourceNumber?: string;
    expectedSourceDate?: string;
    expectedIssuingBody?: string;
    expectedResourceSemanticType?: string;
  };
  evidence: {
    kind: "REPOSITORY_CURATED";
    description: string;
    references: string[];
  };
  legacyProvisionLocator?: LegacyProvisionLocatorCandidate;
}

export interface NormaFamilyMappingPolicy {
  policyVersion: string;
  rules: NormaFamilyMappingRule[];
}

export interface CanonicalFamilyCandidate {
  id: string;
  sourceKey: string;
  title: string;
  sourceType: string;
  sourceNumber: string | null;
  sourceDate: string | null;
  issuingBody: string | null;
  resourceSemanticType: string | null;
}

export interface ArtifactCandidate {
  id: string;
  sourceFamilyId: string;
  observedSha256: string;
  observedSizeBytes: number;
  observedMimeType: string;
  provisionReference: string | null;
  provenanceReference: string | null;
}

export interface LegacyNormaVersioneInput {
  id: string;
  versione: string;
  stato: string;
  dataEntrataVigore: string;
  dataFineVigore: string | null;
  urlTesto: string | null;
  sintesi: string;
  note: string | null;
  legalSourceVersionId: string | null;
  artifactCandidate: ArtifactCandidate | null;
}

export interface LegacyNormaFonteInput {
  id: string;
  codice: string;
  titolo: string;
  enteEmittente: string | null;
  ambito: string;
  descrizione: string | null;
  legalSourceId: string | null;
  versioni: LegacyNormaVersioneInput[];
}

export interface PlannerInput {
  policy: NormaFamilyMappingPolicy;
  normaFonti: LegacyNormaFonteInput[];
  canonicalFamilies: CanonicalFamilyCandidate[];
  scope: { normaFonteCodice: string | null };
  repositoryCommitSha: string | null;
}

export interface FamilyResolution {
  outcome: FamilyResolutionOutcome;
  candidateFamilyIds: string[];
  candidateSourceKeys: string[];
  evidence: string[];
  reasons: string[];
}

export interface NormaVersionePlan {
  id: string;
  versione: string;
  expressionResolution: {
    outcome: ExpressionResolutionOutcome;
    reasons: string[];
  };
  artifactResolution: {
    outcome: ArtifactResolutionOutcome;
    candidateArtifactId: string | null;
    reasons: string[];
  };
}

export interface NormaFontePlan {
  id: string;
  codice: string;
  familyResolution: FamilyResolution;
  legacyProvisionLocatorCandidate: LegacyProvisionLocatorCandidate | null;
  versioni: NormaVersionePlan[];
}

export interface NormaCompatibilityReport {
  reportVersion: typeof REPORT_VERSION;
  policyVersion: string;
  generatedAt: string;
  repositoryCommitSha: string | null;
  scope: { normaFonteCodice: string | null };
  counts: Record<FamilyResolutionOutcome, number> & {
    normaFonti: number;
    normaVersioni: number;
  };
  results: NormaFontePlan[];
  fingerprint: string;
}

const POLICY_KEYS = new Set(["policyVersion", "rules"]);
const RULE_KEYS = new Set(["normaFonteCodice", "target", "evidence", "legacyProvisionLocator"]);
const TARGET_KEYS = new Set([
  "sourceKey",
  "expectedTitle",
  "expectedSourceType",
  "expectedSourceNumber",
  "expectedSourceDate",
  "expectedIssuingBody",
  "expectedResourceSemanticType",
]);
const EVIDENCE_KEYS = new Set(["kind", "description", "references"]);
const LOCATOR_KEYS = new Set(["article", "comma", "letter", "section", "annex", "legacyCode"]);
const LEGAL_SOURCE_TYPES = new Set([
  "LEGGE",
  "DECRETO",
  "REGOLAMENTO",
  "DELIBERA",
  "ORDINANZA",
  "PIANO",
  "PARERE",
  "TARIFFA",
  "PLANIMETRIA",
  "ALTRO",
]);
const RESOURCE_SEMANTIC_TYPES = new Set([
  "NORMATIVE_INSTRUMENT",
  "JUDICIAL_DECISION",
  "ADMINISTRATIVE_ACT",
  "CONTRACT",
  "CORRESPONDENCE",
  "TECHNICAL_DOCUMENT",
  "MEDIA_RECORD",
  "OTHER",
]);

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown fields: ${unknown.sort().join(", ")}.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function requiredEnum(value: unknown, allowed: Set<string>, label: string): string {
  const parsed = requiredString(value, label);
  if (!allowed.has(parsed)) {
    throw new Error(`${label} is unsupported.`);
  }
  return parsed;
}

function optionalEnum(value: unknown, allowed: Set<string>, label: string): string | undefined {
  return value === undefined ? undefined : requiredEnum(value, allowed, label);
}

function parseLocator(value: unknown, ruleLabel: string): LegacyProvisionLocatorCandidate | undefined {
  if (value === undefined) {
    return undefined;
  }
  const locator = asRecord(value, `${ruleLabel}.legacyProvisionLocator`);
  rejectUnknownKeys(locator, LOCATOR_KEYS, `${ruleLabel}.legacyProvisionLocator`);
  const parsed: LegacyProvisionLocatorCandidate = {
    legacyCode: requiredString(locator.legacyCode, `${ruleLabel}.legacyProvisionLocator.legacyCode`),
  };
  for (const key of ["article", "comma", "letter", "section", "annex"] as const) {
    const parsedValue = optionalString(locator[key], `${ruleLabel}.legacyProvisionLocator.${key}`);
    if (parsedValue !== undefined) {
      parsed[key] = parsedValue;
    }
  }
  return parsed;
}

export function parseNormaFamilyMappingPolicy(value: unknown): NormaFamilyMappingPolicy {
  const policy = asRecord(value, "policy");
  rejectUnknownKeys(policy, POLICY_KEYS, "policy");
  const policyVersion = requiredString(policy.policyVersion, "policy.policyVersion");
  if (!Array.isArray(policy.rules)) {
    throw new Error("policy.rules must be an array.");
  }

  const seenCodes = new Set<string>();
  const rules = policy.rules.map((rawRule, index): NormaFamilyMappingRule => {
    const label = `policy.rules[${index}]`;
    const rule = asRecord(rawRule, label);
    rejectUnknownKeys(rule, RULE_KEYS, label);
    const normaFonteCodice = requiredString(rule.normaFonteCodice, `${label}.normaFonteCodice`);
    if (seenCodes.has(normaFonteCodice)) {
      throw new Error(`Duplicate normaFonteCodice: ${normaFonteCodice}.`);
    }
    seenCodes.add(normaFonteCodice);

    const target = asRecord(rule.target, `${label}.target`);
    rejectUnknownKeys(target, TARGET_KEYS, `${label}.target`);
    const evidence = asRecord(rule.evidence, `${label}.evidence`);
    rejectUnknownKeys(evidence, EVIDENCE_KEYS, `${label}.evidence`);
    if (evidence.kind !== "REPOSITORY_CURATED") {
      throw new Error(`${label}.evidence.kind is unsupported.`);
    }
    if (!Array.isArray(evidence.references) || evidence.references.length === 0) {
      throw new Error(`${label}.evidence.references must be a non-empty array.`);
    }
    const references = evidence.references.map((item, referenceIndex) =>
      requiredString(item, `${label}.evidence.references[${referenceIndex}]`),
    );
    return {
      normaFonteCodice,
      target: {
        sourceKey: requiredString(target.sourceKey, `${label}.target.sourceKey`),
        expectedTitle: requiredString(target.expectedTitle, `${label}.target.expectedTitle`),
        expectedSourceType: requiredEnum(
          target.expectedSourceType,
          LEGAL_SOURCE_TYPES,
          `${label}.target.expectedSourceType`,
        ),
        expectedSourceNumber: optionalString(
          target.expectedSourceNumber,
          `${label}.target.expectedSourceNumber`,
        ),
        expectedSourceDate: optionalString(target.expectedSourceDate, `${label}.target.expectedSourceDate`),
        expectedIssuingBody: optionalString(
          target.expectedIssuingBody,
          `${label}.target.expectedIssuingBody`,
        ),
        expectedResourceSemanticType: optionalEnum(
          target.expectedResourceSemanticType,
          RESOURCE_SEMANTIC_TYPES,
          `${label}.target.expectedResourceSemanticType`,
        ),
      },
      evidence: {
        kind: "REPOSITORY_CURATED",
        description: requiredString(evidence.description, `${label}.evidence.description`),
        references: references.sort(ordinalCompare),
      },
      legacyProvisionLocator: parseLocator(rule.legacyProvisionLocator, label),
    };
  });

  return { policyVersion, rules: rules.sort((left, right) => ordinalCompare(left.normaFonteCodice, right.normaFonteCodice)) };
}

function candidateMismatches(
  candidate: CanonicalFamilyCandidate,
  rule: NormaFamilyMappingRule,
): string[] {
  const checks: Array<[string, string | null, string | undefined]> = [
    ["sourceKey", candidate.sourceKey, rule.target.sourceKey],
    ["title", candidate.title, rule.target.expectedTitle],
    ["sourceType", candidate.sourceType, rule.target.expectedSourceType],
    ["sourceNumber", candidate.sourceNumber, rule.target.expectedSourceNumber],
    ["sourceDate", candidate.sourceDate, rule.target.expectedSourceDate],
    ["issuingBody", candidate.issuingBody, rule.target.expectedIssuingBody],
    ["resourceSemanticType", candidate.resourceSemanticType, rule.target.expectedResourceSemanticType],
  ];
  return checks
    .filter(([, , expected]) => expected !== undefined)
    .filter(([, actual, expected]) => actual !== expected)
    .map(([field, actual, expected]) => `${field}: expected ${expected}, found ${actual ?? "null"}`);
}

function resolveFamily(
  fonte: LegacyNormaFonteInput,
  rule: NormaFamilyMappingRule | undefined,
  candidates: CanonicalFamilyCandidate[],
): FamilyResolution {
  if (!rule) {
    return {
      outcome: fonte.legalSourceId ? "BRIDGE_UNVERIFIED" : "UNRESOLVED_FAMILY",
      candidateFamilyIds: fonte.legalSourceId ? [fonte.legalSourceId] : [],
      candidateSourceKeys: [],
      evidence: [],
      reasons: ["No exact curated compatibility rule exists for this legacy code."],
    };
  }

  const rawCandidates = candidates.filter((candidate) => candidate.sourceKey === rule.target.sourceKey);
  const evidence = [rule.evidence.description, ...rule.evidence.references];

  if (fonte.legalSourceId) {
    const bridged = candidates.find((candidate) => candidate.id === fonte.legalSourceId);
    if (!bridged) {
      return {
        outcome: "BRIDGE_UNVERIFIED",
        candidateFamilyIds: [fonte.legalSourceId],
        candidateSourceKeys: [],
        evidence,
        reasons: ["The existing bridge target was not available for verification."],
      };
    }
    const mismatches = candidateMismatches(bridged, rule);
    if (mismatches.length > 0) {
      return {
        outcome: "BRIDGE_CONFLICT",
        candidateFamilyIds: [bridged.id],
        candidateSourceKeys: [bridged.sourceKey],
        evidence,
        reasons: mismatches,
      };
    }
    return {
      outcome: "VERIFIED_EXISTING_BRIDGE",
      candidateFamilyIds: [bridged.id],
      candidateSourceKeys: [bridged.sourceKey],
      evidence,
      reasons: ["Existing bridge target satisfies every curated verification expectation."],
    };
  }

  const verifiedCandidates = rawCandidates.filter((candidate) => candidateMismatches(candidate, rule).length === 0);
  if (verifiedCandidates.length > 1) {
    return {
      outcome: "AMBIGUOUS_IDENTITY",
      candidateFamilyIds: verifiedCandidates.map((candidate) => candidate.id).sort(ordinalCompare),
      candidateSourceKeys: verifiedCandidates.map((candidate) => candidate.sourceKey).sort(ordinalCompare),
      evidence,
      reasons: ["More than one canonical family satisfies every curated verification expectation."],
    };
  }

  if (verifiedCandidates.length === 1) {
    const candidate = verifiedCandidates[0];
    return {
      outcome: "WOULD_MAP_EXISTING_FAMILY",
      candidateFamilyIds: [candidate.id],
      candidateSourceKeys: [candidate.sourceKey],
      evidence,
      reasons: ["Exactly one family satisfies every curated verification expectation."],
    };
  }

  if (rawCandidates.length > 0) {
    return {
      outcome: "CONFLICT",
      candidateFamilyIds: rawCandidates.map((candidate) => candidate.id).sort(ordinalCompare),
      candidateSourceKeys: rawCandidates.map((candidate) => candidate.sourceKey).sort(ordinalCompare),
      evidence,
      reasons: rawCandidates.flatMap((candidate) =>
        candidateMismatches(candidate, rule).map((reason) => `${candidate.id}: ${reason}`),
      ),
    };
  }

  return {
    outcome: "UNRESOLVED_FAMILY",
    candidateFamilyIds: [],
    candidateSourceKeys: [rule.target.sourceKey],
    evidence,
    reasons: ["NO_EXISTING_CANONICAL_FAMILY_MATCH"],
  };
}

function planVersion(
  versione: LegacyNormaVersioneInput,
  familyResolution: FamilyResolution,
): NormaVersionePlan {
  const resolvedFamilyId = familyResolution.candidateFamilyIds.length === 1
    ? familyResolution.candidateFamilyIds[0]
    : null;
  const familyIsResolved = familyResolution.outcome === "VERIFIED_EXISTING_BRIDGE"
    || familyResolution.outcome === "WOULD_MAP_EXISTING_FAMILY";
  const artifact = versione.artifactCandidate;
  const artifactHasObservedIdentity = Boolean(
    artifact
      && /^[0-9a-f]{64}$/.test(artifact.observedSha256)
      && artifact.observedSizeBytes > 0
      && artifact.observedMimeType.trim() !== "",
  );
  const artifactHasProvisionEvidence = Boolean(
    artifact?.provisionReference?.trim() && artifact?.provenanceReference?.trim(),
  );
  const artifactMatchesFamily = Boolean(
    artifact && familyIsResolved && resolvedFamilyId && artifact.sourceFamilyId === resolvedFamilyId,
  );
  const artifactMatchesBridge = Boolean(
    artifact && artifact.id === versione.legalSourceVersionId,
  );

  let artifactResolution: NormaVersionePlan["artifactResolution"];
  if (!versione.legalSourceVersionId) {
    artifactResolution = {
      outcome: "UNRESOLVED_ARTIFACT",
      candidateArtifactId: null,
      reasons: ["No legacy artifact bridge exists."],
    };
  } else if (!artifact) {
    artifactResolution = {
      outcome: "ARTIFACT_CANDIDATE",
      candidateArtifactId: versione.legalSourceVersionId,
      reasons: ["The artifact FK exists but its target was not available for verification."],
    };
  } else if (
    artifactMatchesBridge
    && artifactHasObservedIdentity
    && artifactHasProvisionEvidence
    && artifactMatchesFamily
  ) {
    artifactResolution = {
      outcome: "VERIFIED_ARTIFACT_EVIDENCE",
      candidateArtifactId: artifact.id,
      reasons: ["Observed byte identity, family congruence, provision reference and provenance are present."],
    };
  } else {
    artifactResolution = {
      outcome: "ARTIFACT_CANDIDATE",
      candidateArtifactId: artifact.id,
      reasons: ["An artifact FK alone does not verify that the representation contains this provision version."],
    };
  }

  return {
    id: versione.id,
    versione: versione.versione,
    expressionResolution: {
      outcome: "UNRESOLVED_EXPRESSION",
      reasons: [
        "Provision-level labels and effective dates do not establish a source-wide legal expression.",
      ],
    },
    artifactResolution,
  };
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : canonicalize(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => ordinalCompare(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function buildNormaCompatibilityPlan(
  input: PlannerInput,
  generatedAt = new Date().toISOString(),
): NormaCompatibilityReport {
  const policy = parseNormaFamilyMappingPolicy(input.policy);
  const rulesByCode = new Map(policy.rules.map((rule) => [rule.normaFonteCodice, rule]));
  const scopedFonti = input.normaFonti
    .filter((fonte) => !input.scope.normaFonteCodice || fonte.codice === input.scope.normaFonteCodice)
    .sort((left, right) => ordinalCompare(`${left.codice}:${left.id}`, `${right.codice}:${right.id}`));
  const candidates = [...input.canonicalFamilies].sort((left, right) =>
    ordinalCompare(`${left.sourceKey}:${left.id}`, `${right.sourceKey}:${right.id}`),
  );
  const results = scopedFonti.map((fonte): NormaFontePlan => {
    const rule = rulesByCode.get(fonte.codice);
    const familyResolution = resolveFamily(fonte, rule, candidates);
    return {
      id: fonte.id,
      codice: fonte.codice,
      familyResolution,
      legacyProvisionLocatorCandidate: rule?.legacyProvisionLocator ?? null,
      versioni: [...fonte.versioni]
        .sort((left, right) => ordinalCompare(`${left.versione}:${left.id}`, `${right.versione}:${right.id}`))
        .map((versione) => planVersion(versione, familyResolution)),
    };
  });

  const familyOutcomes: FamilyResolutionOutcome[] = [
    "VERIFIED_EXISTING_BRIDGE",
    "WOULD_MAP_EXISTING_FAMILY",
    "UNRESOLVED_FAMILY",
    "AMBIGUOUS_IDENTITY",
    "BRIDGE_UNVERIFIED",
    "BRIDGE_CONFLICT",
    "CONFLICT",
    "FAILED",
  ];
  const counts = Object.fromEntries(
    familyOutcomes.map((outcome) => [
      outcome,
      results.filter((result) => result.familyResolution.outcome === outcome).length,
    ]),
  ) as NormaCompatibilityReport["counts"];
  counts.normaFonti = results.length;
  counts.normaVersioni = results.reduce((total, result) => total + result.versioni.length, 0);

  const fingerprintInput = {
    fingerprintFormatVersion: FINGERPRINT_FORMAT_VERSION,
    policyVersion: policy.policyVersion,
    policy,
    scope: input.scope,
    normaFonti: scopedFonti,
    canonicalFamilies: candidates,
    results,
  };
  const fingerprintHash = createHash("sha256");
  fingerprintHash["update"](canonicalJson(fingerprintInput));
  const fingerprint = fingerprintHash.digest("hex");

  return {
    reportVersion: REPORT_VERSION,
    policyVersion: policy.policyVersion,
    generatedAt,
    repositoryCommitSha: input.repositoryCommitSha,
    scope: input.scope,
    counts,
    results,
    fingerprint,
  };
}