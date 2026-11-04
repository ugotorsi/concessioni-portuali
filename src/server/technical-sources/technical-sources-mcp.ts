import { z } from "zod";

export const TECHNICAL_SOURCES_MCP_ENDPOINT =
  "https://noetra-fonti-tecniche-staging.onrender.com/mcp";

const sourceIdSchema = z.enum(["campania-tematica", "campania-ctr2020"]);
export const technicalSourcesToolCallSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("search"),
    arguments: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
  }).strict(),
  z.object({
    tool: z.literal("fetch"),
    arguments: z.object({ id: z.string().trim().min(1).max(128) }).strict(),
  }).strict(),
  z.object({
    tool: z.literal("lista_livelli_wms"),
    arguments: z.object({
      source_id: sourceIdSchema,
      filtro: z.string().max(80).optional(),
    }).strict(),
  }).strict(),
  z.object({
    tool: z.literal("interroga_punto_wms"),
    arguments: z.object({
      source_id: sourceIdSchema,
      layer: z.string().trim().min(1).max(256),
      latitudine: z.number().finite().min(-90).max(90),
      longitudine: z.number().finite().min(-180).max(180),
    }).strict(),
  }).strict(),
  z.object({
    tool: z.literal("matrice_verifiche_manufatto"),
    arguments: z.object({
      tipo: z.enum(["biglietteria", "chiosco", "pontile", "struttura_galleggiante", "opera_fissa", "altro"]),
      comune: z.string().trim().min(2).max(120),
      data_riferimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).strict(),
  }).strict(),
]);

export type TechnicalSourcesToolCall = z.infer<typeof technicalSourcesToolCallSchema>;
export type TechnicalSourcesToolName = TechnicalSourcesToolCall["tool"];
export type TechnicalSourcesMcpData = Readonly<Record<string, unknown>>;

export class TechnicalSourcesMcpError extends Error {
  constructor(
    readonly code:
      | "M2M_AUTH_NOT_CONFIGURED"
      | "M2M_TOKEN_ERROR"
      | "UPSTREAM_HTTP_ERROR"
      | "UPSTREAM_RESPONSE_INVALID"
      | "MCP_PROTOCOL_ERROR"
      | "MCP_TOOL_ERROR",
    readonly status?: number,
  ) {
    super(code);
    this.name = "TechnicalSourcesMcpError";
  }
}

export type TechnicalSourcesMcpOptions = Readonly<{
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}>;

const MAX_RESPONSE_BYTES = 256_000;
const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new TechnicalSourcesMcpError("UPSTREAM_RESPONSE_INVALID");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TechnicalSourcesMcpError("UPSTREAM_RESPONSE_INVALID");
    }
    chunks.push(value);
  }

  const content = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}

async function postJsonRpc(
  request: Readonly<Record<string, unknown>>,
  options: TechnicalSourcesMcpOptions,
): Promise<Record<string, unknown>> {
  const token = await options.getAccessToken();
  if (!token.trim()) throw new TechnicalSourcesMcpError("M2M_AUTH_NOT_CONFIGURED");

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(TECHNICAL_SOURCES_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TechnicalSourcesMcpError("UPSTREAM_HTTP_ERROR");
  }
  if (!response.ok) throw new TechnicalSourcesMcpError("UPSTREAM_HTTP_ERROR", response.status);
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new TechnicalSourcesMcpError("UPSTREAM_RESPONSE_INVALID");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(response));
  } catch (error) {
    if (error instanceof TechnicalSourcesMcpError) throw error;
    throw new TechnicalSourcesMcpError("UPSTREAM_RESPONSE_INVALID");
  }
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== request.id) {
    throw new TechnicalSourcesMcpError("MCP_PROTOCOL_ERROR");
  }
  if (isRecord(payload.error)) throw new TechnicalSourcesMcpError("MCP_PROTOCOL_ERROR");
  if (!isRecord(payload.result)) throw new TechnicalSourcesMcpError("MCP_PROTOCOL_ERROR");
  return payload.result;
}

export async function callTechnicalSourcesTool(
  input: unknown,
  options: TechnicalSourcesMcpOptions,
): Promise<Readonly<{ data: TechnicalSourcesMcpData; serviceVersion: string }>> {
  const parsed = technicalSourcesToolCallSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("Technical source tool request is invalid.");

  const initialization = await postJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "noetra-staging", version: "1.0.0" },
    },
  }, options);
  const serverInfo = initialization.serverInfo;
  if (
    initialization.protocolVersion !== "2025-06-18"
    || !isRecord(serverInfo)
    || serverInfo.name !== "noetra-fonti-tecniche"
    || typeof serverInfo.version !== "string"
    || serverInfo.version.length > 64
  ) {
    throw new TechnicalSourcesMcpError("MCP_PROTOCOL_ERROR");
  }

  const result = await postJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: parsed.data.tool, arguments: parsed.data.arguments },
  }, options);
  if (result.isError === true) throw new TechnicalSourcesMcpError("MCP_TOOL_ERROR");
  if (!isRecord(result.structuredContent)) {
    throw new TechnicalSourcesMcpError("MCP_PROTOCOL_ERROR");
  }

  return { data: result.structuredContent, serviceVersion: serverInfo.version };
}

export type TechnicalSourceVerificationStatus =
  | "DA_VERIFICARE_SU_FONTE_ORIGINALE"
  | "INDICATIVO_DA_VERIFICARE"
  | "RISPOSTA_VUOTA_NON_PROBATORIA";

/**
 * MCP output is never probative: the status only records which non-probative category applies.
 * An empty WMS answer is kept distinct and must never be read as absence of constraints.
 */
export function deriveTechnicalSourceVerificationStatus(
  tool: TechnicalSourcesToolName,
  data: TechnicalSourcesMcpData,
): TechnicalSourceVerificationStatus {
  if (tool === "interroga_punto_wms") {
    if (data.result === "EMPTY_RESPONSE_NOT_PROOF") return "RISPOSTA_VUOTA_NON_PROBATORIA";
    if (data.result === "INDICATIVE_RESPONSE") return "INDICATIVO_DA_VERIFICARE";
    throw new TechnicalSourcesMcpError("MCP_PROTOCOL_ERROR");
  }
  return "DA_VERIFICARE_SU_FONTE_ORIGINALE";
}
