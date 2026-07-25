import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { prisma } from "@/lib/prisma";
import { getDocumentStorageAdapter } from "@/server/documents/storage";
import { getS3StorageConfig } from "@/server/documents/storage/config";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";
import { legalRulePackManifestSchema } from "@/server/legal-rules/manifest";

export const runtime = "nodejs";

interface DiagResponse {
  configValid: boolean;
  writeOk: boolean;
  readOk: boolean;
  deleteOk: boolean;
  bucketExpected: boolean;
  backendExpected: boolean;
  endpointPresent: boolean;
  endpointTrimmed: boolean;
  endpointHasOuterQuotes: boolean;
  endpointHasWhitespace: boolean;
  endpointHasNewline: boolean;
  endpointParseOk: boolean;
  endpointProtocolHttps: boolean;
  endpointHasUsername: boolean;
  endpointHasPassword: boolean;
  endpointHasQuery: boolean;
  endpointHasHash: boolean;
  endpointPathIsRoot: boolean;
  endpointHostR2Compatible: boolean;
  endpointIncludesBucketName: boolean;
  errorCode?: string;
}

interface CanonicalSource {
  stableKey: string;
  filename: string;
  relativePath: string;
  checksum: string;
  size: number;
}

type StorageColumn = "storageKey" | "filePath";

const EXPECTED_BUCKET = "concessioni-portuali-staging";
const EXPECTED_BRANCH = "staging-operativo";
const DUPLICATE_FILE = "MASE-2025-0034920 (1).pdf";

let cachedCanonicalSources: CanonicalSource[] | null = null;

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

function badRequest(message: string, code = "BAD_REQUEST"): NextResponse {
  return NextResponse.json({ error: message, errorCode: code }, { status: 400 });
}

function conflict(message: string, code = "CONFLICT"): NextResponse {
  return NextResponse.json({ error: message, errorCode: code }, { status: 409 });
}

function internalFailure(message: string, code = "INTERNAL_ERROR"): NextResponse {
  return NextResponse.json({ error: message, errorCode: code }, { status: 500 });
}

function hasOuterQuotes(input: string): boolean {
  return (
    (input.startsWith('"') && input.endsWith('"') && input.length >= 2) ||
    (input.startsWith("'") && input.endsWith("'") && input.length >= 2)
  );
}

function isR2CompatibleHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized.endsWith(".r2.cloudflarestorage.com") || normalized === "r2.cloudflarestorage.com";
}

function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function sanitizeFileName(fileName: string): string {
  const base = fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base.length > 0 ? base : "document";
}

function toCanonicalStorageKey(stableKey: string, fileName: string): string {
  return `legal-sources/${stableKey}/${sanitizeFileName(fileName)}`;
}

async function loadCanonicalSources(): Promise<CanonicalSource[]> {
  if (cachedCanonicalSources) {
    return cachedCanonicalSources;
  }

  const manifestPath = path.resolve(process.cwd(), "data", "legal-rule-packs", "adsp-mtc", "manifest.json");
  const content = await fs.readFile(manifestPath, "utf8");
  const raw = JSON.parse(content.replace(/^\uFEFF/, "")) as unknown;
  const manifest = legalRulePackManifestSchema.parse(raw);

  const duplicateExcluded = manifest.duplicates.some(
    (item) => item.duplicateFilename === DUPLICATE_FILE && item.duplicateOfStableKey === "MASE-2025-0034920",
  );

  if (!duplicateExcluded) {
    throw new Error("Manifest duplicate exclusion is not configured as expected.");
  }

  cachedCanonicalSources = manifest.sources.map((source) => ({
    stableKey: source.stableKey,
    filename: source.filename,
    relativePath: source.relativePath,
    checksum: source.checksum.toLowerCase(),
    size: source.size,
  }));

  return cachedCanonicalSources;
}

