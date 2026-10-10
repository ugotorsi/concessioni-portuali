import { runDocumentExtractionJobById } from "@/server/documents/documentExtractionJob";

const jobId = process.env.DOCUMENT_EXTRACTION_JOB_ID?.trim();
if (!jobId) {
  throw new Error("DOCUMENT_EXTRACTION_JOB_ID_REQUIRED");
}

const result = await runDocumentExtractionJobById({ jobId });
process.stdout.write(`${JSON.stringify(result)}\n`);
