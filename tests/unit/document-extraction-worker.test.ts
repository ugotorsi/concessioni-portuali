import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({
  drainOneAsyncJob: vi.fn(),
}));

vi.mock("@/server/async-jobs/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/async-jobs/worker")>();
  return { ...actual, drainOneAsyncJob: worker.drainOneAsyncJob };
});

import {
  ApplicationAsyncWorkerConfigurationError,
  type ApplicationAsyncWorkerConfig,
} from "@/server/async-jobs/applicationWorkerRuntime";
import {
  assertDocumentExtractionWorkerConfig,
  documentExtractionAsyncJobRegistry,
  drainOneDocumentExtractionAsyncJob,
} from "@/server/async-jobs/documentExtractionWorker";
import { runDocumentExtractionWorkerProcess } from "@/server/async-jobs/documentExtractionWorkerProcess";
import { DOCUMENT_EXTRACTION_OPERATION } from "@/server/documents/documentExtractionAdmission";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const staticImportPattern = /\bfrom\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

function config(overrides: Partial<ApplicationAsyncWorkerConfig> = {}): ApplicationAsyncWorkerConfig {
  return {
    workerId: "document-extraction-e2e",
    concurrency: 1,
    retryDelayMs: 30_000,
    idleBackoffMs: 1_000,
    errorBackoffMs: 5_000,
    operationAllowlist: [DOCUMENT_EXTRACTION_OPERATION],
    procedimentoAllowlist: ["procedure-canary"],
    dedicatedMode: true,
    providerExecutionEnabled: false,
    ...overrides,
  };
}

function resolveLocalImport(importer: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function staticDependencyGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(staticImportPattern)) {
      const resolved = resolveLocalImport(file, match[1] ?? match[2]);
      if (resolved && !resolved.startsWith(path.join(sourceRoot, "generated"))) pending.push(resolved);
    }
  }
  return visited;
}

describe("dedicated document extraction worker", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["dedicated mode disabled", { dedicatedMode: false }],
    ["operation allowlist empty", { operationAllowlist: [] }],
    ["operation allowlist expanded", { operationAllowlist: [DOCUMENT_EXTRACTION_OPERATION, "OTHER"] }],
    ["operation allowlist different", { operationAllowlist: ["OTHER"] }],
    ["procedure allowlist empty", { procedimentoAllowlist: [] }],
    ["provider execution enabled", { providerExecutionEnabled: true }],
    ["provider execution unspecified", { providerExecutionEnabled: undefined }],
  ])("fails closed when %s", (_case, overrides) => {
    expect(() => assertDocumentExtractionWorkerConfig(config(overrides)))
      .toThrowError(expect.objectContaining<Partial<ApplicationAsyncWorkerConfigurationError>>({
        code: "INVALID_CONFIGURATION",
      }));
  });

  it("registers only document extraction and preserves both claim allowlists", async () => {
    worker.drainOneAsyncJob.mockResolvedValueOnce({ outcome: "IDLE" });

    await expect(drainOneDocumentExtractionAsyncJob({
      workerId: "document-extraction-e2e",
      retryDelayMs: 30_000,
      operationAllowlist: [DOCUMENT_EXTRACTION_OPERATION],
      procedimentoAllowlist: ["procedure-canary"],
      providerExecutionEnabled: false,
    })).resolves.toEqual({ outcome: "IDLE" });

    expect(documentExtractionAsyncJobRegistry.resolve(DOCUMENT_EXTRACTION_OPERATION)).not.toBeNull();
    expect(documentExtractionAsyncJobRegistry.resolve("FASCICOLO.AUTOMATIC_ANALYSIS_V1")).toBeNull();
    expect(documentExtractionAsyncJobRegistry.resolve("LEGAL_RESEARCH.EXECUTE_V1")).toBeNull();
    expect(worker.drainOneAsyncJob).toHaveBeenCalledWith({
      workerId: "document-extraction-e2e",
      retryDelayMs: 30_000,
      leaseDurationMs: 300_000,
      operationAllowlist: [DOCUMENT_EXTRACTION_OPERATION],
      procedimentoAllowlist: ["procedure-canary"],
      registry: documentExtractionAsyncJobRegistry,
    });
  });

  it("validates configuration before creating or running the persistent runtime", async () => {
    const createRuntime = vi.fn();
    const reportFatal = vi.fn();
    const markFailure = vi.fn();

    await runDocumentExtractionWorkerProcess({
      parseConfig: () => config({ operationAllowlist: [] }),
      createRuntime,
      reportFatal,
      markFailure,
    });

    expect(createRuntime).not.toHaveBeenCalled();
    expect(reportFatal).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
    expect(markFailure).toHaveBeenCalledOnce();
  });

  it("starts the shared runtime with the dedicated drain and no bootstrap", async () => {
    const runtime = {
      run: vi.fn(async () => undefined),
      requestShutdown: vi.fn(),
    };
    const removeSignalHandlers = vi.fn();
    const disconnect = vi.fn(async () => undefined);
    const createRuntime = vi.fn(() => runtime);

    await runDocumentExtractionWorkerProcess({
      parseConfig: () => config(),
      createRuntime,
      installSignalHandlers: () => removeSignalHandlers,
      disconnect,
      reportFatal: vi.fn(),
      markFailure: vi.fn(),
    });

    expect(createRuntime).toHaveBeenCalledWith(
      config(),
      expect.objectContaining({ drain: drainOneDocumentExtractionAsyncJob }),
    );
    expect(runtime.run).toHaveBeenCalledOnce();
    expect(removeSignalHandlers).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps the static entrypoint graph free of general application handlers", () => {
    const graph = staticDependencyGraph(path.join(
      sourceRoot,
      "server/async-jobs/documentExtractionWorkerProcess.ts",
    ));
    const relativeFiles = [...graph].map((file) => path.relative(root, file).replaceAll("\\", "/"));

    expect(relativeFiles).not.toContain("src/server/async-jobs/applicationWorker.ts");
    expect(relativeFiles.some((file) => file.startsWith("src/server/ai/"))).toBe(false);
    expect(relativeFiles.some((file) => file.startsWith("src/server/legal-research/"))).toBe(false);
    expect(relativeFiles.some((file) => file.includes("neutralIntake"))).toBe(false);
    expect(relativeFiles.some((file) => file.startsWith("src/server/fascicolo-lifecycle/"))).toBe(false);
  });

  it("loads Canvas only inside the rasterization path", () => {
    const source = readFileSync(
      path.join(sourceRoot, "server/intake/extraction/pdfAdapter.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/^import\s+.*from\s+["']@napi-rs\/canvas["'];?$/m);
    expect(source).toContain('const { createCanvas } = await import("@napi-rs/canvas");');
    expect(source.indexOf('await import("@napi-rs/canvas")'))
      .toBeGreaterThan(source.indexOf("renderPage: async"));
  });

  it("exposes a distinct persistent start command without changing staging", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(packageJson.scripts["worker:async"]).toBe(
      "tsx src/server/async-jobs/applicationWorkerProcess.ts",
    );
    expect(packageJson.scripts["worker:document-extraction"]).toBe(
      "tsx src/server/async-jobs/documentExtractionWorkerProcess.ts",
    );
    expect(packageJson.scripts["worker:document-extraction"])
      .not.toBe(packageJson.scripts["worker:document-extraction-one-shot"]);
  });
});
