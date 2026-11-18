import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
}));

vi.mock("@/server/ai/fascicoloHumanReviewPersistence", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/ai/fascicoloHumanReviewPersistence")
  >();
  return { ...actual, persistAiFascicoloHumanReview: mocks.persist };
});

import { applyAiFascicoloHumanReviewAction } from "@/server/actions/ai-fascicolo-human-review";
import { AiFascicoloHumanReviewPersistenceError } from "@/server/ai/fascicoloHumanReviewPersistence";

const actionSource = readFileSync(
  resolve(process.cwd(), "src/server/actions/ai-fascicolo-human-review.ts"),
  "utf8",
);

const input = {
  materialId: "material-1",
  statementPath: "summary",
  idempotencyKey: "caller-operation-1",
  command: {
    disposition: "COMPANY_AMENDED" as const,
    amendment: { text: "Corrected text", reason: "Professional review" },
  },
};

function serviceResult(outcome: "APPLIED" | "REUSED") {
  return {
    outcome,
    materialId: "material-1",
    statementPath: "summary",
    event: {
      id: "event-1",
      sequence: 1,
      disposition: "COMPANY_AMENDED" as const,
    },
    state: {
      id: "state-1",
      version: 1,
      latestDisposition: "COMPANY_AMENDED" as const,
    },
  };
}

describe("B2C4 Human Review Apply Server Action V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the caller payload unchanged to B2C2 exactly once", async () => {
    mocks.persist.mockResolvedValue(serviceResult("APPLIED"));

    await applyAiFascicoloHumanReviewAction(input);

    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist).toHaveBeenCalledWith(input);
    expect(mocks.persist.mock.calls[0][0]).toBe(input);
    expect(mocks.persist.mock.calls[0][0].idempotencyKey).toBe("caller-operation-1");
  });

  it.each(["APPLIED", "REUSED"] as const)(
    "returns the safe B2C2 %s result without changing its outcome",
    async (outcome) => {
      const result = serviceResult(outcome);
      mocks.persist.mockResolvedValue(result);

      await expect(applyAiFascicoloHumanReviewAction(input)).resolves.toEqual({
        ok: true,
        result: {
          outcome,
          materialId: result.materialId,
          statementPath: result.statementPath,
          event: result.event,
          state: {
            version: result.state.version,
            latestDisposition: result.state.latestDisposition,
          },
        },
      });
    },
  );

  it.each([
    "INVALID_INPUT",
    "UNAUTHENTICATED_ACTOR",
    "MATERIAL_NOT_FOUND",
    "TENANT_MISMATCH",
    "INVALID_TRUSTED_MATERIAL",
    "STATEMENT_NOT_FOUND",
    "IDEMPOTENCY_CONFLICT",
    "CONCURRENT_REVIEW_CONFLICT",
    "PERSISTENCE_FAILURE",
  ] as const)("maps the known B2C2 error %s to code only", async (code) => {
    mocks.persist.mockRejectedValue(
      new AiFascicoloHumanReviewPersistenceError(code, new Error("internal cause")),
    );

    const result = await applyAiFascicoloHumanReviewAction(input);

    expect(result).toEqual({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toMatch(/internal cause|stack|cause/i);
  });

  it("maps an unknown error to PERSISTENCE_FAILURE without leaking details", async () => {
    mocks.persist.mockRejectedValue(new Error("secret db detail"));

    const result = await applyAiFascicoloHumanReviewAction(input);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({ ok: false, error: { code: "PERSISTENCE_FAILURE" } });
    expect(serialized).not.toMatch(/secret db detail|stack|cause/i);
  });

  it("returns no actor, tenant, user, or email authority fields", async () => {
    mocks.persist.mockResolvedValue(serviceResult("APPLIED"));

    const result = await applyAiFascicoloHumanReviewAction(input);
    const serialized = JSON.stringify(result);

    expect(Object.keys(input)).toEqual([
      "materialId",
      "statementPath",
      "idempotencyKey",
      "command",
    ]);
    expect(serialized).not.toMatch(/"(?:actor|tenantId|enteId|userId|email)"/);
    expect(serialized).not.toContain('"state":{"id"');
  });

  it("contains only the B2C2 transport dependency and no local authority", () => {
    expect(actionSource.startsWith('"use server";')).toBe(true);
    expect(actionSource).toContain("persistAiFascicoloHumanReview");
    expect(actionSource).not.toMatch(
      /@\/lib\/(?:auth|tenant-auth|prisma)|@\/server\/(?:audit|queries)|next\/cache/,
    );
    expect(actionSource).not.toMatch(
      /getCurrentUser|getCurrentTenantContext|requireTenantAccess|revalidatePath|revalidateTag|randomUUID|\$transaction|prisma\.|getAiFascicoloHumanReviewReadModel/,
    );
  });

  it("introduces no administrative decision semantics", () => {
    expect(actionSource).not.toMatch(
      /\b(?:APPROVED|DENIED|VALIDATED|COMPLIANT|NON_COMPLIANT|REVOKED|RENEWED|SANCTIONED|ADMINISTRATIVE_DECISION)\b/,
    );
  });
});