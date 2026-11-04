import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  ACTIVITY_AUDIT_ACTION,
  ACTIVITY_ENTITY,
  ACTIVITY_LOCK_NAMESPACE,
  ActivityWorkflowError,
  activityForKey,
  activityNeedsReview,
  activityVersionFromLogRow,
  projectActivities,
  type ActivitySpec,
  type ActivityVersion,
} from "@/server/fascicolo-operational-activities/model";
import { readFascicoloDocumentCorpusInTransaction } from "@/server/queries/fascicolo-document-corpus";

import {
  ACT_DRAFT_AUDIT_ACTION,
  ACT_DRAFT_ENTITY,
  ACT_DRAFT_LOCK_NAMESPACE,
  ACT_DRAFT_SCHEMA_VERSION,
  actDraftMatchesTemplate,
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
  entitaId: string | null;
}

type ActivityLogReader = Pick<Prisma.TransactionClient, "activityLog">;

function toVersion(row: ActivityLogRow, procedimentoId: string): ActDraftVersion {
  const parsed = actDraftVersionMetadataSchema.safeParse(row.metadata);
  if (!parsed.success || parsed.data.procedimentoId !== procedimentoId
    || row.entitaId !== actDraftEntityId(procedimentoId, parsed.data.draftKey)
    || parsed.data.bodySha256 !== bodySha256(parsed.data.body)) {
    throw new Error("La cronologia di una bozza non è integra: verifica amministrativa necessaria.");
  }
  return { ...parsed.data, savedAt: row.createdAt, savedBy: row.userEmail, auditHash: row.currentHash };
}

function versionMetadata(version: ActDraftVersion): ActDraftVersionMetadata {
  const { savedAt, savedBy, auditHash, ...metadata } = version;
  void savedAt;
  void savedBy;
  void auditHash;
  return metadata;
}

