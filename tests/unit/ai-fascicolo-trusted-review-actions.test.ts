import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRuntime: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/ai/openaiRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/openaiRuntime")>();
  return {
    ...actual,
    createOpenAiFascicoloTrustedReviewProductionRuntimeFromEnv: mocks.createRuntime,
  };
});

import { produceAiFascicoloTrustedReviewAction } from "@/server/actions/ai-fascicolo-trusted-review";
import { AiFascicoloAnalysisError } from "@/server/ai/fascicoloAnalysis";
import { AiFascicoloAuthoritativeEvidenceError } from "@/server/ai/fascicoloAuthoritativeEvidence";
import { AiFascicoloBasisRefResolutionError } from "@/server/ai/fascicoloBasisRefResolution";
import { AiFascicoloLiveAnalysisError } from "@/server/ai/fascicoloLiveAnalysis";
import { AiFascicoloOutboundProjectionError } from "@/server/ai/fascicoloOutboundProjection";
import { AiFascicoloReviewPersistenceError } from "@/server/ai/fascicoloReviewPersistence";
import { AiFascicoloSnapshotError } from "@/server/ai/fascicoloSnapshot";
import { AiFascicoloTrustedReviewValidationError } from "@/server/ai/fascicoloTrustedReview";
import { AiFascicoloTrustedReviewProductionError } from "@/server/ai/fascicoloTrustedReviewProduction";
import { OpenAiRuntimeConfigurationError } from "@/server/ai/openaiRuntime";
import { AiRealDataActivationError } from "@/server/ai/realDataActivation";

const actionSource = readFileSync(
  resolve(process.cwd(), "src/server/actions/ai-fascicolo-trusted-review.ts"),
  "utf8",
);
const input = { procedimentoId: "procedimento-1" };

function productionResult(outcome: "CREATED" | "REUSED" | "REUSED_AFTER_RACE") {
  return { materialId: "material-1", procedimentoId: "procedimento-1", outcome };
}

