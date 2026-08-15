import { describe, expect, it } from "vitest";

import {
  AI_REAL_DATA_ACTIVATION_ENV_NAMES,
  AiRealDataActivationError,
  assertRealDataActivation,
  createRealDataActivationPolicy,
  type RealDataActivationEnv,
} from "@/server/ai/realDataActivation";

const APPROVAL_SENTINEL = "APPROVAL-SECRET-DO-NOT-LEAK";
const API_KEY_SENTINEL = "sk-DO-NOT-ENABLE-OR-LEAK";

function enabledEnv(overrides: Partial<RealDataActivationEnv> = {}): RealDataActivationEnv {
  return {
    AI_REAL_DATA_ENABLED: "true",
    AI_REAL_DATA_APPROVAL_ID: APPROVAL_SENTINEL,
    AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
    ...overrides,
  };
}

function expectDisabled(env: RealDataActivationEnv) {
  const policy = createRealDataActivationPolicy(env);
  expect(policy.enabled).toBe(false);
  expect(() => assertRealDataActivation(policy)).toThrowError(
    expect.objectContaining({ code: "AI_REAL_DATA_DISABLED" }),
  );
  try {
    assertRealDataActivation(policy);
  } catch (error) {
    expect(error).toBeInstanceOf(AiRealDataActivationError);
    expect((error as Error).message).toBe("AI_REAL_DATA_DISABLED");
    expect((error as Error).message).not.toContain(APPROVAL_SENTINEL);
    expect(JSON.stringify(error)).not.toContain(APPROVAL_SENTINEL);
    expect(JSON.stringify(error)).not.toContain(API_KEY_SENTINEL);
  }
}

describe("AI-01C1 real-data activation policy", () => {
  it("uses exactly the three canonical activation environment names", () => {
    expect(AI_REAL_DATA_ACTIVATION_ENV_NAMES).toEqual([
      "AI_REAL_DATA_ENABLED",
      "AI_REAL_DATA_APPROVAL_ID",
      "AI_PROVIDER_PROJECT_CLASS",
    ]);
  });

  it("enables only when all three exact conditions are satisfied", () => {
    const policy = createRealDataActivationPolicy(enabledEnv({
      AI_REAL_DATA_APPROVAL_ID: `  ${APPROVAL_SENTINEL}  `,
    }));
    expect(policy.enabled).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => assertRealDataActivation(policy)).not.toThrow();
    expect(policy).not.toHaveProperty("approvalId");
  });

  it("fails closed when each required value is missing", () => {
    for (const envName of AI_REAL_DATA_ACTIVATION_ENV_NAMES) {
      const env = enabledEnv();
      delete env[envName];
      expectDisabled(env);
    }
  });

  it("rejects every truthy-like or disabled variant except exact lowercase true", () => {
    for (const value of ["TRUE", "True", "1", "yes", "on", "enabled", "false", "0", "", " "]) {
      expectDisabled(enabledEnv({ AI_REAL_DATA_ENABLED: value }));
    }
  });

  it("requires exact REAL_DATA_APPROVED project class", () => {
    for (const value of ["real_data_approved", "REAL", "GLOBAL", "EU", "SYNTHETIC", "", " "]) {
      expectDisabled(enabledEnv({ AI_PROVIDER_PROJECT_CLASS: value }));
    }
  });

  it("rejects empty or whitespace approval references", () => {
    for (const value of ["", " ", "\t", "\r\n"]) {
      expectDisabled(enabledEnv({ AI_REAL_DATA_APPROVAL_ID: value }));
    }
  });

  it("ignores unrelated env values, NEXT_PUBLIC aliases, API keys, region, and smoke flags", () => {
    const unrelated = {
      NEXT_PUBLIC_AI_REAL_DATA_ENABLED: "true",
      AI_OPENAI_API_KEY: API_KEY_SENTINEL,
      AI_OPENAI_REGION: "EU",
      SYNTHETIC_SMOKE_STATUS: "PASS",
    } as RealDataActivationEnv & Record<string, string>;
    expectDisabled(unrelated);
  });

  it("fails closed for an absent or forged policy", () => {
    expect(() => assertRealDataActivation(undefined)).toThrowError(
      expect.objectContaining({ code: "AI_REAL_DATA_DISABLED" }),
    );
    expect(() => assertRealDataActivation({ enabled: true } as never)).toThrowError(
      expect.objectContaining({ code: "AI_REAL_DATA_DISABLED" }),
    );
  });
});
