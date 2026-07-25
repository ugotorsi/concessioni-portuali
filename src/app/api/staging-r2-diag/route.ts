import { NextResponse } from "next/server";

import { getDocumentStorageAdapter } from "@/server/documents/storage";

export const runtime = "nodejs";

function safeEqual(left: string | undefined, right: string): boolean {
  return (left ?? "").trim() === right;
}

function hasValue(input: string | undefined): boolean {
  return (input ?? "").trim().length > 0;
}

function isAuthorized(request: Request): boolean {
  const configured = process.env.STAGING_R2_DIAG_SECRET;
  if (!configured || configured.trim().length < 16) {
    return false;
  }

  const provided = request.headers.get("x-staging-r2-diag-secret") ?? "";
  return provided === configured;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const backendExpected = safeEqual(process.env.DOCUMENT_STORAGE_BACKEND, "s3");
  const regionExpected = safeEqual(process.env.S3_REGION, "auto");
  const bucketExpected = safeEqual(process.env.S3_BUCKET, "concessioni-portuali-staging");
  const forcePathExpected = safeEqual(process.env.S3_FORCE_PATH_STYLE, "true");
  const endpointPresent = hasValue(process.env.S3_ENDPOINT);
  const accessKeyPresent = hasValue(process.env.S3_ACCESS_KEY_ID);
  const secretKeyPresent = hasValue(process.env.S3_SECRET_ACCESS_KEY);

  const configValid =
    backendExpected &&
    regionExpected &&
    bucketExpected &&
    forcePathExpected &&
    endpointPresent &&
    accessKeyPresent &&
    secretKeyPresent;

  let writeOk = false;
  let readOk = false;
  let deleteOk = false;

  if (configValid) {
    const storage = getDocumentStorageAdapter();
    const marker = `staging-r2-diag-${Date.now()}`;
    const body = Buffer.from(marker, "utf8");
    const key = `__diag__/${marker}.txt`;

    try {
      await storage.put({
        storageKey: key,
        body,
        mimeType: "text/plain",
        sizeBytes: body.byteLength,
        sha256: marker,
        originalName: "diag.txt",
      });
      writeOk = true;

      const read = await storage.get(key);
      readOk = read.body.toString("utf8") === marker;

      await storage.delete(key);
      const existsAfterDelete = await storage.exists(key);
      deleteOk = !existsAfterDelete;
    } catch {
      writeOk = false;
      readOk = false;
      deleteOk = false;
    }
  }

  return NextResponse.json({
    configValid,
    writeOk,
    readOk,
    deleteOk,
    bucketExpected,
    backendExpected,
  });
}
