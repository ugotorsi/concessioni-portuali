import { createHash } from "node:crypto";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  ACT_DRAFT_LOCK_NAMESPACE,
  actDraftEntityId,
  type ActDraft,
} from "@/server/fascicolo-acts/model";
import {
  listActDrafts,
  type ActDraftActor,
  type ActDraftScope,
} from "@/server/fascicolo-acts/repository";
import { readFascicoloDocumentCorpusInTransaction } from "@/server/queries/fascicolo-document-corpus";

import {
  ACTIVITY_AUDIT_ACTION,
  ACTIVITY_ENTITY,
  ACTIVITY_LOCK_NAMESPACE,
  ActivityWorkflowError,
  activityCommandSchema,
  activityDocumentVersionSchema,
  activityForKey,
  activityMetadataSchema,
  activityVersionFromLogRow,
  applyActivityCommand,
  projectActivities,
  type ActivityCommand,
  type ActivityDocumentVersion,
  type ActivityMetadata,
  type ActivityRecord,
  type ActivitySpec,
  type ActivityVersion,
} from "./model";

export interface ActivityRepositoryExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  listDrafts(scope: Pick<ActDraftScope, "tenantId" | "procedimentoId">): Promise<readonly ActDraft[]>;
  readCorpusFingerprint(scope: Pick<ActDraftScope, "tenantId" | "procedimentoId">): Promise<string | null>;
  audit(input: {
    scope: ActDraftScope;
    actor: ActDraftActor;
    metadata: ActivityMetadata;
  }): Promise<unknown>;
}

export interface ActivityRepositoryContext {
  read: ActivityRepositoryExecutor;
  transaction<T>(operation: (tx: ActivityRepositoryExecutor) => Promise<T>): Promise<T>;
  now?: () => Date;
}

function activityEntityId(procedimentoId: string, activityKey: string): string {
  return `${procedimentoId}::${activityKey}`;
}

function executor(client: Prisma.TransactionClient): ActivityRepositoryExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) };
    },
    listDrafts: (scope) => listActDrafts(scope, client),
    readCorpusFingerprint: async (scope) => (await readFascicoloDocumentCorpusInTransaction(scope, client))?.corpusFingerprint ?? null,
    audit: ({ scope, actor, metadata }) => createAuditLogInTransaction(client, {
      azione: ACTIVITY_AUDIT_ACTION,
      entita: ACTIVITY_ENTITY,
      entitaId: activityEntityId(scope.procedimentoId, metadata.activityKey),
      enteId: scope.tenantId,
      concessioneId: scope.concessioneId,
      esito: "SUCCESS",
      metadata: { ...metadata },
      actor: { userId: actor.actorId, userEmail: actor.actorEmail, userRole: actor.actorRole },
    }),
  };
}

const defaultContext: ActivityRepositoryContext = {
  read: executor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(executor(tx))),
};

interface ActivityLogRow {
  entitaId: string | null;
  metadata: unknown;
  createdAt: Date;
  userEmail: string | null;
  currentHash: string;
}

async function assertAuthority(tx: ActivityRepositoryExecutor, scope: ActDraftScope): Promise<void> {
  const result = await tx.query<{ concessioneId: string | null }>(`
    SELECT p."concessioneId"
    FROM "Procedimento" p
    LEFT JOIN "Concessione" c ON c."id" = p."concessioneId"
    WHERE p."id" = $1 AND p."enteId" = $2
      AND (p."concessioneId" IS NULL OR c."enteId" = $2)
  `, [scope.procedimentoId, scope.tenantId]);
  if (!result.rows[0] || result.rows[0].concessioneId !== scope.concessioneId) {
    throw new ActivityWorkflowError("AUTHORITY_MISMATCH", "Procedimento o ente competente non corrispondente.");
  }
}

async function listVersions(tx: ActivityRepositoryExecutor, scope: ActDraftScope): Promise<ActivityVersion[]> {
  const prefix = `${scope.procedimentoId}::`;
  const result = await tx.query<ActivityLogRow>(`
    SELECT "entitaId", "metadata", "createdAt", "userEmail", "currentHash"
    FROM "ActivityLog"
    WHERE "enteId" = $1 AND "entita" = $2 AND "azione" = $3 AND "esito" = 'SUCCESS'
      AND left("entitaId", length($4)) = $4
    ORDER BY "createdAt", "id"
  `, [scope.tenantId, ACTIVITY_ENTITY, ACTIVITY_AUDIT_ACTION, prefix]);
  return result.rows.map((row) => activityVersionFromLogRow(row, scope.procedimentoId));
}

