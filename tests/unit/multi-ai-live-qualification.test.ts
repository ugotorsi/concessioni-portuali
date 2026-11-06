import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getEncoding } from "js-tiktoken";
import { describe, expect, it, vi } from "vitest";

import {
  liveQualificationPreflight,
  runLiveSyntheticQualification,
} from "@/server/ai/qualification/liveSyntheticQualification";
import {
  createLiveQualificationRunStore,
  type LiveQualificationRunStore,
  type LiveQualificationStoredResult,
} from "@/server/ai/qualification/liveSyntheticQualificationStore";
import {
  assertLiveQualificationEnvironment,
  assertLiveQualificationMutationRequest,
  createLiveQualificationCsrfToken,
  verifyLiveQualificationCsrfToken,
} from "@/server/ai/qualification/liveSyntheticQualificationSecurity";
import {
  isLiveQualificationAllowedPath,
  isLiveQualificationDeployment,
  isLiveQualificationRequestAllowed,
  liveQualificationDeploymentHost,
} from "@/server/ai/qualification/liveSyntheticQualificationDeployment";

const validPayload = {
  summary: {
    text: "SYN.P1 indica 20 mq e SYN.P2 indica 30 mq.",
    basisRefs: ["SYN.P1", "SYN.P2"],
  },
  timeline: [{
    recordedAt: "2027-05-01T00:00:00.000Z",
    text: "La polizza sintetica scade il 1 maggio 2027.",
    basisRefs: ["SYN.P1"],
  }],
  recordedState: [{
    text: "Le superfici sintetiche di 20 e 30 mq sono discordanti.",
    basisRefs: ["SYN.P1", "SYN.P2"],
  }],
  signals: [{
    type: "VERIFY",
    text: "Verificare la discrepanza tra 20 e 30 mq.",
    basisRefs: ["SYN.P1", "SYN.P2"],
  }],
  investigativeQuestions: [],
  suggestedActivities: [],
  legalResearchQuestions: [],
};

function anthropicResponse(
  payload: unknown = validPayload,
  status = 200,
): Response {
  return Response.json({
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: {
      input_tokens: 800,
      output_tokens: 180,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    },
  }, { status });
}

function deepSeekResponse(payload: unknown = validPayload): Response {
  return Response.json({
    model: "deepseek-v4-pro",
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(payload) },
    }],
    usage: {
      prompt_tokens: 900,
      completion_tokens: 160,
      prompt_cache_hit_tokens: 120,
    },
  });
}

function memoryStore(): LiveQualificationRunStore & {
  values: LiveQualificationStoredResult[];
} {
  let runReserved = false;
  const providerReservations = new Set<string>();
  const values: LiveQualificationStoredResult[] = [];
  return {
    values,
    async reserveRun(value) {
      if (runReserved) return false;
      runReserved = true;
      values.push(value);
      return true;
    },
    async reserveProvider(provider) {
      if (providerReservations.has(provider)) return false;
      providerReservations.add(provider);
      return true;
    },
    async record(value) {
      values.push(value);
    },
    async read() {
      return values.at(-1) ?? null;
    },
  };
}

