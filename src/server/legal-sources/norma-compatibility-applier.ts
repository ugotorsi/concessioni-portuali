import { createHash } from "node:crypto";

import {
  REPORT_VERSION,
  buildNormaCompatibilityPlan,
  parseNormaFamilyMappingPolicy,
  type CanonicalFamilyCandidate,
  type LegacyNormaFonteInput,
  type NormaCompatibilityReport,
} from "./norma-compatibility-planner";

export const BLOCK_2B_CONTRACT_VERSION = "B2C9_BLOCK_2B_FAMILY_BRIDGE_V1" as const;
export const BLOCK_2B_ACKNOWLEDGEMENT = BLOCK_2B_CONTRACT_VERSION;

const CANONICAL_CHILD_COUNT_FIELDS = [
  ["LegalExpressionVersion", "legalExpressionVersion"],
  ["LegalSourceVersion", "legalSourceVersion"],
  ["LegalSourceAcquisition", "legalSourceAcquisition"],
  ["LegalSourceIdentityAssertion", "legalSourceIdentityAssertion"],
] as const;

type ReviewedCanonicalChildCounts = Record<
  typeof CANONICAL_CHILD_COUNT_FIELDS[number][0],
  number
>;

export interface Block2BCommandOptions {
  apply: boolean;
  acknowledgement: string | null;
  contractPath: string;
  reportPath: string;
}

export interface ReviewedFamilyBridgeOperation {
  kind: "NORMA_FONTE_FAMILY_BRIDGE";
  normaFonteId: string;
  normaFonteCodice: string;
  expectedCurrentLegalSourceId: null;
  targetLegalSourceId: string;
  targetSourceKey: string;
  targetCanonicalRowSha256: string;
}

export interface ReviewedFamilyBridgeContract {
  contractVersion: typeof BLOCK_2B_CONTRACT_VERSION;
  expectedDatabase: string;
  expectedUser: string;
  expectedReportSha256: string;
  expectedSemanticFingerprint: string;
  expectedRepositoryCommitSha: string;
  expectedPolicyBlobOid: string;
  expectedReportVersion: typeof REPORT_VERSION;
  expectedPolicyVersion: string;
  unresolvedNormaFonteCodes: string[];
  expectedCanonicalChildCounts: ReviewedCanonicalChildCounts;
  expectedOtherFamilyBridgeCount: number;
  approvedOperations: ReviewedFamilyBridgeOperation[];
}

export interface RepositoryEvidence {
  repositoryCommitSha: string;
  policyWorktreeBlobOid: string;
  policyHeadBlobOid: string;
}

export interface ReviewedEvidence {
  contract: ReviewedFamilyBridgeContract;
  report: NormaCompatibilityReport;
  policy: ReturnType<typeof parseNormaFamilyMappingPolicy>;
  reportSha256: string;
}

export interface NormaFonteBridgeRow {
  id: string;
  codice: string;
  legalSourceId: string | null;
  updatedAt: Date;
}

export interface PlannerSnapshot {
  normaFonti: LegacyNormaFonteInput[];
  canonicalFamilies: CanonicalFamilyCandidate[];
}

export interface CanonicalChildCounts {
  legalExpressionVersion: number;
  legalSourceVersion: number;
  legalSourceAcquisition: number;
  legalSourceIdentityAssertion: number;
}

export interface Block2BTransaction {
  getDatabaseIdentity(): Promise<{ database: string; user: string }>;
  getPlannerSnapshot(sourceKeys: string[], scopeCode: string | null): Promise<PlannerSnapshot>;
  findNormaFonte(id: string, codice: string): Promise<NormaFonteBridgeRow[]>;
  findCanonicalLegalSource(
    id: string,
    sourceKey: string,
  ): Promise<Array<{ id: string; sourceKey: string; canonicalPayload: string }>>;
  countOtherFamilyBridges(targetNormaFonteId: string): Promise<number>;
  findNormaFonteBridges(codici: string[]): Promise<Array<{ codice: string; legalSourceId: string | null }>>;
  getCanonicalChildCounts(): Promise<CanonicalChildCounts>;
  updateNormaFonteBridge(input: {
    id: string;
    codice: string;
    expectedCurrentLegalSourceId: null;
    expectedUpdatedAt: Date;
    targetLegalSourceId: string;
  }): Promise<number>;
}

