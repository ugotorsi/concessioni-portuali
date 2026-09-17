import { Prisma, type LegalSourceTemporalAssessment } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assessLegalSourceTemporalApplicability,
  type TemporalAssessmentInput,
} from "@/server/legal-sources/temporal";
import {
  assessAndPersistTemporalAssessment,
  getLatestTemporalAssessment,
  getTemporalAssessmentByIdentity,
  listTemporalAssessmentHistory,
  persistTemporalAssessment,
  temporalAssessmentInputFingerprint,
  type PersistableTemporalAssessmentResult,
  type TemporalAssessmentClient,
} from "@/server/legal-sources/temporal/persistence";

function input(overrides: Partial<TemporalAssessmentInput> = {}): TemporalAssessmentInput {
  return {
    sourceFamilyId: "source-1",
    legalAuthorityKind: "LEGISLATION",
    sourceStatus: "CURRENT",
    expression: {
      expressionId: "expression-1",
      publicationDate: "2019-12-20T00:00:00.000Z",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: "2020-12-31T23:59:59.999Z",
      expressionStatus: "CURRENT",
      correctionMetadata: null,
      consolidationMetadata: null,
    },
    referenceDate: "2020-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function expression(
  overrides: Partial<TemporalAssessmentInput["expression"]>,
): TemporalAssessmentInput["expression"] {
  return { ...input().expression, ...overrides };
}

function row(overrides: Partial<LegalSourceTemporalAssessment> = {}): LegalSourceTemporalAssessment {
  return {
    id: "assessment-1",
    sourceFamilyId: "source-1",
    legalExpressionVersionId: "expression-1",
    assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
    referenceDate: new Date("2020-06-01T00:00:00.000Z"),
    validityState: "VALID",
    temporalWindowState: "SATISFIED",
    applicabilityState: "REQUIRES_HUMAN_REVIEW",
    reasonCodes: ["EFFECTIVE_INTERVAL_MATCH", "HUMAN_LEGAL_ASSESSMENT_REQUIRED"],
    effectiveFromSnapshot: new Date("2020-01-01T00:00:00.000Z"),
    effectiveToSnapshot: new Date("2020-12-31T23:59:59.999Z"),
    humanReviewRequired: true,
    confidence: "MEDIUM",
    inputFingerprint: "a".repeat(64),
    createdAt: new Date("2026-09-17T10:00:00.000Z"),
    ...overrides,
  };
}

function client() {
  return {
    legalSourceTemporalAssessment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as TemporalAssessmentClient;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "LegalSourceTemporalAssessment", target: ["inputFingerprint"] },
  });
}

