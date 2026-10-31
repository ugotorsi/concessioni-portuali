import { verifyAutomaticResearchConnectorReadiness } from "../../src/server/legal-research/automatic-research-readiness";

async function main(): Promise<void> {
  const readiness = await verifyAutomaticResearchConnectorReadiness();
  console.info(JSON.stringify(readiness, null, 2));
  if (!readiness.ready) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "CONNECTOR_READINESS_FAILED");
  process.exitCode = 1;
});
