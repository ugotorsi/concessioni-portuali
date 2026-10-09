import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/next-auth";
import {
  getActiveDocumentStorageBackend,
  getDocumentStorageAdapter,
} from "@/server/documents/storage";
import { getS3StorageConfig } from "@/server/documents/storage/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_VERCEL_ENV = "preview";
const EXPECTED_GIT_BRANCH = "e2e-unified-fascicolo-20261009";
const EXPECTED_BUCKET = "concessioni-portuali-e2e-20261009";
const EXPECTED_ENDPOINT_HOSTNAME = "4ac24bca26aa795c991ef8d9d6459922.r2.cloudflarestorage.com";
const PROBE_KEY = "e2e-storage-probe/d41b17c4-939f-4c58-9c2a-bf5e19e3945f";
const PROBE_BODY = Buffer.from("NOETRA R2 E2E runtime persistence probe v1\n", "utf8");
const PROBE_SHA256 = createHash("sha256").update(PROBE_BODY).digest("hex");
const NO_STORE = { "Cache-Control": "no-store" };

type ProbeAction = "create" | "verify" | "delete";

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function hasExpectedEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "https:"
      && parsed.hostname === EXPECTED_ENDPOINT_HOSTNAME
      && parsed.port === ""
      && parsed.pathname === "/"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

async function readAction(request: Request): Promise<ProbeAction | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 1) {
      return null;
    }
    return record.action === "create" || record.action === "verify" || record.action === "delete"
      ? record.action
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (
    process.env.VERCEL_ENV !== EXPECTED_VERCEL_ENV
    || process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_GIT_BRANCH
  ) {
    return json({ error: "Not found." }, 404);
  }

  if (getActiveDocumentStorageBackend() !== "s3") {
    return json({ error: "Storage diagnostic unavailable." }, 503);
  }

  let config;
  try {
    config = getS3StorageConfig();
  } catch {
    return json({ error: "Storage diagnostic unavailable." }, 503);
  }

  if (
    config.bucket !== EXPECTED_BUCKET
    || config.region !== "auto"
    || !config.forcePathStyle
    || !hasExpectedEndpoint(config.endpoint)
  ) {
    return json({ error: "Storage diagnostic unavailable." }, 503);
  }

  const session = await getAuthSession();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return json({ error: "Authentication required." }, 401);
  }

  const action = await readAction(request);
  if (!action) {
    return json({ error: "Invalid request." }, 400);
  }

  const storage = getDocumentStorageAdapter();

  try {
    if (action === "create") {
      if (await storage.exists(PROBE_KEY)) {
        throw new Error("PROBE_ALREADY_EXISTS");
      }

      const result = await storage.createIfAbsent({
        storageKey: PROBE_KEY,
        body: PROBE_BODY,
        mimeType: "text/plain",
        originalName: "runtime-persistence-probe.txt",
        sha256: PROBE_SHA256,
        sizeBytes: PROBE_BODY.length,
      });
      if (result.disposition !== "CREATED") {
        throw new Error("PROBE_NOT_CREATED");
      }
    }

    const presentBeforeRead = await storage.exists(PROBE_KEY);
    if (!presentBeforeRead) {
      throw new Error("PROBE_MISSING");
    }

    const stored = await storage.get(PROBE_KEY);
    const observedSha256 = createHash("sha256").update(stored.body).digest("hex");
    if (!stored.body.equals(PROBE_BODY) || observedSha256 !== PROBE_SHA256) {
      throw new Error("PROBE_CONTENT_MISMATCH");
    }

    if (action === "delete") {
      await storage.delete(PROBE_KEY);
      if (await storage.exists(PROBE_KEY)) {
        throw new Error("PROBE_DELETE_INCOMPLETE");
      }
    }

    return json({
      status: action === "create" ? "CREATED" : action === "verify" ? "VERIFIED" : "DELETED",
      headVerified: true,
      sha256Verified: true,
      absentAfterDelete: action === "delete",
    }, 200);
  } catch (error) {
    let cleanupVerified = false;
    try {
      await storage.delete(PROBE_KEY);
      cleanupVerified = !(await storage.exists(PROBE_KEY));
    } catch {
      cleanupVerified = false;
    }

    console.error({
      event: "preview_storage_probe_failed",
      action,
      errorName: error instanceof Error ? error.name : "UnknownError",
      cleanupVerified,
    });
    return json({ error: "Storage diagnostic failed.", cleanupVerified }, 503);
  }
}
