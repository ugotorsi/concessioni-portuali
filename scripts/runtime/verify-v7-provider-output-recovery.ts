import { randomUUID } from "node:crypto";

import {
  deleteV7ProviderOutputRecoveryArtifact,
  loadV7ProviderOutputRecoveryArtifact,
  persistV7ProviderOutputRecoveryArtifact,
} from "../../src/server/ai/v7ProviderOutputRecovery";
import { SELVARA_PILOT_AUTHORIZATION } from "../../src/server/ai/selvaraPilotAuthorization";

async function main(): Promise<void> {
  const enabledGate = [
    ["AI_REAL_DATA_ENABLED", process.env.AI_REAL_DATA_ENABLED],
    ["ASYNC_PROVIDER_EXECUTION_ENABLED", process.env.ASYNC_PROVIDER_EXECUTION_ENABLED],
    ["AUTOMATIC_RESEARCH_EXECUTION_ENABLED", process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED],
  ].find(([, value]) => value === "true");
  if (enabledGate) {
    throw new Error(`Paid/provider gate must remain OFF: ${enabledGate[0]}`);
  }
  if (process.env.DOCUMENT_WORKER_ACTIVATION_MODE !== "DISABLED") {
    throw new Error("DOCUMENT_WORKER_ACTIVATION_MODE must remain DISABLED.");
  }

  const binding = {
    jobId: `recovery-probe-${randomUUID()}`,
    tenantId: "synthetic-recovery-probe",
    procedimentoId: "synthetic-recovery-probe",
    corpusFingerprint: "f".repeat(64),
    approvalId: SELVARA_PILOT_AUTHORIZATION.approvalId,
  };
  const output = {
    probe: "NOETRA_V7_PROVIDER_OUTPUT_RECOVERY_PROBE",
    facts: [{ localId: "synthetic-fact", basisRefs: ["SYNTHETIC.PAGE_1"] }],
  };
  const artifact = await persistV7ProviderOutputRecoveryArtifact({ binding, output });
  try {
    const recovered = await loadV7ProviderOutputRecoveryArtifact({ binding });
    if (JSON.stringify(recovered.output) !== JSON.stringify(output)) {
      throw new Error("Recovered payload does not match the protected input.");
    }
    if (recovered.outputFingerprint !== artifact.outputFingerprint) {
      throw new Error("Recovered fingerprint does not match the protected input.");
    }
    console.info(JSON.stringify({
      outcome: "RECOVERY_PROBE_SUCCEEDED",
      storageBackend: "neon",
      encryptedAtRestByApplication: true,
      outputFingerprint: artifact.outputFingerprint,
      sizeBytes: artifact.sizeBytes,
      paidProviderCalled: false,
    }, null, 2));
  } finally {
    await deleteV7ProviderOutputRecoveryArtifact({ binding });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "UNKNOWN_RECOVERY_PROBE_ERROR");
  process.exitCode = 1;
});