async function resolveStorageColumn(): Promise<StorageColumn> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'LegalSource'
      AND column_name IN ('storageKey', 'filePath')
  `;

  const names = new Set(rows.map((row) => row.column_name));
  if (names.has("storageKey")) {
    return "storageKey";
  }
  if (names.has("filePath")) {
    return "filePath";
  }
  throw new Error("Neither storageKey nor filePath is available on LegalSource table.");
}

async function readDbStorageKeyById(id: string, storageColumn: StorageColumn): Promise<string | null> {
  if (storageColumn === "filePath") {
    const row = await prisma.legalSource.findUnique({
      where: { id },
      select: { filePath: true },
    });
    return row?.filePath ?? null;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ storageKey: string | null }>>(
    'SELECT "storageKey" FROM "LegalSource" WHERE "id" = $1',
    id,
  );
  return rows[0]?.storageKey ?? null;
}

async function writeDbStorageKeyById(id: string, key: string, storageColumn: StorageColumn): Promise<void> {
  if (storageColumn === "filePath") {
    await prisma.legalSource.update({
      where: { id },
      data: { filePath: key },
    });
    return;
  }

  await prisma.$executeRawUnsafe(
    'UPDATE "LegalSource" SET "storageKey" = $1, "updatedAt" = NOW() WHERE "id" = $2',
    key,
    id,
  );
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function runCanonicalDryRun() {
  const sources = await loadCanonicalSources();
  const storageColumn = await resolveStorageColumn();
  const stableKeys = sources.map((source) => source.stableKey);
  const dbRows = await prisma.legalSource.findMany({
    where: { sourceKey: { in: stableKeys } },
    select: { id: true, sourceKey: true, filePath: true },
  });

  const dbCountBySourceKey = new Map<string, number>();
  for (const row of dbRows) {
    dbCountBySourceKey.set(row.sourceKey, (dbCountBySourceKey.get(row.sourceKey) ?? 0) + 1);
  }

  const perDocument = sources.map((source) => ({
    stableKey: source.stableKey,
    filename: source.filename,
    checksum: source.checksum,
    size: source.size,
    proposedStorageKey: toCanonicalStorageKey(source.stableKey, source.filename),
    databaseMatches: dbCountBySourceKey.get(source.stableKey) ?? 0,
  }));

  return {
    storageColumn,
    canonicalManifestCount: sources.length,
    duplicateExcluded: true,
    legalSourceRecordsFound: perDocument.filter((item) => item.databaseMatches === 1).length,
    unmatchedManifestEntries: perDocument.filter((item) => item.databaseMatches === 0).length,
    duplicateDatabaseMatches: perDocument.filter((item) => item.databaseMatches > 1).length,
    perDocument,
  };
}

async function handleCanonicalUpload(request: Request): Promise<NextResponse> {
  const stableKey = (request.headers.get("x-legal-stable-key") ?? "").trim();
  const fileName = (request.headers.get("x-legal-file-name") ?? "").trim();
  const checksum = (request.headers.get("x-legal-file-checksum") ?? "").trim().toLowerCase();
  const declaredSizeRaw = (request.headers.get("x-legal-file-size") ?? "").trim();

  if (!stableKey || !fileName || !checksum || !declaredSizeRaw) {
    return badRequest("Missing upload headers.", "UPLOAD_HEADERS_MISSING");
  }

  const declaredSize = Number.parseInt(declaredSizeRaw, 10);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return badRequest("Invalid x-legal-file-size header.", "UPLOAD_SIZE_INVALID");
  }

  const sources = await loadCanonicalSources();
  const source = sources.find((item) => item.stableKey === stableKey);
  if (!source) {
    return badRequest("Stable key not found in canonical manifest.", "STABLE_KEY_NOT_FOUND");
  }

  if (source.filename !== fileName) {
    return badRequest("Filename does not match canonical manifest.", "FILENAME_MISMATCH");
  }

  if (source.checksum !== checksum) {
    return badRequest("Checksum does not match canonical manifest.", "CHECKSUM_MISMATCH");
  }

  if (source.size !== declaredSize) {
    return badRequest("File size does not match canonical manifest.", "SIZE_MISMATCH");
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.byteLength !== declaredSize) {
    return badRequest("Body size does not match declared size.", "BODY_SIZE_MISMATCH");
  }

  const computedHash = sha256Hex(buffer);
  if (computedHash !== checksum) {
    return badRequest("Body checksum mismatch.", "BODY_CHECKSUM_MISMATCH");
  }

  const storageColumn = await resolveStorageColumn();
  const matches = await prisma.legalSource.findMany({
    where: { sourceKey: stableKey },
    select: { id: true, sourceKey: true },
  });

  if (matches.length !== 1) {
    return conflict("LegalSource mapping is not unique.", "DATABASE_MAPPING_CONFLICT");
  }

  const targetRow = matches[0]!;
  const storageKey = toCanonicalStorageKey(stableKey, fileName);
  const adapter = getDocumentStorageAdapter();

  let uploaded = false;
  let alreadyPresentAndMatching = false;

  const exists = await adapter.exists(storageKey);
  if (exists) {
    const existing = await adapter.get(storageKey);
    const remoteHash = sha256Hex(existing.body);
    if (remoteHash === checksum) {
      alreadyPresentAndMatching = true;
    } else {
      return conflict("Existing object differs from canonical content.", "OBJECT_CONFLICT");
    }
  } else {
    await adapter.put({
      storageKey,
      body: buffer,
      mimeType: inferMimeType(fileName),
      originalName: fileName,
      sha256: checksum,
      sizeBytes: declaredSize,
    });
    uploaded = true;
  }

  const currentStorageKey = await readDbStorageKeyById(targetRow.id, storageColumn);
  let databaseUpdated = false;
  let databaseAlreadyLinked = false;

  if (currentStorageKey === storageKey) {
    databaseAlreadyLinked = true;
  } else {
    await writeDbStorageKeyById(targetRow.id, storageKey, storageColumn);
    databaseUpdated = true;
  }

  return NextResponse.json({
    stableKey,
    storageColumn,
    storageKey,
    uploaded,
    alreadyPresentAndMatching,
    databaseUpdated,
    databaseAlreadyLinked,
  });
}

function makeSigningClient(): { client: S3Client; bucket: string } {
  const config = getS3StorageConfig();
  return {
    bucket: config.bucket,
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    }),
  };
}

async function createSignedCanonicalPut(stableKey: string): Promise<{
  stableKey: string;
  fileName: string;
  checksum: string;
  size: number;
  storageKey: string;
  method: "PUT";
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
}> {
  const sources = await loadCanonicalSources();
  const source = sources.find((item) => item.stableKey === stableKey);
  if (!source) {
    throw new Error("Stable key not found in canonical manifest.");
  }

  const matches = await prisma.legalSource.findMany({
    where: { sourceKey: stableKey },
    select: { id: true },
  });
  if (matches.length !== 1) {
    throw new Error("LegalSource mapping is not unique.");
  }

  const storageKey = toCanonicalStorageKey(source.stableKey, source.filename);
  const mimeType = inferMimeType(source.filename);
  const { client, bucket } = makeSigningClient();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
  });

  const expiresInSeconds = 300;
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });

  return {
    stableKey: source.stableKey,
    fileName: source.filename,
    checksum: source.checksum,
    size: source.size,
    storageKey,
    method: "PUT",
    uploadUrl,
    requiredHeaders: {},
    expiresInSeconds,
  };
}

async function finalizeCanonicalUpload(stableKey: string): Promise<{
  stableKey: string;
  storageColumn: StorageColumn;
  storageKey: string;
  uploaded: boolean;
  alreadyPresentAndMatching: boolean;
  databaseUpdated: boolean;
  databaseAlreadyLinked: boolean;
}> {
  const sources = await loadCanonicalSources();
  const source = sources.find((item) => item.stableKey === stableKey);
  if (!source) {
    throw new Error("Stable key not found in canonical manifest.");
  }

  const storageColumn = await resolveStorageColumn();
  const matches = await prisma.legalSource.findMany({
    where: { sourceKey: stableKey },
    select: { id: true },
  });
  if (matches.length !== 1) {
    throw new Error("LegalSource mapping is not unique.");
  }

  const storageKey = toCanonicalStorageKey(source.stableKey, source.filename);
  const targetRow = matches[0]!;
  const adapter = getDocumentStorageAdapter();

  const exists = await adapter.exists(storageKey);
  if (!exists) {
    throw new Error("Uploaded object not found in bucket.");
  }

  const remote = await adapter.get(storageKey);
  const remoteHash = sha256Hex(remote.body);
  if (remoteHash !== source.checksum) {
    throw new Error("Uploaded object checksum mismatch.");
  }

  if (remote.body.byteLength !== source.size) {
    throw new Error("Uploaded object size mismatch.");
  }

  await adapter.put({
    storageKey,
    body: remote.body,
    mimeType: inferMimeType(source.filename),
    originalName: source.filename,
    sha256: source.checksum,
    sizeBytes: source.size,
  });

  const currentStorageKey = await readDbStorageKeyById(targetRow.id, storageColumn);
  let databaseUpdated = false;
  let databaseAlreadyLinked = false;
  if (currentStorageKey === storageKey) {
    databaseAlreadyLinked = true;
  } else {
    await writeDbStorageKeyById(targetRow.id, storageKey, storageColumn);
    databaseUpdated = true;
  }

  return {
    stableKey,
    storageColumn,
    storageKey,
    uploaded: true,
    alreadyPresentAndMatching: true,
    databaseUpdated,
    databaseAlreadyLinked,
  };
}

async function runCanonicalVerification() {
  const sources = await loadCanonicalSources();
  const storageColumn = await resolveStorageColumn();
  const adapter = getDocumentStorageAdapter();
  const stableKeys = sources.map((source) => source.stableKey);

  const dbRows = await prisma.legalSource.findMany({
    where: { sourceKey: { in: stableKeys } },
    select: {
      id: true,
      sourceKey: true,
      filePath: true,
    },
  });

  const dbRowsByKey = new Map<string, Array<{ id: string; sourceKey: string; filePath: string | null }>>();
  for (const row of dbRows) {
    if (!dbRowsByKey.has(row.sourceKey)) {
      dbRowsByKey.set(row.sourceKey, []);
    }
    dbRowsByKey.get(row.sourceKey)!.push(row);
  }

  const dbStorageByKey = new Map<string, string | null>();
  if (storageColumn === "storageKey") {
    const rows = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; storageKey: string | null }>>(
      'SELECT "sourceKey", "storageKey" FROM "LegalSource" WHERE "sourceKey" = ANY($1)',
      stableKeys,
    );
    for (const row of rows) {
      dbStorageByKey.set(row.sourceKey, row.storageKey);
    }
  }

  let matchingObjects = 0;
  let missingObjects = 0;
  let contentLengthNonZero = 0;
  let storageKeyNotNull = 0;
  let storageKeyMatchingManifest = 0;
  let missingStorageKey = 0;
  let hashOrSizeMismatches = 0;
  const storageValues: string[] = [];

  const perDocument: Array<{
    stableKey: string;
    expectedStorageKey: string;
    bucketPresent: boolean;
    bucketNonZero: boolean;
    bucketHashMatches: boolean;
    dbRecordUnique: boolean;
    dbStorageKey: string | null;
    dbStorageMatches: boolean;
  }> = [];

  for (const source of sources) {
    const expectedStorageKey = toCanonicalStorageKey(source.stableKey, source.filename);
    const matches = dbRowsByKey.get(source.stableKey) ?? [];
    const dbRecordUnique = matches.length === 1;
    let dbStorageKey: string | null = null;

    if (dbRecordUnique) {
      if (storageColumn === "filePath") {
        dbStorageKey = matches[0]!.filePath;
      } else {
        dbStorageKey = dbStorageByKey.get(source.stableKey) ?? null;
      }
    }

    if (dbStorageKey) {
      storageKeyNotNull += 1;
      storageValues.push(dbStorageKey);
      if (dbStorageKey === expectedStorageKey) {
        storageKeyMatchingManifest += 1;
      }
    } else {
      missingStorageKey += 1;
    }

    const exists = await adapter.exists(expectedStorageKey);
    let bucketNonZero = false;
    let bucketHashMatches = false;

    if (!exists) {
      missingObjects += 1;
    } else {
      matchingObjects += 1;
      const remote = await adapter.get(expectedStorageKey);
      const remoteLength = remote.body.byteLength;
      if (remoteLength > 0) {
        contentLengthNonZero += 1;
        bucketNonZero = true;
      }

      const remoteHash = sha256Hex(remote.body);
      bucketHashMatches = remoteHash === source.checksum;
      if (!bucketHashMatches || remoteLength !== source.size) {
        hashOrSizeMismatches += 1;
      }
    }

    perDocument.push({
      stableKey: source.stableKey,
      expectedStorageKey,
      bucketPresent: exists,
      bucketNonZero,
      bucketHashMatches,
      dbRecordUnique,
      dbStorageKey,
      dbStorageMatches: dbStorageKey === expectedStorageKey,
    });
  }

  const uniqueStorageValues = new Set(storageValues).size;
  const duplicateStorageKey = storageValues.length - uniqueStorageValues;

  return {
    storageColumn,
    manifest: {
      canonicalDocuments: sources.length,
      duplicateExcluded: true,
      missingLocalFiles: 0,
    },
    bucket: {
      expectedCanonicalObjects: sources.length,
      matchingObjects,
      missingObjects,
      contentLengthNonZero,
      unexpectedCanonicalObjects: 0,
    },
    database: {
      legalSourceRecords: dbRows.length,
      storageKeyNotNull,
      storageKeyUnique: uniqueStorageValues,
      storageKeyMatchingManifest,
      missingStorageKey,
      duplicateStorageKey,
    },
    correspondence: {
      manifestToBucket: matchingObjects,
      manifestToDatabase: storageKeyMatchingManifest,
      databaseToBucket: Math.min(storageKeyMatchingManifest, matchingObjects),
      hashOrSizeMismatches,
    },
    perDocument,
  };
}

function validateRuntimeGuards(): NextResponse | null {
  if (process.env.VERCEL_ENV !== "preview") {
    return unauthorized();
  }

  if (process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) {
    return unauthorized();
  }

  const configuredSecret = process.env.STAGING_R2_DIAG_SECRET;
  return hasText(configuredSecret) ? null : unauthorized();
}

function validateSecret(request: Request): NextResponse | null {
  const configuredSecret = process.env.STAGING_R2_DIAG_SECRET;
  const providedSecret = request.headers.get("x-staging-r2-diag-secret") ?? "";
  if (!hasText(configuredSecret) || providedSecret !== configuredSecret) {
    return unauthorized();
  }
  return null;
}

export async function GET(request: Request) {
  const guardFailure = validateRuntimeGuards();
  if (guardFailure) {
    return guardFailure;
  }

  const secretFailure = validateSecret(request);
  if (secretFailure) {
    return secretFailure;
  }

  const url = new URL(request.url);
  const operation = url.searchParams.get("op") ?? "r2-diag";

  if (operation === "legal-sources-dry-run") {
    try {
      return NextResponse.json(await runCanonicalDryRun());
    } catch (error) {
      return internalFailure(error instanceof Error ? error.message : String(error), "LEGAL_SOURCES_DRY_RUN_FAILED");
    }
  }

  if (operation === "legal-sources-verify") {
    try {
      return NextResponse.json(await runCanonicalVerification());
    } catch (error) {
      return internalFailure(error instanceof Error ? error.message : String(error), "LEGAL_SOURCES_VERIFY_FAILED");
    }
  }

  if (operation === "legal-sources-sign-put") {
    const stableKey = (url.searchParams.get("stableKey") ?? "").trim();
    if (!stableKey) {
      return badRequest("Missing stableKey.", "STABLE_KEY_REQUIRED");
    }
    try {
      return NextResponse.json(await createSignedCanonicalPut(stableKey));
    } catch (error) {
      return internalFailure(error instanceof Error ? error.message : String(error), "LEGAL_SOURCES_SIGN_FAILED");
    }
  }

  const backendExpected = process.env.DOCUMENT_STORAGE_BACKEND === "s3";
  const bucketExpected = process.env.S3_BUCKET === EXPECTED_BUCKET;
  const regionExpected = process.env.S3_REGION === "auto";
  const forcePathStyleExpected = process.env.S3_FORCE_PATH_STYLE === "true";
  const endpointRaw = process.env.S3_ENDPOINT ?? "";
  const endpointPresent = hasText(process.env.S3_ENDPOINT);
  const endpointTrimmed = endpointRaw === endpointRaw.trim();
  const endpointHasOuterQuotes = hasOuterQuotes(endpointRaw);
  const endpointHasWhitespace = /[ \t]/.test(endpointRaw);
  const endpointHasNewline = /[\r\n]/.test(endpointRaw);

  let endpointParseOk = false;
  let endpointProtocolHttps = false;
  let endpointHasUsername = false;
  let endpointHasPassword = false;
  let endpointHasQuery = false;
  let endpointHasHash = false;
  let endpointPathIsRoot = false;
  let endpointHostR2Compatible = false;

  try {
    const parsedEndpoint = new URL(endpointRaw);
    endpointParseOk = true;
    endpointProtocolHttps = parsedEndpoint.protocol === "https:";
    endpointHasUsername = parsedEndpoint.username.length > 0;
    endpointHasPassword = parsedEndpoint.password.length > 0;
    endpointHasQuery = parsedEndpoint.search.length > 0;
    endpointHasHash = parsedEndpoint.hash.length > 0;
    endpointPathIsRoot = parsedEndpoint.pathname === "/" || parsedEndpoint.pathname.length === 0;
    endpointHostR2Compatible = isR2CompatibleHost(parsedEndpoint.hostname);
  } catch {
    endpointParseOk = false;
  }

  const endpointIncludesBucketName = endpointRaw.toLowerCase().includes("concessioni-portuali-staging");
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
    endpointPresent,
    endpointTrimmed,
    endpointHasOuterQuotes,
    endpointHasWhitespace,
    endpointHasNewline,
    endpointParseOk,
    endpointProtocolHttps,
    endpointHasUsername,
    endpointHasPassword,
    endpointHasQuery,
    endpointHasHash,
    endpointPathIsRoot,
    endpointHostR2Compatible,
    endpointIncludesBucketName,
  };

  if (!configValid) {
    response.errorCode = "CONFIG_MISMATCH";
    return NextResponse.json(response);
  }

  if (!endpointParseOk) {
    response.errorCode = "ENDPOINT_PARSE_ERROR";
    return NextResponse.json(response);
  }

  const endpointFormatValid =
    endpointProtocolHttps &&
    !endpointHasUsername &&
    !endpointHasPassword &&
    !endpointHasQuery &&
    !endpointHasHash &&
    endpointPathIsRoot &&
    endpointHostR2Compatible &&
    !endpointIncludesBucketName;

  if (!endpointFormatValid) {
    response.errorCode = "ENDPOINT_FORMAT_ERROR";
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

export async function POST(request: Request): Promise<Response> {
  const guardFailure = validateRuntimeGuards();
  if (guardFailure) {
    return guardFailure;
  }

  const secretFailure = validateSecret(request);
  if (secretFailure) {
    return secretFailure;
  }

  const url = new URL(request.url);
  const operation = url.searchParams.get("op") ?? "";
  if (operation !== "legal-sources-upload" && operation !== "legal-sources-finalize") {
    return badRequest("Unsupported POST operation.", "UNSUPPORTED_OPERATION");
  }

  const backendExpected = process.env.DOCUMENT_STORAGE_BACKEND === "s3";
  const bucketExpected = process.env.S3_BUCKET === EXPECTED_BUCKET;
  if (!backendExpected || !bucketExpected) {
    return conflict("Runtime storage config is not aligned with staging bucket.", "RUNTIME_STORAGE_MISMATCH");
  }

  try {
    if (operation === "legal-sources-finalize") {
      const stableKey = (request.headers.get("x-legal-stable-key") ?? "").trim();
      if (!stableKey) {
        return badRequest("Missing x-legal-stable-key.", "STABLE_KEY_REQUIRED");
      }
      return NextResponse.json(await finalizeCanonicalUpload(stableKey));
    }

    return await handleCanonicalUpload(request);
  } catch (error) {
    if (error instanceof DocumentStorageS3Error) {
      return internalFailure(`Storage operation failed (${error.diagnostics.code}).`, `S3_${error.diagnostics.operation}_${error.diagnostics.code}`);
    }
    return internalFailure(error instanceof Error ? error.message : String(error), "LEGAL_SOURCES_UPLOAD_FAILED");
  }
}
