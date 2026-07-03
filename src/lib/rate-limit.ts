type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const current = store.get(key);

  if (!current || now > current.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });

    return {
      allowed: true,
      remaining: Math.max(limit - 1, 0),
      resetAt,
    };
  }

  current.count += 1;
  store.set(key, current);

  const allowed = current.count <= limit;

  return {
    allowed,
    remaining: Math.max(limit - current.count, 0),
    resetAt: current.resetAt,
  };
}

export function clearRateLimitStore(): void {
  store.clear();
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return headers.get("x-real-ip") ?? "unknown";
}
