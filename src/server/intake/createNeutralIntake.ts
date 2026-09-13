import { createHash } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  createDocumentFileIfAbsent,
  readDocumentFileFromProvider,
} from "@/server/documents/storage";
import {
  buildNeutralIntakeIdempotencyKeyV1,
  neutralIntakeIdempotencyAnchorSchema,
  neutralIntakeManifestsEqual,
  normalizeNeutralIntakeManifest,
  type NeutralIntakeImmutableManifest,
} from "@/server/intake/neutralIntakeIdentity";
import { buildNeutralIntakeExtractionAdmission } from "@/server/intake/neutralIntakeExtractionJob";

const nonBlank = z.string().trim().min(1);
const optionalNonBlank = nonBlank.nullable().optional().transform((value) => value ?? null);

const createNeutralIntakeSchema = z.object({
  body: z.custom<Buffer>((value) => Buffer.isBuffer(value) && value.length > 0),
  mimeType: nonBlank.transform((value) => value.toLowerCase()),
  originalName: optionalNonBlank,
  ingressChannel: nonBlank,
  originReference: optionalNonBlank,
  enteId: optionalNonBlank,
  receivedByUserId: optionalNonBlank,
  receivedByActorId: nonBlank,
  receivedByRole: nonBlank,
  idempotencyAnchor: neutralIntakeIdempotencyAnchorSchema,
}).strict().superRefine((input, context) => {
  if (
    input.idempotencyAnchor.type === "ORIGIN_REFERENCE"
    && input.originReference !== input.idempotencyAnchor.value
  ) {
    context.addIssue({
      code: "custom",
      path: ["originReference"],
      message: "originReference must match the ORIGIN_REFERENCE idempotency anchor.",
    });
  }
});

export type CreateNeutralIntakeInput = z.input<typeof createNeutralIntakeSchema>;

type NeutralIntakeRecord = Prisma.NeutralIntakeGetPayload<object>;

type NeutralIntakeClient = Pick<Prisma.TransactionClient, "neutralIntake">;

export class NeutralIntakeIdempotencyConflictError extends Error {
  readonly code = "NEUTRAL_INTAKE_IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("NEUTRAL_INTAKE_IDEMPOTENCY_CONFLICT");
    this.name = "NeutralIntakeIdempotencyConflictError";
  }
}

export class NeutralIntakeStorageConflictError extends Error {
  readonly code = "NEUTRAL_INTAKE_STORAGE_CONFLICT" as const;

  constructor() {
    super("NEUTRAL_INTAKE_STORAGE_CONFLICT");
    this.name = "NeutralIntakeStorageConflictError";
  }
}

function recordManifest(record: NeutralIntakeRecord): NeutralIntakeImmutableManifest {
  return normalizeNeutralIntakeManifest({
    storageProvider: record.storageProvider,
    storageBucket: record.storageBucket,
    storageKey: record.storageKey,
    sha256: record.sha256,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    originalName: record.originalName,
    ingressChannel: record.ingressChannel,
    originReference: record.originReference,
    enteId: record.enteId,
    receivedByUserId: record.receivedByUserId,
    receivedByActorId: record.receivedByActorId,
    receivedByRole: record.receivedByRole,
  });
}

function isIdempotencyP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "NeutralIntake") {
    return false;
  }
  const target = meta.target;
  if (target === "NeutralIntake_idempotencyKey_key" || target === "idempotencyKey") {
    return true;
  }
  return Array.isArray(target) && target.length === 1 && target[0] === "idempotencyKey";
}

function isAsyncJobIdempotencyP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "AsyncJob") return false;
  const target = meta.target;
  return target === "AsyncJob_idempotencyKey_key"
    || target === "idempotencyKey"
    || (Array.isArray(target) && target.length === 1 && target[0] === "idempotencyKey");
}

async function findByIdempotencyKey(client: NeutralIntakeClient, idempotencyKey: string) {
  return client.neutralIntake.findUnique({ where: { idempotencyKey } });
}

