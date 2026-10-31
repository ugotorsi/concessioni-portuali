const WORKOS_RESOURCE_ENDPOINT = "https://api.workos.com/user_management/authkit_oauth_resources";
export const SELVARA_PREVIEW_MCP_RESOURCE =
  "https://concessioni-portuali-demo-v7-mcp-preview.vercel.app/api/mcp";

type WorkosResource = Readonly<{
  id: string;
  uri: string;
  default: boolean;
}>;

type WorkosResourceList = Readonly<{
  data: readonly WorkosResource[];
}>;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function validateEnvironment(): string {
  const issuer = process.env.WORKOS_AUTHKIT_ISSUER;
  const apiKey = process.env.WORKOS_API_KEY;
  if (!issuer || !apiKey) throw new Error("WORKOS_CONFIGURATION_REQUIRED");
  const issuerUrl = new URL(issuer);
  if (
    issuerUrl.protocol !== "https:"
    || !issuerUrl.hostname.endsWith("-staging.authkit.app")
  ) {
    throw new Error("WORKOS_STAGING_ENVIRONMENT_REQUIRED");
  }
  return apiKey;
}

function validateResource(value: string | null): string {
  if (value !== SELVARA_PREVIEW_MCP_RESOURCE || value.includes("*")) {
    throw new Error("WORKOS_RESOURCE_NOT_ALLOWED");
  }
  return value;
}

async function request(
  apiKey: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(WORKOS_RESOURCE_ENDPOINT, {
    ...init,
    headers: {
      Authorization: ["Bearer", apiKey].join(" "),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`WORKOS_RESOURCE_REQUEST_FAILED:${response.status}`);
  }
  return response;
}

async function listResources(apiKey: string): Promise<readonly WorkosResource[]> {
  const response = await fetch(`${WORKOS_RESOURCE_ENDPOINT}?limit=100&order=asc`, {
    headers: { Authorization: ["Bearer", apiKey].join(" ") },
  });
  if (!response.ok) {
    throw new Error(`WORKOS_RESOURCE_LIST_FAILED:${response.status}`);
  }
  const payload = await response.json() as WorkosResourceList;
  if (!Array.isArray(payload.data)) throw new Error("WORKOS_RESOURCE_LIST_INVALID");
  return payload.data;
}

async function main(): Promise<void> {
  const resource = validateResource(argument("--resource"));
  const apply = process.argv.includes("--apply");
  const confirmation = argument("--confirm-resource");
  if (apply && confirmation !== resource) throw new Error("WORKOS_RESOURCE_CONFIRMATION_REQUIRED");

  const apiKey = validateEnvironment();
  const before = await listResources(apiKey);
  const existing = before.filter((item) => item.uri === resource);
  if (existing.length > 1) throw new Error("WORKOS_RESOURCE_DUPLICATED");

  if (existing.length === 0 && apply) {
    await request(apiKey, {
      method: "POST",
      body: JSON.stringify({ uri: resource }),
    });
  }

  const after = await listResources(apiKey);
  const registered = after.filter((item) => item.uri === resource);
  const beforeIdentity = new Set(before.map((item) => `${item.id}\u0000${item.uri}`));
  const existingResourcesPreserved = before.every(
    (item) => after.some((candidate) => candidate.id === item.id && candidate.uri === item.uri),
  );
  const unexpectedAdditions = after.filter(
    (item) => !beforeIdentity.has(`${item.id}\u0000${item.uri}`) && item.uri !== resource,
  );
  if (
    !existingResourcesPreserved
    || unexpectedAdditions.length > 0
    || (apply && registered.length !== 1)
  ) {
    throw new Error("WORKOS_RESOURCE_POSTCONDITION_FAILED");
  }

  console.log(JSON.stringify({
    environment: "staging",
    resource,
    apply,
    created: existing.length === 0 && apply,
    registered: registered.length === 1,
    existingResourceCountBefore: before.length,
    existingResourceCountAfter: after.length,
    existingResourcesPreserved,
    wildcardUsed: false,
  }));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
import path from "node:path";
import { pathToFileURL } from "node:url";
