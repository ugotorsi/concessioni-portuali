import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

const cliConstructors = vi.hoisted(() => ({
  pool: vi.fn(function MockPool() { return {}; }),
  prismaAdapter: vi.fn(function MockPrismaAdapter() { return {}; }),
  prismaClient: vi.fn(function MockPrismaClient() { return {}; }),
}));

vi.mock("pg", () => ({ Pool: cliConstructors.pool }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: cliConstructors.prismaAdapter }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: cliConstructors.prismaClient }));

import {
  BLOCK_2B_ACKNOWLEDGEMENT,
  BLOCK_2B_CONTRACT_VERSION,
  parseBlock2BCommandOptions,
  runReviewedFamilyBridge,
  verifyReviewedEvidence,
  type Block2BDatabase,
  type Block2BTransaction,
  type ReviewedFamilyBridgeContract,
} from "@/server/legal-sources/norma-compatibility-applier";
import {
  REPORT_VERSION,
  buildNormaCompatibilityPlan,
  type LegacyNormaFonteInput,
  type NormaFamilyMappingPolicy,
} from "@/server/legal-sources/norma-compatibility-planner";

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const preUpdatedAt = new Date("2026-07-27T16:31:56.279Z");
const postUpdatedAt = new Date("2026-09-12T08:00:00.123Z");
const canonicalPayload = '{"role": "NORMATIVE", "sourceKey": "L-84-1994"}';
const codes = ["ART_18_L84_1994", "ART_42_COD_NAV", "ART_47_COD_NAV", "ART_54_COD_NAV"];
const reviewedChildCounts = {
  LegalExpressionVersion: 0,
  LegalSourceVersion: 0,
  LegalSourceAcquisition: 0,
  LegalSourceIdentityAssertion: 0,
};

const policy: NormaFamilyMappingPolicy = {
  policyVersion: "B2C9_BLOCK_2A_V1",
  rules: [{
    normaFonteCodice: codes[0],
    target: {
      sourceKey: "L-84-1994",
      expectedTitle: "L. 28 gennaio 1994 n. 84",
      expectedSourceType: "LEGGE",
      expectedSourceNumber: "84",
      expectedSourceDate: "1994-01-28T00:00:00.000Z",
    },
    evidence: { kind: "REPOSITORY_CURATED", description: "Reviewed fixture.", references: ["fixture"] },
    legacyProvisionLocator: { article: "18", legacyCode: codes[0] },
  }],
};

function fonte(codice: string, index: number): LegacyNormaFonteInput {
  return {
    id: `norma-${index}`,
    codice,
    titolo: codice,
    enteEmittente: "Stato",
    ambito: "CONCESSIONI",
    descrizione: null,
    legalSourceId: null,
    versioni: [{
      id: `versione-${index}`,
      versione: "v1",
      stato: "VIGENTE",
      dataEntrataVigore: "2024-01-01T00:00:00.000Z",
      dataFineVigore: null,
      urlTesto: null,
      sintesi: "Fixture",
      note: null,
      legalSourceVersionId: null,
      artifactCandidate: null,
    }],
  };
}

const snapshot = {
  normaFonti: codes.map(fonte),
  canonicalFamilies: [{
    id: "family-l84",
    sourceKey: "L-84-1994",
    title: "L. 28 gennaio 1994 n. 84",
    sourceType: "LEGGE",
    sourceNumber: "84",
    sourceDate: "1994-01-28T00:00:00.000Z",
    issuingBody: null,
    resourceSemanticType: null,
  }],
};

function makeReport() {
  return buildNormaCompatibilityPlan({
    policy,
    ...snapshot,
    scope: { normaFonteCodice: null },
    repositoryCommitSha: "commit-reviewed",
  }, "2026-09-12T00:00:00.000Z");
}