describe("issue #70 live synthetic qualification", () => {
  it("preflights below the authorized token and cost limits", () => {
    expect(liveQualificationPreflight()).toMatchObject({
      compatible: true,
      maximumCostUsd: 0.03524,
    });
    expect(liveQualificationPreflight().inputTokenUpperBound).toBeLessThanOrEqual(4_000);
  });

  it("runs exactly one simulated request per provider and records redacted usage", async () => {
    const anthropicTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(anthropicResponse());
    const deepSeekTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(deepSeekResponse());
    const store = memoryStore();

    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store,
      anthropicTransport,
      deepSeekTransport,
      now: () => new Date("2026-11-06T10:00:00.000Z"),
    });

    expect(result.status).toBe("PASS");
    expect(result.providers).toMatchObject([
      {
        provider: "ANTHROPIC",
        status: "PASS",
        attempted: true,
        model: "claude-sonnet-5",
        jsonValid: true,
        refsValid: true,
        usage: { inputTokens: 950, outputTokens: 180 },
      },
      {
        provider: "DEEPSEEK",
        status: "PASS",
        attempted: true,
        model: "deepseek-v4-pro",
        jsonValid: true,
        refsValid: true,
        usage: { inputTokens: 900, outputTokens: 160 },
      },
    ]);
    expect(anthropicTransport).toHaveBeenCalledOnce();
    expect(deepSeekTransport).toHaveBeenCalledOnce();
    const anthropicBody = JSON.parse(String(
      anthropicTransport.mock.calls[0]?.[1]?.body,
    )) as Record<string, unknown>;
    const deepSeekBody = JSON.parse(String(
      deepSeekTransport.mock.calls[0]?.[1]?.body,
    )) as Record<string, unknown>;
    expect(anthropicBody).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 1_000,
    });
    expect(deepSeekBody).toMatchObject({
      model: "deepseek-v4-pro",
      max_tokens: 1_000,
      stream: false,
      thinking: { type: "disabled" },
    });
    expect(JSON.stringify(anthropicBody)).toContain("SYN-001");
    expect(JSON.stringify(anthropicBody)).toContain(
      "Keep the complete JSON under 700 output tokens.",
    );
    expect(JSON.stringify(deepSeekBody)).toContain("SYN-001");
    expect(getEncoding("o200k_base").encode(JSON.stringify(validPayload)).length)
      .toBeLessThan(700);
    expect(store.values.at(-1)).toMatchObject({
      status: "PASS",
      providers: [
        { provider: "ANTHROPIC", status: "PASS" },
        { provider: "DEEPSEEK", status: "PASS" },
      ],
    });
  });

  it.each([
    {
      name: "output truncation",
      response: {
        model: "claude-sonnet-5",
        stop_reason: "max_tokens",
        content: [{ type: "text", text: "{\"summary\":" }],
      },
      expected: "OUTPUT_TRUNCATED",
      outputTokens: 1_000,
    },
    {
      name: "invalid JSON",
      response: {
        model: "claude-sonnet-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "{\"summary\":" }],
      },
      expected: "JSON_PARSE_ERROR",
      outputTokens: 120,
    },
    {
      name: "model mismatch",
      response: {
        model: "claude-unexpected",
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(validPayload) }],
      },
      expected: "MODEL_MISMATCH",
      outputTokens: 120,
    },
  ])("distinguishes Anthropic $name without retaining response content", async ({
    response,
    expected,
    outputTokens,
  }) => {
    const anthropicTransport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...response,
        usage: {
          input_tokens: 800,
          output_tokens: outputTokens,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 50,
        },
      }, { headers: { "request-id": "req_01H_safe" } }),
    );
    const deepSeekTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(deepSeekResponse());

    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store: memoryStore(),
      anthropicTransport,
      deepSeekTransport,
    });

    expect(result.providers[0]).toMatchObject({
      provider: "ANTHROPIC",
      status: "FAIL",
      attempted: true,
      usage: { inputTokens: 950, outputTokens },
      anomaly: expected,
      providerDiagnostics: {
        httpStatus: 200,
        providerCode: expected,
        providerRequestId: "req_01H_safe",
      },
    });
    expect(result.providers[0]?.estimatedCostUsd).toBeGreaterThan(0);
    expect(JSON.stringify(result.providers[0]?.providerDiagnostics))
      .not.toContain("{\"summary\":");
    expect(anthropicTransport).toHaveBeenCalledOnce();
    expect(deepSeekTransport).not.toHaveBeenCalled();
  });

  it("reports strict Zod validation separately from Anthropic protocol failures", async () => {
    const deepSeekTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(deepSeekResponse());
    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store: memoryStore(),
      anthropicTransport: vi.fn<typeof fetch>()
        .mockResolvedValue(anthropicResponse({ invalid: true })),
      deepSeekTransport,
    });

    expect(result.providers[0]).toMatchObject({
      status: "FAIL",
      anomaly: "ZOD_VALIDATION_ERROR",
      providerDiagnostics: null,
    });
    expect(deepSeekTransport).not.toHaveBeenCalled();
  });

  it("stops after the first provider error without fallback or retry", async () => {
    const anthropicTransport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { type: "overloaded_error" } }, { status: 529 }),
    );
    const deepSeekTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(deepSeekResponse());

    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store: memoryStore(),
      anthropicTransport,
      deepSeekTransport,
    });

    expect(result.status).toBe("FAIL");
    expect(result.providers).toMatchObject([
      { provider: "ANTHROPIC", status: "FAIL", attempted: true },
      { provider: "DEEPSEEK", status: "NOT_TESTED", attempted: false },
    ]);
    expect(anthropicTransport).toHaveBeenCalledOnce();
    expect(deepSeekTransport).not.toHaveBeenCalled();
  });

  it("blocks replay before any provider request", async () => {
    const store = memoryStore();
    expect(await store.reserveRun({
      authorizationId: "GH_ISSUE_70_2026_11_06_RUN_2",
      status: "RESERVED",
      updatedAt: "2026-11-06T10:00:00.000Z",
      providers: [],
      totalEstimatedCostUsd: 0,
    })).toBe(true);
    const anthropicTransport = vi.fn<typeof fetch>();
    const deepSeekTransport = vi.fn<typeof fetch>();

    await expect(runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store,
      anthropicTransport,
      deepSeekTransport,
    })).rejects.toThrow("LIVE_QUALIFICATION_ALREADY_RESERVED");
    expect(anthropicTransport).not.toHaveBeenCalled();
    expect(deepSeekTransport).not.toHaveBeenCalled();
  });

  it("allows only one concurrent run to reach each provider", async () => {
    const store = memoryStore();
    const anthropicTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(anthropicResponse());
    const deepSeekTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(deepSeekResponse());
    const run = () => runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store,
      anthropicTransport,
      deepSeekTransport,
    });

    const outcomes = await Promise.allSettled([run(), run()]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled"))
      .toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: "LIVE_QUALIFICATION_ALREADY_RESERVED",
      }),
    });
    expect(anthropicTransport).toHaveBeenCalledOnce();
    expect(deepSeekTransport).toHaveBeenCalledOnce();
  });

  it("fails closed when provider usage is absent", async () => {
    const response = Response.json({
      model: "claude-sonnet-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(validPayload) }],
    });
    const deepSeekTransport = vi.fn<typeof fetch>()
      .mockResolvedValue(deepSeekResponse());
    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store: memoryStore(),
      anthropicTransport: vi.fn<typeof fetch>().mockResolvedValue(response),
      deepSeekTransport,
    });
    expect(result.providers).toMatchObject([
      {
        provider: "ANTHROPIC",
        status: "FAIL",
        attempted: true,
        estimatedCostUsd: null,
      },
      {
        provider: "DEEPSEEK",
        status: "NOT_TESTED",
        attempted: false,
      },
    ]);
    expect(deepSeekTransport).not.toHaveBeenCalled();
  });

  it("fails semantic grounding on unknown or missing SYN references", async () => {
    const invalidPayload = {
      ...validPayload,
      summary: {
        text: "Superficie non verificabile.",
        basisRefs: ["REAL.P1"],
      },
    };
    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store: memoryStore(),
      anthropicTransport: vi.fn<typeof fetch>()
        .mockResolvedValue(anthropicResponse(invalidPayload)),
      deepSeekTransport: vi.fn<typeof fetch>()
        .mockResolvedValue(deepSeekResponse()),
    });
    expect(result.providers[0]).toMatchObject({
      status: "FAIL",
      jsonValid: true,
      refsValid: false,
      anomaly: "UNKNOWN_BASIS_REF",
    });
    expect(result.providers[1]).toMatchObject({
      status: "NOT_TESTED",
      attempted: false,
    });
  });

  it("rejects invented external authorities even when basis refs are valid", async () => {
    const invalidPayload = {
      ...validPayload,
      summary: {
        text: "La legge inventata conferma i 20 e 30 mq.",
        basisRefs: ["SYN.P1", "SYN.P2"],
      },
    };
    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        AI_DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      },
      store: memoryStore(),
      anthropicTransport: vi.fn<typeof fetch>()
        .mockResolvedValue(anthropicResponse(invalidPayload)),
      deepSeekTransport: vi.fn<typeof fetch>()
        .mockResolvedValue(deepSeekResponse()),
    });
    expect(result.providers[0]).toMatchObject({
      status: "FAIL",
      jsonValid: true,
      refsValid: true,
      anomaly: "FABRICATED_EXTERNAL_SOURCE",
    });
    expect(result.providers[1]).toMatchObject({ status: "NOT_TESTED" });
  });
});

