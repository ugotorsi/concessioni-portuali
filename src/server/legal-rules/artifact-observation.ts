import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type ObservedArtifactMimeType = "application/pdf" | "image/jpeg";

export type ArtifactObservationFailureCode =
  | "INVALID_PACK_ROOT"
  | "UNSAFE_ARTIFACT_PATH"
  | "ARTIFACT_READ_FAILED"
  | "DECLARED_SIZE_MISMATCH"
  | "MIME_MISMATCH"
  | "MIME_UNDETERMINED";

export interface ObserveLocalArtifactInput {
  packRoot: string;
  relativePath: string;
  declaredSha256: string;
  declaredSizeBytes: number;
}

interface DeclaredArtifactMetadata {
  artifactLocator: string;
  declaredSha256: string;
  declaredSizeBytes: number;
}

interface ObservedArtifactMetadata extends DeclaredArtifactMetadata {
  observedSha256: string;
  observedSizeBytes: number;
  observedMimeType?: ObservedArtifactMimeType;
}

export type LocalArtifactObservation =
  | (ObservedArtifactMetadata & { outcome: "OBSERVED_VALID"; observedMimeType: ObservedArtifactMimeType })
  | (ObservedArtifactMetadata & { outcome: "INTEGRITY_MISMATCH" })
  | (ObservedArtifactMetadata & {
      outcome: "FAILED";
      failureCode: Exclude<
        ArtifactObservationFailureCode,
        "INVALID_PACK_ROOT" | "UNSAFE_ARTIFACT_PATH" | "ARTIFACT_READ_FAILED"
      >;
    })
  | (DeclaredArtifactMetadata & { outcome: "MISSING" })
  | (DeclaredArtifactMetadata & {
      outcome: "FAILED";
      failureCode: "ARTIFACT_READ_FAILED";
    })
  | {
      outcome: "FAILED";
      failureCode: "INVALID_PACK_ROOT" | "UNSAFE_ARTIFACT_PATH";
      artifactLocator: null;
      declaredSha256: string;
      declaredSizeBytes: number;
    };

type SafeArtifactPath = {
  artifactLocator: string;
  candidatePath: string;
};

type SafePathResolution =
  | { kind: "SAFE"; value: SafeArtifactPath }
  | { kind: "MISSING"; value: Omit<SafeArtifactPath, "candidatePath"> }
  | { kind: "INVALID_ROOT" }
  | { kind: "UNSAFE" }
  | { kind: "READ_FAILED"; value: Omit<SafeArtifactPath, "candidatePath"> };

function isContained(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isAbsoluteOrDriveQualified(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value);
}

function portableLocator(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function resolveSafeArtifactPath(packRoot: string, inputPath: string): Promise<SafePathResolution> {
  if (!packRoot.trim()) {
    return { kind: "INVALID_ROOT" };
  }

  const lexicalRoot = path.resolve(packRoot);
  let physicalRoot: string;
  try {
    const rootStatus = await lstat(lexicalRoot);
    if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
      return { kind: "INVALID_ROOT" };
    }
    physicalRoot = await realpath(lexicalRoot);
  } catch {
    return { kind: "INVALID_ROOT" };
  }

  const trimmedPath = inputPath.trim();
  if (!trimmedPath || trimmedPath.includes("\0") || isAbsoluteOrDriveQualified(trimmedPath)) {
    return { kind: "UNSAFE" };
  }

  const platformPath = trimmedPath.replace(/[\\/]+/g, path.sep);
  const lexicalCandidate = path.resolve(lexicalRoot, platformPath);
  if (!isContained(lexicalRoot, lexicalCandidate)) {
    return { kind: "UNSAFE" };
  }

  const lexicalRelative = path.relative(lexicalRoot, lexicalCandidate);
  if (!lexicalRelative || lexicalRelative === ".") {
    return { kind: "UNSAFE" };
  }

  const locator = { artifactLocator: portableLocator(lexicalRelative) };
  const segments = lexicalRelative.split(path.sep);
  let currentPath = lexicalRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const status = await lstat(currentPath);
      if (status.isSymbolicLink()) {
        return { kind: "UNSAFE" };
      }
    } catch (error) {
      if (isNotFound(error)) {
        return { kind: "MISSING", value: locator };
      }
      return { kind: "READ_FAILED", value: locator };
    }
  }

  let physicalCandidate: string;
  try {
    physicalCandidate = await realpath(lexicalCandidate);
  } catch (error) {
    return isNotFound(error)
      ? { kind: "MISSING", value: locator }
      : { kind: "READ_FAILED", value: locator };
  }

  if (!isContained(physicalRoot, physicalCandidate)) {
    return { kind: "UNSAFE" };
  }

  return {
    kind: "SAFE",
    value: { ...locator, candidatePath: physicalCandidate },
  };
}

