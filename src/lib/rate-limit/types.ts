export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

export interface RateLimitAdapter {
  check(options: RateLimitOptions): Promise<RateLimitResult>;
}

export type RateLimitBackend = "memory" | "upstash";