describe("issue #70 deployment and request security", () => {
  const environment = {
    NOETRA_LIVE_QUALIFICATION_ENABLED: "true",
    NOETRA_LIVE_QUALIFICATION_AUTHORIZATION_ID:
      "GH_ISSUE_70_2026_11_06_RUN_2",
    NOETRA_LIVE_QUALIFICATION_HOST:
      "concessioni-portuali-demo-issue70.vercel.app",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
    VERCEL_DEPLOYMENT_ID: "dpl_issue70",
    VERCEL_URL:
      "concessioni-portuali-demo-generated.vercel.app",
    VERCEL_GIT_COMMIT_REF: "qualification/multi-ai-synthetic-20261105",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    NEXTAUTH_URL: "https://concessioni-portuali-demo-issue70.vercel.app",
    NEXTAUTH_SECRET: "nextauth-secret",
    AI_ANTHROPIC_API_KEY: "anthropic-secret",
    AI_DEEPSEEK_API_KEY: "deepseek-secret",
    UPSTASH_REDIS_REST_URL: "https://production-rate-limit.example.test",
    UPSTASH_REDIS_REST_TOKEN: "production-redis-secret",
    NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_READ_ONLY_TOKEN:
      "issue70-read-only-secret",
    NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_TOKEN:
      "issue70-redis-secret",
    NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_URL:
      "https://issue70-lock.example.test",
    NOETRA_LIVE_QUALIFICATION_REDIS_KV_URL:
      "rediss://issue70-lock.example.test",
    NOETRA_LIVE_QUALIFICATION_REDIS_REDIS_URL:
      "rediss://issue70-lock.example.test",
    NOETRA_LIVE_QUALIFICATION_REDIS_RESOURCE_ID: "redis_issue70_dedicated",
  };

  it("allows only the dedicated non-production alias and authorized commit", () => {
    expect(() => assertLiveQualificationEnvironment({
      env: environment,
      requestHost: "concessioni-portuali-demo-issue70.vercel.app",
    })).not.toThrow();
    expect(() => assertLiveQualificationEnvironment({
      env: { ...environment, VERCEL_GIT_COMMIT_REF: undefined },
      requestHost: "concessioni-portuali-demo-issue70.vercel.app",
    })).not.toThrow();
    expect(() => assertLiveQualificationEnvironment({
      env: environment,
      requestHost: "app.noetra.it",
    })).toThrow("LIVE_QUALIFICATION_HOST_INVALID");
    expect(() => assertLiveQualificationEnvironment({
      env: { ...environment, NEXTAUTH_URL: "https://app.noetra.it" },
      requestHost: "concessioni-portuali-demo-issue70.vercel.app",
    })).toThrow("LIVE_QUALIFICATION_CONFIGURATION_INVALID");
  });

  it("identifies only the failed environment check without exposing values", () => {
    try {
      assertLiveQualificationEnvironment({
        env: {
          ...environment,
          VERCEL_DEPLOYMENT_ID: undefined,
        },
        requestHost: "concessioni-portuali-demo-issue70.vercel.app",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "LIVE_QUALIFICATION_ENVIRONMENT_DISABLED",
        environmentCheck: "VERCEL_DEPLOYMENT_ID",
      });
      expect(JSON.stringify(error)).not.toContain("anthropic-secret");
      expect(JSON.stringify(error)).not.toContain("deepseek-secret");
      expect(JSON.stringify(error)).not.toContain("issue70-redis-secret");
    }
  });

  it("binds the harness to Vercel-generated deployment identity", () => {
    for (const [name, value, check] of [
      ["VERCEL_PROJECT_ID", "prj_other", "VERCEL_PROJECT_ID"],
      ["VERCEL_DEPLOYMENT_ID", "user-controlled", "VERCEL_DEPLOYMENT_ID"],
      [
        "VERCEL_URL",
        "concessioni-portuali-demo-issue70.vercel.app",
        "VERCEL_URL",
      ],
    ] as const) {
      try {
        assertLiveQualificationEnvironment({
          env: { ...environment, [name]: value },
          requestHost: "concessioni-portuali-demo-issue70.vercel.app",
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ environmentCheck: check });
      }
    }
  });

  it("isolates the deployment to auth and qualification paths", () => {
    expect(isLiveQualificationDeployment(environment)).toBe(true);
    expect(liveQualificationDeploymentHost(environment))
      .toBe("concessioni-portuali-demo-issue70.vercel.app");
    expect(isLiveQualificationAllowedPath("/login")).toBe(true);
    expect(isLiveQualificationAllowedPath("/api/auth/session")).toBe(true);
    expect(isLiveQualificationAllowedPath("/api/auth/mfa/enrollment")).toBe(false);
    expect(isLiveQualificationAllowedPath("/api/auth/password-recovery")).toBe(false);
    expect(isLiveQualificationAllowedPath("/admin/ai-live-qualification")).toBe(true);
    expect(isLiveQualificationAllowedPath("/api/admin/ai-live-qualification")).toBe(true);
    expect(isLiveQualificationAllowedPath("/dashboard")).toBe(false);
    expect(isLiveQualificationAllowedPath("/api/procedimenti")).toBe(false);
    expect(isLiveQualificationAllowedPath("/documenti")).toBe(false);
    expect(isLiveQualificationRequestAllowed({
      pathname: "/admin/ai-live-qualification",
      hasNextActionHeader: true,
    })).toBe(false);
    expect(isLiveQualificationRequestAllowed({
      pathname: "/admin/ai-live-qualification",
      hasNextActionHeader: false,
    })).toBe(true);
  });

  it("requires a lock resource distinct from Production coordination", () => {
    expect(() => assertLiveQualificationEnvironment({
      env: {
        ...environment,
        NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_URL:
          environment.UPSTASH_REDIS_REST_URL,
      },
      requestHost: "concessioni-portuali-demo-issue70.vercel.app",
    })).toThrow("LIVE_QUALIFICATION_CONFIGURATION_INVALID");
  });

  it("requires the complete provider-managed Upstash variable set", () => {
    for (const name of [
      "NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_READ_ONLY_TOKEN",
      "NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_TOKEN",
      "NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_URL",
      "NOETRA_LIVE_QUALIFICATION_REDIS_KV_URL",
      "NOETRA_LIVE_QUALIFICATION_REDIS_REDIS_URL",
    ]) {
      expect(() => assertLiveQualificationEnvironment({
        env: { ...environment, [name]: undefined },
        requestHost: "concessioni-portuali-demo-issue70.vercel.app",
      })).toThrow("LIVE_QUALIFICATION_CONFIGURATION_INVALID");
    }
  });

  it("keeps the harness free of application data and storage imports", () => {
    const sources = [
      "src/server/ai/qualification/liveSyntheticQualification.ts",
      "src/server/ai/qualification/liveSyntheticQualificationStore.ts",
      "src/app/api/admin/ai-live-qualification/route.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");
    for (const forbidden of [
      "@/lib/prisma",
      "@/lib/tenant-auth",
      "@/server/queries/",
      "@/server/documents/",
      "@/server/async-jobs/",
      "DATABASE_URL",
      "S3_",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("binds CSRF to actor, deployment host, cookie and expiry", () => {
    const token = createLiveQualificationCsrfToken({
      actorId: "admin-1",
      deploymentHost: "concessioni-portuali-demo-issue70.vercel.app",
      secret: "csrf-secret",
      now: new Date("2026-11-06T10:00:00.000Z"),
    });
    expect(() => verifyLiveQualificationCsrfToken({
      actorId: "admin-1",
      deploymentHost: "concessioni-portuali-demo-issue70.vercel.app",
      secret: "csrf-secret",
      headerToken: token,
      cookieToken: token,
      now: new Date("2026-11-06T10:05:00.000Z"),
    })).not.toThrow();
    expect(() => verifyLiveQualificationCsrfToken({
      actorId: "admin-2",
      deploymentHost: "concessioni-portuali-demo-issue70.vercel.app",
      secret: "csrf-secret",
      headerToken: token,
      cookieToken: token,
      now: new Date("2026-11-06T10:05:00.000Z"),
    })).toThrow("LIVE_QUALIFICATION_CSRF_INVALID");
  });

  it("accepts only same-origin JSON mutations", () => {
    const request = new Request(
      "https://concessioni-portuali-demo-issue70.vercel.app/api/admin/ai-live-qualification",
      {
        method: "POST",
        headers: {
          host: "concessioni-portuali-demo-issue70.vercel.app",
          origin: "https://concessioni-portuali-demo-issue70.vercel.app",
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
      },
    );
    expect(() => assertLiveQualificationMutationRequest(request)).not.toThrow();
    const crossOrigin = new Request(request, {
      headers: {
        host: "concessioni-portuali-demo-issue70.vercel.app",
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
    });
    expect(() => assertLiveQualificationMutationRequest(crossOrigin))
      .toThrow("LIVE_QUALIFICATION_ORIGIN_INVALID");
  });
});

describe("issue #70 distributed reservation store", () => {
  it("uses atomic SET NX keys and persists only redacted result JSON", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: "OK" }))
      .mockResolvedValueOnce(Response.json({ result: "OK" }))
      .mockResolvedValueOnce(Response.json({ result: "OK" }))
      .mockResolvedValueOnce(Response.json({
        result: JSON.stringify({
          authorizationId: "GH_ISSUE_70_2026_11_06_RUN_2",
          status: "PASS",
          updatedAt: "2026-11-06T10:00:00.000Z",
          providers: [],
          totalEstimatedCostUsd: 0.01,
        }),
      }));
    const store = createLiveQualificationRunStore({
      url: "https://redis.example.test",
      token: "redis-secret",
      transport,
    });
    const value: LiveQualificationStoredResult = {
      authorizationId: "GH_ISSUE_70_2026_11_06_RUN_2",
      status: "RESERVED",
      updatedAt: "2026-11-06T10:00:00.000Z",
      providers: [],
      totalEstimatedCostUsd: 0,
    };
    expect(await store.reserveRun(value)).toBe(true);
    expect(await store.reserveProvider("ANTHROPIC")).toBe(true);
    await store.record({ ...value, status: "PASS" });
    expect(await store.read()).toMatchObject({ status: "PASS" });
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body)))
      .toEqual(expect.arrayContaining(["SET", "NX"]));
    expect(String(transport.mock.calls[0]?.[1]?.body))
      .toContain("noetra:qualification:issue70:2026-11-06:run-2:run");
    expect(String(transport.mock.calls[0]?.[1]?.body))
      .not.toContain("noetra:qualification:issue70:2026-11-05");
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body)))
      .toEqual(expect.arrayContaining(["SET", "NX"]));
    const commandBodies = transport.mock.calls.map((call) =>
      String(call[1]?.body));
    expect(JSON.stringify(commandBodies)).not.toContain("redis-secret");
  });

  it("treats an existing reservation as a permanent replay block", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValue(Response.json({ result: null }));
    const store = createLiveQualificationRunStore({
      url: "https://redis.example.test",
      token: "redis-secret",
      transport,
    });
    expect(await store.reserveRun({
      authorizationId: "GH_ISSUE_70_2026_11_06_RUN_2",
      status: "RESERVED",
      updatedAt: "2026-11-06T10:00:00.000Z",
      providers: [],
      totalEstimatedCostUsd: 0,
    })).toBe(false);
  });
});
