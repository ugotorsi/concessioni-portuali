import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  isLiveQualificationDeployment,
  LIVE_QUALIFICATION_AUTHORIZATION_ID,
  LIVE_QUALIFICATION_BRANCH,
  liveQualificationDeploymentHost,
} from "@/server/ai/qualification/liveSyntheticQualificationDeployment";

export {
  LIVE_QUALIFICATION_AUTHORIZATION_ID,
  LIVE_QUALIFICATION_BRANCH,
};
export const LIVE_QUALIFICATION_CSRF_COOKIE =
  "__Host-noetra-live-qualification-csrf" as const;

export type LiveQualificationEnvironment =
  Readonly<Record<string, string | undefined>>;

export class LiveQualificationSecurityError extends Error {
  constructor(readonly code:
    | "LIVE_QUALIFICATION_ENVIRONMENT_DISABLED"
    | "LIVE_QUALIFICATION_CONFIGURATION_INVALID"
    | "LIVE_QUALIFICATION_HOST_INVALID"
    | "LIVE_QUALIFICATION_CSRF_INVALID"
    | "LIVE_QUALIFICATION_ORIGIN_INVALID") {
    super(code);
    this.name = "LiveQualificationSecurityError";
  }
}

function normalizedHost(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "").replace(/:\d+$/, "");
}

function required(env: LiveQualificationEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value || value === "[SENSITIVE]") {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_CONFIGURATION_INVALID",
    );
  }
  return value;
}

function normalizedUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_CONFIGURATION_INVALID",
    );
  }
  if (url.protocol !== "https:") {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_CONFIGURATION_INVALID",
    );
  }
  return url.href.replace(/\/+$/, "").toLowerCase();
}

export function assertLiveQualificationEnvironment(input: {
  env?: LiveQualificationEnvironment;
  requestHost: string | null;
}): void {
  const env = input.env ?? process.env;
  if (env.NOETRA_LIVE_QUALIFICATION_ENABLED !== "true"
    || env.NOETRA_LIVE_QUALIFICATION_AUTHORIZATION_ID
      !== LIVE_QUALIFICATION_AUTHORIZATION_ID
    || env.VERCEL_ENV !== "production"
    || env.VERCEL_GIT_COMMIT_REF !== LIVE_QUALIFICATION_BRANCH) {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_ENVIRONMENT_DISABLED",
    );
  }
  const deploymentHost = liveQualificationDeploymentHost(env);
  const requestHost = normalizedHost(input.requestHost);
  if (!deploymentHost || !deploymentHost.endsWith(".vercel.app")
    || requestHost !== deploymentHost
    || requestHost === "app.noetra.it") {
    throw new LiveQualificationSecurityError("LIVE_QUALIFICATION_HOST_INVALID");
  }
  if (normalizedHost(required(env, "NEXTAUTH_URL")) !== deploymentHost) {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_CONFIGURATION_INVALID",
    );
  }
  const expectedCommit = required(
    env,
    "NOETRA_LIVE_QUALIFICATION_EXPECTED_COMMIT",
  );
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)
    || required(env, "VERCEL_GIT_COMMIT_SHA") !== expectedCommit) {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_CONFIGURATION_INVALID",
    );
  }
  for (const name of [
    "NEXTAUTH_SECRET",
    "AI_ANTHROPIC_API_KEY",
    "AI_DEEPSEEK_API_KEY",
    "NOETRA_LIVE_QUALIFICATION_REDIS_REST_URL",
    "NOETRA_LIVE_QUALIFICATION_REDIS_REST_TOKEN",
    "NOETRA_LIVE_QUALIFICATION_REDIS_RESOURCE_ID",
  ]) {
    required(env, name);
  }
  const dedicatedStoreUrl = normalizedUrl(required(
    env,
    "NOETRA_LIVE_QUALIFICATION_REDIS_REST_URL",
  ));
  for (const sharedName of [
    "UPSTASH_REDIS_REST_URL",
    "KV_REST_API_URL",
  ]) {
    const sharedUrl = env[sharedName]?.trim();
    if (sharedUrl && normalizedUrl(sharedUrl) === dedicatedStoreUrl) {
      throw new LiveQualificationSecurityError(
        "LIVE_QUALIFICATION_CONFIGURATION_INVALID",
      );
    }
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createLiveQualificationCsrfToken(input: {
  actorId: string;
  deploymentHost: string;
  secret: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const payload = Buffer.from(JSON.stringify({
    actorId: input.actorId,
    deploymentHost: normalizedHost(input.deploymentHost),
    expiresAt: now.getTime() + 10 * 60 * 1_000,
    nonce: randomBytes(24).toString("hex"),
  })).toString("base64url");
  return `${payload}.${signature(payload, input.secret).toString("base64url")}`;
}

export function verifyLiveQualificationCsrfToken(input: {
  actorId: string;
  deploymentHost: string;
  secret: string;
  headerToken: string | null;
  cookieToken: string | null;
  now?: Date;
}): void {
  if (!input.headerToken || !input.cookieToken
    || input.headerToken !== input.cookieToken) {
    throw new LiveQualificationSecurityError("LIVE_QUALIFICATION_CSRF_INVALID");
  }
  const [payload, encodedSignature, extra] = input.headerToken.split(".");
  if (!payload || !encodedSignature || extra) {
    throw new LiveQualificationSecurityError("LIVE_QUALIFICATION_CSRF_INVALID");
  }
  const actual = Buffer.from(encodedSignature, "base64url");
  const expected = signature(payload, input.secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new LiveQualificationSecurityError("LIVE_QUALIFICATION_CSRF_INVALID");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new LiveQualificationSecurityError("LIVE_QUALIFICATION_CSRF_INVALID");
  }
  const parsed = z.object({
    actorId: z.string().min(1),
    deploymentHost: z.string().min(1),
    expiresAt: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{48}$/),
  }).strict().safeParse(decoded);
  const now = (input.now ?? new Date()).getTime();
  if (!parsed.success
    || parsed.data.actorId !== input.actorId
    || parsed.data.deploymentHost !== normalizedHost(input.deploymentHost)
    || parsed.data.expiresAt <= now) {
    throw new LiveQualificationSecurityError("LIVE_QUALIFICATION_CSRF_INVALID");
  }
}

export const liveQualificationRunRequestSchema = z.object({
  action: z.literal("RUN_ISSUE_70_ONCE"),
  confirmation: z.literal("ESEGUI DUE TEST SYN-001"),
  csrfToken: z.string().min(1).max(2048),
}).strict();

export function assertLiveQualificationMutationRequest(request: Request): void {
  const origin = request.headers.get("origin");
  const requestHost = normalizedHost(request.headers.get("host"));
  const originHost = normalizedHost(origin);
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!contentType.startsWith("application/json")
    || !origin?.startsWith("https://")
    || originHost !== requestHost
    || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new LiveQualificationSecurityError(
      "LIVE_QUALIFICATION_ORIGIN_INVALID",
    );
  }
}

export { isLiveQualificationDeployment };
