export const SELVARA_PILOT_AUTHORIZATION = Object.freeze({
  approvalId: "NOETRA-V3-SELVARA-2026-10-25-ONE-SHOT",
  tenantId: "cmrzd08yp000dqwudd9dvaidl",
  procedimentoId: "procedimento-intake-9e04f4d4cdbf092845b57c66",
  corpusFingerprint: "c9f04d508174cba8e7939704da11921963c60656660df988ee4cb5fdd25cdd5f",
  purpose: "FASCICOLO_EXISTING_CORPUS_ANALYSIS",
  operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
} as const);

export interface SelvaraPilotAuthorizationScope {
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly corpusFingerprint: string;
  readonly purpose: string;
  readonly operation: string;
}

export class SelvaraPilotAuthorizationError extends Error {
  readonly code = "SELVARA_PILOT_AUTHORIZATION_MISMATCH" as const;

  constructor() {
    super("SELVARA_PILOT_AUTHORIZATION_MISMATCH");
    this.name = "SelvaraPilotAuthorizationError";
  }
}

export function isSelvaraPilotApprovalId(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.AI_REAL_DATA_APPROVAL_ID?.trim()
    === SELVARA_PILOT_AUTHORIZATION.approvalId;
}

export function assertSelvaraPilotAuthorization(
  environment: Readonly<Record<string, string | undefined>>,
  scope: SelvaraPilotAuthorizationScope | undefined,
): void {
  if (!isSelvaraPilotApprovalId(environment)) {
    throw new SelvaraPilotAuthorizationError();
  }
  if (
    !scope
    || scope.tenantId !== SELVARA_PILOT_AUTHORIZATION.tenantId
    || scope.procedimentoId !== SELVARA_PILOT_AUTHORIZATION.procedimentoId
    || scope.corpusFingerprint !== SELVARA_PILOT_AUTHORIZATION.corpusFingerprint
    || scope.purpose !== SELVARA_PILOT_AUTHORIZATION.purpose
    || scope.operation !== SELVARA_PILOT_AUTHORIZATION.operation
  ) {
    throw new SelvaraPilotAuthorizationError();
  }
}

export function assertSelvaraPilotScopeForConfiguredApproval(
  environment: Readonly<Record<string, string | undefined>>,
  scope: SelvaraPilotAuthorizationScope | undefined,
): void {
  if (isSelvaraPilotApprovalId(environment)) {
    assertSelvaraPilotAuthorization(environment, scope);
  }
}
