import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const sha256Schema = z.string().trim().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());
const nonBlank = z.string().trim().min(1);

const createSourceFileVersionSchema = z.object({
  documentId: nonBlank,
  canonicalEnteId: nonBlank,
  storageProvider: z.enum(["local", "s3"]),
  storageKey: nonBlank,
  storageBucket: nonBlank.nullable().optional(),
  mimeType: nonBlank.transform((value) => value.toLowerCase()),
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  createdByUserId: nonBlank.nullable().optional(),
  createdByActorId: nonBlank,
  createdByRole: nonBlank,
}).strict();

export type CreateSourceFileVersionInput = z.input<typeof createSourceFileVersionSchema>;
export type SourceFileVersion = Awaited<ReturnType<typeof getSourceFileVersionById>> extends infer Result
  ? NonNullable<Result>
  : never;

export class SourceFileVersionConflictError extends Error {
  readonly code = "SOURCE_FILE_VERSION_CONFLICT" as const;

  constructor() {
    super("SOURCE_FILE_VERSION_CONFLICT");
    this.name = "SourceFileVersionConflictError";
  }
}

function sameManifest(
  existing: {
    documentId: string;
    canonicalEnteId: string;
    storageProvider: string;
    storageKey: string;
    storageBucket: string | null;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  },
  input: z.output<typeof createSourceFileVersionSchema>,
): boolean {
  return existing.documentId === input.documentId
    && existing.canonicalEnteId === input.canonicalEnteId
    && existing.storageProvider === input.storageProvider
    && existing.storageKey === input.storageKey
    && existing.storageBucket === (input.storageBucket ?? null)
    && existing.mimeType === input.mimeType
    && existing.sizeBytes === input.sizeBytes
    && existing.sha256 === input.sha256;
}

function isIdentityP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "DocumentFileVersion") {
    return false;
  }

  const target = meta.target;
  if (target === "DocumentFileVersion_documentId_sha256_key" || target === "documentId_sha256") {
    return true;
  }
  if (!Array.isArray(target) || !target.every((field) => typeof field === "string")) {
    return false;
  }

  const fields = new Set(target.map((field) => field.replace(/^"|"$/g, "")));
  return fields.size === 2 && fields.has("documentId") && fields.has("sha256");
}

async function findSameDocumentHash(documentId: string, sha256: string) {
  return prisma.documentFileVersion.findUnique({
    where: { documentId_sha256: { documentId, sha256 } },
  });
}

export async function createSourceFileVersion(
  rawInput: CreateSourceFileVersionInput,
): Promise<{ outcome: "CREATED" | "REUSED"; version: NonNullable<Awaited<ReturnType<typeof findSameDocumentHash>>> }> {
  const input = createSourceFileVersionSchema.parse(rawInput);
  const existing = await findSameDocumentHash(input.documentId, input.sha256);
  if (existing) {
    if (!sameManifest(existing, input)) {
      throw new SourceFileVersionConflictError();
    }
    return { outcome: "REUSED", version: existing };
  }

  try {
    const version = await prisma.documentFileVersion.create({
      data: {
        ...input,
        storageBucket: input.storageBucket ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    return { outcome: "CREATED", version };
  } catch (error) {
    if (!isIdentityP2002(error)) {
      throw error;
    }
    const concurrent = await findSameDocumentHash(input.documentId, input.sha256);
    if (!concurrent) {
      throw error;
    }
    if (!sameManifest(concurrent, input)) {
      throw new SourceFileVersionConflictError();
    }
    return { outcome: "REUSED", version: concurrent };
  }
}

export async function getSourceFileVersionById(id: string) {
  const normalizedId = nonBlank.parse(id);
  return prisma.documentFileVersion.findUnique({ where: { id: normalizedId } });
}