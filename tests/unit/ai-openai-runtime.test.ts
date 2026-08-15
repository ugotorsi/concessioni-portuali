import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const createProviderMock = vi.hoisted(() => vi.fn());
const createServiceMock = vi.hoisted(() => vi.fn());
const providerAnalyzeMock = vi.hoisted(() => vi.fn());
const serviceAnalyzeMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/ai/providers/openai", () => ({
  createOpenAiAnalysisProvider: createProviderMock,
}));
vi.mock("@/server/ai/fascicoloLiveAnalysis", () => ({
  createFascicoloLiveAnalysisService: createServiceMock,
}));

import {
  AI_OPENAI_RUNTIME_ENV_NAMES,
  OpenAiRuntimeConfigurationError,
  createOpenAiFascicoloRuntimeFromEnv,
  type OpenAiRuntimeEnv,
} from "@/server/ai/openaiRuntime";
import type { OpenAiFetch } from "@/server/ai/providers/openai";

const SECRET = "sk-runtime-DO-NOT-LEAK";

function validEnv(overrides: Partial<OpenAiRuntimeEnv> = {}): OpenAiRuntimeEnv {
  return {
    AI_OPENAI_API_KEY: SECRET,
    AI_OPENAI_REGION: "GLOBAL",
    AI_OPENAI_TIMEOUT_MS: "45000",
    AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "262144",
    AI_OPENAI_MAX_OUTPUT_TOKENS: "8192",
    AI_MAX_INPUT_BYTES: "262144",
    ...overrides,
  };
}

function fakeTransport(): ReturnType<typeof vi.fn<OpenAiFetch>> {
  return vi.fn<OpenAiFetch>();
}

function expectConfigurationError(operation: () => unknown, envName: string) {
  try {
    operation();
    throw new Error("Expected configuration failure");
  } catch (error) {
    expect(error).toBeInstanceOf(OpenAiRuntimeConfigurationError);
    expect((error as OpenAiRuntimeConfigurationError).code).toBe("AI_CONFIGURATION_ERROR");
    expect((error as OpenAiRuntimeConfigurationError).envName).toBe(envName);
    expect((error as Error).message).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
  }
}

function sourceText() {
  return readFileSync(resolve(process.cwd(), "src/server/ai/openaiRuntime.ts"), "utf8");
}

