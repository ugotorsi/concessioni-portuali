import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

import {
  ACT_DRAFT_AUDIT_ACTION,
  ACT_DRAFT_ENTITY,
  ACT_DRAFT_SCHEMA_VERSION,
  actDraftEntityId,
  actDraftVersionMetadataSchema,
  bodySha256,
  normalizeActDraftContent,
  projectActDrafts,
  type ActDraft,
  type ActDraftContent,
  type ActDraftVersion,
  type ActDraftVersionMetadata,
} from "./model";

export interface ActDraftScope {
  tenantId: string;
  procedimentoId: string;
  concessioneId: string | null;
}

export interface ActDraftActor {
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
}

interface ActivityLogRow {
  metadata: unknown;
  createdAt: Date;
  userEmail: string | null;
  currentHash: string;
}

function toVersion(row: ActivityLogRow, procedimentoId: string): ActDraftVersion | null {
  const parsed = actDraftVersionMetadataSchema.safeParse(row.metadata);
  if (!parsed.success || parsed.data.procedimentoId !== procedimentoId) return null;
  if (parsed.data.bodySha256 !== bodySha256(parsed.data.body)) return null;
  return { ...parsed.data, savedAt: row.createdAt, savedBy: row.userEmail, auditHash: row.currentHash };
}

export async function listActDraftVersions(scope: Pick<ActDraftScope, "tenantId" | "procedimentoId">): Promise<ActDraftVersion[]> {
  const rows = await prisma.activityLog.findMany({
    where: {
      enteId: scope.tenantId,
      entita: ACT_DRAFT_ENTITY,
      azione: ACT_DRAFT_AUDIT_ACTION,
      esito: "SUCCESS",
      entitaId: { startsWith: `${scope.procedimentoId}::` },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { metadata: true, createdAt: true, userEmail: true, currentHash: true },
  });
  return rows
    .map((row) => toVersion(row, scope.procedimentoId))
    .filter((version): version is ActDraftVersion => version !== null);
}

export async function listActDrafts(scope: Pick<ActDraftScope, "tenantId" | "procedimentoId">): Promise<ActDraft[]> {
  return projectActDrafts(await listActDraftVersions(scope));
}

export async function listActAttachmentOptions(procedimentoId: string): Promise<Array<{ id: string; nome: string }>> {
  return prisma.documento.findMany({
    where: { procedimentoId },
    orderBy: [{ nome: "asc" }, { id: "asc" }],
    select: { id: true, nome: true },
  });
}

async function lockDraft(tx: Prisma.TransactionClient, entityId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT TRUE AS "acquired"
    FROM pg_advisory_xact_lock(hashtext(${"fascicolo-act-draft:v1"}), hashtext(${entityId}))
  `;
}

export class ActDraftVersionConflictError extends Error {
  constructor() {
    super("La bozza è stata modificata da un altro utente: ricaricare la pagina prima di salvare.");
    this.name = "ActDraftVersionConflictError";
  }
}

/**
 * Appends an immutable draft version to the hash-chained audit log.
 * `expectedVersion` is 0 for a new draft and guards against lost updates.
 */
export async function saveActDraftVersion(input: {
  scope: ActDraftScope;
  draftKey: string | null;
  expectedVersion: number;
  content: ActDraftContent;
  actor: ActDraftActor;
}): Promise<ActDraftVersionMetadata> {
  const draftKey = input.draftKey ?? `act_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const entityId = actDraftEntityId(input.scope.procedimentoId, draftKey);
  const existing = await listActDraftVersions(input.scope);
  const knownKeys = new Set(existing.map((version) => version.draftKey));
  const content = normalizeActDraftContent(input.content, draftKey);
  const unknownDependency = content.dependencies.find((key) => !knownKeys.has(key));
  if (unknownDependency) throw new Error("Dipendenza non riconosciuta nel procedimento corrente.");

  return prisma.$transaction(async (tx) => {
    await lockDraft(tx, entityId);
    const rows = await tx.activityLog.findMany({
      where: { enteId: input.scope.tenantId, entita: ACT_DRAFT_ENTITY, entitaId: entityId, esito: "SUCCESS" },
      select: { metadata: true, createdAt: true, userEmail: true, currentHash: true },
    });
    const latest = rows
      .map((row) => toVersion(row, input.scope.procedimentoId))
      .filter((version): version is ActDraftVersion => version !== null)
      .reduce((max, version) => Math.max(max, version.version), 0);
    if (latest !== input.expectedVersion) throw new ActDraftVersionConflictError();
    const metadata: ActDraftVersionMetadata = {
      ...content,
      schema: ACT_DRAFT_SCHEMA_VERSION,
      procedimentoId: input.scope.procedimentoId,
      draftKey,
      version: latest + 1,
      bodySha256: bodySha256(content.body),
    };
    await createAuditLogInTransaction(tx, {
      azione: ACT_DRAFT_AUDIT_ACTION,
      entita: ACT_DRAFT_ENTITY,
      entitaId: entityId,
      enteId: input.scope.tenantId,
      concessioneId: input.scope.concessioneId,
      esito: "SUCCESS",
      metadata: metadata as unknown as Prisma.InputJsonValue,
      actor: { userId: input.actor.actorId, userEmail: input.actor.actorEmail, userRole: input.actor.actorRole },
    });
    return metadata;
  });
}
