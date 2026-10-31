import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { legalRulePackManifestSchema } from "../../src/server/legal-rules/manifest";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const packDirectory = path.resolve(process.cwd(), "data", "legal-rule-packs", "adsp-mtc");
  const manifestPath = path.join(packDirectory, "manifest.json");
  const manifest = legalRulePackManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const sourceInventory = await Promise.all(
    manifest.sources.map(async (source) => ({
      stableKey: source.stableKey,
      relativePath: source.relativePath,
      status: source.status,
      sourceOrigin: source.sourceOrigin,
      binaryAvailable: await fileExists(path.join(packDirectory, source.relativePath)),
    })),
  );
  const missingSources = sourceInventory.filter((source) => !source.binaryAvailable);

  console.log(JSON.stringify({
    packCode: manifest.packCode,
    packVersion: manifest.packVersion,
    metadataSources: manifest.sources.length,
    binarySourcesAvailable: sourceInventory.length - missingSources.length,
    binarySourcesMissing: missingSources.length,
    missingSources,
    declaredGaps: manifest.gaps.map((gap) => ({
      gapKey: gap.gapKey,
      title: gap.title,
      severity: gap.severity,
      status: gap.status,
      requiredDocumentTypes: gap.requiredDocumentTypes,
    })),
    declaredDuplicates: manifest.duplicates.length,
    completeLocalCorpus: missingSources.length === 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