function reuseOrConflict(
  existing: NonNullable<Awaited<ReturnType<typeof findByIdempotencyKey>>>,
  manifest: NeutralIntakeImmutableManifest,
) {
  if (!neutralIntakeManifestsEqual(recordManifest(existing), manifest)) {
    throw new NeutralIntakeIdempotencyConflictError();
  }
  return { outcome: "REUSED" as const, intake: existing };
}

export async function createNeutralIntakeRecordInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    idempotencyKey: string;
    manifest: NeutralIntakeImmutableManifest;
  },
) {
  const existing = await findByIdempotencyKey(tx, input.idempotencyKey);
  if (existing) {
    return reuseOrConflict(existing, input.manifest);
  }

  const intake = await tx.neutralIntake.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      ...input.manifest,
      status: "RECEIVED",
      statusVersion: 0,
    },
  });
  return { outcome: "CREATED" as const, intake };
}

async function createNeutralIntakeWithExtractionJobInTransaction(
  tx: Prisma.TransactionClient,
  input: { idempotencyKey: string; manifest: NeutralIntakeImmutableManifest },
) {
  const intakeResult = await createNeutralIntakeRecordInTransaction(tx, input);
  const initiatingUser = intakeResult.intake.receivedByUserId === null
    ? null
    : await tx.user.findUnique({
        where: { id: intakeResult.intake.receivedByUserId },
        select: { ruolo: true },
      });
  const extractionJob = await admitAsyncJobInTransaction(
    tx,
    buildNeutralIntakeExtractionAdmission({
      ...intakeResult.intake,
      initiatingUserRole: initiatingUser?.ruolo ?? null,
    }),
  );
  return { ...intakeResult, extractionJob: extractionJob.job };
}

export async function createNeutralIntake(rawInput: CreateNeutralIntakeInput) {
  const input = createNeutralIntakeSchema.parse(rawInput);
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const storageKey = `intake/sha256/${sha256}`;
  const idempotencyKey = buildNeutralIntakeIdempotencyKeyV1({
    ingressChannel: input.ingressChannel,
    anchor: input.idempotencyAnchor,
  });
  const storage = await createDocumentFileIfAbsent({
    storageKey,
    body: input.body,
    mimeType: input.mimeType,
    originalName: input.originalName ?? "intake-artifact",
    sha256,
    sizeBytes: input.body.length,
  });
  if (storage.disposition === "ALREADY_EXISTS") {
    const existingObject = await readDocumentFileFromProvider({
      storageProvider: storage.object.storageProvider,
      storageBucket: storage.object.bucket,
      storageKey: storage.object.storageKey,
    });
    if (
      existingObject.disposition !== "FOUND"
      || existingObject.body.length !== input.body.length
      || createHash("sha256").update(existingObject.body).digest("hex") !== sha256
    ) {
      throw new NeutralIntakeStorageConflictError();
    }
  }
  const manifest = normalizeNeutralIntakeManifest({
    storageProvider: storage.object.storageProvider,
    storageBucket: storage.object.bucket,
    storageKey: storage.object.storageKey,
    sha256,
    mimeType: input.mimeType,
    sizeBytes: input.body.length,
    originalName: input.originalName,
    ingressChannel: input.ingressChannel,
    originReference: input.originReference,
    enteId: input.enteId,
    receivedByUserId: input.receivedByUserId,
    receivedByActorId: input.receivedByActorId,
    receivedByRole: input.receivedByRole,
  });

  try {
    return await runSerializableTransactionWithRetry((tx) =>
      createNeutralIntakeWithExtractionJobInTransaction(tx, { idempotencyKey, manifest }));
  } catch (error) {
    if (!isIdempotencyP2002(error) && !isAsyncJobIdempotencyP2002(error)) {
      throw error;
    }
    return runSerializableTransactionWithRetry((tx) =>
      createNeutralIntakeWithExtractionJobInTransaction(tx, { idempotencyKey, manifest }));
  }
}

export async function getNeutralIntakeById(id: string) {
  return prisma.neutralIntake.findUnique({ where: { id: nonBlank.parse(id) } });
}
