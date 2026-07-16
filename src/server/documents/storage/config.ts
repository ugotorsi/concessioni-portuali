import path from "node:path";

import type { DocumentStorageBackend } from "./types";

const DEFAULT_STORAGE_ROOT = ".local-storage/documents";

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) {
    return fallback;
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return fallback;
}

export function getDocumentStorageBackend(): DocumentStorageBackend {
  const configured = process.env.DOCUMENT_STORAGE_BACKEND?.trim().toLowerCase();

  if (configured === "s3") {
    return "s3";
  }

  if (configured === "local") {
    return "local";
  }

  if (process.env.NODE_ENV === "production") {
    return "local";
  }

  return "local";
}

export function getDocumentStorageRoot(): string {
  const configured = process.env.DOCUMENT_STORAGE_ROOT?.trim();
  if (!configured) {
    return DEFAULT_STORAGE_ROOT;
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }

  return configured;
}

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function getS3StorageConfig(): S3StorageConfig {
  const endpoint = process.env.S3_ENDPOINT?.trim() ?? "";
  const region = process.env.S3_REGION?.trim() ?? "";
  const bucket = process.env.S3_BUCKET?.trim() ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim() ?? "";
  const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE, true);

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "DOCUMENT_STORAGE_BACKEND=s3 richiede S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY.",
    );
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  };
}
