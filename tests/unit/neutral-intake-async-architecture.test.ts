import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const wiring = [
  "src/server/intake/createNeutralIntake.ts",
  "src/server/intake/neutralIntakeExtractionJob.ts",
  "src/server/intake/neutralIntakeClassificationJob.ts",
  "src/server/intake/neutralIntakeLegalReferenceDiscoveryJob.ts",
  "src/server/async-jobs/applicationWorker.ts",
].map((file) => readFileSync(resolve(root, file), "utf8")).join("\n");
const genericCore = ["domain.ts", "persistence.ts", "registry.ts", "worker.ts"]
  .map((file) => readFileSync(resolve(root, "src/server/async-jobs", file), "utf8"))
  .join("\n");

describe("B2C9 Block 3B.2C async extraction architecture", () => {
  it("keeps NeutralIntake workload registration outside the generic async core", () => {
    expect(genericCore).not.toMatch(/@\/server\/intake|neutralIntakeExtraction/i);
    expect(wiring).toContain("new AsyncJobHandlerRegistry");
    expect(wiring).toContain("NEUTRAL_INTAKE_EXTRACTION_V1");
    expect(wiring).toContain("5 * 60 * 1_000");
    expect(wiring).toContain("EXTRACTION_HEARTBEAT_INTERVAL_MS = 60_000");
  });

  it("reuses the existing extractor without implementing PDF or OCR logic", () => {
    expect(wiring).toContain("extractNeutralIntake");
    expect(wiring).not.toMatch(/tesseract|pdfjs|recognize\(|renderPage\(/i);
  });

  it("coexists with local classification on the same post-extraction worker", () => {
    expect(wiring).toContain("NEUTRAL_INTAKE_CLASSIFICATION_V1");
    expect(wiring).toContain("LEGAL_REFERENCE_DISCOVERY_V1");
    expect(wiring).toContain("classifyNeutralIntakeInTransaction");
    expect(wiring).not.toMatch(/openai|AiOutboundAnalysisProvider|fascicoloOutboundProjection|simpliciter/i);
    expect(wiring).not.toMatch(/LegalSource|Case Guardian|CaseGuardian/);
    expect(wiring).not.toMatch(/status:\s*["']ROUTED["']/);
    expect(wiring).not.toMatch(/new (?:Queue|Worker|Scheduler|Orchestrator)/);
  });
});