export async function listOperationalActivities(
  scope: ActDraftScope,
  overrides: Partial<ActivityRepositoryContext> = {},
): Promise<ActivityRecord[]> {
  const ctx = { ...defaultContext, ...overrides };
  await assertAuthority(ctx.read, scope);
  return projectActivities(await listVersions(ctx.read, scope));
}

function commandDocumentIds(command: ActivityCommand, current: ActivityRecord | undefined): string[] {
  switch (command.kind) {
    case "CONFIGURE":
      return [...command.dueDateDocumentIds, ...command.attachedDocumentIds];
    case "RECORD_EXECUTION":
    case "RECORD_OUTCOME":
      return command.documentIds;
    case "VERIFY_COMPLETION":
      return [...(current?.current.execution?.documentIds ?? []), ...(current?.current.outcome?.documentIds ?? [])];
    default:
      return [];
  }
}

async function lockDrafts(
  tx: ActivityRepositoryExecutor,
  procedimentoId: string,
  command: ActivityCommand,
  current: ActivityRecord | undefined,
): Promise<void> {
  const keys = command.kind === "PREPARE_DRAFT" || command.kind === "VALIDATE_DRAFT"
    ? [command.draftKey]
    : command.kind === "RECORD_EXECUTION" ? (current?.current.drafts.map((draft) => draft.draftKey) ?? []) : [];
  for (const draftKey of [...new Set(keys)].sort()) {
    await tx.query(`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(hashtext($1), hashtext($2))
    `, [ACT_DRAFT_LOCK_NAMESPACE, actDraftEntityId(procedimentoId, draftKey)]);
  }
}

async function verifiedApproval(
  tx: ActivityRepositoryExecutor,
  input: {
    scope: ActDraftScope;
    proposalId: string;
    spec: ActivitySpec;
    specs: readonly ActivitySpec[];
    knowledgeRevisionId: string;
    reportFingerprint: string;
    command: Extract<ActivityCommand, { kind: "ADOPT_APPROVAL" | "REEVALUATE_PROPOSAL" }>;
  },
): Promise<string> {
  const result = await tx.query<{
    id: string;
    status: string;
    proposalType: string;
    title: string;
    knowledgeRevisionId: string;
    structuredReportFingerprint: string;
    originatingIssueSemanticKeys: string[];
    proposedPayload: unknown;
    samePayload: boolean;
    reviewVersion: number;
    supersededAt: Date | null;
  }>(`
    SELECT "id", "status", "proposalType", "title", "knowledgeRevisionId",
      "structuredReportFingerprint", "originatingIssueSemanticKeys", "proposedPayload",
      "reviewVersion", "supersededAt", ("approvedPayload" = "proposedPayload") AS "samePayload"
    FROM "FascicoloOperationalProposal"
    WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3
    FOR UPDATE
  `, [input.proposalId, input.scope.tenantId, input.scope.procedimentoId]);
  const proposal = result.rows[0];
  const payload = proposal?.proposedPayload;
  const code = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Reflect.get(payload, "activityCode") : null;
  const uniqueLegacyTitle = input.specs.filter((spec) =>
    spec.issueSemanticKey === input.spec.issueSemanticKey && spec.title === input.spec.title).length === 1;
  const reviewMatches = proposal && (input.command.kind === "ADOPT_APPROVAL"
    ? ["APPROVED", "AMENDED_AND_APPROVED"].includes(proposal.status) && proposal.samePayload === true
      && proposal.knowledgeRevisionId === input.knowledgeRevisionId
      && proposal.structuredReportFingerprint === input.reportFingerprint && proposal.supersededAt === null
    : proposal.status === input.command.expectedProposalStatus
      && proposal.reviewVersion === input.command.expectedReviewVersion);
  if (!proposal || !reviewMatches
    || proposal.proposalType !== "ACTIVITY"
    || !proposal.originatingIssueSemanticKeys.includes(input.spec.issueSemanticKey)
    || (typeof code === "string" ? code !== input.spec.activityCode : proposal.title !== input.spec.title || !uniqueLegacyTitle)) {
    throw new ActivityWorkflowError(
      "APPROVAL_NOT_AVAILABLE",
      "La proposta approvata non coincide con l'attività e il rapporto correnti: occorre una nuova valutazione.",
    );
  }
  return proposal.id;
}