export interface Block2BDatabase {
  serializableTransaction<T>(operation: (transaction: Block2BTransaction) => Promise<T>): Promise<T>;
}

export interface Block2BReceipt {
  contractVersion: typeof BLOCK_2B_CONTRACT_VERSION;
  normaFonteId: string;
  codice: string;
  previousLegalSourceId: null;
  newLegalSourceId: string;
  targetSourceKey: string;
  affectedRows: number;
  previousUpdatedAt: string;
  persistedUpdatedAt: string;
  reportSha256: string;
  semanticFingerprint: string;
  repositoryCommitSha: string;
  policyBlobOid: string;
  transactionResult: "VALIDATED" | "APPLIED";
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseBlock2BCommandOptions(argv: string[]): Block2BCommandOptions {
  const options: Partial<Block2BCommandOptions> = { apply: false, acknowledgement: null };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}.`);
      seen.add(argument);
      options.apply = true;
      continue;
    }
    if (argument === "--contract" || argument === "--report" || argument === "--ack") {
      if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}.`);
      seen.add(argument);
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error(`${argument} requires a non-empty value.`);
      }
      if (argument === "--contract") options.contractPath = value;
      if (argument === "--report") options.reportPath = value;
      if (argument === "--ack") options.acknowledgement = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}.`);
  }
  if (!options.contractPath || !options.reportPath) {
    throw new Error("Both --contract and --report are required.");
  }
  if (options.apply && options.acknowledgement !== BLOCK_2B_ACKNOWLEDGEMENT) {
    throw new Error(`Apply mode requires --ack ${BLOCK_2B_ACKNOWLEDGEMENT}.`);
  }
  if (!options.apply && options.acknowledgement !== null) {
    throw new Error("--ack is accepted only together with --apply.");
  }
  return options as Block2BCommandOptions;
}

function requireSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim() === "") {
    throw new Error(`${label} must be non-empty.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return value;
}

function parseReport(reportBytes: Uint8Array): NormaCompatibilityReport {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(reportBytes).toString("utf8"));
  } catch {
    throw new Error("Reviewed Block 2A report is not valid JSON.");
  }
  const report = requireRecord(value, "Reviewed Block 2A report");
  requireString(report.reportVersion, "report.reportVersion");
  requireString(report.policyVersion, "report.policyVersion");
  requireString(report.fingerprint, "report.fingerprint");
  if (report.repositoryCommitSha !== null && typeof report.repositoryCommitSha !== "string") {
    throw new Error("report.repositoryCommitSha must be a string or null.");
  }
  const scope = requireRecord(report.scope, "report.scope");
  if (scope.normaFonteCodice !== null && typeof scope.normaFonteCodice !== "string") {
    throw new Error("report.scope.normaFonteCodice must be a string or null.");
  }
  const counts = requireRecord(report.counts, "report.counts");
  for (const outcome of ["AMBIGUOUS_IDENTITY", "BRIDGE_CONFLICT", "CONFLICT", "FAILED"]) {
    if (!Number.isSafeInteger(counts[outcome]) || (counts[outcome] as number) < 0) {
      throw new Error(`report.counts.${outcome} must be a non-negative integer.`);
    }
  }
  if (!Array.isArray(report.results)) {
    throw new Error("report.results must be an array.");
  }
  for (const [resultIndex, rawResult] of report.results.entries()) {
    const result = requireRecord(rawResult, `report.results[${resultIndex}]`);
    requireString(result.id, `report.results[${resultIndex}].id`);
    requireString(result.codice, `report.results[${resultIndex}].codice`);
    const family = requireRecord(result.familyResolution, `report.results[${resultIndex}].familyResolution`);
    requireString(family.outcome, `report.results[${resultIndex}].familyResolution.outcome`);
    requireStringArray(
      family.candidateFamilyIds,
      `report.results[${resultIndex}].familyResolution.candidateFamilyIds`,
    );
    requireStringArray(
      family.candidateSourceKeys,
      `report.results[${resultIndex}].familyResolution.candidateSourceKeys`,
    );
    if (!Array.isArray(result.versioni)) {
      throw new Error(`report.results[${resultIndex}].versioni must be an array.`);
    }
    for (const [versionIndex, rawVersion] of result.versioni.entries()) {
      const version = requireRecord(rawVersion, `report.results[${resultIndex}].versioni[${versionIndex}]`);
      const expression = requireRecord(
        version.expressionResolution,
        `report.results[${resultIndex}].versioni[${versionIndex}].expressionResolution`,
      );
      const artifact = requireRecord(
        version.artifactResolution,
        `report.results[${resultIndex}].versioni[${versionIndex}].artifactResolution`,
      );
      requireString(
        expression.outcome,
        `report.results[${resultIndex}].versioni[${versionIndex}].expressionResolution.outcome`,
      );
      requireString(
        artifact.outcome,
        `report.results[${resultIndex}].versioni[${versionIndex}].artifactResolution.outcome`,
      );
    }
  }
  return value as NormaCompatibilityReport;
}

