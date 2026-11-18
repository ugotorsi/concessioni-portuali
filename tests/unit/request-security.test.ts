import { afterEach, describe, expect, it, vi } from "vitest";

import { isTrustedJsonMutation } from "@/lib/request-security";

function request(headers: Record<string, string>) {
  return new Request("https://staging.example.test/api/resource", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("session mutation request security", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts same-origin JSON", () => {
    expect(isTrustedJsonMutation(request({
      "content-type": "application/json",
      origin: "https://staging.example.test",
    }))).toBe(true);
  });

  it("rejects cross-origin and non-JSON requests", () => {
    expect(isTrustedJsonMutation(request({
      "content-type": "application/json",
      origin: "https://evil.example",
    }))).toBe(false);
    expect(isTrustedJsonMutation(request({
      "content-type": "text/plain",
      origin: "https://staging.example.test",
    }))).toBe(false);
  });

  it("rejects missing Origin on deployed Preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isTrustedJsonMutation(request({ "content-type": "application/json" }))).toBe(false);
  });
});