import type { RateLimitAdapter, RateLimitOptions, RateLimitResult } from "./types";

type UpstashCredentials = {
  url: string;
  token: string;
};

export class UpstashRateLimitAdapter implements RateLimitAdapter {
  constructor(private readonly credentials: UpstashCredentials) {}

  async check({ key, limit, windowMs }: RateLimitOptions): Promise<RateLimitResult> {
    const count = await this.commandNumber("incr", [key]);
    let ttlMs = await this.commandNumber("pttl", [key]);

    if (ttlMs < 0) {
      await this.commandNumber("pexpire", [key, String(windowMs)]);
      ttlMs = windowMs;
    }

    const allowed = count <= limit;

    return {
      allowed,
      remaining: Math.max(limit - count, 0),
      resetAt: new Date(Date.now() + Math.max(ttlMs, 0)),
      retryAfterSeconds: Math.max(Math.ceil(Math.max(ttlMs, 0) / 1000), 1),
    };
  }

  private async commandNumber(command: string, args: string[]): Promise<number> {
    const encodedArgs = args.map((arg) => encodeURIComponent(arg));
    const endpoint = `${this.credentials.url.replace(/\/+$/, "")}/${command}/${encodedArgs.join("/")}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Upstash rate limit command failed: ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown; error?: string };

    if (typeof payload.result === "number") {
      return payload.result;
    }

    if (typeof payload.result === "string") {
      const parsed = Number(payload.result);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    throw new Error(payload.error ?? "Unexpected Upstash response format");
  }
}