async function assertNoMatchingProposal(
  tx: ActivityRepositoryExecutor,
  input: {
    scope: ActDraftScope;
    spec: ActivitySpec;
    knowledgeRevisionId: string;
    reportFingerprint: string;
  },
): Promise<void> {
  const result = await tx.query<{ id: string }>(`
    SELECT "id" FROM "FascicoloOperationalProposal"
    WHERE "tenantId" = $1 AND "procedimentoId" = $2
      AND "proposalType" = 'ACTIVITY'
      AND ("status" IN ('APPROVED', 'AMENDED_AND_APPROVED', 'REJECTED')
        OR ("status" = 'PROPOSED' AND "supersededAt" IS NULL
          AND "knowledgeRevisionId" = $3 AND "structuredReportFingerprint" = $4))
      AND $5 = ANY("originatingIssueSemanticKeys")
      AND (("proposedPayload" ->> 'activityCode') = $7
        OR ("proposedPayload" ->> 'activityCode' IS NULL AND "title" = $6))
    FOR SHARE
  `, [
    input.scope.tenantId, input.scope.procedimentoId, input.knowledgeRevisionId,
    input.reportFingerprint, input.spec.issueSemanticKey, input.spec.title, input.spec.activityCode,
  ]);
  if (result.rows.length) {
    throw new ActivityWorkflowError(
      "APPROVAL_NOT_AVAILABLE",
      "Esiste una proposta per questa attività: riesaminare la proposta invece di aggirarne la decisione.",
    );
  }
}

