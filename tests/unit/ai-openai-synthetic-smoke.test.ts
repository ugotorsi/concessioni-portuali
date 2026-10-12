import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AiProviderAdapterError } from "@/server/ai/providerErrors";
import type { AiAnalysisProvider, ProviderAnalysisPayloadV1 } from "@/server/ai/fascicoloAnalysis";
import {
  createSyntheticFascicoloSnapshot,
  formatSyntheticSmokeResult,
  runOpenAiSyntheticSmoke,
} from "../../scripts/ai/openai-synthetic-smoke";

const SECRET = "sk-smoke-DO-NOT-LEAK";
const RAW_PROVIDER_SENTINEL = "RAW_PROVIDER_BODY_DO_NOT_LEAK";

function env() {
  return {
    AI_OPENAI_API_KEY: SECRET,
    AI_OPENAI_REGION: "GLOBAL",
    AI_OPENAI_TIMEOUT_MS: "45000",
    AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "262144",
    AI_OPENAI_MAX_OUTPUT_TOKENS: "8192",
    AI_MAX_INPUT_BYTES: "262144",
  } as const;
}

function validPayload(): ProviderAnalysisPayloadV1 {
  return {
    summary: {
      text: "Sintesi tecnica sintetica che non deve essere stampata integralmente.",
      basisRefs: ["identityContext.procedimentoId"],
    },
    timeline: [{
      recordedAt: "2026-01-10T09:00:00.000Z",
      text: "Evento sintetico registrato.",
      basisRefs: ["procedimento.dataAvvio"],
    }],
    recordedState: [{
      text: "Stato sintetico registrato.",
      basisRefs: ["procedimento.stato"],
    }],
    signals: [{
      type: "INFO",
      text: "Segnale sintetico neutro.",
      basisRefs: ["fascicoloObservations.0.id"],
    }],
    investigativeQuestions: [{
      text: "Verificare il dato sintetico.",
      basisRefs: ["requirements.0.id"],
    }],
    suggestedActivities: [{
      text: "Riesaminare il metadato sintetico.",
      basisRefs: ["documents.0.id"],
    }],
    legalResearchQuestions: [],
  };
}

function providerFactory(output: unknown = validPayload()) {
  const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockResolvedValue(output);
  const factory = vi.fn(() => ({ analyze } satisfies AiAnalysisProvider));
  return { factory, analyze };
}

function sourceText() {
  return readFileSync(resolve(process.cwd(), "scripts/ai/openai-synthetic-smoke.ts"), "utf8");
}