describe("AI-01B2B1 OpenAI runtime wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createProviderMock.mockReturnValue({ analyze: providerAnalyzeMock });
    createServiceMock.mockReturnValue({ analyze: serviceAnalyzeMock });
  });

  it("imports without reading env, creating a provider, or composing a service", () => {
    expect(AI_OPENAI_RUNTIME_ENV_NAMES).toEqual([
      "AI_OPENAI_API_KEY",
      "AI_OPENAI_REGION",
      "AI_OPENAI_TIMEOUT_MS",
      "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
      "AI_OPENAI_MAX_OUTPUT_TOKENS",
      "AI_MAX_INPUT_BYTES",
    ]);
    expect(createProviderMock).not.toHaveBeenCalled();
    expect(createServiceMock).not.toHaveBeenCalled();
    expect(providerAnalyzeMock).not.toHaveBeenCalled();
    expect(serviceAnalyzeMock).not.toHaveBeenCalled();
  });

  it("parses complete GLOBAL configuration and composes provider plus B1 service", () => {
    const transport = fakeTransport();
    const runtime = createOpenAiFascicoloRuntimeFromEnv(validEnv(), { transport });
    expect(createProviderMock).toHaveBeenCalledOnce();
    expect(createProviderMock).toHaveBeenCalledWith({
      apiKey: SECRET,
      region: "GLOBAL",
      timeoutMs: 45000,
      maxRawResponseBytes: 262144,
      maxOutputTokens: 8192,
      transport,
    });
    expect(createServiceMock).toHaveBeenCalledOnce();
    expect(createServiceMock).toHaveBeenCalledWith({
      provider: { analyze: providerAnalyzeMock },
      maxInputBytes: 262144,
    });
    expect(runtime).toEqual({ analyze: serviceAnalyzeMock });
    expect(transport).not.toHaveBeenCalled();
    expect(serviceAnalyzeMock).not.toHaveBeenCalled();
  });

  it("accepts EU structurally without claiming runtime eligibility", () => {
    const transport = fakeTransport();
    createOpenAiFascicoloRuntimeFromEnv(validEnv({ AI_OPENAI_REGION: "EU" }), { transport });
    expect(createProviderMock).toHaveBeenCalledWith(expect.objectContaining({ region: "EU" }));
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects invalid region and lowercase coercion", () => {
    for (const region of ["global", "eu", "CUSTOM", ""] ) {
      expectConfigurationError(
        () => createOpenAiFascicoloRuntimeFromEnv(validEnv({ AI_OPENAI_REGION: region })),
        "AI_OPENAI_REGION",
      );
    }
  });

  it("requires every exact environment variable individually", () => {
    for (const envName of AI_OPENAI_RUNTIME_ENV_NAMES) {
      const env = validEnv();
      delete env[envName];
      expectConfigurationError(() => createOpenAiFascicoloRuntimeFromEnv(env), envName);
      expect(createProviderMock).not.toHaveBeenCalled();
      expect(createServiceMock).not.toHaveBeenCalled();
    }
  });

  it("does not accept OPENAI_API_KEY or NEXT_PUBLIC aliases", () => {
    const withoutExactKey = validEnv();
    delete withoutExactKey.AI_OPENAI_API_KEY;
    const envWithAliases = {
      ...withoutExactKey,
      OPENAI_API_KEY: SECRET,
      NEXT_PUBLIC_OPENAI_API_KEY: SECRET,
    } as OpenAiRuntimeEnv & Record<string, string>;
    expectConfigurationError(
      () => createOpenAiFascicoloRuntimeFromEnv(envWithAliases),
      "AI_OPENAI_API_KEY",
    );
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("trims the API key but never leaks it through configuration failures", () => {
    const transport = fakeTransport();
    createOpenAiFascicoloRuntimeFromEnv(validEnv({ AI_OPENAI_API_KEY: `  ${SECRET}  ` }), { transport });
    expect(createProviderMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: SECRET }));

    const invalid = validEnv({
      AI_OPENAI_API_KEY: SECRET,
      AI_OPENAI_TIMEOUT_MS: "invalid",
    });
    expectConfigurationError(
      () => createOpenAiFascicoloRuntimeFromEnv(invalid),
      "AI_OPENAI_TIMEOUT_MS",
    );
  });

  it("rejects non-canonical numeric environment values for every numeric setting", () => {
    const numericNames = [
      "AI_OPENAI_TIMEOUT_MS",
      "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
      "AI_OPENAI_MAX_OUTPUT_TOKENS",
      "AI_MAX_INPUT_BYTES",
    ] as const;
    const unsafe = String(Number.MAX_SAFE_INTEGER + 1);
    for (const envName of numericNames) {
      for (const value of ["", " ", "0", "-1", "+1", "1.5", "1e3", "0x100", "Infinity", "NaN", "45000abc", unsafe]) {
        expectConfigurationError(
          () => createOpenAiFascicoloRuntimeFromEnv(validEnv({ [envName]: value })),
          envName,
        );
      }
    }
    expect(createProviderMock).not.toHaveBeenCalled();
    expect(createServiceMock).not.toHaveBeenCalled();
  });

  it("intentionally trims surrounding whitespace before strict numeric validation", () => {
    const transport = fakeTransport();
    createOpenAiFascicoloRuntimeFromEnv(validEnv({
      AI_OPENAI_TIMEOUT_MS: " 45000 ",
      AI_OPENAI_MAX_RAW_RESPONSE_BYTES: " 262144 ",
      AI_OPENAI_MAX_OUTPUT_TOKENS: " 8192 ",
      AI_MAX_INPUT_BYTES: " 262144 ",
    }), { transport });
    expect(createProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 45000,
      maxRawResponseBytes: 262144,
      maxOutputTokens: 8192,
    }));
    expect(createServiceMock).toHaveBeenCalledWith(expect.objectContaining({ maxInputBytes: 262144 }));
  });

  it("contains no top-level env read, alias, logging, route, persistence, or automatic analysis", () => {
    const source = sourceText();
    expect(source.match(/process\.env/g)).toHaveLength(1);
    expect(source).toContain("env: OpenAiRuntimeEnv = process.env as unknown as OpenAiRuntimeEnv");
    const factoryIndex = source.indexOf("export function createOpenAiFascicoloRuntimeFromEnv");
    expect(source.indexOf("process.env")).toBeGreaterThan(factoryIndex);
    expect(source).not.toMatch(/(?<!AI_)OPENAI_API_KEY/);
    for (const forbidden of [
      "NEXT_PUBLIC_",
      "console.log",
      "console.error",
      "@/lib/prisma",
      "storageKey",
      "Simpliciter",
      "revalidatePath",
      "server/actions",
      "readFile",
      ".analyze(\"",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