export async function appendActivityCommand(input: {
  scope: ActDraftScope;
  actor: ActDraftActor;
  knowledgeRevisionId: string;
  reportFingerprint: string;
  specs: readonly ActivitySpec[];
  activityKey: string;
  expectedSpecFingerprint: string;
  expectedCorpusFingerprint: string;
  expectedVersion: number;
  requestId: string;
  command: ActivityCommand;
  verifiedDocuments?: readonly ActivityDocumentVersion[];
}, overrides: Partial<ActivityRepositoryContext> = {}): Promise<ActivityMetadata> {
  z.string().uuid().parse(input.requestId);
  z.number().int().nonnegative().parse(input.expectedVersion);
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedSpecFingerprint);
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedCorpusFingerprint);
  const command = activityCommandSchema.parse(input.command);
  const verifiedDocuments = z.array(activityDocumentVersionSchema).max(50).parse(input.verifiedDocuments ?? []);
  const requestFingerprint = createHash("sha256").update(stableStringify({
    activityKey: input.activityKey,
    expectedVersion: input.expectedVersion,
    expectedSpecFingerprint: input.expectedSpecFingerprint,
    expectedCorpusFingerprint: input.expectedCorpusFingerprint,
    reportFingerprint: input.reportFingerprint,
    command,
  }), "utf8").digest("hex");
  const ctx = { ...defaultContext, ...overrides };
  return ctx.transaction(async (tx) => {
    await tx.query(`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(hashtext($1), hashtext($2))
    `, [ACTIVITY_LOCK_NAMESPACE, `${input.scope.tenantId}::${input.scope.procedimentoId}`]);
    await assertAuthority(tx, input.scope);
    const records = projectActivities(await listVersions(tx, input.scope));
    const current = activityForKey(records, input.activityKey);
    if (current && current.activityKey !== input.activityKey) {
      throw new ActivityWorkflowError("SHARING_CONFLICT", "L'attività è condivisa: utilizzare la sua cronologia principale.");
    }
    const retry = current?.history.find((version) => version.requestId === input.requestId);
    if (retry) {
      if (retry.requestFingerprint !== requestFingerprint) {
        throw new ActivityWorkflowError("IDEMPOTENCY_CONFLICT", "Identificativo di richiesta già usato per un'altra operazione.");
      }
      const { savedAt, savedBy, auditHash, ...metadata } = retry;
      void savedAt;
      void savedBy;
      void auditHash;
      return activityMetadataSchema.parse(metadata);
    }
    if ((current?.current.version ?? 0) !== input.expectedVersion) {
      throw new ActivityWorkflowError("STALE_VERSION", "L'attività è stata modificata: ricaricare la pagina.");
    }
    const spec = input.specs.find((item) => item.activityKey === input.activityKey);
    if (!spec || spec.fingerprint !== input.expectedSpecFingerprint) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il quadro giuridico o documentale è cambiato: ricaricare la pagina.");
    }
    const revision = await tx.query<{ id: string; corpusFingerprint: string }>(`
      SELECT "id", "corpusFingerprint" FROM "FascicoloKnowledgeRevision"
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 AND "status" = 'CURRENT'
      FOR SHARE
    `, [input.knowledgeRevisionId, input.scope.tenantId, input.scope.procedimentoId]);
    if (!revision.rows[0]) {
      throw new ActivityWorkflowError("STALE_SPEC", "La revisione documentale non è più attuale.");
    }
    const report = await tx.query<{ id: string }>(`
      SELECT "id" FROM "StructuredFascicoloReportSnapshot"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "knowledgeRevisionId" = $3
        AND "reportFingerprint" = $4 AND "status" = 'CURRENT'
      FOR SHARE
    `, [input.scope.tenantId, input.scope.procedimentoId, input.knowledgeRevisionId, input.reportFingerprint]);
    if (!report.rows[0]) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il rapporto non è archiviato o è stato sostituito: aggiornare il quadro prima di procedere.");
    }
    const corpusFingerprint = await tx.readCorpusFingerprint(input.scope);
    if (corpusFingerprint !== input.expectedCorpusFingerprint) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il fascicolo è cambiato: ricaricare e verificare i documenti.");
    }
    const corpus = {
      fingerprint: corpusFingerprint,
      analysisCurrent: revision.rows[0].corpusFingerprint === corpusFingerprint,
    };
    if (!corpus.analysisCurrent
      && (["APPROVE", "ADOPT_APPROVAL", "REEVALUATE_PROPOSAL", "RECONFIRM"].includes(command.kind)
        || (command.kind === "VERIFY_COMPLETION" && command.manualReview !== true))) {
      throw new ActivityWorkflowError("STALE_SPEC", "L'analisi non è aggiornata rispetto ai documenti del fascicolo.");
    }
    if (command.kind === "APPROVE") {
      await assertNoMatchingProposal(tx, {
        scope: input.scope, spec, knowledgeRevisionId: input.knowledgeRevisionId,
        reportFingerprint: input.reportFingerprint,
      });
    }
    const requestedIds = [...new Set(commandDocumentIds(command, current))];
    const documents = requestedIds.length ? await tx.query<{
      id: string;
      fileVersionId: string | null;
      sha256: string | null;
    }>(`
      SELECT d."id", v."id" AS "fileVersionId", v."sha256"
      FROM "Documento" d
      LEFT JOIN "DocumentFileVersion" v ON v."id" = d."currentFileVersionId"
        AND v."documentId" = d."id" AND v."canonicalEnteId" = d."enteId"
      WHERE d."procedimentoId" = $1 AND d."id" = ANY($2::text[]) AND d."enteId" = $3
      FOR SHARE OF d
    `, [input.scope.procedimentoId, requestedIds, input.scope.tenantId]) : { rows: [] };
    const documentVersions = new Map<string, ActivityDocumentVersion>();
    for (const document of documents.rows) {
      const verified = verifiedDocuments.find((item) => item.documentId === document.id);
      if (verified && verified.fileVersionId === document.fileVersionId && verified.sha256 === document.sha256) {
        documentVersions.set(document.id, verified);
      }
    }
    await lockDrafts(tx, input.scope.procedimentoId, command, current);
    const needsDrafts = ["PREPARE_DRAFT", "VALIDATE_DRAFT", "RECORD_EXECUTION"].includes(command.kind);
    const drafts = needsDrafts ? await tx.listDrafts(input.scope) : [];
    const approvedProposalId = command.kind === "ADOPT_APPROVAL" || command.kind === "REEVALUATE_PROPOSAL" ? await verifiedApproval(tx, {
      scope: input.scope,
      proposalId: command.proposalId,
      spec,
      specs: input.specs,
      knowledgeRevisionId: input.knowledgeRevisionId,
      reportFingerprint: input.reportFingerprint,
      command,
    }) : null;
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    }).format((ctx.now ?? (() => new Date()))());
    const metadata = applyActivityCommand({
      procedimentoId: input.scope.procedimentoId,
      spec,
      specs: input.specs,
      current,
      records,
      drafts,
      documentIds: new Set(documents.rows.map((document) => document.id)),
      documentVersions,
      corpus,
      command,
      requestId: input.requestId,
      requestFingerprint,
      today,
      approvedProposalId,
    });
    await tx.audit({ scope: input.scope, actor: input.actor, metadata });
    return metadata;
  });
}
