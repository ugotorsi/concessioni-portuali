import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import type { CurrentUser } from "@/lib/auth";
import {
  getDatasetScope,
  type DatasetScope,
} from "@/lib/dataset-visibility";
import { resolveNextAuthSecret } from "@/lib/next-auth-secret";

export const DATASET_WORKSPACE_COOKIE = "noetra.dataset-workspace";
export const DATASET_WORKSPACE_TTL_SECONDS = 8 * 60 * 60;
export const SELECTABLE_DATASET_SCOPES = ["PROFESSIONAL", "SYNTHETIC"] as const;

type SelectableDatasetScope = (typeof SELECTABLE_DATASET_SCOPES)[number];

type DatasetWorkspacePayload = Readonly<{
  version: "dw1";
  userId: string;
  scope: SelectableDatasetScope;
  issuedAt: number;
  expiresAt: number;
}>;

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

function isSelectableDatasetScope(value: unknown): value is SelectableDatasetScope {
  return typeof value === "string"
    && SELECTABLE_DATASET_SCOPES.includes(value as SelectableDatasetScope);
}

function isPayload(value: unknown): value is DatasetWorkspacePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return payload.version === "dw1"
    && typeof payload.userId === "string"
    && payload.userId.length > 0
    && isSelectableDatasetScope(payload.scope)
    && Number.isInteger(payload.issuedAt)
    && Number.isInteger(payload.expiresAt);
}

export function createDatasetWorkspaceToken(input: {
  userId: string;
  scope: SelectableDatasetScope;
  secret: string;
  now?: Date;
}): string {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const payload: DatasetWorkspacePayload = {
    version: "dw1",
    userId: input.userId,
    scope: input.scope,
    issuedAt,
    expiresAt: issuedAt + DATASET_WORKSPACE_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${encode(signature(encodedPayload, input.secret))}`;
}

export function verifyDatasetWorkspaceToken(input: {
  token: string;
  userId: string;
  secret: string;
  now?: Date;
}): SelectableDatasetScope | null {
  const [encodedPayload, encodedSignature, ...extra] = input.token.split(".");
  if (!encodedPayload || !encodedSignature || extra.length > 0) {
    return null;
  }

  let suppliedSignature: Buffer;
  let payload: unknown;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const expectedSignature = signature(encodedPayload, input.secret);
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
    || !isPayload(payload)
  ) {
    return null;
  }

  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    payload.userId !== input.userId
    || payload.issuedAt > now
    || payload.expiresAt <= now
  ) {
    return null;
  }
  return payload.scope;
}

export async function resolveCurrentDatasetScope(
  user: Pick<CurrentUser, "id" | "role" | "mfaVerified">,
): Promise<DatasetScope> {
  const configuredScope = getDatasetScope();
  if (user.role !== "ADMIN" || !user.mfaVerified) {
    return configuredScope;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(DATASET_WORKSPACE_COOKIE)?.value;
  if (!token) {
    return configuredScope;
  }

  return verifyDatasetWorkspaceToken({
    token,
    userId: user.id,
    secret: resolveNextAuthSecret(),
  }) ?? configuredScope;
}