function makeContract(reportFingerprint = makeReport().fingerprint): ReviewedFamilyBridgeContract {
  return {
    contractVersion: BLOCK_2B_CONTRACT_VERSION,
    expectedDatabase: "database-reviewed",
    expectedUser: "user-reviewed",
    expectedReportSha256: "0".repeat(64),
    expectedSemanticFingerprint: reportFingerprint,
    expectedRepositoryCommitSha: "commit-reviewed",
    expectedPolicyBlobOid: "policy-reviewed",
    expectedReportVersion: REPORT_VERSION,
    expectedPolicyVersion: policy.policyVersion,
    unresolvedNormaFonteCodes: codes.slice(1),
    expectedCanonicalChildCounts: { ...reviewedChildCounts },
    expectedOtherFamilyBridgeCount: 0,
    approvedOperations: [{
      kind: "NORMA_FONTE_FAMILY_BRIDGE",
      normaFonteId: "norma-0",
      normaFonteCodice: codes[0],
      expectedCurrentLegalSourceId: null,
      targetLegalSourceId: "family-l84",
      targetSourceKey: "L-84-1994",
      targetCanonicalRowSha256: sha256(canonicalPayload),
    }],
  };
}

function evidence(options: {
  report?: ReturnType<typeof makeReport>;
  contract?: ReviewedFamilyBridgeContract;
  repositoryCommitSha?: string;
  policyHeadBlobOid?: string;
  policyWorktreeBlobOid?: string;
  reportBytes?: Buffer;
} = {}) {
  const report = options.report ?? makeReport();
  const reportBytes = options.reportBytes ?? Buffer.from(`${JSON.stringify(report)}\n`);
  const contract = options.contract ?? makeContract(report.fingerprint);
  contract.expectedReportSha256 = sha256(reportBytes);
  return verifyReviewedEvidence({
    contract,
    reportBytes,
    rawPolicy: policy,
    repository: {
      repositoryCommitSha: options.repositoryCommitSha ?? "commit-reviewed",
      policyHeadBlobOid: options.policyHeadBlobOid ?? "policy-reviewed",
      policyWorktreeBlobOid: options.policyWorktreeBlobOid ?? "policy-reviewed",
    },
  });
}

function setupTransaction(overrides: Partial<Block2BTransaction> = {}) {
  let applied = false;
  const transaction: Block2BTransaction = {
    getDatabaseIdentity: vi.fn().mockResolvedValue({ database: "database-reviewed", user: "user-reviewed" }),
    getPlannerSnapshot: vi.fn().mockResolvedValue(snapshot),
    findNormaFonte: vi.fn().mockImplementation(async () => [{
      id: "norma-0",
      codice: codes[0],
      legalSourceId: applied ? "family-l84" : null,
      updatedAt: applied ? postUpdatedAt : preUpdatedAt,
    }]),
    findCanonicalLegalSource: vi.fn().mockResolvedValue([{
      id: "family-l84",
      sourceKey: "L-84-1994",
      canonicalPayload,
    }]),
    countOtherFamilyBridges: vi.fn().mockResolvedValue(0),
    findNormaFonteBridges: vi.fn().mockResolvedValue(codes.slice(1).map((codice) => ({
      codice,
      legalSourceId: null,
    }))),
    getCanonicalChildCounts: vi.fn().mockResolvedValue({
      legalExpressionVersion: 0,
      legalSourceVersion: 0,
      legalSourceAcquisition: 0,
      legalSourceIdentityAssertion: 0,
    }),
    updateNormaFonteBridge: vi.fn().mockImplementation(async () => {
      applied = true;
      return 1;
    }),
    ...overrides,
  };
  const database: Block2BDatabase = {
    serializableTransaction: vi.fn().mockImplementation(async (operation) => operation(transaction)),
  };
  return { database, transaction };
}

