import type { RateLimitAdapter, RateLimitOptions, RateLimitResult } from "./types";

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

const store = new Map<string, RateLimitEntry>();

export class MemoryRateLimitAdapter implements RateLimitAdapter {
  async check({ key, limit, windowMs }: RateLimitOptions): Promise<RateLimitResult> {
    const now = Date.now();
    const current = store.get(key);

    if (!current || now > current.resetAtMs) {
      const resetAtMs = now + windowMs;
      store.set(key, { count: 1, resetAtMs });

      return {
        allowed: true,
        remaining: Math.max(limit - 1, 0),
        resetAt: new Date(resetAtMs),
        retryAfterSeconds: Math.max(Math.ceil(windowMs / 1000), 1),
      };
    }

    current.count += 1;
    store.set(key, current);

    const allowed = current.count <= limit;
    const remainingMs = Math.max(current.resetAtMs - now, 0);

    return {
      allowed,
      remaining: Math.max(limit - current.count, 0),
      resetAt: new Date(current.resetAtMs),
      retryAfterSeconds: Math.max(Math.ceil(remainingMs / 1000), 1),
    };
  }
}

export function clearMemoryRateLimitStore(): void {
  store.clear();
}
