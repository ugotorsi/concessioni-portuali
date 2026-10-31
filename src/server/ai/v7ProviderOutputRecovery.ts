import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const RECOVERY_VERSION = "NOETRA_V7_PROVIDER_OUTPUT_RECOVERY_V1";
const MAX_RECOVERY_BYTES = 8 * 1024 * 1024;
const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

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

interface RecoveryRow {
  id: string;
  jobId: string;
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  approvalId: string;
  outputFingerprint: string;
  encryptedPayload: string;
  sizeBytes: number;
  expiresAt: Date;
}

interface RecoveryRepository {
  create(input: Omit<RecoveryRow, "id">): Promise<RecoveryRow>;
  findByJobId(jobId: string): Promise<RecoveryRow | null>;
  deleteByBinding(binding: V7ProviderOutputRecoveryBinding): Promise<void>;
}

export interface V7ProviderOutputRecoveryArtifact {
  readonly artifactRef: string;
  readonly outputFingerprint: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date;
}

export class V7ProviderOutputRecoveryError extends Error {
  constructor(readonly code:
    | "RECOVERY_CONFIGURATION_INVALID"
    | "RECOVERY_PAYLOAD_TOO_LARGE"
    | "RECOVERY_ARTIFACT_MISSING"
    | "RECOVERY_ARTIFACT_EXPIRED"
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

function artifactRef(row: Pick<RecoveryRow, "id">): string {
  return `V7ProviderOutputRecoveryArtifact:${row.id}`;
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
): { encryptedPayload: string; outputFingerprint: string; sizeBytes: number } {
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
  const encryptedPayload = JSON.stringify(envelope);
  return {
    encryptedPayload,
    outputFingerprint,
    sizeBytes: Buffer.byteLength(encryptedPayload, "utf8"),
  };
}

function decrypt(
  binding: V7ProviderOutputRecoveryBinding,
  row: RecoveryRow,
  key: Buffer,
): { output: unknown; outputFingerprint: string } {
  let envelope: RecoveryEnvelope;
  try {
    envelope = JSON.parse(row.encryptedPayload) as RecoveryEnvelope;
  } catch {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_INVALID");
  }
  if (
    envelope.version !== RECOVERY_VERSION
    || envelope.outputFingerprint !== row.outputFingerprint
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

const databaseRepository: RecoveryRepository = {
  async create(input) {
    return prisma.v7ProviderOutputRecoveryArtifact.create({ data: input });
  },
  async findByJobId(jobId) {
    return prisma.v7ProviderOutputRecoveryArtifact.findUnique({ where: { jobId } });
  },
  async deleteByBinding(binding) {
    await prisma.v7ProviderOutputRecoveryArtifact.deleteMany({
      where: {
        jobId: binding.jobId,
        tenantId: binding.tenantId,
        procedimentoId: binding.procedimentoId,
        corpusFingerprint: binding.corpusFingerprint,
        approvalId: binding.approvalId,
      },
    });
  },
};

function matchesBinding(row: RecoveryRow, binding: V7ProviderOutputRecoveryBinding): boolean {
  return row.jobId === binding.jobId
    && row.tenantId === binding.tenantId
    && row.procedimentoId === binding.procedimentoId
    && row.corpusFingerprint === binding.corpusFingerprint
    && row.approvalId === binding.approvalId;
}

export async function persistV7ProviderOutputRecoveryArtifact(input: {
  binding: V7ProviderOutputRecoveryBinding;
  output: unknown;
  repository?: RecoveryRepository;
  encryptionKey?: Buffer;
  now?: Date;
}): Promise<V7ProviderOutputRecoveryArtifact> {
  assertBinding(input.binding);
  const key = input.encryptionKey ?? recoveryKey();
  if (key.length !== 32) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
  const encrypted = encrypt(input.binding, input.output, key);
  const repository = input.repository ?? databaseRepository;
  const now = input.now ?? new Date();
  let row: RecoveryRow;
  try {
    row = await repository.create({
      ...input.binding,
      outputFingerprint: encrypted.outputFingerprint,
      encryptedPayload: encrypted.encryptedPayload,
      sizeBytes: encrypted.sizeBytes,
      expiresAt: new Date(now.getTime() + RECOVERY_RETENTION_MS),
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const existing = await repository.findByJobId(input.binding.jobId);
    if (!existing) throw error;
    row = existing;
  }
  if (!matchesBinding(row, input.binding)) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_CONFLICT");
  }
  const existing = decrypt(input.binding, row, key);
  if (existing.outputFingerprint !== encrypted.outputFingerprint) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_CONFLICT");
  }
  return {
    artifactRef: artifactRef(row),
    outputFingerprint: row.outputFingerprint,
    sizeBytes: row.sizeBytes,
    expiresAt: row.expiresAt,
  };
}

export async function loadV7ProviderOutputRecoveryArtifact(input: {
  binding: V7ProviderOutputRecoveryBinding;
  repository?: RecoveryRepository;
  encryptionKey?: Buffer;
  now?: Date;
}): Promise<{
  output: unknown;
  outputFingerprint: string;
  artifactRef: string;
  expiresAt: Date;
}> {
  assertBinding(input.binding);
  const key = input.encryptionKey ?? recoveryKey();
  if (key.length !== 32) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_CONFIGURATION_INVALID");
  }
  const row = await (input.repository ?? databaseRepository).findByJobId(input.binding.jobId);
  if (!row) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_MISSING");
  }
  if (!matchesBinding(row, input.binding)) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_INVALID");
  }
  if (row.expiresAt <= (input.now ?? new Date())) {
    throw new V7ProviderOutputRecoveryError("RECOVERY_ARTIFACT_EXPIRED");
  }
  return {
    ...decrypt(input.binding, row, key),
    artifactRef: artifactRef(row),
    expiresAt: row.expiresAt,
  };
}

export async function deleteV7ProviderOutputRecoveryArtifact(input: {
  binding: V7ProviderOutputRecoveryBinding;
  repository?: RecoveryRepository;
}): Promise<void> {
  assertBinding(input.binding);
  await (input.repository ?? databaseRepository).deleteByBinding(input.binding);
}
