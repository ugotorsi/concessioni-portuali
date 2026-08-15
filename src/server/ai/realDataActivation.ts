export const AI_REAL_DATA_ACTIVATION_ENV_NAMES = [
  "AI_REAL_DATA_ENABLED",
  "AI_REAL_DATA_APPROVAL_ID",
  "AI_PROVIDER_PROJECT_CLASS",
] as const;

type RealDataActivationEnvName = (typeof AI_REAL_DATA_ACTIVATION_ENV_NAMES)[number];
export type RealDataActivationEnv = Partial<Record<RealDataActivationEnvName, string | undefined>>;

const activationPolicyBrand = Symbol("RealDataActivationPolicy");

export interface RealDataActivationPolicy {
  readonly enabled: boolean;
  readonly [activationPolicyBrand]: true;
}

export class AiRealDataActivationError extends Error {
  readonly code = "AI_REAL_DATA_DISABLED" as const;

  constructor() {
    super("AI_REAL_DATA_DISABLED");
    this.name = "AiRealDataActivationError";
  }
}

export function createRealDataActivationPolicy(env: RealDataActivationEnv): RealDataActivationPolicy {
  const approvalId = env.AI_REAL_DATA_APPROVAL_ID;
  const enabled = env.AI_REAL_DATA_ENABLED === "true"
    && typeof approvalId === "string"
    && approvalId.trim().length > 0
    && env.AI_PROVIDER_PROJECT_CLASS === "REAL_DATA_APPROVED";

  return Object.freeze({
    enabled,
    [activationPolicyBrand]: true as const,
  });
}

export function assertRealDataActivation(
  policy: RealDataActivationPolicy | undefined,
): asserts policy is RealDataActivationPolicy {
  if (!policy || policy[activationPolicyBrand] !== true || policy.enabled !== true) {
    throw new AiRealDataActivationError();
  }
}