function validateContract(contract: ReviewedFamilyBridgeContract): ReviewedFamilyBridgeOperation {
  requireRecord(contract, "contract");
  if (contract.contractVersion !== BLOCK_2B_CONTRACT_VERSION) {
    throw new Error("Unsupported Block 2B contract version.");
  }
  if (!Array.isArray(contract.approvedOperations)) {
    throw new Error("contract.approvedOperations must be an array.");
  }
  if (contract.approvedOperations.length !== 1) {
    throw new Error("Block 2B V1 requires exactly one explicitly approved operation.");
  }
  const operation = contract.approvedOperations[0];
  requireRecord(operation, "contract.approvedOperations[0]");
  if (operation.kind !== "NORMA_FONTE_FAMILY_BRIDGE") {
    throw new Error("Block 2B V1 supports only NormaFonte family bridge operations.");
  }
  if (operation.expectedCurrentLegalSourceId !== null) {
    throw new Error("Block 2B V1 requires an unlinked NormaFonte as its starting state.");
  }
  for (const [label, value] of [
    ["expectedDatabase", contract.expectedDatabase],
    ["expectedUser", contract.expectedUser],
    ["expectedRepositoryCommitSha", contract.expectedRepositoryCommitSha],
    ["expectedPolicyBlobOid", contract.expectedPolicyBlobOid],
    ["expectedPolicyVersion", contract.expectedPolicyVersion],
    ["normaFonteId", operation.normaFonteId],
    ["normaFonteCodice", operation.normaFonteCodice],
    ["targetLegalSourceId", operation.targetLegalSourceId],
    ["targetSourceKey", operation.targetSourceKey],
  ] as const) {
    requireNonEmpty(value, label);
  }
  requireSha256(contract.expectedReportSha256, "expectedReportSha256");
  requireSha256(contract.expectedSemanticFingerprint, "expectedSemanticFingerprint");
  requireSha256(operation.targetCanonicalRowSha256, "targetCanonicalRowSha256");
  requireStringArray(contract.unresolvedNormaFonteCodes, "contract.unresolvedNormaFonteCodes");
  if (new Set(contract.unresolvedNormaFonteCodes).size !== contract.unresolvedNormaFonteCodes.length) {
    throw new Error("Unresolved NormaFonte codes must be unique.");
  }
  const childCounts = requireRecord(
    contract.expectedCanonicalChildCounts,
    "contract.expectedCanonicalChildCounts",
  );
  const requiredChildCountKeys = CANONICAL_CHILD_COUNT_FIELDS.map(([contractKey]) => contractKey);
  const actualChildCountKeys = Object.keys(childCounts);
  if (actualChildCountKeys.length !== requiredChildCountKeys.length
    || requiredChildCountKeys.some((key) => !Object.hasOwn(childCounts, key))
    || actualChildCountKeys.some((key) => !requiredChildCountKeys.includes(
      key as typeof requiredChildCountKeys[number],
    ))) {
    throw new Error("Expected canonical child counts must contain exactly the four V1 child-table keys.");
  }
  for (const key of requiredChildCountKeys) {
    const count = childCounts[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Expected canonical child counts must be non-negative integers.");
    }
  }
  if (!Number.isSafeInteger(contract.expectedOtherFamilyBridgeCount)
    || contract.expectedOtherFamilyBridgeCount < 0) {
    throw new Error("Expected other family bridge count must be a non-negative integer.");
  }
  return operation;
}

