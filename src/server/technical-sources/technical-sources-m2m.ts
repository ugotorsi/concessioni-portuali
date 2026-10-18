import { TechnicalSourcesMcpError } from "@/server/technical-sources/technical-sources-mcp";

type Env = Readonly<Record<string, string | undefined>>;

export type TechnicalSourcesM2MConfig = Readonly<{
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}>;

const TOKEN_TIMEOUT_MS = 10_000;
const MAX_TOKEN_RESPONSE_BYTES = 16_384;
const EXPIRY_SAFETY_MS = 60_000;

function isAllowedTokenHost(hostname: string): boolean {
  return hostname === "test.stytch.com"
    || hostname === "api.stytch.com"
    || /^[a-z0-9-]+\.customers\.stytch\.(dev|com)$/.test(hostname);
}

/**
 * Returns null when the channel is disabled. Throws when it is enabled but misconfigured,
 * so a partial configuration can never silently fall back to another identity.
 */
export function readTechnicalSourcesM2MConfig(env: Env = process.env): TechnicalSourcesM2MConfig | null {
  if (env.TECHNICAL_SOURCES_MCP_ENABLED !== "true") return null;

  const tokenUrl = env.TECHNICAL_SOURCES_MCP_TOKEN_URL?.trim() ?? "";
  const clientId = env.TECHNICAL_SOURCES_MCP_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.TECHNICAL_SOURCES_MCP_CLIENT_SECRET ?? "";
  const scope = env.TECHNICAL_SOURCES_MCP_SCOPE?.trim() ?? "";

  let url: URL;
  try {
    url = new URL(tokenUrl);
  } catch {
    throw new TechnicalSourcesMcpError("M2M_AUTH_NOT_CONFIGURED");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || !isAllowedTokenHost(url.hostname)
    || !/^m2m-client-(test|live)-[0-9a-f-]+$/.test(clientId)
    || clientSecret.length < 16
    || !/^[a-z0-9:_-]{1,80}$/i.test(scope)
  ) {
    throw new TechnicalSourcesMcpError("M2M_AUTH_NOT_CONFIGURED");
  }
  return { tokenUrl: url.href, clientId, clientSecret, scope };
}

export function isTechnicalSourcesChannelEnabled(env: Env = process.env): boolean {
  try {
    return readTechnicalSourcesM2MConfig(env) !== null;
  } catch {
    return false;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TOKEN_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR");
  }
}

export function createTechnicalSourcesTokenProvider(options: Readonly<{
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: () => number;
}> = {}): () => Promise<string> {
  let cached: { key: string; token: string; expiresAt: number } | null = null;
  const now = options.now ?? Date.now;

  return async () => {
    const config = readTechnicalSourcesM2MConfig(options.env ?? process.env);
    if (!config) throw new TechnicalSourcesMcpError("M2M_AUTH_NOT_CONFIGURED");

    const cacheKey = `${config.tokenUrl}|${config.clientId}|${config.scope}`;
    if (cached && cached.key === cacheKey && cached.expiresAt > now()) return cached.token;

    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(config.tokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: config.scope,
        }).toString(),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch {
      throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR");
    }
    if (!response.ok) throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR", response.status);

    const payload = await readBoundedJson(response);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR");
    }
    const { access_token: token, token_type: tokenType, expires_in: expiresIn, scope } =
      payload as Record<string, unknown>;
    if (
      typeof token !== "string"
      || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
      || token.length > 8192
      || typeof tokenType !== "string"
      || tokenType.toLowerCase() !== "bearer"
      || typeof expiresIn !== "number"
      || !Number.isFinite(expiresIn)
      || expiresIn <= 0
      || (scope !== undefined && (typeof scope !== "string" || !scope.split(" ").includes(config.scope)))
    ) {
      throw new TechnicalSourcesMcpError("M2M_TOKEN_ERROR");
    }

    const lifetimeMs = Math.min(expiresIn * 1000, 3_600_000);
    cached = {
      key: cacheKey,
      token,
      expiresAt: now() + Math.max(0, lifetimeMs - EXPIRY_SAFETY_MS),
    };
    return token;
  };
}

export const getTechnicalSourcesMcpAccessToken = createTechnicalSourcesTokenProvider();
