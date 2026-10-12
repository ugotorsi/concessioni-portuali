import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const importPattern = /\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

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

function dependencyGraph(entry: string) {
  const visited = new Set<string>();
  const externalImports = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      const resolved = resolveLocalImport(file, specifier);
      if (resolved && !resolved.startsWith(path.join(sourceRoot, "generated"))) {
        pending.push(resolved);
      } else {
        externalImports.add(specifier);
      }
    }
  }

  return { visited, externalImports };
}

describe("document extraction admission boundary", () => {
  it("keeps the HTTP upload graph free of extraction runtime and native/OCR packages", () => {
    const graph = dependencyGraph(path.join(sourceRoot, "server/documents/uploadService.ts"));
    const relativeFiles = [...graph.visited].map((file) => path.relative(root, file).replaceAll("\\", "/"));

    expect(relativeFiles).not.toContain("src/server/documents/documentExtraction.ts");
    expect(relativeFiles).not.toContain("src/server/documents/documentExtractionJob.ts");
    expect(relativeFiles).not.toContain("src/server/intake/extraction/technicalExtractor.ts");
    expect(relativeFiles).not.toContain("src/server/intake/extraction/pdfAdapter.ts");
    expect([...graph.externalImports]).not.toContain("@napi-rs/canvas");
    expect([...graph.externalImports]).not.toContain("tesseract.js");
    expect([...graph.externalImports]).not.toContain("@tesseract.js-data/ita");
  });
});