export function verifyReviewedEvidence(input: {
  contract: ReviewedFamilyBridgeContract;
  reportBytes: Uint8Array;
  rawPolicy: unknown;
  repository: RepositoryEvidence;
}): ReviewedEvidence {
  const operation = validateContract(input.contract);
  const actualReportSha256 = sha256(input.reportBytes);
  if (actualReportSha256 !== input.contract.expectedReportSha256) {
    throw new Error("Reviewed Block 2A report SHA-256 mismatch.");
  }
  const report = parseReport(input.reportBytes);
  if (report.reportVersion !== input.contract.expectedReportVersion || report.reportVersion !== REPORT_VERSION) {
    throw new Error("Unsupported or unexpected Block 2A report version.");
  }
  if (report.policyVersion !== input.contract.expectedPolicyVersion) {
    throw new Error("Block 2A policy version mismatch.");
  }
  if (report.repositoryCommitSha !== input.contract.expectedRepositoryCommitSha
    || input.repository.repositoryCommitSha !== input.contract.expectedRepositoryCommitSha) {
    throw new Error("Reviewed repository commit mismatch.");
  }
  if (report.fingerprint !== input.contract.expectedSemanticFingerprint) {
    throw new Error("Reviewed semantic fingerprint mismatch.");
  }
  if (input.repository.policyHeadBlobOid !== input.contract.expectedPolicyBlobOid
    || input.repository.policyWorktreeBlobOid !== input.repository.policyHeadBlobOid) {
    throw new Error("Reviewed policy blob identity mismatch.");
  }

  const policy = parseNormaFamilyMappingPolicy(input.rawPolicy);
  if (policy.policyVersion !== input.contract.expectedPolicyVersion) {
    throw new Error("Current policy version mismatch.");
  }
  const result = report.results.filter((item) => item.id === operation.normaFonteId
    && item.codice === operation.normaFonteCodice);
  if (result.length !== 1) {
    throw new Error("Reviewed report must contain exactly one expected NormaFonte result.");
  }
  const expectedReportCodes = [
    operation.normaFonteCodice,
    ...input.contract.unresolvedNormaFonteCodes,
  ];
  if (report.results.length !== expectedReportCodes.length
    || new Set(report.results.map((item) => item.codice)).size !== report.results.length
    || report.results.map((item) => item.codice).sort().join("\n")
      !== expectedReportCodes.sort().join("\n")) {
    throw new Error("Reviewed report contains an unexpected NormaFonte result set.");
  }
  const family = result[0].familyResolution;
  if (family.outcome !== "WOULD_MAP_EXISTING_FAMILY"
    || family.candidateFamilyIds.length !== 1
    || family.candidateFamilyIds[0] !== operation.targetLegalSourceId
    || family.candidateSourceKeys.length !== 1
    || family.candidateSourceKeys[0] !== operation.targetSourceKey) {
    throw new Error("Reviewed report does not prove the approved family bridge.");
  }
  if (report.counts.AMBIGUOUS_IDENTITY !== 0
    || report.counts.BRIDGE_CONFLICT !== 0
    || report.counts.CONFLICT !== 0
    || report.counts.FAILED !== 0) {
    throw new Error("Reviewed report contains ambiguity, conflict or failure outcomes.");
  }
  for (const codice of input.contract.unresolvedNormaFonteCodes) {
    const unresolved = report.results.filter((item) => item.codice === codice);
    if (unresolved.length !== 1
      || unresolved[0].familyResolution.outcome !== "UNRESOLVED_FAMILY"
      || unresolved[0].familyResolution.candidateFamilyIds.length !== 0) {
      throw new Error(`Reviewed report does not preserve unresolved family boundary for ${codice}.`);
    }
  }
  for (const item of report.results) {
    for (const versione of item.versioni) {
      if (versione.expressionResolution.outcome !== "UNRESOLVED_EXPRESSION"
        || versione.artifactResolution.outcome !== "UNRESOLVED_ARTIFACT") {
        throw new Error("Reviewed report contains an unsupported expression or artifact resolution.");
      }
    }
  }
  return { contract: input.contract, report, policy, reportSha256: actualReportSha256 };
}

