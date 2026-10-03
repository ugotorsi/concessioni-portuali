import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRateLimitKey,
  checkRateLimit,
  clearRateLimitStore,
  getRateLimitBackend,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
    for (const name of [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
      "KV_REST_API_READ_ONLY_TOKEN",
    ]) {
      vi.stubEnv(name, "");
    }
    clearRateLimitStore();
  });

  afterEach(() => {
    clearRateLimitStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mockUpstashResponses() {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 5_000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

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
    vi.stubEnv("RATE_LIMIT_BACKEND", "upstash");
    clearRateLimitStore();

    const first = await checkRateLimit({ key: "fallback:key", limit: 1, windowMs: 5_000 });
    const second = await checkRateLimit({ key: "fallback:key", limit: 1, windowMs: 5_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("usa credenziali UPSTASH legacy quando configurate", async () => {
    vi.stubEnv("RATE_LIMIT_BACKEND", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://legacy.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "primary-write");
    const fetchMock = mockUpstashResponses();
    clearRateLimitStore();

    await checkRateLimit({ key: "legacy:key", limit: 2, windowMs: 5_000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://legacy.example.test/incr/legacy%3Akey");
  });

  it("usa credenziali KV REST generate da Vercel", async () => {
    vi.stubEnv("RATE_LIMIT_BACKEND", "upstash");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-write");
    const fetchMock = mockUpstashResponses();
    clearRateLimitStore();

    await checkRateLimit({ key: "kv:key", limit: 2, windowMs: 5_000 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://kv.example.test/incr/kv%3Akey");
  });

  it("preferisce UPSTASH quando entrambi i naming sono configurati", async () => {
    vi.stubEnv("RATE_LIMIT_BACKEND", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://preferred.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "preferred-write");
    vi.stubEnv("KV_REST_API_URL", "https://fallback.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "fallback-write");
    const fetchMock = mockUpstashResponses();
    clearRateLimitStore();

    await checkRateLimit({ key: "priority:key", limit: 2, windowMs: 5_000 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://preferred.example.test/incr/priority%3Akey");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer preferred-write" },
    });
  });

  it("non usa il token KV read-only per operazioni di scrittura", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_BACKEND", "upstash");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example.test");
    vi.stubEnv("KV_REST_API_READ_ONLY_TOKEN", "read-only");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    clearRateLimitStore();

    await expect(checkRateLimit({ key: "readonly:key", limit: 2, windowMs: 5_000 }))
      .rejects.toThrow("writable REST URL and token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("senza credenziali in production fallisce closed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_BACKEND", "upstash");
    clearRateLimitStore();

    await expect(checkRateLimit({ key: "production:key", limit: 2, windowMs: 5_000 }))
      .rejects.toThrow("writable REST URL and token");
  });

  it("backend diverso da upstash resta memory", async () => {
    vi.stubEnv("RATE_LIMIT_BACKEND", "redis");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-write");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    clearRateLimitStore();

    const first = await checkRateLimit({ key: "memory:key", limit: 1, windowMs: 5_000 });
    const second = await checkRateLimit({ key: "memory:key", limit: 1, windowMs: 5_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
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
