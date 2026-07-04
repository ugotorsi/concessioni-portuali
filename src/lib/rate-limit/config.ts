import { MemoryRateLimitAdapter } from "./memory-adapter";
import { UpstashRateLimitAdapter } from "./upstash-adapter";
import type { RateLimitAdapter, RateLimitBackend } from "./types";

let adapter: RateLimitAdapter | null = null;
let warnedFallback = false;

function getConfiguredBackend(): string {
  return (process.env.RATE_LIMIT_BACKEND ?? "memory").trim().toLowerCase();
}

function resolveBackend(): RateLimitBackend {
  const configured = getConfiguredBackend();
  return configured === "upstash" ? "upstash" : "memory";
}

function getUpstashCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

function createUpstashOrFallback(): RateLimitAdapter {
  const credentials = getUpstashCredentials();

  if (credentials) {
    return new UpstashRateLimitAdapter(credentials);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RATE_LIMIT_BACKEND=upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in production",
    );
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "RATE_LIMIT_BACKEND=upstash configured without credentials. Falling back to in-memory adapter for dev/test.",
    );
  }

  return new MemoryRateLimitAdapter();
}

export function getRateLimitBackend(): RateLimitBackend {
  return resolveBackend();
}

export function getRateLimitAdapter(): RateLimitAdapter {
  if (adapter) {
    return adapter;
  }

  adapter = resolveBackend() === "upstash" ? createUpstashOrFallback() : new MemoryRateLimitAdapter();
  return adapter;
}

export function resetRateLimitAdapterForTests(): void {
  adapter = null;
  warnedFallback = false;
}