describe("B2C7 Trusted Review Production Trigger Server Action V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRuntime.mockReturnValue({ execute: mocks.execute });
  });

  it("creates one server runtime and forwards the exact caller reference once", async () => {
    mocks.execute.mockResolvedValue(productionResult("CREATED"));

    await produceAiFascicoloTrustedReviewAction(input);

    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.createRuntime).toHaveBeenCalledWith();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(input);
    expect(mocks.execute.mock.calls[0][0]).toBe(input);
  });

  it.each(["CREATED", "REUSED", "REUSED_AFTER_RACE"] as const)(
    "returns the minimal B2C6 %s result without changing its outcome",
    async (outcome) => {
      const result = productionResult(outcome);
      mocks.execute.mockResolvedValue({ ...result, ignored: "internal" });

      await expect(produceAiFascicoloTrustedReviewAction(input)).resolves.toEqual({
        ok: true,
        result,
      });
    },
  );

  it.each([
    ["INVALID_INPUT", () => new AiFascicoloTrustedReviewProductionError()],
    ["UNAUTHENTICATED", () => new AiFascicoloSnapshotError("UNAUTHENTICATED")],
    ["AI_ROLE_FORBIDDEN", () => new AiFascicoloSnapshotError("AI_ROLE_FORBIDDEN")],
    ["PROCEDIMENTO_NOT_FOUND", () => new AiFascicoloSnapshotError("PROCEDIMENTO_NOT_FOUND")],
    ["TENANT_ACCESS_DENIED", () => new AiFascicoloSnapshotError("TENANT_ACCESS_DENIED")],
    ["SOURCE_INCONSISTENCY", () => new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY")],
    ["AI_REAL_DATA_DISABLED", () => new AiRealDataActivationError()],
    ["AI_CONFIGURATION_ERROR", () => new OpenAiRuntimeConfigurationError("AI_OPENAI_API_KEY")],
    ["INVALID_SOURCE_SNAPSHOT", () => new AiFascicoloOutboundProjectionError("INVALID_SOURCE_SNAPSHOT")],
    ["OUTBOUND_PROJECTION_INCONSISTENCY", () => new AiFascicoloOutboundProjectionError("OUTBOUND_PROJECTION_INCONSISTENCY")],
    ["OUTBOUND_FIELD_TOO_LARGE", () => new AiFascicoloOutboundProjectionError("OUTBOUND_FIELD_TOO_LARGE")],
    ["BASISREF_NOT_GROUNDED", () => new AiFascicoloBasisRefResolutionError()],
    ["AI_INPUT_TOO_LARGE", () => new AiFascicoloLiveAnalysisError("AI_INPUT_TOO_LARGE")],
    ["AI_PROVIDER_UNAVAILABLE", () => new AiFascicoloLiveAnalysisError("AI_PROVIDER_UNAVAILABLE")],
    ["AI_PROVIDER_TIMEOUT", () => new AiFascicoloLiveAnalysisError("AI_PROVIDER_TIMEOUT")],
    ["AI_PROVIDER_RATE_LIMITED", () => new AiFascicoloLiveAnalysisError("AI_PROVIDER_RATE_LIMITED")],
    ["UNSUPPORTED_SNAPSHOT_VERSION", () => new AiFascicoloAnalysisError("UNSUPPORTED_SNAPSHOT_VERSION")],
    ["INVALID_PROVIDER_OUTPUT", () => new AiFascicoloAnalysisError("INVALID_PROVIDER_OUTPUT")],
    ["OUTBOUND_TRUSTED_METADATA_MISMATCH", () => new AiFascicoloAnalysisError("OUTBOUND_TRUSTED_METADATA_MISMATCH")],
    ["SNAPSHOT_PROJECTION_MISMATCH", () => new AiFascicoloAuthoritativeEvidenceError("SNAPSHOT_PROJECTION_MISMATCH")],
    ["MISSING_CANONICAL_MAPPING", () => new AiFascicoloAuthoritativeEvidenceError("MISSING_CANONICAL_MAPPING")],
    ["DUPLICATE_EVIDENCE_TARGET", () => new AiFascicoloAuthoritativeEvidenceError("DUPLICATE_EVIDENCE_TARGET")],
    ["UNSUPPORTED_EVIDENCE_FIELD", () => new AiFascicoloAuthoritativeEvidenceError("UNSUPPORTED_EVIDENCE_FIELD")],
    ["INVALID_LOCAL_VALUE", () => new AiFascicoloAuthoritativeEvidenceError("INVALID_LOCAL_VALUE")],
    ["INVALID_TRUSTED_REVIEW", () => new AiFascicoloTrustedReviewValidationError()],
    ["TENANT_MISMATCH", () => new AiFascicoloReviewPersistenceError("TENANT_MISMATCH")],
    ["TENANT_CONTEXT_REQUIRED", () => new AiFascicoloReviewPersistenceError("TENANT_CONTEXT_REQUIRED")],
    ["FORBIDDEN", () => new AiFascicoloReviewPersistenceError("FORBIDDEN")],
    ["INVALID_CANONICAL_PAYLOAD", () => new AiFascicoloReviewPersistenceError("INVALID_CANONICAL_PAYLOAD")],
    ["MATERIAL_IDENTITY_CONFLICT", () => new AiFascicoloReviewPersistenceError("MATERIAL_IDENTITY_CONFLICT")],
    ["PERSISTENCE_FAILURE", () => new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE")],
  ] as const)("maps known typed error %s to code only", async (code, createError) => {
    mocks.execute.mockRejectedValue(createError());

    const result = await produceAiFascicoloTrustedReviewAction(input);

    expect(result).toEqual({ ok: false, error: { code } });
    expect(Object.keys((result as { error: object }).error)).toEqual(["code"]);
  });

  it("maps runtime construction errors through the same code-only boundary", async () => {
    mocks.createRuntime.mockImplementation(() => {
      throw new OpenAiRuntimeConfigurationError("AI_OPENAI_API_KEY");
    });

    const result = await produceAiFascicoloTrustedReviewAction(input);

    expect(result).toEqual({ ok: false, error: { code: "AI_CONFIGURATION_ERROR" } });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/AI_OPENAI_API_KEY|stack|cause|message/i);
  });

  it("rejects unknown and code-shaped errors without leaking details", async () => {
    mocks.execute.mockRejectedValue({ code: "FORBIDDEN", message: "secret provider detail" });

    const result = await produceAiFascicoloTrustedReviewAction(input);

    expect(result).toEqual({ ok: false, error: { code: "PRODUCTION_FAILURE" } });
    expect(JSON.stringify(result)).not.toMatch(/secret provider detail|stack|cause|message/i);
  });

  it("contains only transport composition and no local authority or side effects", () => {
    expect(actionSource.startsWith('"use server";')).toBe(true);
    expect(actionSource).toContain("createOpenAiFascicoloTrustedReviewProductionRuntimeFromEnv");
    expect(actionSource).toContain("service.execute(input)");
    expect(actionSource).not.toMatch(
      /@\/lib\/(?:auth|tenant-auth|prisma)|@\/server\/(?:audit|queries)|next\/cache/,
    );
    expect(actionSource).not.toMatch(
      /process\.env|getCurrentUser|getCurrentTenantContext|requireTenantAccess|revalidatePath|revalidateTag|randomUUID|\$transaction|prisma\.|fetch\(|setTimeout|Promise\.all/,
    );
  });

  it("introduces no retry, idempotency, administrative decision, or UI semantics", () => {
    expect(actionSource).not.toMatch(/\b(?:retry|idempotency|lock|mutex|formAction|redirect)\b/i);
    expect(actionSource).not.toMatch(
      /\b(?:APPROVED|DENIED|VALIDATED|COMPLIANT|NON_COMPLIANT|REVOKED|RENEWED|SANCTIONED|ADMINISTRATIVE_DECISION)\b/,
    );
  });
});