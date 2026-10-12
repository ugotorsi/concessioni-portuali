import path from "node:path";

import { MoonlitOAuthProvider } from "./moonlit-oauth";

export const SIMPLICITER_MCP_URL = "https://simpliciter.ai/mcp" as const;
export const SIMPLICITER_OAUTH_STORAGE_PATH = path.join(
  process.cwd(),
  ".local-storage",
  "simpliciter",
  "oauth.json",
);

function configuredSimpliciterStoragePath(): string {
  return process.env.SIMPLICITER_OAUTH_STORAGE_PATH?.trim() || SIMPLICITER_OAUTH_STORAGE_PATH;
}

export class SimpliciterOAuthProvider extends MoonlitOAuthProvider {
  constructor(
    redirectUrl: string,
    onRedirect: (authorizationUrl: URL) => void | Promise<void>,
  ) {
    super(redirectUrl, onRedirect, configuredSimpliciterStoragePath());
  }
}