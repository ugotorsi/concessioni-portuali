export function hasVerifiedDocumentFileVersion(
  currentFileVersionId: string | null | undefined,
): currentFileVersionId is string {
  return currentFileVersionId != null;
}