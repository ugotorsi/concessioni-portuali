export function isRealDataDeploymentAuthorized(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const approvalId = environment.AI_REAL_DATA_APPROVAL_ID;
  return typeof approvalId === "string"
    && approvalId.trim().length > 0
    && environment.AI_PROVIDER_PROJECT_CLASS === "REAL_DATA_APPROVED";
}
