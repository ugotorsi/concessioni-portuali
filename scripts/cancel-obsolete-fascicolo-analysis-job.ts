import { prisma } from "@/lib/prisma";
import {
  cancelObsoleteFascicoloAnalysisJob,
  prepareObsoleteFascicoloAnalysisJobCancellation,
} from "@/server/async-jobs/persistence";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : null;
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

async function main() {
  const input = {
    jobId: argument("--job-id"),
    tenantId: argument("--tenant-id"),
    procedimentoId: argument("--procedimento-id"),
    obsoleteCorpusFingerprint: argument("--obsolete-corpus-fingerprint"),
    currentCorpusFingerprint: argument("--current-corpus-fingerprint"),
    actor: {
      userId: null,
      userEmail: null,
      userRole: argument("--actor-role"),
    },
  };
  const prepared = await prepareObsoleteFascicoloAnalysisJobCancellation(input);
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      outcome: prepared.outcome,
      jobId: input.jobId,
      mutationApplied: false,
    }));
    return;
  }
  if (argument("--confirm-job-id") !== input.jobId) {
    throw new Error("CONFIRMATION_JOB_ID_MISMATCH");
  }
  if (prepared.outcome !== "READY" && prepared.outcome !== "ALREADY_CANCELLED") {
    throw new Error(`CANCELLATION_NOT_READY:${prepared.outcome}`);
  }
  const result = await cancelObsoleteFascicoloAnalysisJob(input);
  console.log(JSON.stringify({
    mode: "APPLY",
    outcome: result.outcome,
    jobId: input.jobId,
  }));
}

main().finally(() => prisma.$disconnect());