function repositorySource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("AI-01B2B2 synthetic OpenAI smoke harness", () => {
  it("imports without executing smoke or constructing a provider", () => {
    const { factory, analyze } = providerFactory();
    expect(factory).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(sourceText()).toContain("if (directlyInvoked)");
  });

  it("imports in a child process without DATABASE_URL or AI env and does not execute smoke", () => {
    const childEnv = { ...process.env };
    for (const envName of [
      "DATABASE_URL",
      "AI_OPENAI_API_KEY",
      "AI_OPENAI_REGION",
      "AI_OPENAI_TIMEOUT_MS",
      "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
      "AI_OPENAI_MAX_OUTPUT_TOKENS",
      "AI_MAX_INPUT_BYTES",
    ]) {
      delete childEnv[envName];
    }
    const harnessUrl = pathToFileURL(resolve(process.cwd(), "scripts/ai/openai-synthetic-smoke.ts")).href;
    const child = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "--eval",
      `import(${JSON.stringify(harnessUrl)}).then(() => process.stdout.write("SYNTHETIC_HARNESS_IMPORT_OK"))`,
    ], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: "utf8",
    });
    expect(child.status).toBe(0);
    expect(child.stdout).toBe("SYNTHETIC_HARNESS_IMPORT_OK");
    expect(child.stderr).toBe("");
  });

  it("constructs a small unmistakably synthetic snapshot without real-data markers", () => {
    const snapshot = createSyntheticFascicoloSnapshot();
    const serialized = JSON.stringify(snapshot);
    for (const marker of [
      "SYNTHETIC-PROCEDIMENTO-001",
      "SYNTHETIC-ENTE-001",
      "CONCESSIONARIO TEST SINTETICO",
      "DOCUMENTO-SINTETICO.pdf",
      "SYNTHETIC-REQUIREMENT-001",
    ]) {
      expect(serialized).toContain(marker);
    }
    expect(serialized).not.toContain("@");
    expect(snapshot.metadata.schemaVersion).toBe("ai-fascicolo-snapshot/v1");
    expect(snapshot.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.byteLength(JSON.stringify(snapshot.content), "utf8")).toBeLessThan(262144);
  });

  it("produces a safe PASS summary after exactly one validated provider call", async () => {
    const { factory, analyze } = providerFactory();
    const result = await runOpenAiSyntheticSmoke({
      env: env(),
      providerFactory: factory,
      now: () => 100,
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: SECRET,
      region: "GLOBAL",
      timeoutMs: 45000,
      maxRawResponseBytes: 262144,
      maxOutputTokens: 8192,
    }));
    expect(analyze).toHaveBeenCalledOnce();
    if (!result.ok) {
      throw new Error("Expected successful smoke result");
    }
    const snapshot = createSyntheticFascicoloSnapshot();
    expect(result.summary).toMatchObject({
      SMOKE_STATUS: "PASS",
      provider: "OpenAI",
      model: "gpt-5.6-terra",
      region: "GLOBAL",
      snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
      snapshotContentHash: snapshot.metadata.contentHash,
      analysisSchemaVersion: "ai-fascicolo-analysis/v1",
      summaryItems: 1,
      timelineItems: 1,
      signalItems: 1,
      questionItems: 1,
      activityItems: 1,
      mandatoryLimitationsCount: 7,
      FORBIDDEN_STRUCTURAL_FIELDS_PRESENT: "NO",
    });
  });

  it("maps invalid provider output to a deterministic sanitized failure", async () => {
    const { factory, analyze } = providerFactory({ summary: "invalid" });
    const result = await runOpenAiSyntheticSmoke({ env: env(), providerFactory: factory });
    expect(result).toEqual({
      ok: false,
      exitCode: 1,
      summary: { SMOKE_STATUS: "FAIL", errorCategory: "INVALID_PROVIDER_OUTPUT" },
    });
    expect(analyze).toHaveBeenCalledOnce();
  });

  it.each([
    ["TIMEOUT", "AI_PROVIDER_TIMEOUT"],
    ["RATE_LIMITED", "AI_PROVIDER_RATE_LIMITED"],
    ["UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE"],
    ["CONFIGURATION", "AI_CONFIGURATION_ERROR"],
  ] as const)("maps normalized %s failure to sanitized %s", async (category, expected) => {
    const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockRejectedValue(new AiProviderAdapterError(category));
    const result = await runOpenAiSyntheticSmoke({
      env: env(),
      providerFactory: () => ({ analyze }),
    });
    expect(result).toEqual({
      ok: false,
      exitCode: 1,
      summary: { SMOKE_STATUS: "FAIL", errorCategory: expected },
    });
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("sanitizes unexpected failures and never emits raw provider details", async () => {
    const analyze = vi.fn<AiAnalysisProvider["analyze"]>()
      .mockRejectedValue(new Error(`${RAW_PROVIDER_SENTINEL} ${SECRET}`));
    const result = await runOpenAiSyntheticSmoke({
      env: env(),
      providerFactory: () => ({ analyze }),
    });
    const output = formatSyntheticSmokeResult(result);
    expect(result.exitCode).toBe(1);
    expect(output).toBe("SMOKE_STATUS=FAIL\nerrorCategory=UNEXPECTED_SMOKE_FAILURE");
    expect(output).not.toContain(RAW_PROVIDER_SENTINEL);
    expect(output).not.toContain(SECRET);
  });

  it("prints only the technical allowlist and never full snapshot or analysis text", async () => {
    const { factory } = providerFactory();
    const result = await runOpenAiSyntheticSmoke({ env: env(), providerFactory: factory, now: () => 5 });
    const output = formatSyntheticSmokeResult(result);
    for (const safeKey of [
      "SMOKE_STATUS",
      "provider",
      "model",
      "region",
      "snapshotSchemaVersion",
      "snapshotContentHash",
      "analysisSchemaVersion",
      "summaryItems",
      "timelineItems",
      "signalItems",
      "questionItems",
      "activityItems",
      "mandatoryLimitationsCount",
      "elapsedMs",
      "FORBIDDEN_STRUCTURAL_FIELDS_PRESENT",
    ]) {
      expect(output).toContain(`${safeKey}=`);
    }
    for (const forbidden of [
      "SYNTHETIC-PROCEDIMENTO-001",
      "DOCUMENTO-SINTETICO.pdf",
      "Sintesi tecnica sintetica che non deve essere stampata integralmente.",
      SECRET,
      RAW_PROVIDER_SENTINEL,
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it("fails configuration without constructing or invoking a provider", async () => {
    const { AI_OPENAI_API_KEY: _removed, ...missingKey } = env();
    const { factory, analyze } = providerFactory();
    const result = await runOpenAiSyntheticSmoke({ env: missingKey, providerFactory: factory });
    expect(result).toEqual({
      ok: false,
      exitCode: 1,
      summary: { SMOKE_STATUS: "FAIL", errorCategory: "AI_CONFIGURATION_ERROR" },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("contains no DB, storage, auth, route, UI, env-file, or automatic invocation boundary", () => {
    const source = sourceText();
    for (const forbidden of [
      "@/lib/prisma",
      "tenant-auth",
      "@/lib/auth",
      "buildAiFascicoloSnapshotV1",
      "storageKey",
      "readFile",
      "vercel env pull",
      "src/app/api",
      "route.ts",
      "server action",
      "console.log",
      "console.error",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/["'`](?:\.env|\.env\.local|\.vercel\/\.env)/);
    expect(source).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    expect(source).toMatch(/if \(directlyInvoked\) \{\s+void runCli\(\);\s+\}/);
  });

  it("keeps harness, AI-01A, and OpenAI provider on pure runtime import boundaries", () => {
    const harness = sourceText();
    const analysis = repositorySource("src/server/ai/fascicoloAnalysis.ts");
    const provider = repositorySource("src/server/ai/providers/openai.ts");
    const snapshotContract = repositorySource("src/server/ai/fascicoloSnapshotContract.ts");
    const providerErrors = repositorySource("src/server/ai/providerErrors.ts");
    const snapshot = repositorySource("src/server/ai/fascicoloSnapshot.ts");
    const liveAnalysis = repositorySource("src/server/ai/fascicoloLiveAnalysis.ts");

    expect(harness).not.toContain("@/server/ai/fascicoloLiveAnalysis");
    expect(harness).toContain("@/server/ai/providerErrors");
    expect(provider).not.toContain("@/server/ai/fascicoloLiveAnalysis");
    expect(provider).toContain("@/server/ai/providerErrors");
    expect(analysis).toContain("@/server/ai/fascicoloSnapshotContract");
    expect(analysis).toContain("import type { buildAiFascicoloSnapshotV1 }");
    expect(snapshotContract).not.toMatch(/^import /m);
    expect(providerErrors).not.toMatch(/^import /m);
    expect(snapshot).toContain("export { AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION }");
    expect(liveAnalysis).toContain("export { AiProviderAdapterError }");
    expect(liveAnalysis).toContain("buildAiFascicoloSnapshotV1");
  });
});
