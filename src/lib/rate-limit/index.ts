import { getRateLimitAdapter, getRateLimitBackend, resetRateLimitAdapterForTests } from "./config";
import { clearMemoryRateLimitStore } from "./memory-adapter";
import type { RateLimitOptions, RateLimitResult } from "./types";

export type { RateLimitAdapter, RateLimitBackend, RateLimitOptions, RateLimitResult } from "./types";

export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const adapter = getRateLimitAdapter();

  try {
    return await adapter.check(options);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    const fallbackAdapter = new (await import("./memory-adapter")).MemoryRateLimitAdapter();
    return fallbackAdapter.check(options);
  }
}

export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "Retry-After": String(Math.max(result.retryAfterSeconds, 1)),
    "X-RateLimit-Remaining": String(Math.max(result.remaining, 0)),
    "X-RateLimit-Reset": result.resetAt.toISOString(),
  };
}

export function createRateLimitResponse(
  result: RateLimitResult,
  message = "Too many requests. Please retry later.",
): Response {
  return Response.json(
    { error: message },
    {
      status: 429,
      headers: getRateLimitHeaders(result),
    },
  );
}

export function clearRateLimitStore(): void {
  clearMemoryRateLimitStore();
  resetRateLimitAdapterForTests();
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return headers.get("x-real-ip") ?? "unknown";
}

export function buildRateLimitKey(scope: string, headers: Headers): string {
  return `${scope}:${getClientIp(headers)}`;
}

export { getRateLimitBackend };
