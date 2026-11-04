// Failures that can be retried only through an explicit, audited retry permit. Storage
// coherence failures are operator configuration errors: the retry re-runs the same coherence check.
const RETRYABLE_DOCUMENT_EXTRACTION_FAILURES = new Set([
  "STORAGE_READ_FAILURE",
  "INTERNAL_EXTRACTION_FAILURE",
  "PROVIDER_MISMATCH",
  "BUCKET_MISMATCH",
]);

export function isRetryableDocumentExtractionFailure(
  failureCode: string | null | undefined,
): boolean {
  return Boolean(failureCode && RETRYABLE_DOCUMENT_EXTRACTION_FAILURES.has(failureCode));
}
