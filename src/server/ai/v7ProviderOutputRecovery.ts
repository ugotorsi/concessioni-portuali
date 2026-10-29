import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  getActiveDocumentStorageBackend,
  getDocumentStorageAdapter,
} from "@/server/documents/storage";
import type { DocumentStorageAdapter } from "@/server/documents/storage/types";

const RECOVERY_VERSION = "NOETRA_V7_PROVIDER_OUTPUT_RECOVERY_V1";
const MAX_RECOVERY_BYTES = 8 * 1024 * 1024;

export interface V7ProviderOutputRecoveryBinding {
  readonly jobId: string;
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly corpusFingerprint: string;
  readonly approvalId: string;
}

interface RecoveryEnvelope {
  version: typeof RECOVERY_VERSION;
  outputFingerprint: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

type RecoveryStorage = Pick<
  DocumentStorageAdapter,
  "createIfAbsent" | "readBounded" | "delete"
>;

export interface V7ProviderOutputRecoveryArtifact {
  readonly storageKey: string;
  readonly outputFingerprint: string;
  readonly sizeBytes: number;
}

export class V7ProviderOutputRecoveryError extends Error {
  constructor(readonly code:
    | "RECOVERY_CONFIGURATION_INVALID"
    | "RECOVERY_STORAGE_NOT_DURABLE"
    | "RECOVERY_PAYLOAD_TOO_LARGE"
    | "RECOVERY_ARTIFACT_MISSING"
    | "RECOVERY_ARTIFACT_INVALID"
    | "RECOVERY_ARTIFACT_CONFLICT") {
    super(code);
    this.name = "V7ProviderOutputRecoveryError";
  }
}

function recoveryKey(): Buffer {
  const encoded = process.env.AI_PROVIDER_OUTPUT_RECOVERY_KEY?.trim();
  if (!encoded) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
  return key;
}

function assertBinding(binding: V7ProviderOutputRecoveryBinding): void {
  if (
    !binding.jobId.trim()
    || !binding.tenantId.trim()
    || !binding.procedimentoId.trim()
    || !/^[0-9a-f]{64}$/.test(binding.corpusFingerprint)
    || !binding.approvalId.trim()
  ) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
}

function fingerprint(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function storageKey(binding: V7ProviderOutputRecoveryBinding): string {
  return `ai-provider-output-recovery/v1/${fingerprint(binding.jobId)}/provider-output.enc`;
}

function aad(binding: V7ProviderOutputRecoveryBinding, outputFingerprint: string): Buffer {
  return Buffer.from([
    RECOVERY_VERSION,
    binding.jobId,
    binding.tenantId,
    binding.procedimentoId,
    binding.corpusFingerprint,
    binding.approvalId,
    outputFingerprint,
  ].join("\n"), "utf8");
}

function encrypt(
  binding: V7ProviderOutputRecoveryBinding,
  output: unknown,
  key: Buffer,
): { body: Buffer; outputFingerprint: string } {
  const plaintext = Buffer.from(JSON.stringify(output), "utf8");
  if (plaintext.length === 0 || plaintext.length > MAX_RECOVERY_BYTES) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_PAYLOAD_TOO_LARGE");
  }
  const outputFingerprint = fingerprint(plaintext);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(binding, outputFingerprint));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: RecoveryEnvelope = {
    version: RECOVERY_VERSION,
    outputFingerprint,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  return {
    body: Buffer.from(JSON.stringify(envelope), "utf8"),
    outputFingerprint,
  };
}

function decrypt(
  binding: V7ProviderOutputRecoveryBinding,
  body: Buffer,
  key: Buffer,
): { output: unknown; outputFingerprint: string } {
  let envelope: RecoveryEnvelope;
  try {
    envelope = JSON.parse(body.toString("utf8")) as RecoveryEnvelope;
  } catch {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_INVALID");
  }
  if (
    envelope.version !== RECOVERY_VERSION
    || !/^[0-9a-f]{64}$/.test(envelope.outputFingerprint)
    || !envelope.iv
    || !envelope.authTag
    || !envelope.ciphertext
  ) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_INVALID");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(aad(binding, envelope.outputFingerprint));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const observed = Buffer.from(fingerprint(plaintext), "hex");
    const expected = Buffer.from(envelope.outputFingerprint, "hex");
    if (!timingSafeEqual(observed, expected)) {
      throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_INVALID");
    }
    return {
      output: JSON.parse(plaintext.toString("utf8")) as unknown,
      outputFingerprint: envelope.outputFingerprint,
    };
  } catch (error) {
    if (error instanceof V7ProviderOutputRecoveryError) throw error;
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_INVALID");
  }
}

function durableStorage(storage?: RecoveryStorage): RecoveryStorage {
  if (storage) return storage;
  if (getActiveDocumentStorageBackend() !== "s3") {
    throw new V7ProviderOutputRecoveryError("RECOVERY_STORAGE_NOT_DURABLE");
  }
  return getDocumentStorageAdapter();
}

export async function persistV7ProviderOutputRecoveryArtifact(input: {
  binding: V7ProviderOutputRecoveryBinding;
  output: unknown;
  storage?: RecoveryStorage;
  encryptionKey?: Buffer;
}): Promise<V7ProviderOutputRecoveryArtifact> {
  assertBinding(input.binding);
  const key = input.encryptionKey ?? recoveryKey();
  if (key.length !== 32) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
  const encrypted = encrypt(input.binding, input.output, key);
  const keyName = storageKey(input.binding);
  const storage = durableStorage(input.storage);
  const created = await storage.createIfAbsent({
    storageKey: keyName,
    body: encrypted.body,
    mimeType: "application/octet-stream",
    originalName: "provider-output.enc",
    sha256: fingerprint(encrypted.body),
    sizeBytes: encrypted.body.length,
  });
  if (created.disposition === "ALREADY_EXISTS") {
    const existing = await loadV7ProviderOutputRecoveryArtifact({
      binding: input.binding,
      storage,
      encryptionKey: key,
    });
    if (existing.outputFingerprint !== encrypted.outputFingerprint) {
      throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_CONFLICT");
    }
  }
  return {
    storageKey: keyName,
    outputFingerprint: encrypted.outputFingerprint,
    sizeBytes: encrypted.body.length,
  };
}

export async function loadV7ProviderOutputRecoveryArtifact(input: {
  binding: V7ProviderOutputRecoveryBinding;
  storage?: RecoveryStorage;
  encryptionKey?: Buffer;
}): Promise<{ output: unknown; outputFingerprint: string; storageKey: string }> {
  assertBinding(input.binding);
  const key = input.encryptionKey ?? recoveryKey();
  if (key.length !== 32) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
  const keyName = storageKey(input.binding);
  const stored = await durableStorage(input.storage).readBounded(keyName, MAX_RECOVERY_BYTES);
  if (stored.disposition === "MISSING") {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_MISSING");
  }
  return {
    ...decrypt(input.binding, stored.body, key),
    storageKey: keyName,
  };
}

export async function deleteV7ProviderOutputRecoveryArtifact(input: {
  binding: V7ProviderOutputRecoveryBinding;
  storage?: RecoveryStorage;
}): Promise<void> {
  assertBinding(input.binding);
  await durableStorage(input.storage).delete(storageKey(input.binding));
}
