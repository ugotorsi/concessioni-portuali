import { AiProviderAdapterError } from "@/server/ai/providerErrors";

export type AiProviderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function readBoundedProviderJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
}

function providerCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const value = (error as Record<string, unknown>).code
    ?? (error as Record<string, unknown>).type;
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
    ? value
    : null;
}

export function sanitizedProviderRequestId(
  headers: Pick<Headers, "get"> | undefined,
): string | null {
  const value = headers?.get("request-id")
    ?? headers?.get("x-request-id")
    ?? headers?.get("anthropic-request-id");
  return value && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
}

export function mapProviderHttpError(
  status: number,
  body: unknown,
  headers?: Pick<Headers, "get">,
): AiProviderAdapterError {
  const diagnostics = {
    httpStatus: status,
    providerCode: providerCode(body),
    providerRequestId: sanitizedProviderRequestId(headers),
  };
  if (status === 408) return new AiProviderAdapterError("TIMEOUT", diagnostics);
  if (status === 429) return new AiProviderAdapterError("RATE_LIMITED", diagnostics);
  if (status === 401 || status === 403) {
    return new AiProviderAdapterError("CONFIGURATION", diagnostics);
  }
  if (status >= 400 && status <= 499) {
    return new AiProviderAdapterError("REQUEST_REJECTED", diagnostics);
  }
  return new AiProviderAdapterError("UNAVAILABLE", diagnostics);
}
