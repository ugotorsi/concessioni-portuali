import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit, clearRateLimitStore } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    clearRateLimitStore();
  });

  afterEach(() => {
    clearRateLimitStore();
    vi.useRealTimers();
  });

  it("consente richieste entro limite", () => {
    const first = checkRateLimit({ key: "ip:1", limit: 3, windowMs: 60_000 });
    const second = checkRateLimit({ key: "ip:1", limit: 3, windowMs: 60_000 });
    const third = checkRateLimit({ key: "ip:1", limit: 3, windowMs: 60_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocca oltre limite", () => {
    checkRateLimit({ key: "ip:2", limit: 2, windowMs: 60_000 });
    checkRateLimit({ key: "ip:2", limit: 2, windowMs: 60_000 });
    const blocked = checkRateLimit({ key: "ip:2", limit: 2, windowMs: 60_000 });

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("espone resetAt utile per calcolare retryAfter", () => {
    const result = checkRateLimit({ key: "ip:3", limit: 1, windowMs: 30_000 });
    const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);

    expect(result.allowed).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it("chiavi diverse non si contaminano", () => {
    checkRateLimit({ key: "window:A", limit: 1, windowMs: 60_000 });
    const sameKeyBlocked = checkRateLimit({ key: "window:A", limit: 1, windowMs: 60_000 });
    const differentKeyAllowed = checkRateLimit({ key: "window:B", limit: 1, windowMs: 60_000 });

    expect(sameKeyBlocked.allowed).toBe(false);
    expect(differentKeyAllowed.allowed).toBe(true);
  });
});
