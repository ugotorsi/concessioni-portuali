import { readFile } from "node:fs/promises";
import path from "node:path";

export type AutomaticResearchConnectorReadiness = Readonly<{
  ready: boolean;
  legalDataHunter: "READY" | "CREDENTIAL_MISSING";
  moonlit: "READY" | "PATH_MISSING" | "PATH_NOT_ABSOLUTE" | "TOKEN_FILE_INVALID";
  simpliciter: "READY" | "PATH_MISSING" | "PATH_NOT_ABSOLUTE" | "TOKEN_FILE_INVALID";
}>;

async function oauthTokenState(
  storagePath: string | undefined,
): Promise<AutomaticResearchConnectorReadiness["moonlit"]> {
  const configuredPath = storagePath?.trim();
  if (!configuredPath) return "PATH_MISSING";
  if (!path.isAbsolute(configuredPath)) return "PATH_NOT_ABSOLUTE";
  try {
    const stored = JSON.parse(await readFile(configuredPath, "utf8")) as {
      tokens?: { access_token?: unknown };
    };
    return typeof stored.tokens?.access_token === "string"
      && stored.tokens.access_token.trim().length > 0
      ? "READY"
      : "TOKEN_FILE_INVALID";
  } catch {
    return "TOKEN_FILE_INVALID";
  }
}

export async function verifyAutomaticResearchConnectorReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AutomaticResearchConnectorReadiness> {
  const legalDataHunter = env.LEGAL_DATA_HUNTER_API_KEY?.trim()
    ? "READY"
    : "CREDENTIAL_MISSING";
  const [moonlit, simpliciter] = await Promise.all([
    oauthTokenState(env.MOONLIT_OAUTH_STORAGE_PATH),
    oauthTokenState(env.SIMPLICITER_OAUTH_STORAGE_PATH),
  ]);
  return {
    ready: legalDataHunter === "READY"
      && moonlit === "READY"
      && simpliciter === "READY",
    legalDataHunter,
    moonlit,
    simpliciter,
  };
}