export async function listActDraftVersions(
  scope: Pick<ActDraftScope, "tenantId" | "procedimentoId">,
  client: ActivityLogReader = prisma,
): Promise<ActDraftVersion[]> {
  const rows = await client.activityLog.findMany({
    where: {
      enteId: scope.tenantId,
      entita: ACT_DRAFT_ENTITY,
      azione: ACT_DRAFT_AUDIT_ACTION,
      esito: "SUCCESS",
      entitaId: { startsWith: `${scope.procedimentoId}::` },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { metadata: true, createdAt: true, userEmail: true, currentHash: true, entitaId: true },
  });
  return rows.map((row) => toVersion(row, scope.procedimentoId));
}

export async function listActDrafts(
  scope: Pick<ActDraftScope, "tenantId" | "procedimentoId">,
  client: ActivityLogReader = prisma,
): Promise<ActDraft[]> {
  return projectActDrafts(await listActDraftVersions(scope, client));
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
    FROM pg_advisory_xact_lock(hashtext(${ACT_DRAFT_LOCK_NAMESPACE}), hashtext(${entityId}))
  `;
}

async function lockActivityScope(tx: Prisma.TransactionClient, scope: ActDraftScope): Promise<void> {
  await tx.$queryRaw`
    SELECT TRUE AS "acquired"
    FROM pg_advisory_xact_lock(hashtext(${ACTIVITY_LOCK_NAMESPACE}), hashtext(${`${scope.tenantId}::${scope.procedimentoId}`}))
  `;
}

async function appendDraftVersion(
  tx: Prisma.TransactionClient,
  scope: ActDraftScope,
  actor: ActDraftActor,
  metadata: ActDraftVersionMetadata,
): Promise<void> {
  await createAuditLogInTransaction(tx, {
    azione: ACT_DRAFT_AUDIT_ACTION,
    entita: ACT_DRAFT_ENTITY,
    entitaId: actDraftEntityId(scope.procedimentoId, metadata.draftKey),
    enteId: scope.tenantId,
    concessioneId: scope.concessioneId,
    esito: "SUCCESS",
    metadata: { ...metadata },
    actor: { userId: actor.actorId, userEmail: actor.actorEmail, userRole: actor.actorRole },
  });
}

export class ActDraftVersionConflictError extends Error {
  constructor() {
    super("La bozza è stata modificata da un altro utente: ricaricare la pagina prima di salvare.");
    this.name = "ActDraftVersionConflictError";
  }
}

interface GuidedDraftContext {
  knowledgeRevisionId: string;
  reportFingerprint: string;
  expectedCorpusFingerprint: string;
  specs: readonly ActivitySpec[];
  spec: ActivitySpec;
  expectedActivityVersion: number;
  templateKey: string;
}

async function assertGuidedDraftContext(
  tx: Prisma.TransactionClient,
  scope: ActDraftScope,
  input: GuidedDraftContext,
): Promise<ActivityVersion[]> {
  const document = input.spec.documents.find((item) => item.templateKey === input.templateKey);
  const currentSpec = input.specs.find((spec) => spec.activityKey === input.spec.activityKey);
  if (!document || !currentSpec || currentSpec.fingerprint !== input.spec.fingerprint
    || input.spec.necessity === "NOT_JUSTIFIED") {
    throw new ActivityWorkflowError("INVALID_DRAFT", "Il documento non è disponibile per l'attività corrente.");
  }
  const revision = await tx.$queryRaw<Array<{ id: string; corpusFingerprint: string }>>`
    SELECT "id", "corpusFingerprint" FROM "FascicoloKnowledgeRevision"
    WHERE "id" = ${input.knowledgeRevisionId} AND "tenantId" = ${scope.tenantId}
      AND "procedimentoId" = ${scope.procedimentoId} AND "status" = 'CURRENT'
    FOR SHARE
  `;
  if (!revision.length) throw new ActivityWorkflowError("STALE_SPEC", "La revisione documentale non è più attuale.");
  const report = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StructuredFascicoloReportSnapshot"
    WHERE "tenantId" = ${scope.tenantId} AND "procedimentoId" = ${scope.procedimentoId}
      AND "knowledgeRevisionId" = ${input.knowledgeRevisionId}
      AND "reportFingerprint" = ${input.reportFingerprint} AND "status" = 'CURRENT'
    FOR SHARE
  `;
  if (!report.length) throw new ActivityWorkflowError("STALE_SPEC", "Il rapporto non è archiviato o è stato sostituito.");
  const corpus = await readFascicoloDocumentCorpusInTransaction(scope, tx);
  if (!corpus || corpus.corpusFingerprint !== input.expectedCorpusFingerprint
    || revision[0].corpusFingerprint !== corpus.corpusFingerprint) {
    throw new ActivityWorkflowError("STALE_SPEC", "Il fascicolo è cambiato: aggiornare e riesaminare l'analisi.");
  }
  const rows = await tx.activityLog.findMany({
    where: {
      enteId: scope.tenantId,
      entita: ACTIVITY_ENTITY,
      azione: ACTIVITY_AUDIT_ACTION,
      esito: "SUCCESS",
      entitaId: { startsWith: `${scope.procedimentoId}::` },
    },
    select: { metadata: true, createdAt: true, userEmail: true, currentHash: true, entitaId: true },
  });
  const versions = rows.map((row) => activityVersionFromLogRow(row, scope.procedimentoId));
  const activity = activityForKey(projectActivities(versions), input.spec.activityKey);
  if (!activity || activity.activityKey !== input.spec.activityKey
    || activity.current.version !== input.expectedActivityVersion) {
    throw new ActivityWorkflowError("STALE_VERSION", "L'attività è stata modificata: ricaricare la pagina.");
  }
  if (activityNeedsReview(activity, input.specs, { fingerprint: corpus.corpusFingerprint, analysisCurrent: true })
    || activity.current.blockedReason
    || !["IN_PROGRESS", "DRAFT_PREPARATION", "DRAFT_VALIDATED"].includes(activity.current.status)) {
    throw new ActivityWorkflowError("STALE_SPEC", "Riesaminare e prendere in carico l'attività prima di predisporre l'atto.");
  }
  return versions;
}

/**
 * Appends an immutable draft version to the hash-chained audit log.
 * `expectedVersion` is 0 for a new draft and guards against lost updates.
 */
export async function saveActDraftVersion(input: {
  scope: ActDraftScope;
  draftKey: string | null;
  expectedVersion: number;
  idempotentCreate?: boolean;
  creationIdentity?: {
    legacyTemplateKeys: readonly string[];
    ambiguousLegacyKeys: readonly string[];
  };
  guidedContext?: GuidedDraftContext;
  content: ActDraftContent;
  actor: ActDraftActor;
}): Promise<ActDraftVersionMetadata> {
  const draftKey = input.draftKey ?? `act_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const entityId = actDraftEntityId(input.scope.procedimentoId, draftKey);
  const content = normalizeActDraftContent(input.content, draftKey);

  if (input.guidedContext && (!input.idempotentCreate || input.expectedVersion !== 0
    || input.guidedContext.templateKey !== content.templateKey
    || input.guidedContext.spec.issueSemanticKey !== content.issueSemanticKey)) {
    throw new ActivityWorkflowError("INVALID_DRAFT", "L'identità della bozza non corrisponde all'attività.");
  }
  const save = async (tx: Prisma.TransactionClient) => {
    if (input.idempotentCreate) await lockActivityScope(tx, input.scope);
    await lockDraft(tx, entityId);
    if (input.guidedContext) await assertGuidedDraftContext(tx, input.scope, input.guidedContext);
    const drafts = await listActDrafts(input.scope, tx);
    const knownKeys = new Set(drafts.map((draft) => draft.draftKey));
    if (content.dependencies.some((key) => !knownKeys.has(key))) {
      throw new Error("Dipendenza non riconosciuta nel procedimento corrente.");
    }
    if (input.idempotentCreate && input.expectedVersion === 0) {
      const matches = drafts.filter((draft) => actDraftMatchesTemplate(draft, {
        templateKey: content.templateKey,
        issueSemanticKey: content.issueSemanticKey,
        legacyTemplateKeys: input.creationIdentity?.legacyTemplateKeys,
      }));
      if (matches.length > 1) {
        throw new Error("Sono presenti più bozze per questa attività: selezionare esplicitamente quella pertinente nell'archivio.");
      }
      if (matches[0]) return versionMetadata(matches[0].current);
      if (drafts.some((draft) => (input.creationIdentity?.ambiguousLegacyKeys ?? [])
        .includes(draft.current.templateKey) && draft.current.issueSemanticKey === content.issueSemanticKey)) {
        throw new Error("È presente una bozza precedente con collegamento ambiguo: attribuirla esplicitamente prima di crearne un'altra.");
      }
    }
    const latestVersion = drafts.find((draft) => draft.draftKey === draftKey)?.current ?? null;
    const latest = latestVersion?.version ?? 0;
    if (latest !== input.expectedVersion) {
      if (input.idempotentCreate && input.expectedVersion === 0 && latestVersion
        && latestVersion.templateKey === content.templateKey
        && latestVersion.issueSemanticKey === content.issueSemanticKey) {
        return versionMetadata(latestVersion);
      }
      throw new ActDraftVersionConflictError();
    }
    if (latestVersion && (latestVersion.templateKey !== content.templateKey
      || latestVersion.issueSemanticKey !== content.issueSemanticKey)) {
      throw new Error("L'identità dell'atto può essere modificata solo mediante associazione esplicita e verificata.");
    }
    const metadata: ActDraftVersionMetadata = {
      ...content,
      schema: ACT_DRAFT_SCHEMA_VERSION,
      procedimentoId: input.scope.procedimentoId,
      draftKey,
      version: latest + 1,
      bodySha256: bodySha256(content.body),
    };
    await appendDraftVersion(tx, input.scope, input.actor, metadata);
    return metadata;
  };
  return input.guidedContext
    ? runSerializableTransactionWithRetry(save)
    : prisma.$transaction(save);
}

export async function associateLegacyActDraft(input: {
  scope: ActDraftScope;
  actor: ActDraftActor;
  knowledgeRevisionId: string;
  reportFingerprint: string;
  expectedCorpusFingerprint: string;
  specs: readonly ActivitySpec[];
  spec: ActivitySpec;
  expectedActivityVersion: number;
  draftKey: string;
  expectedDraftVersion: number;
  templateKey: string;
  legacyKeys: readonly string[];
  note: string;
}): Promise<ActDraftVersionMetadata> {
  const document = input.spec.documents.find((item) => item.templateKey === input.templateKey);
  if (!document || !input.note.trim() || input.legacyKeys.length === 0) {
    throw new ActivityWorkflowError("INVALID_DRAFT", "L'associazione della bozza non è valida.");
  }
  return runSerializableTransactionWithRetry(async (tx) => {
    await lockActivityScope(tx, input.scope);
    await lockDraft(tx, actDraftEntityId(input.scope.procedimentoId, input.draftKey));
    const versions = await assertGuidedDraftContext(tx, input.scope, input);
    const drafts = await listActDrafts(input.scope, tx);
    const draft = drafts.find((item) => item.draftKey === input.draftKey);
    if (!draft || draft.current.issueSemanticKey !== input.spec.issueSemanticKey
      || draft.current.status === "ARCHIVIATA") {
      throw new ActivityWorkflowError("INVALID_DRAFT", "La bozza non è disponibile per questa problematica.");
    }
    const alreadyAssociated = draft.current.templateKey === input.templateKey;
    if (!alreadyAssociated && draft.current.version !== input.expectedDraftVersion) {
      throw new ActivityWorkflowError("STALE_VERSION", "La bozza è stata modificata: ricaricare la pagina.");
    }
    if (!alreadyAssociated && !input.legacyKeys.includes(draft.current.templateKey)) {
      throw new ActivityWorkflowError("INVALID_DRAFT", "La bozza non è un precedente ambiguo per questo documento.");
    }
    if (drafts.some((other) => other.draftKey !== draft.draftKey && actDraftMatchesTemplate(other, {
      templateKey: input.templateKey,
      issueSemanticKey: input.spec.issueSemanticKey,
      legacyTemplateKeys: document.legacyTemplateKeys,
    }))) {
      throw new ActivityWorkflowError("INVALID_DRAFT", "Esiste già una bozza per questa attività e tipologia di documento.");
    }
    if (versions.some((version) => version.drafts.some((link) => link.draftKey === draft.draftKey
      && (version.activityKey !== input.spec.activityKey || link.templateKey !== input.templateKey)))) {
      throw new ActivityWorkflowError("INVALID_DRAFT", "La bozza risulta già collegata alla cronologia di un'altra attività o documento.");
    }
    if (alreadyAssociated) return versionMetadata(draft.current);
    const metadata = actDraftVersionMetadataSchema.parse({
      ...versionMetadata(draft.current),
      templateKey: input.templateKey,
      version: draft.current.version + 1,
      status: draft.current.status === "APPROVATA_INTERNAMENTE" ? "IN_REVISIONE" : draft.current.status,
      changeNote: `Associazione esplicita all'attività e al documento: ${input.note.trim()}`,
    });
    await appendDraftVersion(tx, input.scope, input.actor, metadata);
    return metadata;
  });
}
