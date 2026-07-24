import "dotenv/config";
import path from "node:path";

import { importLegalRulePack } from "../importer";

async function main() {
  const manifestPath = path.resolve(process.cwd(), "data", "legal-rule-packs", "adsp-mtc", "manifest.json");
  const result = await importLegalRulePack(manifestPath);

  console.log("[legal-import] runId:", result.runId);
  console.log("[legal-import] status:", result.status);
  console.log("[legal-import] sources:", result.sourceCount);
  console.log("[legal-import] rules:", result.ruleCount);
  console.log("[legal-import] relations:", result.relationCount);
  console.log("[legal-import] gaps:", result.gapCount);
  console.log("[legal-import] summary:", JSON.stringify(result.summary));

  if (result.warnings.length > 0) {
    console.log("[legal-import] warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main().catch((error) => {
  console.error("[legal-import] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
