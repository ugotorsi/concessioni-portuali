import { createHash } from "node:crypto";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getS3StorageConfig } from "@/server/documents/storage/config";

const EXPECTED_WORKER_ID = "concessioni-portuali-staging-01";
const EXPECTED_BUCKET = "concessioni-portuali-staging-c1-bdeaa8dd";
const OBJECT_KEY = "intake/sha256/962787b6969e6b0b99dc00544e7b2036f2bb3ee20370de7712e3503bfb9de3ca";
const MAX_BYTES = 1024 * 1024;

type AwsError = Error & {
  code?: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
  };
};

function safeCode(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  const candidate = error as AwsError;
  const value = candidate.code ?? candidate.name;
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : "UnknownError";
}

export async function runR2WorkerProbeIfEnabled(): Promise<void> {
  if (process.env.ALLOW_R2_WORKER_PROBE !== "true") return;
  if (
    process.env.ASYNC_WORKER_ID !== EXPECTED_WORKER_ID
    || process.env.ASYNC_PROVIDER_EXECUTION_ENABLED !== "false"
  ) {
    throw new Error("R2 worker probe staging guard failed.");
  }

  const config = getS3StorageConfig();
  if (config.bucket !== EXPECTED_BUCKET) {
    throw new Error("R2 worker probe bucket guard failed.");
  }

  const endpointHost = new URL(config.endpoint).host;
  const keyFingerprint = createHash("sha256").update(OBJECT_KEY).digest("hex");
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: OBJECT_KEY,
      Range: `bytes=0-${MAX_BYTES - 1}`,
    }));
    const bytes = response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error("R2 worker probe byte limit exceeded.");
    }
    console.log(JSON.stringify({
      event: "R2_WORKER_PROBE",
      httpStatus: response.$metadata.httpStatusCode ?? 200,
      code: null,
      requestId: response.$metadata.requestId ?? null,
      endpointHost,
      bucket: config.bucket,
      keyFingerprint,
      contentLength: response.ContentLength ?? bytes.byteLength,
    }));
  } catch (error) {
    const candidate = error as AwsError;
    console.log(JSON.stringify({
      event: "R2_WORKER_PROBE",
      httpStatus: candidate.$metadata?.httpStatusCode ?? null,
      code: safeCode(error),
      requestId: candidate.$metadata?.requestId ?? null,
      endpointHost,
      bucket: config.bucket,
      keyFingerprint,
      contentLength: null,
    }));
  } finally {
    client.destroy();
  }
}