describe("Block 2B reviewed family bridge applicator", () => {
  it("applies one reviewed bridge and returns an audit receipt", async () => {
    const { database, transaction } = setupTransaction();
    const reviewedEvidence = evidence();
    const receipt = await runReviewedFamilyBridge({ database, evidence: reviewedEvidence, apply: true });
    expect(receipt).toEqual({
      contractVersion: BLOCK_2B_CONTRACT_VERSION,
      normaFonteId: "norma-0",
      codice: codes[0],
      previousLegalSourceId: null,
      newLegalSourceId: "family-l84",
      targetSourceKey: "L-84-1994",
      affectedRows: 1,
      previousUpdatedAt: preUpdatedAt.toISOString(),
      persistedUpdatedAt: postUpdatedAt.toISOString(),
      reportSha256: reviewedEvidence.reportSha256,
      semanticFingerprint: reviewedEvidence.contract.expectedSemanticFingerprint,
      repositoryCommitSha: "commit-reviewed",
      policyBlobOid: "policy-reviewed",
      transactionResult: "APPLIED",
    });
    expect(transaction.updateNormaFonteBridge).toHaveBeenCalledWith({
      id: "norma-0",
      codice: codes[0],
      expectedCurrentLegalSourceId: null,
      expectedUpdatedAt: preUpdatedAt,
      targetLegalSourceId: "family-l84",
    });
  });

  it("validates by default without invoking a mutation", async () => {
    const options = parseBlock2BCommandOptions(["--contract", "contract.json", "--report", "report.json"]);
    const { database, transaction } = setupTransaction();
    const receipt = await runReviewedFamilyBridge({ database, evidence: evidence(), apply: options.apply });
    expect(receipt.transactionResult).toBe("VALIDATED");
    expect(receipt.affectedRows).toBe(0);
    expect(transaction.updateNormaFonteBridge).not.toHaveBeenCalled();
  });

  it("requires apply acknowledgement and rejects unknown CLI flags", () => {
    expect(() => parseBlock2BCommandOptions([
      "--contract", "c", "--report", "r", "--apply",
    ])).toThrow(/requires --ack/);
    expect(parseBlock2BCommandOptions([
      "--contract", "c", "--report", "r", "--apply", "--ack", BLOCK_2B_ACKNOWLEDGEMENT,
    ]).apply).toBe(true);
    expect(() => parseBlock2BCommandOptions(["--contract", "c", "--report", "r", "--write"]))
      .toThrow(/Unknown argument/);
  });

  it.each([
    [[], /Both --contract and --report/],
    [["--report", "r"], /Both --contract and --report/],
    [["--contract", "c"], /Both --contract and --report/],
    [["--contract"], /requires a non-empty value/],
    [["--contract", "c", "--report", "r", "--ack", BLOCK_2B_ACKNOWLEDGEMENT], /only together/],
    [["--contract", "c", "--report", "r", "--apply", "--ack", "WRONG"], /requires --ack/],
  ])("fails closed for invalid CLI arguments %#", (argv, expected) => {
    expect(() => parseBlock2BCommandOptions(argv as string[])).toThrow(expected as RegExp);
  });

  it.each(["--contract", "--report", "--ack", "--apply"])(
    "rejects duplicate singleton flag %s",
    (flag) => {
      const argv = ["--contract", "c", "--report", "r"];
      if (flag === "--contract") argv.push("--contract", "c2");
      if (flag === "--report") argv.push("--report", "r2");
      if (flag === "--ack") argv.push("--apply", "--ack", BLOCK_2B_ACKNOWLEDGEMENT, "--ack", BLOCK_2B_ACKNOWLEDGEMENT);
      if (flag === "--apply") argv.push("--apply", "--apply", "--ack", BLOCK_2B_ACKNOWLEDGEMENT);
      expect(() => parseBlock2BCommandOptions(argv)).toThrow(`Duplicate argument: ${flag}.`);
    },
  );

  it("imports the CLI without executing main or opening a database connection", async () => {
    const previousExitCode = process.exitCode;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const cli = await import("../../scripts/db/apply-norma-compatibility");
      await Promise.resolve();
      expect(cli).toMatchObject({
        main: expect.any(Function),
        makeDatabase: expect.any(Function),
        makeTransaction: expect.any(Function),
        parseBlock2BCommandOptions: expect.any(Function),
      });
      expect(cliConstructors.pool).not.toHaveBeenCalled();
      expect(cliConstructors.prismaAdapter).not.toHaveBeenCalled();
      expect(cliConstructors.prismaClient).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      consoleError.mockRestore();
      stdoutWrite.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("rejects zero and multiple approved operations", () => {
    const zero = makeContract();
    zero.approvedOperations = [];
    expect(() => evidence({ contract: zero })).toThrow(/exactly one/);
    const multiple = makeContract();
    multiple.approvedOperations = [multiple.approvedOperations[0], multiple.approvedOperations[0]];
    expect(() => evidence({ contract: multiple })).toThrow(/exactly one/);
  });

  it.each(["EXPRESSION_BRIDGE", "ARTIFACT_BRIDGE"])("rejects unsupported %s operations", (kind) => {
    const unsupported = makeContract() as unknown as { approvedOperations: Array<{ kind: string }> };
    unsupported.approvedOperations[0].kind = kind;
    expect(() => evidence({ contract: unsupported as unknown as ReviewedFamilyBridgeContract }))
      .toThrow(/only NormaFonte family bridge/);
  });

  it("accepts exactly the four reviewed canonical child-count keys", async () => {
    const { database, transaction } = setupTransaction();
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: false }))
      .resolves.toMatchObject({ transactionResult: "VALIDATED" });
    expect(transaction.updateNormaFonteBridge).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty object", {}],
    ["one missing key", {
      LegalExpressionVersion: 0,
      LegalSourceVersion: 0,
      LegalSourceAcquisition: 0,
    }],
    ["multiple missing keys", { LegalExpressionVersion: 0 }],
    ["an extra key", { ...reviewedChildCounts, UnexpectedChildTable: 0 }],
    ["a non-number", { ...reviewedChildCounts, LegalExpressionVersion: "0" }],
    ["a negative count", { ...reviewedChildCounts, LegalSourceVersion: -1 }],
    ["a fractional count", { ...reviewedChildCounts, LegalSourceAcquisition: 0.5 }],
    ["null", null],
    ["an array", [0, 0, 0, 0]],
  ])("rejects canonical child counts with %s before mutation", async (_label, counts) => {
    const reviewedEvidence = evidence();
    (reviewedEvidence.contract as unknown as { expectedCanonicalChildCounts: unknown })
      .expectedCanonicalChildCounts = counts;
    const { database, transaction } = setupTransaction();
    await expect(runReviewedFamilyBridge({ database, evidence: reviewedEvidence, apply: true }))
      .rejects.toThrow(/expectedCanonicalChildCounts|canonical child counts|child-table keys/);
    expect(database.serializableTransaction).not.toHaveBeenCalled();
    expect(transaction.updateNormaFonteBridge).not.toHaveBeenCalled();
  });

  it("fails closed on report hash, version, policy version and semantic fingerprint drift", () => {
    const original = makeReport();
    const contract = makeContract(original.fingerprint);
    const bytes = Buffer.from(`${JSON.stringify(original)}\n`);
    contract.expectedReportSha256 = sha256(bytes);
    expect(() => verifyReviewedEvidence({
      contract,
      reportBytes: Buffer.concat([bytes, Buffer.from(" ")]),
      rawPolicy: policy,
      repository: { repositoryCommitSha: "commit-reviewed", policyHeadBlobOid: "policy-reviewed", policyWorktreeBlobOid: "policy-reviewed" },
    })).toThrow(/SHA-256 mismatch/);
    const wrongVersion = { ...original, reportVersion: "V2" } as unknown as typeof original;
    expect(() => evidence({ report: wrongVersion })).toThrow(/report version/);
    const wrongPolicy = { ...original, policyVersion: "OTHER" };
    expect(() => evidence({ report: wrongPolicy })).toThrow(/policy version/);
    const wrongFingerprint = { ...original, fingerprint: "f".repeat(64) };
    expect(() => evidence({ report: wrongFingerprint, contract: makeContract(original.fingerprint) }))
      .toThrow(/semantic fingerprint/);
  });

  it("rejects malformed report fields before semantic use", () => {
    expect(() => evidence({ reportBytes: Buffer.from("{}") })).toThrow(/report\.reportVersion/);
  });

  it("fails closed on repository commit or policy blob drift", () => {
    expect(() => evidence({ repositoryCommitSha: "other" })).toThrow(/repository commit/);
    expect(() => evidence({ policyHeadBlobOid: "other" })).toThrow(/policy blob/);
    expect(() => evidence({ policyWorktreeBlobOid: "other" })).toThrow(/policy blob/);
  });

  it("rejects unexpected report records, target status, ambiguity, expressions and artifacts", () => {
    const extra = makeReport();
    extra.results.push({ ...extra.results[1], id: "extra", codice: "EXTRA" });
    expect(() => evidence({ report: extra })).toThrow(/unexpected NormaFonte result set/);
    const wrongStatus = makeReport();
    wrongStatus.results[0].familyResolution.outcome = "UNRESOLVED_FAMILY";
    expect(() => evidence({ report: wrongStatus })).toThrow(/approved family bridge/);
    const ambiguous = makeReport();
    ambiguous.counts.AMBIGUOUS_IDENTITY = 1;
    expect(() => evidence({ report: ambiguous })).toThrow(/ambiguity/);
    const expression = makeReport();
    expression.results[0].versioni[0].expressionResolution.outcome = "EXPRESSION_CANDIDATE";
    expect(() => evidence({ report: expression })).toThrow(/expression or artifact/);
    const artifact = makeReport();
    artifact.results[0].versioni[0].artifactResolution.outcome = "ARTIFACT_CANDIDATE";
    expect(() => evidence({ report: artifact })).toThrow(/expression or artifact/);
  });

  it.each([
    [{ database: "wrong", user: "user-reviewed" }, "Database identity"],
    [{ database: "database-reviewed", user: "wrong" }, "Database identity"],
  ])("rejects database identity drift %#", async (identity, message) => {
    const { database } = setupTransaction({ getDatabaseIdentity: vi.fn().mockResolvedValue(identity) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true })).rejects.toThrow(message);
  });

  it("rejects current semantic fingerprint drift", async () => {
    const changed = structuredClone(snapshot);
    changed.normaFonti[0].titolo = "Changed";
    const { database } = setupTransaction({ getPlannerSnapshot: vi.fn().mockResolvedValue(changed) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/semantic fingerprint/);
  });

  it.each([
    [[], "missing"],
    [[
      { id: "norma-0", codice: codes[0], legalSourceId: null, updatedAt: preUpdatedAt },
      { id: "norma-0", codice: codes[0], legalSourceId: null, updatedAt: preUpdatedAt },
    ], "duplicate"],
  ])("rejects %s target NormaFonte cardinality", async (rows) => {
    const { database, transaction } = setupTransaction({ findNormaFonte: vi.fn().mockResolvedValue(rows) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/exactly one target NormaFonte/);
    expect(transaction.updateNormaFonteBridge).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: "wrong", codice: codes[0], legalSourceId: null, updatedAt: preUpdatedAt }, "wrong ID"],
    [{ id: "norma-0", codice: "WRONG_CODE", legalSourceId: null, updatedAt: preUpdatedAt }, "wrong code"],
  ])("rejects a target NormaFonte with %s", async (row) => {
    const { database, transaction } = setupTransaction({ findNormaFonte: vi.fn().mockResolvedValue([row]) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/identity does not match/);
    expect(transaction.updateNormaFonteBridge).not.toHaveBeenCalled();
  });

  it("rejects an unexpected current family bridge", async () => {
    const rows = [{ id: "norma-0", codice: codes[0], legalSourceId: "already", updatedAt: preUpdatedAt }];
    const { database, transaction } = setupTransaction({ findNormaFonte: vi.fn().mockResolvedValue(rows) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/starting state/);
    expect(transaction.updateNormaFonteBridge).not.toHaveBeenCalled();
  });

  it.each([
    [[], "exactly one canonical"],
    [[{ id: "family-l84", sourceKey: "L-84-1994", canonicalPayload }, { id: "family-l84", sourceKey: "L-84-1994", canonicalPayload }], "exactly one canonical"],
    [[{ id: "wrong", sourceKey: "L-84-1994", canonicalPayload }], "target identity"],
    [[{ id: "family-l84", sourceKey: "WRONG", canonicalPayload }], "target identity"],
    [[{ id: "family-l84", sourceKey: "L-84-1994", canonicalPayload: "changed" }], "fingerprint mismatch"],
  ])("rejects canonical target drift %#", async (rows, message) => {
    const { database } = setupTransaction({ findCanonicalLegalSource: vi.fn().mockResolvedValue(rows) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true })).rejects.toThrow(message);
  });

  it("rejects unexpected family bridges and unresolved-code drift", async () => {
    const other = setupTransaction({ countOtherFamilyBridges: vi.fn().mockResolvedValue(1) });
    await expect(runReviewedFamilyBridge({ database: other.database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/non-target family bridge/);
    const unresolved = setupTransaction({
      findNormaFonteBridges: vi.fn().mockResolvedValue(codes.slice(1).map((codice, index) => ({
        codice,
        legalSourceId: index === 0 ? "invented" : null,
      }))),
    });
    await expect(runReviewedFamilyBridge({ database: unresolved.database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/Unresolved family bridge/);
  });

  it.each([
    "legalExpressionVersion",
    "legalSourceVersion",
    "legalSourceAcquisition",
    "legalSourceIdentityAssertion",
  ] as const)("rejects unexpected %s rows", async (key) => {
    const counts = {
      legalExpressionVersion: 0,
      legalSourceVersion: 0,
      legalSourceAcquisition: 0,
      legalSourceIdentityAssertion: 0,
      [key]: 1,
    };
    const { database } = setupTransaction({ getCanonicalChildCounts: vi.fn().mockResolvedValue(counts) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/Canonical child count drift/);
  });

  it.each([0, 2])("rolls back logically when updateMany affects %i rows", async (count) => {
    const { database } = setupTransaction({ updateNormaFonteBridge: vi.fn().mockResolvedValue(count) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/instead of 1/);
  });

  it("rejects a wrong post-update bridge", async () => {
    const row = { id: "norma-0", codice: codes[0], legalSourceId: null, updatedAt: preUpdatedAt };
    const { database } = setupTransaction({ findNormaFonte: vi.fn().mockResolvedValue([row]) });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/Post-update family bridge/);
  });

  it("rejects protected-boundary drift observed only after the update", async () => {
    const findNormaFonte = vi.fn()
      .mockResolvedValueOnce([{
        id: "norma-0", codice: codes[0], legalSourceId: null, updatedAt: preUpdatedAt,
      }])
      .mockResolvedValueOnce([{
        id: "norma-0", codice: codes[0], legalSourceId: "family-l84", updatedAt: postUpdatedAt,
      }]);
    const countOtherFamilyBridges = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const updateNormaFonteBridge = vi.fn().mockResolvedValue(1);
    const { database } = setupTransaction({
      findNormaFonte,
      countOtherFamilyBridges,
      updateNormaFonteBridge,
    });
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/changed during the transaction/);
    expect(updateNormaFonteBridge).toHaveBeenCalledOnce();
    expect(countOtherFamilyBridges).toHaveBeenCalledTimes(2);
  });

  it("rejects reviewed unresolved-family drift observed only after the update", async () => {
    const unresolvedBefore = codes.slice(1).map((codice) => ({ codice, legalSourceId: null }));
    const unresolvedAfter = unresolvedBefore.map((row, index) => ({
      ...row,
      legalSourceId: index === 0 ? "unexpected-family" : null,
    }));
    const findNormaFonteBridges = vi.fn()
      .mockResolvedValueOnce(unresolvedBefore)
      .mockResolvedValueOnce(unresolvedAfter);
    const { database, transaction } = setupTransaction({ findNormaFonteBridges });

    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/Unresolved family bridge boundary drift/);
    expect(transaction.updateNormaFonteBridge).toHaveBeenCalledOnce();
    expect(findNormaFonteBridges).toHaveBeenCalledTimes(2);
  });

  it("rejects canonical child-count drift observed only after the update", async () => {
    const validCounts = {
      legalExpressionVersion: 0,
      legalSourceVersion: 0,
      legalSourceAcquisition: 0,
      legalSourceIdentityAssertion: 0,
    };
    const getCanonicalChildCounts = vi.fn()
      .mockResolvedValueOnce(validCounts)
      .mockResolvedValueOnce({ ...validCounts, legalSourceVersion: 1 });
    const findNormaFonte = vi.fn()
      .mockResolvedValueOnce([{
        id: "norma-0", codice: codes[0], legalSourceId: null, updatedAt: preUpdatedAt,
      }])
      .mockResolvedValueOnce([{
        id: "norma-0", codice: codes[0], legalSourceId: "family-l84", updatedAt: postUpdatedAt,
      }]);
    const updateNormaFonteBridge = vi.fn().mockResolvedValue(1);
    const { database, transaction } = setupTransaction({
      findNormaFonte,
      getCanonicalChildCounts,
      updateNormaFonteBridge,
    });

    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/Canonical child count drift for LegalSourceVersion/);
    expect(updateNormaFonteBridge).toHaveBeenCalledOnce();
    await expect(updateNormaFonteBridge.mock.results[0].value).resolves.toBe(1);
    expect(getCanonicalChildCounts).toHaveBeenCalledTimes(2);
    expect(transaction.findNormaFonte).toHaveBeenCalledTimes(2);
    expect(transaction.countOtherFamilyBridges).toHaveBeenCalledTimes(2);
    expect(transaction.findNormaFonteBridges).toHaveBeenCalledTimes(2);
    expect(updateNormaFonteBridge.mock.invocationCallOrder[0])
      .toBeLessThan(getCanonicalChildCounts.mock.invocationCallOrder[1]);
  });

  it("accepts equal timestamp precision but rejects an older persisted updatedAt", async () => {
    let calls = 0;
    const equal = setupTransaction({
      findNormaFonte: vi.fn().mockImplementation(async () => [{
        id: "norma-0", codice: codes[0], legalSourceId: calls++ === 0 ? null : "family-l84", updatedAt: preUpdatedAt,
      }]),
    });
    await expect(runReviewedFamilyBridge({ database: equal.database, evidence: evidence(), apply: true }))
      .resolves.toMatchObject({ persistedUpdatedAt: preUpdatedAt.toISOString() });
    calls = 0;
    const older = setupTransaction({
      findNormaFonte: vi.fn().mockImplementation(async () => [{
        id: "norma-0", codice: codes[0], legalSourceId: calls++ === 0 ? null : "family-l84",
        updatedAt: calls === 1 ? preUpdatedAt : new Date(preUpdatedAt.getTime() - 1),
      }]),
    });
    await expect(runReviewedFamilyBridge({ database: older.database, evidence: evidence(), apply: true }))
      .rejects.toThrow(/older/);
  });

  it("does not return a success receipt when the transaction throws", async () => {
    const database: Block2BDatabase = {
      serializableTransaction: vi.fn().mockRejectedValue(new Error("rollback")),
    };
    await expect(runReviewedFamilyBridge({ database, evidence: evidence(), apply: true }))
      .rejects.toThrow("rollback");
  });

  it("uses one Serializable adapter and limits Prisma update data to legalSourceId", async () => {
    const { makeDatabase, makeTransaction } = await import("../../scripts/db/apply-norma-compatibility");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = makeTransaction({ normaFonte: { updateMany } } as never);
    await expect(transaction.updateNormaFonteBridge({
      id: "norma-0",
      codice: codes[0],
      expectedCurrentLegalSourceId: null,
      expectedUpdatedAt: preUpdatedAt,
      targetLegalSourceId: "family-l84",
    })).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "norma-0",
        codice: codes[0],
        legalSourceId: null,
        updatedAt: preUpdatedAt,
      },
      data: { legalSourceId: "family-l84" },
    });

    const prismaTransaction = {} as never;
    const transactionRunner = {
      $transaction: vi.fn(async (operation: (value: never) => Promise<string>) => operation(prismaTransaction)),
    };
    const database = makeDatabase(transactionRunner as never);
    await expect(database.serializableTransaction(async (adapter) => {
      expect(adapter).toMatchObject({
        getDatabaseIdentity: expect.any(Function),
        getPlannerSnapshot: expect.any(Function),
        findNormaFonte: expect.any(Function),
        findCanonicalLegalSource: expect.any(Function),
        countOtherFamilyBridges: expect.any(Function),
        findNormaFonteBridges: expect.any(Function),
        getCanonicalChildCounts: expect.any(Function),
        updateNormaFonteBridge: expect.any(Function),
      });
      return "done";
    })).resolves.toBe("done");
    expect(transactionRunner.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });
});
