import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyzeAndPersist: vi.fn(),
  createKnowledgeService: vi.fn(),
  createRuntime: vi.fn(),
  createTransport: vi.fn(),
  findProcedimento: vi.fn(),
  getTenantContext: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: {
      findUnique: mocks.findProcedimento,
    },
  },
}));
vi.mock("@/lib/tenant-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant-auth")>();
  return {
    ...actual,
    getCurrentTenantContext: mocks.getTenantContext,
  };
});
vi.mock("@/server/ai/openaiRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/openaiRuntime")>();
  return {
    ...actual,
    createOpenAiFascicoloDocumentRuntimeFromEnv: mocks.createRuntime,
  };
});
vi.mock("@/server/ai/e2eFascicoloStructuredKnowledgeGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/e2eFascicoloStructuredKnowledgeGuard")>();
  return {
    ...actual,
    createE2EFascicoloStructuredKnowledgeTransport: mocks.createTransport,
  };
});
vi.mock("@/server/ai/fascicoloDocumentStructuredKnowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/fascicoloDocumentStructuredKnowledge")>();
  return {
    ...actual,
    createFascicoloDocumentStructuredKnowledgeService: mocks.createKnowledgeService,
  };
});

import {
  analyzeFascicoloDocumentStructuredKnowledgeAction,
} from "@/server/actions/fascicolo-document-structured-knowledge";
import type { DemoRole } from "@/lib/auth";
import {
  E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH,
  E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST,
  E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH,
  E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";

function input(procedimentoId = E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID): FormData {
  const formData = new FormData();
  formData.set("procedimentoId", procedimentoId);
  return formData;
}

function tenantContext(role: DemoRole = "GIURIDICO", accessibleTenantIds = ["ente-e2e"]) {
  return {
    userId: "user-e2e",
    role,
    isAdmin: role === "ADMIN",
    tenantMemberships: [],
    defaultTenantId: accessibleTenantIds[0] ?? null,
    accessibleTenantIds,
  };
}

function enableAuthorizedEnvironment(): void {
  vi.stubEnv("E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED", "true");
  vi.stubEnv("E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED", "true");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH);
  vi.stubEnv("NEON_BRANCH_ID", E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH);
  vi.stubEnv(
    "DATABASE_URL",
    `postgresql://local-test:local-test@${E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST}/neondb`,
  );
  vi.stubEnv("AI_REAL_DATA_ENABLED", "true");
  vi.stubEnv("AI_REAL_DATA_APPROVAL_ID", "local-test-approval");
  vi.stubEnv("AI_PROVIDER_PROJECT_CLASS", "REAL_DATA_APPROVED");
  vi.stubEnv("AI_OPENAI_API_KEY", "local-test-key");
  vi.stubEnv("AI_OPENAI_PROJECT_ID", "proj_local_e2e");
  vi.stubEnv("AI_OPENAI_REGION", "EU");
  vi.stubEnv("AI_OPENAI_TIMEOUT_MS", "1000");
  vi.stubEnv("AI_OPENAI_MAX_RAW_RESPONSE_BYTES", "10000");
  vi.stubEnv("AI_OPENAI_MAX_OUTPUT_TOKENS", "1000");
  vi.stubEnv("AI_MAX_INPUT_BYTES", "10000");
}

describe("fascicolo document structured knowledge action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTenantContext.mockResolvedValue(tenantContext());
    mocks.findProcedimento.mockResolvedValue({
      id: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      enteId: "ente-e2e",
    });
    mocks.createRuntime.mockReturnValue({ analyze: vi.fn() });
    mocks.createTransport.mockReturnValue(vi.fn());
    mocks.createKnowledgeService.mockReturnValue({
      analyzeAndPersist: mocks.analyzeAndPersist,
    });
    mocks.analyzeAndPersist.mockResolvedValue({
      outcome: "REUSED",
      corpus: {},
      analysis: null,
      knowledge: {},
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("performs no provider construction or persistence while disabled", async () => {
    vi.stubEnv("E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED", "false");

    await expect(analyzeFascicoloDocumentStructuredKnowledgeAction(input()))
      .rejects.toMatchObject({
        code: "FEATURE_DISABLED",
      });

    expect(mocks.findProcedimento).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.analyzeAndPersist).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a role without procedimento write permission", async () => {
    enableAuthorizedEnvironment();
    mocks.getTenantContext.mockResolvedValue(tenantContext("TECNICO"));

    await expect(analyzeFascicoloDocumentStructuredKnowledgeAction(input()))
      .rejects.toMatchObject({
        code: "ROLE_FORBIDDEN",
      });

    expect(mocks.findProcedimento).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });

  it("rejects a different procedimento before database or provider access", async () => {
    enableAuthorizedEnvironment();

    await expect(analyzeFascicoloDocumentStructuredKnowledgeAction(input("procedimento-altro")))
      .rejects.toMatchObject({
        code: "PROCEDIMENTO_NOT_ALLOWED",
      });

    expect(mocks.findProcedimento).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant access before provider construction", async () => {
    enableAuthorizedEnvironment();
    mocks.getTenantContext.mockResolvedValue(tenantContext("GIURIDICO", ["ente-altro"]));

    await expect(analyzeFascicoloDocumentStructuredKnowledgeAction(input()))
      .rejects.toMatchObject({
        code: "TENANT_ACCESS_DENIED",
      });

    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.analyzeAndPersist).not.toHaveBeenCalled();
  });

  it("derives the tenant from the procedimento and revalidates after execution", async () => {
    enableAuthorizedEnvironment();

    await analyzeFascicoloDocumentStructuredKnowledgeAction(input());

    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.createTransport).toHaveBeenCalledWith({
      tenantId: "ente-e2e",
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      projectId: "proj_local_e2e",
      region: "EU",
    });
    expect(mocks.analyzeAndPersist).toHaveBeenCalledWith({
      tenantId: "ente-e2e",
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/procedimenti/${E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID}`,
    );
  });
});
