export type LiveQualificationProviderId = "ANTHROPIC" | "DEEPSEEK";

export interface LiveQualificationStoredResult {
  readonly authorizationId: "GH_ISSUE_70_2026_11_06_RUN_3";
  readonly status: "RESERVED" | "RUNNING" | "PASS" | "FAIL";
  readonly updatedAt: string;
  readonly providers: readonly unknown[];
  readonly totalEstimatedCostUsd: number;
}

export interface LiveQualificationRunStore {
  reserveRun(value: LiveQualificationStoredResult): Promise<boolean>;
  reserveProvider(provider: LiveQualificationProviderId): Promise<boolean>;
  record(value: LiveQualificationStoredResult): Promise<void>;
  read(): Promise<LiveQualificationStoredResult | null>;
}

type StoreFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const KEY_PREFIX = "noetra:qualification:issue70:2026-11-06:run-3";

function assertConfig(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[SENSITIVE]") {
    throw new Error("LIVE_QUALIFICATION_STORE_CONFIGURATION_INVALID");
  }
  return trimmed;
}

export function createLiveQualificationRunStore(config: {
  url: string;
  token: string;
  transport?: StoreFetch;
}): LiveQualificationRunStore {
  const url = assertConfig(config.url).replace(/\/+$/, "");
  const token = assertConfig(config.token);
  const transport = config.transport ?? globalThis.fetch.bind(globalThis);

  async function command(args: readonly string[]): Promise<unknown> {
    const response = await transport(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error("LIVE_QUALIFICATION_STORE_UNAVAILABLE");
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || !("result" in payload)) {
      throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
    }
    return (payload as { result: unknown }).result;
  }

  return {
    async reserveRun(value) {
      const result = await command([
        "SET",
        `${KEY_PREFIX}:run`,
        JSON.stringify(value),
        "NX",
      ]);
      if (result === "OK") return true;
      if (result === null) return false;
      throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
    },
    async reserveProvider(provider) {
      const result = await command([
        "SET",
        `${KEY_PREFIX}:provider:${provider.toLowerCase()}`,
        "RESERVED",
        "NX",
      ]);
      if (result === "OK") return true;
      if (result === null) return false;
      throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
    },
    async record(value) {
      const result = await command([
        "SET",
        `${KEY_PREFIX}:run`,
        JSON.stringify(value),
        "XX",
      ]);
      if (result !== "OK") {
        throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
      }
    },
    async read() {
      const result = await command(["GET", `${KEY_PREFIX}:run`]);
      if (result === null) return null;
      if (typeof result !== "string") {
        throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result);
      } catch {
        throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("LIVE_QUALIFICATION_STORE_PROTOCOL_INVALID");
      }
      return parsed as LiveQualificationStoredResult;
    },
  };
}
