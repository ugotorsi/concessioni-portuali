import { createHash, timingSafeEqual } from "node:crypto";

function digestToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimeTokenMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digestToken(provided), digestToken(expected));
}