function assertCounts(actual: CanonicalChildCounts, expected: ReviewedCanonicalChildCounts): void {
  for (const [contractKey, actualKey] of CANONICAL_CHILD_COUNT_FIELDS) {
    if (actual[actualKey] !== expected[contractKey]) {
      throw new Error(`Canonical child count drift for ${contractKey}.`);
    }
  }
}

function assertUnresolvedFamilyBridges(
  rows: Array<{ codice: string; legalSourceId: string | null }>,
  expectedCodes: string[],
): void {
  if (rows.length !== expectedCodes.length
    || rows.some((row) => row.legalSourceId !== null)
    || rows.map((row) => row.codice).sort().join("\n")
      !== [...expectedCodes].sort().join("\n")) {
    throw new Error("Unresolved family bridge boundary drift detected.");
  }
}

export async function runReviewedFamilyBridge(input: {
  database: Block2BDatabase;
  evidence: ReviewedEvidence;
  apply: boolean;
}): Promise<Block2BReceipt> {
  const operation = validateContract(input.evidence.contract);
  return input.database.serializableTransaction(async (transaction) => {
    const identity = await transaction.getDatabaseIdentity();
    if (identity.database !== input.evidence.contract.expectedDatabase
      || identity.user !== input.evidence.contract.expectedUser) {
      throw new Error(`Database identity mismatch: ${identity.database}/${identity.user}.`);
    }

    const sourceKeys = [...new Set(input.evidence.policy.rules.map((rule) => rule.target.sourceKey))];
    const snapshot = await transaction.getPlannerSnapshot(sourceKeys, input.evidence.report.scope.normaFonteCodice);
    const currentPlan = buildNormaCompatibilityPlan({
      policy: input.evidence.policy,
      normaFonti: snapshot.normaFonti,
      canonicalFamilies: snapshot.canonicalFamilies,
      scope: input.evidence.report.scope,
      repositoryCommitSha: input.evidence.contract.expectedRepositoryCommitSha,
    });
    if (currentPlan.fingerprint !== input.evidence.contract.expectedSemanticFingerprint) {
      throw new Error("Current database semantic fingerprint does not match the reviewed report.");
    }

    const fonteRows = await transaction.findNormaFonte(operation.normaFonteId, operation.normaFonteCodice);
    if (fonteRows.length !== 1) {
      throw new Error("Expected exactly one target NormaFonte row.");
    }
    const fonte = fonteRows[0];
    if (fonte.id !== operation.normaFonteId || fonte.codice !== operation.normaFonteCodice) {
      throw new Error("Target NormaFonte identity does not match the reviewed contract.");
    }
    if (fonte.legalSourceId !== operation.expectedCurrentLegalSourceId) {
      throw new Error("Target NormaFonte bridge is not in the reviewed starting state.");
    }

    const targetRows = await transaction.findCanonicalLegalSource(
      operation.targetLegalSourceId,
      operation.targetSourceKey,
    );
    if (targetRows.length !== 1) {
      throw new Error("Expected exactly one canonical LegalSource target.");
    }
    if (targetRows[0].id !== operation.targetLegalSourceId
      || targetRows[0].sourceKey !== operation.targetSourceKey) {
      throw new Error("Canonical LegalSource target identity mismatch.");
    }
    if (sha256(targetRows[0].canonicalPayload) !== operation.targetCanonicalRowSha256) {
      throw new Error("Canonical LegalSource row fingerprint mismatch.");
    }
    const otherBridgeCount = await transaction.countOtherFamilyBridges(operation.normaFonteId);
    if (otherBridgeCount !== input.evidence.contract.expectedOtherFamilyBridgeCount) {
      throw new Error("Unexpected non-target family bridge state.");
    }
    const unresolvedRows = await transaction.findNormaFonteBridges(
      input.evidence.contract.unresolvedNormaFonteCodes,
    );
    assertUnresolvedFamilyBridges(unresolvedRows, input.evidence.contract.unresolvedNormaFonteCodes);
    assertCounts(
      await transaction.getCanonicalChildCounts(),
      input.evidence.contract.expectedCanonicalChildCounts,
    );

    if (!input.apply) {
      return {
        contractVersion: input.evidence.contract.contractVersion,
        normaFonteId: fonte.id,
        codice: fonte.codice,
        previousLegalSourceId: null,
        newLegalSourceId: operation.targetLegalSourceId,
        targetSourceKey: operation.targetSourceKey,
        affectedRows: 0,
        previousUpdatedAt: fonte.updatedAt.toISOString(),
        persistedUpdatedAt: fonte.updatedAt.toISOString(),
        reportSha256: input.evidence.reportSha256,
        semanticFingerprint: input.evidence.contract.expectedSemanticFingerprint,
        repositoryCommitSha: input.evidence.contract.expectedRepositoryCommitSha,
        policyBlobOid: input.evidence.contract.expectedPolicyBlobOid,
        transactionResult: "VALIDATED",
      };
    }

    const affectedRows = await transaction.updateNormaFonteBridge({
      id: operation.normaFonteId,
      codice: operation.normaFonteCodice,
      expectedCurrentLegalSourceId: operation.expectedCurrentLegalSourceId,
      expectedUpdatedAt: fonte.updatedAt,
      targetLegalSourceId: operation.targetLegalSourceId,
    });
    if (affectedRows !== 1) {
      throw new Error(`Conditional family bridge update affected ${affectedRows} rows instead of 1.`);
    }
    const persistedRows = await transaction.findNormaFonte(operation.normaFonteId, operation.normaFonteCodice);
    if (persistedRows.length !== 1 || persistedRows[0].legalSourceId !== operation.targetLegalSourceId) {
      throw new Error("Post-update family bridge verification failed.");
    }
    if (persistedRows[0].updatedAt.getTime() < fonte.updatedAt.getTime()) {
      throw new Error("Post-update updatedAt is older than its pre-write value.");
    }
    if (await transaction.countOtherFamilyBridges(operation.normaFonteId)
      !== input.evidence.contract.expectedOtherFamilyBridgeCount) {
      throw new Error("A non-target family bridge changed during the transaction.");
    }
    assertUnresolvedFamilyBridges(
      await transaction.findNormaFonteBridges(input.evidence.contract.unresolvedNormaFonteCodes),
      input.evidence.contract.unresolvedNormaFonteCodes,
    );
    assertCounts(
      await transaction.getCanonicalChildCounts(),
      input.evidence.contract.expectedCanonicalChildCounts,
    );

    return {
      contractVersion: input.evidence.contract.contractVersion,
      normaFonteId: fonte.id,
      codice: fonte.codice,
      previousLegalSourceId: null,
      newLegalSourceId: operation.targetLegalSourceId,
      targetSourceKey: operation.targetSourceKey,
      affectedRows,
      previousUpdatedAt: fonte.updatedAt.toISOString(),
      persistedUpdatedAt: persistedRows[0].updatedAt.toISOString(),
      reportSha256: input.evidence.reportSha256,
      semanticFingerprint: input.evidence.contract.expectedSemanticFingerprint,
      repositoryCommitSha: input.evidence.contract.expectedRepositoryCommitSha,
      policyBlobOid: input.evidence.contract.expectedPolicyBlobOid,
      transactionResult: "APPLIED",
    };
  });
}
