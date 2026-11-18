import { runDocumentExtractionJobById } from "@/server/documents/documentExtractionJob";

async function main(): Promise<void> {
  const jobId = process.env.DOCUMENT_EXTRACTION_JOB_ID?.trim();
  if (!jobId) {
    throw new Error("DOCUMENT_EXTRACTION_JOB_ID_REQUIRED");
  }

  const result = await runDocumentExtractionJobById({ jobId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "UNKNOWN_RUNNER_ERROR";

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