describe("Block 3B.9B temporal assessment persistence", () => {
  it("persists the evaluator output and expression metadata snapshot", async () => {
    const db = client();
    const snapshot = input();
    const stored = row();
    vi.mocked(db.legalSourceTemporalAssessment.findUnique).mockResolvedValue(null);
    vi.mocked(db.legalSourceTemporalAssessment.create).mockResolvedValue(stored);

    await expect(assessAndPersistTemporalAssessment(snapshot, db)).resolves.toEqual({
      outcome: "CREATED",
      assessment: stored,
    });
    expect(db.legalSourceTemporalAssessment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceFamilyId: "source-1",
        legalExpressionVersionId: "expression-1",
        assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
        referenceDate: new Date("2020-06-01T00:00:00.000Z"),
        effectiveFromSnapshot: new Date("2020-01-01T00:00:00.000Z"),
        effectiveToSnapshot: new Date("2020-12-31T23:59:59.999Z"),
        reasonCodes: ["EFFECTIVE_INTERVAL_MATCH", "HUMAN_LEGAL_ASSESSMENT_REQUIRED"],
        humanReviewRequired: true,
      }),
    });
  });

  it("reuses an identical deterministic input without another insert", async () => {
    const db = client();
    const stored = row();
    vi.mocked(db.legalSourceTemporalAssessment.findUnique).mockResolvedValue(stored);
    await expect(assessAndPersistTemporalAssessment(input(), db)).resolves.toEqual({
      outcome: "REUSED",
      assessment: stored,
    });
    expect(db.legalSourceTemporalAssessment.create).not.toHaveBeenCalled();
  });

  it.each([
    ["reference date", input({ referenceDate: "2020-06-02T00:00:00.000Z" })],
    ["expression version", input({ expression: expression({ expressionId: "expression-2" }) })],
    ["effective metadata", input({ expression: expression({ effectiveTo: null }) })],
    ["correction metadata", input({ expression: expression({ correctionMetadata: { corrected: true } }) })],
  ])("assigns a distinct identity for a different %s", (_label, changed) => {
    const assessment = assessLegalSourceTemporalApplicability(input());
    const changedAssessment = assessLegalSourceTemporalApplicability(changed);
    expect(temporalAssessmentInputFingerprint(changed, changedAssessment.assessmentVersion))
      .not.toBe(temporalAssessmentInputFingerprint(input(), assessment.assessmentVersion));
  });

  it("assigns a distinct identity to a different evaluator version", () => {
    expect(temporalAssessmentInputFingerprint(input(), "LEGAL_SOURCE_TEMPORAL_V2"))
      .not.toBe(temporalAssessmentInputFingerprint(input(), "LEGAL_SOURCE_TEMPORAL_V1"));
  });

  it("normalizes equivalent explicit date representations in the identity", () => {
    const shifted = input({
      referenceDate: "2020-06-01T02:00:00+02:00",
      expression: expression({ effectiveFrom: "2019-12-31T19:00:00-05:00" }),
    });
    expect(temporalAssessmentInputFingerprint(shifted, "LEGAL_SOURCE_TEMPORAL_V1"))
      .toBe(temporalAssessmentInputFingerprint(input(), "LEGAL_SOURCE_TEMPORAL_V1"));
  });

  it("does not silently reuse conflicting output for an identical input identity", async () => {
    const db = client();
    vi.mocked(db.legalSourceTemporalAssessment.findUnique).mockResolvedValue(row({ validityState: "EXPIRED" }));
    await expect(assessAndPersistTemporalAssessment(input(), db))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("round-trips reason codes and human-review state through the persisted row", async () => {
    const db = client();
    const stored = row({
      reasonCodes: ["SOURCE_PARTIALLY_SUPERSEDED", "HUMAN_LEGAL_ASSESSMENT_REQUIRED"],
      humanReviewRequired: true,
    });
    vi.mocked(db.legalSourceTemporalAssessment.findUnique).mockResolvedValue(stored);
    await expect(getTemporalAssessmentByIdentity(stored.inputFingerprint, db)).resolves.toEqual(stored);
  });

  it("queries the latest assessment deterministically", async () => {
    const db = client();
    vi.mocked(db.legalSourceTemporalAssessment.findFirst).mockResolvedValue(row());
    const referenceDate = new Date("2020-06-01T00:00:00.000Z");
    await getLatestTemporalAssessment("expression-1", referenceDate, db);
    expect(db.legalSourceTemporalAssessment.findFirst).toHaveBeenCalledWith({
      where: { legalExpressionVersionId: "expression-1", referenceDate },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("lists preserved history in append order", async () => {
    const db = client();
    const history = [row(), row({ id: "assessment-2", assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V2" })];
    vi.mocked(db.legalSourceTemporalAssessment.findMany).mockResolvedValue(history);
    const referenceDate = new Date("2020-06-01T00:00:00.000Z");
    await expect(listTemporalAssessmentHistory("expression-1", referenceDate, 500, db)).resolves.toEqual(history);
    expect(db.legalSourceTemporalAssessment.findMany).toHaveBeenCalledWith({
      where: { legalExpressionVersionId: "expression-1", referenceDate },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
  });

  it("converges concurrent identical inserts on the fingerprint winner", async () => {
    const db = client();
    const stored = row();
    vi.mocked(db.legalSourceTemporalAssessment.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored);
    vi.mocked(db.legalSourceTemporalAssessment.create)
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(p2002());

    const results = await Promise.all([
      assessAndPersistTemporalAssessment(input(), db),
      assessAndPersistTemporalAssessment(input(), db),
    ]);
    expect(results.map(({ outcome }) => outcome).sort()).toEqual(["CREATED", "REUSED"]);
  });

  it("does not use current time or expose canonical mutation delegates", async () => {
    const db = client();
    const now = vi.spyOn(Date, "now");
    vi.mocked(db.legalSourceTemporalAssessment.findUnique).mockResolvedValue(row());
    await assessAndPersistTemporalAssessment(input(), db);
    expect(now).not.toHaveBeenCalled();
    expect(db).not.toHaveProperty("legalSource");
    expect(db).not.toHaveProperty("legalReferenceOfficialHit");
    expect(db).not.toHaveProperty("legalReferenceOfficialReconciliation");
    now.mockRestore();
  });

  it("rejects output that does not preserve the explicit evaluator dates", async () => {
    const db = client();
    const assessment: PersistableTemporalAssessmentResult = {
      ...assessLegalSourceTemporalApplicability(input()),
      referenceDate: "2020-06-02T00:00:00.000Z",
    };
    await expect(persistTemporalAssessment(input(), assessment, db))
      .rejects.toMatchObject({ code: "INVALID_ASSESSMENT" });
    expect(db.legalSourceTemporalAssessment.create).not.toHaveBeenCalled();
  });
});