function detectMimeType(prefix: Buffer): ObservedArtifactMimeType | undefined {
  if (prefix.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return "application/pdf";
  }
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg";
  }
  return undefined;
}

function extensionMatchesMimeType(locator: string, mimeType: ObservedArtifactMimeType): boolean {
  const extension = path.extname(locator).toLowerCase();
  return mimeType === "application/pdf"
    ? extension === ".pdf"
    : extension === ".jpg" || extension === ".jpeg";
}

export async function observeLocalArtifact(input: ObserveLocalArtifactInput): Promise<LocalArtifactObservation> {
  const declared = {
    declaredSha256: input.declaredSha256,
    declaredSizeBytes: input.declaredSizeBytes,
  };
  const resolution = await resolveSafeArtifactPath(input.packRoot, input.relativePath);

  if (resolution.kind === "INVALID_ROOT") {
    return { outcome: "FAILED", failureCode: "INVALID_PACK_ROOT", artifactLocator: null, ...declared };
  }
  if (resolution.kind === "UNSAFE") {
    return { outcome: "FAILED", failureCode: "UNSAFE_ARTIFACT_PATH", artifactLocator: null, ...declared };
  }

  const located = { ...resolution.value, ...declared };
  if (resolution.kind === "MISSING") {
    return { outcome: "MISSING", ...located };
  }
  if (resolution.kind === "READ_FAILED") {
    return { outcome: "FAILED", failureCode: "ARTIFACT_READ_FAILED", ...located };
  }

  const hash = createHash("sha256");
  let observedSizeBytes = 0;
  let prefix = Buffer.alloc(0);
  try {
    for await (const chunk of createReadStream(resolution.value.candidatePath)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      observedSizeBytes += bytes.length;
      if (prefix.length < 5) {
        prefix = Buffer.concat([prefix, bytes.subarray(0, 5 - prefix.length)]);
      }
    }
  } catch (error) {
    return isNotFound(error)
      ? { outcome: "MISSING", ...located }
      : { outcome: "FAILED", failureCode: "ARTIFACT_READ_FAILED", ...located };
  }

  const observedSha256 = hash.digest("hex");
  const observedMimeType = detectMimeType(prefix);
  const observed = {
    ...located,
    observedSha256,
    observedSizeBytes,
    ...(observedMimeType ? { observedMimeType } : {}),
  };

  if (observedSha256 !== input.declaredSha256.toLowerCase()) {
    return { outcome: "INTEGRITY_MISMATCH", ...observed };
  }
  if (observedSizeBytes !== input.declaredSizeBytes) {
    return { outcome: "FAILED", failureCode: "DECLARED_SIZE_MISMATCH", ...observed };
  }
  if (observedMimeType && !extensionMatchesMimeType(located.artifactLocator, observedMimeType)) {
    return { outcome: "FAILED", failureCode: "MIME_MISMATCH", ...observed };
  }
  if (!observedMimeType) {
    return { outcome: "FAILED", failureCode: "MIME_UNDETERMINED", ...observed };
  }

  return { outcome: "OBSERVED_VALID", ...observed, observedMimeType };
}