import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

type DatabaseLabel = "canonical" | "historical";

type StorageReference = {
  database: DatabaseLabel;
  table: "Documento" | "DocumentFileVersion";
  rowId: string;
  provider: string;
  bucket: string;
  key: string;
  sizeBytes: number | null;
  sha256: string | null;
};

type ObjectInventory = {
  database: DatabaseLabel;
  bucket: string;
  key: string;
  referenceCount: number;
  expectedSizes: number[];
  expectedSha256: string[];
  remote: {
    status: "VERIFIED" | "NOT_CONFIGURED" | "NOT_FOUND" | "ERROR";
    contentLength?: number;
    etag?: string;
    metadataSha256?: string;
    errorCode?: string;
  };
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function optionalS3Client(label: DatabaseLabel): S3Client | null {
  const prefix = label === "historical" ? "NOETRA_HISTORICAL_S3_" : "NOETRA_CANONICAL_S3_";
  const endpoint = process.env[`${prefix}ENDPOINT`]?.trim();
  const region = process.env[`${prefix}REGION`]?.trim();
  const accessKeyId = process.env[`${prefix}ACCESS_KEY_ID`]?.trim();
  const secretAccessKey = process.env[`${prefix}SECRET_ACCESS_KEY`]?.trim();
  if (!endpoint && !region && !accessKeyId && !secretAccessKey) return null;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(`${prefix}CONFIG_INCOMPLETE`);
  }
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: process.env[`${prefix}FORCE_PATH_STYLE`] !== "false",
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function loadReferences(
  database: DatabaseLabel,
  connectionString: string,
): Promise<StorageReference[]> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ");
    const result = await client.query<{
      table: StorageReference["table"];
      rowId: string;
      provider: string;
      bucket: string;
      key: string;
      sizeBytes: number | null;
      sha256: string | null;
    }>(`
      SELECT
        'Documento'::text AS "table",
        "id" AS "rowId",
        "storageProvider" AS provider,
        "storageBucket" AS bucket,
        "storageKey" AS key,
        "sizeBytes",
        COALESCE("sha256", "checksumSha256") AS sha256
      FROM "Documento"
      WHERE "storageKey" IS NOT NULL
      UNION ALL
      SELECT
        'DocumentFileVersion'::text,
        "id",
        "storageProvider",
        "storageBucket",
        "storageKey",
        "sizeBytes",
        "sha256"
      FROM "DocumentFileVersion"
      WHERE "storageKey" IS NOT NULL
      ORDER BY 1, 2
    `);
    await client.query("ROLLBACK");
    return result.rows.map((row) => {
      if (!row.provider || !row.bucket || !row.key) {
        throw new Error(`STORAGE_REFERENCE_INCOMPLETE:${database}:${row.table}:${row.rowId}`);
      }
      return { database, ...row };
    });
  } finally {
    client.release();
    await pool.end();
  }
}

function errorCode(error: unknown): string {
  const candidate = error as { name?: string; code?: string };
  return candidate.code ?? candidate.name ?? "UNKNOWN";
}

async function main(): Promise<void> {
  const output = required("NOETRA_STORAGE_INVENTORY_OUTPUT");
  const references = [
    ...await loadReferences("historical", required("NOETRA_HISTORICAL_DATABASE_URL")),
    ...await loadReferences("canonical", required("NOETRA_CANONICAL_DATABASE_URL")),
  ];
  const clients = {
    historical: optionalS3Client("historical"),
    canonical: optionalS3Client("canonical"),
  };
  const grouped = new Map<string, StorageReference[]>();
  for (const reference of references) {
    const key = `${reference.database}\0${reference.bucket}\0${reference.key}`;
    grouped.set(key, [...(grouped.get(key) ?? []), reference]);
  }
  const objects: ObjectInventory[] = [];
  for (const entries of grouped.values()) {
    const first = entries[0];
    const client = clients[first.database];
    const inventory: ObjectInventory = {
      database: first.database,
      bucket: first.bucket,
      key: first.key,
      referenceCount: entries.length,
      expectedSizes: [...new Set(entries.flatMap((entry) => (
        entry.sizeBytes == null ? [] : [entry.sizeBytes]
      )))].sort((left, right) => left - right),
      expectedSha256: [...new Set(entries.flatMap((entry) => (
        entry.sha256 == null ? [] : [entry.sha256]
      )))].sort(),
      remote: { status: "NOT_CONFIGURED" },
    };
    if (client) {
      try {
        const head = await client.send(new HeadObjectCommand({
          Bucket: first.bucket,
          Key: first.key,
        }));
        inventory.remote = {
          status: "VERIFIED",
          contentLength: head.ContentLength,
          etag: head.ETag,
          metadataSha256: head.Metadata?.sha256,
        };
        if (
          inventory.expectedSizes.length > 0
          && !inventory.expectedSizes.includes(head.ContentLength ?? -1)
        ) {
          throw new Error(`STORAGE_SIZE_MISMATCH:${first.database}:${first.key}`);
        }
        if (
          head.Metadata?.sha256
          && inventory.expectedSha256.length > 0
          && !inventory.expectedSha256.includes(head.Metadata.sha256)
        ) {
          throw new Error(`STORAGE_SHA256_MISMATCH:${first.database}:${first.key}`);
        }
      } catch (error) {
        const code = errorCode(error);
        inventory.remote = {
          status: code === "NotFound" || code === "NoSuchKey" ? "NOT_FOUND" : "ERROR",
          errorCode: code,
        };
      }
    }
    objects.push(inventory);
  }
  objects.sort((left, right) => (
    left.database.localeCompare(right.database)
    || left.bucket.localeCompare(right.bucket)
    || left.key.localeCompare(right.key)
  ));
  const remoteRequired = process.env.NOETRA_STORAGE_REQUIRE_REMOTE_HEAD === "true";
  const remoteVerified = objects.filter((object) => object.remote.status === "VERIFIED").length;
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    references,
    objects,
    summary: {
      referenceCount: references.length,
      uniqueObjectCount: objects.length,
      historicalObjects: objects.filter((object) => object.database === "historical").length,
      canonicalObjects: objects.filter((object) => object.database === "canonical").length,
      remoteVerified,
      remotePending: objects.length - remoteVerified,
    },
  };
  const canonical = JSON.stringify(manifest);
  const envelope = {
    ...manifest,
    manifestSha256: createHash("sha256").update(canonical).digest("hex"),
  };
  await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx" });
  console.info(`NOETRA_STORAGE_INVENTORY=${JSON.stringify({
    output,
    ...manifest.summary,
    manifestSha256: envelope.manifestSha256,
  })}`);
  if (remoteRequired && remoteVerified !== objects.length) {
    throw new Error("STORAGE_REMOTE_VERIFICATION_INCOMPLETE");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "STORAGE_INVENTORY_FAILED");
  process.exitCode = 1;
});
