import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRateLimitKey,
  checkRateLimit,
  clearRateLimitStore,
  getRateLimitBackend,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  const originalBackend = process.env.RATE_LIMIT_BACKEND;
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    process.env.RATE_LIMIT_BACKEND = "memory";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    clearRateLimitStore();
  });

  afterEach(() => {
    clearRateLimitStore();
    process.env.RATE_LIMIT_BACKEND = originalBackend;
    process.env.UPSTASH_REDIS_REST_URL = originalUpstashUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstashToken;
    vi.useRealTimers();
  });

  it("consente richieste entro limite", async () => {
    const first = await checkRateLimit({ key: "ip:1", limit: 3, windowMs: 60_000 });
    const second = await checkRateLimit({ key: "ip:1", limit: 3, windowMs: 60_000 });
    const third = await checkRateLimit({ key: "ip:1", limit: 3, windowMs: 60_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocca oltre limite", async () => {
    await checkRateLimit({ key: "ip:2", limit: 2, windowMs: 60_000 });
    await checkRateLimit({ key: "ip:2", limit: 2, windowMs: 60_000 });
    const blocked = await checkRateLimit({ key: "ip:2", limit: 2, windowMs: 60_000 });

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("espone resetAt utile per calcolare retryAfter", async () => {
    const result = await checkRateLimit({ key: "ip:3", limit: 1, windowMs: 30_000 });

    expect(result.allowed).toBe(true);
    expect(result.resetAt instanceof Date).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it("chiavi diverse non si contaminano", async () => {
    await checkRateLimit({ key: "window:A", limit: 1, windowMs: 60_000 });
    const sameKeyBlocked = await checkRateLimit({ key: "window:A", limit: 1, windowMs: 60_000 });
    const differentKeyAllowed = await checkRateLimit({ key: "window:B", limit: 1, windowMs: 60_000 });

    expect(sameKeyBlocked.allowed).toBe(false);
    expect(differentKeyAllowed.allowed).toBe(true);
  });

  it("resetta il limite dopo la finestra temporale", async () => {
    await checkRateLimit({ key: "reset:key", limit: 1, windowMs: 1_000 });
    const blocked = await checkRateLimit({ key: "reset:key", limit: 1, windowMs: 1_000 });
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(1_001);

    const allowedAgain = await checkRateLimit({ key: "reset:key", limit: 1, windowMs: 1_000 });
    expect(allowedAgain.allowed).toBe(true);
    expect(allowedAgain.remaining).toBe(0);
  });

  it("default config usa backend memory", () => {
    delete process.env.RATE_LIMIT_BACKEND;
    clearRateLimitStore();

    expect(getRateLimitBackend()).toBe("memory");
  });

  it("backend upstash senza credenziali in test ripiega su memory", async () => {
    process.env.RATE_LIMIT_BACKEND = "upstash";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    clearRateLimitStore();

    const first = await checkRateLimit({ key: "fallback:key", limit: 1, windowMs: 5_000 });
    const second = await checkRateLimit({ key: "fallback:key", limit: 1, windowMs: 5_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("header Retry-After e remaining sono valorizzati", async () => {
    await checkRateLimit({ key: "headers:key", limit: 1, windowMs: 3_000 });
    const blocked = await checkRateLimit({ key: "headers:key", limit: 1, windowMs: 3_000 });
    const headers = getRateLimitHeaders(blocked);

    expect(headers["Retry-After"]).toBeDefined();
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBeTruthy();
  });

  it("buildRateLimitKey combina scope e IP cliente", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.25, 203.0.113.26",
    });

    expect(buildRateLimitKey("export:report", headers)).toBe("export:report:203.0.113.25");
  });
});
