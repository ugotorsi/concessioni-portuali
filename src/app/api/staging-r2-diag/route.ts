import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getDocumentStorageAdapter } from "@/server/documents/storage";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";

export const runtime = "nodejs";

interface DiagResponse {
  configValid: boolean;
  writeOk: boolean;
  readOk: boolean;
  deleteOk: boolean;
  bucketExpected: boolean;
  backendExpected: boolean;
  errorCode?: string;
}

function hasText(value: string | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

function getSanitizedErrorCode(error: unknown): string {
  if (error instanceof DocumentStorageS3Error) {
    return `S3_${error.diagnostics.operation}_${error.diagnostics.code}`;
  }

  if (error instanceof Error && error.name) {
    return `UNEXPECTED_${error.name.toUpperCase()}`;
  }

  return "UNEXPECTED_ERROR";
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return unauthorized();
  }

  if (process.env.VERCEL_GIT_COMMIT_REF !== "staging-operativo") {
    return unauthorized();
  }

  const configuredSecret = process.env.STAGING_R2_DIAG_SECRET;
  const providedSecret = request.headers.get("x-staging-r2-diag-secret") ?? "";
  if (!hasText(configuredSecret) || providedSecret !== configuredSecret) {
    return unauthorized();
  }

  const backendExpected = process.env.DOCUMENT_STORAGE_BACKEND === "s3";
  const bucketExpected = process.env.S3_BUCKET === "concessioni-portuali-staging";
  const regionExpected = process.env.S3_REGION === "auto";
  const forcePathStyleExpected = process.env.S3_FORCE_PATH_STYLE === "true";
  const endpointPresent = hasText(process.env.S3_ENDPOINT);
  const accessKeyPresent = hasText(process.env.S3_ACCESS_KEY_ID);
  const secretKeyPresent = hasText(process.env.S3_SECRET_ACCESS_KEY);

  const configValid =
    backendExpected &&
    bucketExpected &&
    regionExpected &&
    forcePathStyleExpected &&
    endpointPresent &&
    accessKeyPresent &&
    secretKeyPresent;

  const response: DiagResponse = {
    configValid,
    writeOk: false,
    readOk: false,
    deleteOk: false,
    bucketExpected,
    backendExpected,
  };

  if (!configValid) {
    response.errorCode = "CONFIG_MISMATCH";
    return NextResponse.json(response);
  }

  const adapter = getDocumentStorageAdapter();
  const nonce = randomUUID();
  const storageKey = `_diagnostics/${nonce}.txt`;
  const content = `diag:${nonce}`;
  const body = Buffer.from(content, "utf8");

  try {
    await adapter.put({
      storageKey,
      body,
      mimeType: "text/plain",
      sizeBytes: body.byteLength,
      sha256: nonce,
      originalName: "diag.txt",
    });
    response.writeOk = true;

    const readResult = await adapter.get(storageKey);
    response.readOk = readResult.body.toString("utf8") === content;
  } catch (error) {
    response.errorCode = getSanitizedErrorCode(error);
    return NextResponse.json(response);
  } finally {
    try {
      await adapter.delete(storageKey);
      const existsAfterDelete = await adapter.exists(storageKey);
      response.deleteOk = !existsAfterDelete;
    } catch {
      if (!response.errorCode) {
        response.errorCode = "DELETE_FAILED";
      }
      response.deleteOk = false;
    }
  }

  if (!response.writeOk || !response.readOk || !response.deleteOk) {
    if (!response.errorCode) {
      response.errorCode = "RUNTIME_CHECK_FAILED";
    }
    return NextResponse.json(response);
  }

  return NextResponse.json(response);
}
