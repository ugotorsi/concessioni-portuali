import { createHash } from "node:crypto";

import { z } from "zod";

import { stableStringify } from "@/server/audit/hash";
import { actDraftMatchesTemplate, type ActDraft } from "@/server/fascicolo-acts/model";
import { reportStepDocumentIdentity, reportStepDocuments } from "@/server/fascicolo-acts/templates";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

export const ACTIVITY_ENTITY = "FascicoloOperationalActivity" as const;
export const ACTIVITY_AUDIT_ACTION = "FASCICOLO_OPERATIONAL_ACTIVITY_VERSION_SAVED" as const;
export const ACTIVITY_SCHEMA = "FASCICOLO_OPERATIONAL_ACTIVITY_V1" as const;
export const ACTIVITY_LOCK_NAMESPACE = "fascicolo-operational-activity:v1" as const;

export const ACTIVITY_STATUSES = [
  "APPROVED",
  "IN_PROGRESS",
  "DRAFT_PREPARATION",
  "DRAFT_VALIDATED",
  "EXECUTED",
  "OUTCOME_RECORDED",
  "COMPLETED",
  "EXCLUDED",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  APPROVED: "Approvata, da prendere in carico",
  IN_PROGRESS: "In lavorazione",
  DRAFT_PREPARATION: "Atto in preparazione",
  DRAFT_VALIDATED: "Bozza validata internamente",
  EXECUTED: "Esecuzione registrata",
  OUTCOME_RECORDED: "Riscontro acquisito",
  COMPLETED: "Completamento verificato dal professionista",
  EXCLUDED: "Iniziativa esclusa motivatamente",
};

const hash = (value: unknown) => createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
const activityKeySchema = z.string().regex(/^activity_[a-f0-9]{32}$/);
const documentIdSchema = z.string().trim().min(1).max(256);
const documentIdsSchema = z.array(documentIdSchema).max(50);
const noteSchema = z.string().trim().min(3).max(4_000);
const isoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data non valida.");

export interface ActivitySpec {
  activityKey: string;
  issueSemanticKey: string;
  issueText: string;
  activityCode: string;
  title: string;
  action: string;
  office: string;
  requiredDocuments: readonly string[];
  completionGate: string;
  necessity: "REQUIRED" | "CONDITIONAL" | "NOT_JUSTIFIED";
  legalSummary: string;
  legalSourceStatus: "VERIFIED_SOURCES_ATTACHED" | "LEGAL_RESEARCH_REQUIRED";
  alternatives: readonly { title: string; whenApplicable: string; practicalRoute: string; riskOrLimit: string }[];
  documents: readonly {
    templateKey: string;
    title: string;
    legacyTemplateKeys: readonly string[];
  }[];
  fingerprint: string;
}

export function stableActivityKey(procedimentoId: string, issueSemanticKey: string, activityCode: string): string {
  return `activity_${hash([procedimentoId, issueSemanticKey, activityCode]).slice(0, 32)}`;
}

export function buildActivitySpecs(payload: StructuredFascicoloReportPayload): ActivitySpec[] {
  const specs: ActivitySpec[] = [];
  for (const plan of payload.operationalPlans ?? []) {
    const application = payload.legalApplication?.find((item) => item.issueSemanticKey === plan.issueSemanticKey);
    for (const step of plan.steps) {
      const activityCode = step.activityCode ?? `LEGACY:${hash(step.title).slice(0, 24)}`;
      const documents = reportStepDocuments(step).map((document) => {
        const { templateKey, legacyTemplateKeys } = reportStepDocumentIdentity(plan, step, document);
        return {
          templateKey,
          title: document.title,
          legacyTemplateKeys,
        };
      });
      const fingerprint = hash({
        issueSemanticKey: plan.issueSemanticKey,
        activityCode,
        step,
        legalSourceStatus: plan.legalSourceStatus,
        legalApplication: application ?? null,
        alternatives: plan.alternatives,
      });
      specs.push({
        activityKey: stableActivityKey(payload.procedimentoId, plan.issueSemanticKey, activityCode),
        issueSemanticKey: plan.issueSemanticKey,
        issueText: plan.issueText,
        activityCode,
        title: step.title,
        action: step.action,
        office: step.office,
        requiredDocuments: step.requiredDocuments,
        completionGate: step.completionGate,
        necessity: step.necessity ?? "CONDITIONAL",
        legalSummary: application?.conclusion ?? "Analisi giuridica da verificare prima di scegliere l'iniziativa.",
        legalSourceStatus: plan.legalSourceStatus,
        alternatives: plan.alternatives,
        documents,
        fingerprint,
      });
    }
  }
  if (new Set(specs.map((spec) => spec.activityKey)).size !== specs.length) {
    throw new Error("Identità di attività duplicata nel rapporto corrente.");
  }
  return specs;
}

const draftLinkSchema = z.object({
  templateKey: z.string().min(1).max(160),
  draftKey: z.string().min(1).max(64),
  preparedVersion: z.number().int().positive(),
  validatedVersion: z.number().int().positive().nullable(),
}).strict();
export const activityDocumentVersionSchema = z.object({
  documentId: documentIdSchema,
  fileVersionId: documentIdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ActivityDocumentVersion = z.infer<typeof activityDocumentVersionSchema>;
const evidenceSchema = z.object({
  date: isoDaySchema,
  description: noteSchema,
  documentIds: documentIdsSchema.min(1),
  fileVersions: z.array(activityDocumentVersionSchema).max(50).optional(),
}).strict();

export const activityMetadataSchema = z.object({
  schema: z.literal(ACTIVITY_SCHEMA),
  procedimentoId: z.string().min(1).max(256),
  activityKey: activityKeySchema,
  issueSemanticKey: z.string().min(1).max(256),
  issueText: z.string().min(1).max(100_000).optional(),
  activityCode: z.string().min(1).max(256),
  title: z.string().min(1).max(512),
  specFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
  requestId: z.string().uuid(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  event: z.enum([
    "APPROVE", "ADOPT_APPROVAL", "REEVALUATE_PROPOSAL", "TAKE_CHARGE", "CONFIGURE", "PREPARE_DRAFT",
    "VALIDATE_DRAFT", "RECORD_EXECUTION", "RECORD_OUTCOME", "VERIFY_COMPLETION",
    "BLOCK", "UNBLOCK", "EXCLUDE", "RECONFIRM", "REOPEN",
  ]),
  eventNote: noteSchema,
  approvalProposalId: z.string().max(96).nullable(),
  approvalReviewVersion: z.number().int().nonnegative().optional(),
  approvalReviewStatus: z.enum(["REJECTED", "APPROVED", "AMENDED_AND_APPROVED"]).optional(),
  status: z.enum(ACTIVITY_STATUSES),
  assignee: z.string().trim().max(200).nullable(),
  dueDate: isoDaySchema.nullable(),
  dueDateReason: z.string().trim().max(2_000).nullable(),
  dueDateDocumentIds: documentIdsSchema,
  dueDateFileVersions: z.array(activityDocumentVersionSchema).max(50).optional(),
  dependencyKeys: z.array(activityKeySchema).max(50),
  sharedActivities: z.array(z.object({
    activityKey: activityKeySchema,
    specFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(50),
  attachedDocumentIds: documentIdsSchema,
  drafts: z.array(draftLinkSchema).max(20),
  execution: evidenceSchema.nullable(),
  outcome: evidenceSchema.extend({ alternativeTitle: z.string().max(512).nullable() }).nullable(),
  completionNote: z.string().max(4_000).nullable(),
  completionReviewMode: z.enum(["CURRENT_ANALYSIS", "MANUAL_CORPUS"]).optional(),
  completionCorpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  exclusionNote: z.string().max(4_000).nullable(),
  exclusionCorpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  blockedReason: z.string().max(4_000).nullable(),
}).strict();

export type ActivityMetadata = z.infer<typeof activityMetadataSchema>;
export interface ActivityVersion extends ActivityMetadata {
  savedAt: Date;
  savedBy: string | null;
  auditHash: string;
}

export function activityVersionFromLogRow(row: {
  entitaId: string | null;
  metadata: unknown;
  createdAt: Date;
  userEmail: string | null;
  currentHash: string;
}, procedimentoId: string): ActivityVersion {
  const parsed = activityMetadataSchema.safeParse(row.metadata);
  if (!parsed.success || parsed.data.procedimentoId !== procedimentoId
    || row.entitaId !== `${procedimentoId}::${parsed.data.activityKey}`
    || !(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    throw new ActivityWorkflowError("CORRUPT_HISTORY", "La cronologia dell'attività non è integra.");
  }
  return { ...parsed.data, savedAt: row.createdAt, savedBy: row.userEmail, auditHash: row.currentHash };
}
export interface ActivityRecord {
  activityKey: string;
  current: ActivityVersion;
  history: readonly ActivityVersion[];
}

const commandNote = { note: noteSchema };
export const activityCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("APPROVE"), ...commandNote, confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("ADOPT_APPROVAL"), ...commandNote, proposalId: z.string().min(1).max(96), confirmed: z.literal(true) }).strict(),
  z.object({
    kind: z.literal("REEVALUATE_PROPOSAL"), ...commandNote, proposalId: z.string().min(1).max(96),
    expectedReviewVersion: z.number().int().nonnegative(),
    expectedProposalStatus: z.enum(["REJECTED", "APPROVED", "AMENDED_AND_APPROVED"]), confirmed: z.literal(true),
  }).strict(),
  z.object({ kind: z.literal("TAKE_CHARGE"), ...commandNote }).strict(),
  z.object({
    kind: z.literal("CONFIGURE"), ...commandNote,
    assignee: z.string().trim().max(200).nullable(),
    dueDate: isoDaySchema.nullable(),
    dueDateReason: z.string().trim().max(2_000).nullable(),
    dueDateDocumentIds: documentIdsSchema,
    dueDateVerified: z.boolean(),
    dependencyKeys: z.array(activityKeySchema).max(50),
    sharedActivityKeys: z.array(activityKeySchema).max(50),
    attachedDocumentIds: documentIdsSchema,
  }).strict(),
  z.object({ kind: z.literal("PREPARE_DRAFT"), ...commandNote, templateKey: z.string().min(1).max(160), draftKey: z.string().min(1).max(64), draftVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("VALIDATE_DRAFT"), ...commandNote, templateKey: z.string().min(1).max(160), draftKey: z.string().min(1).max(64), draftVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("RECORD_EXECUTION"), ...commandNote, date: isoDaySchema, documentIds: documentIdsSchema.min(1) }).strict(),
  z.object({ kind: z.literal("RECORD_OUTCOME"), ...commandNote, date: isoDaySchema, documentIds: documentIdsSchema.min(1), alternativeTitle: z.string().max(512).nullable() }).strict(),
  z.object({ kind: z.literal("VERIFY_COMPLETION"), ...commandNote, confirmed: z.literal(true), manualReview: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("BLOCK"), ...commandNote }).strict(),
  z.object({ kind: z.literal("UNBLOCK"), ...commandNote }).strict(),
  z.object({ kind: z.literal("EXCLUDE"), ...commandNote, confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("RECONFIRM"), ...commandNote, confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("REOPEN"), ...commandNote, confirmed: z.literal(true) }).strict(),
]);
export type ActivityCommand = z.infer<typeof activityCommandSchema>;

export class ActivityWorkflowError extends Error {
  constructor(readonly code:
    | "AUTHORITY_MISMATCH" | "IDEMPOTENCY_CONFLICT" | "STALE_VERSION" | "STALE_SPEC" | "INVALID_TRANSITION" | "NOT_JUSTIFIED"
    | "DEPENDENCY_BLOCKED" | "INVALID_DEPENDENCY" | "DEPENDENCY_CYCLE"
    | "SHARING_CONFLICT" | "UNKNOWN_DOCUMENT" | "EVIDENCE_UNAVAILABLE" | "EVIDENCE_CHANGED" | "INVALID_DRAFT"
    | "INVALID_DATE" | "DUE_EVIDENCE_REQUIRED" | "INVALID_ALTERNATIVE"
    | "APPROVAL_NOT_AVAILABLE" | "CORRUPT_HISTORY",
  message: string) {
    super(message);
    this.name = "ActivityWorkflowError";
  }
}

function fail(code: ActivityWorkflowError["code"], message: string): never {
  throw new ActivityWorkflowError(code, message);
}

export function activityForKey(records: readonly ActivityRecord[], key: string): ActivityRecord | undefined {
  return records.find((record) => record.activityKey === key
    || record.current.sharedActivities.some((shared) => shared.activityKey === key));
}

export interface ActivityCorpusState {
  fingerprint: string;
  analysisCurrent: boolean;
}

export function activityNeedsReview(
  record: ActivityRecord,
  specs: readonly ActivitySpec[],
  corpus?: ActivityCorpusState,
): boolean {
  const fingerprints = new Map(specs.map((spec) => [spec.activityKey, spec.fingerprint]));
  return fingerprints.get(record.activityKey) !== record.current.specFingerprint
    || record.current.sharedActivities.some((shared) => fingerprints.get(shared.activityKey) !== shared.specFingerprint)
    || Boolean(corpus && (
      (record.current.status === "EXCLUDED" && (
        !corpus.analysisCurrent || record.current.exclusionCorpusFingerprint !== corpus.fingerprint
      ))
      || (record.current.status === "COMPLETED" && record.current.completionCorpusFingerprint !== corpus.fingerprint)
    ));
}

function isVerifiedComplete(
  record: ActivityRecord,
  records: readonly ActivityRecord[],
  specs: readonly ActivitySpec[],
  corpus?: ActivityCorpusState,
  active: ReadonlySet<string> = new Set(),
): boolean {
  if (active.has(record.activityKey) || record.current.status !== "COMPLETED"
    || record.current.blockedReason !== null || activityNeedsReview(record, specs, corpus)) return false;
  const ancestors = new Set(active).add(record.activityKey);
  return record.current.dependencyKeys.every((key) => {
    const dependency = activityForKey(records, key);
    return dependency !== undefined && isVerifiedComplete(dependency, records, specs, corpus, ancestors);
  });
}

export function openActivityDependencies(
  record: ActivityRecord,
  records: readonly ActivityRecord[],
  specs: readonly ActivitySpec[],
  corpus?: ActivityCorpusState,
): string[] {
  return record.current.dependencyKeys.filter((key) => {
    const dependency = activityForKey(records, key);
    return !dependency || !isVerifiedComplete(dependency, records, specs, corpus);
  });
}

export function activityProgress(
  specs: readonly ActivitySpec[],
  records: readonly ActivityRecord[],
  allSpecs: readonly ActivitySpec[] = specs,
  corpus?: ActivityCorpusState,
): {
  completed: number;
  pending: number;
  excluded: number;
  percentage: number | null;
} {
  let completed = 0;
  let excluded = 0;
  for (const spec of specs) {
    const record = activityForKey(records, spec.activityKey);
    if (!record || activityNeedsReview(record, allSpecs, corpus)) continue;
    if (isVerifiedComplete(record, records, allSpecs, corpus)) completed += 1;
    if (record.current.status === "EXCLUDED") excluded += 1;
  }
  const applicable = specs.length - excluded;
  return {
    completed,
    pending: applicable - completed,
    excluded,
    percentage: applicable > 0 ? Math.round((completed / applicable) * 100) : null,
  };
}

export function projectActivities(versions: readonly ActivityVersion[]): ActivityRecord[] {
  const byKey = new Map<string, ActivityVersion[]>();
  for (const version of versions) {
    const history = byKey.get(version.activityKey) ?? [];
    if (history.some((item) => item.version === version.version)) {
      fail("CORRUPT_HISTORY", "La cronologia dell'attività contiene versioni duplicate.");
    }
    history.push(version);
    byKey.set(version.activityKey, history);
  }
  const records = [...byKey.entries()].map(([activityKey, history]) => {
    history.sort((left, right) => right.version - left.version);
    if (history.some((item, index) => item.version !== history.length - index
      || item.activityKey !== stableActivityKey(item.procedimentoId, item.issueSemanticKey, item.activityCode))
      || new Set(history.map((item) => item.requestId)).size !== history.length) {
      fail("CORRUPT_HISTORY", "La cronologia dell'attività non è continua.");
    }
    return { activityKey, current: history[0], history };
  });
  const owners = new Map<string, string>();
  for (const record of records) {
    for (const key of [record.activityKey, ...record.current.sharedActivities.map((shared) => shared.activityKey)]) {
      if (owners.has(key)) fail("SHARING_CONFLICT", "Un'attività è collegata a più cronologie.");
      owners.set(key, record.activityKey);
    }
  }
  return records;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertKnownDocuments(ids: readonly string[], allowed: ReadonlySet<string>): void {
  if (ids.some((id) => !allowed.has(id))) {
    fail("UNKNOWN_DOCUMENT", "Uno o più documenti non appartengono al fascicolo corrente.");
  }
}

function verifiedDocumentVersions(
  ids: readonly string[],
  versions: ReadonlyMap<string, ActivityDocumentVersion>,
): ActivityDocumentVersion[] {
  return unique(ids).map((id) => {
    const version = versions.get(id);
    if (!version) fail("EVIDENCE_UNAVAILABLE", "Il file documentale non è disponibile o non ha superato la verifica di integrità.");
    return version;
  });
}

function assertEvidenceUnchanged(
  evidence: z.infer<typeof evidenceSchema>,
  versions: ReadonlyMap<string, ActivityDocumentVersion>,
): void {
  const current = verifiedDocumentVersions(evidence.documentIds, versions);
  if (!evidence.fileVersions || evidence.fileVersions.length !== current.length
    || current.some((version) => !evidence.fileVersions?.some((saved) =>
      saved.documentId === version.documentId && saved.fileVersionId === version.fileVersionId && saved.sha256 === version.sha256))) {
    fail("EVIDENCE_CHANGED", "La versione di un documento è cambiata o non è stata verificata: aggiornare la registrazione.");
  }
}

function assertNoDependencyCycle(records: readonly ActivityRecord[], next: ActivityMetadata): void {
  const byKey = new Map<string, ActivityMetadata>();
  for (const record of records) {
    const value = record.activityKey === next.activityKey ? next : record.current;
    byKey.set(value.activityKey, value);
    for (const shared of value.sharedActivities) byKey.set(shared.activityKey, value);
  }
  byKey.set(next.activityKey, next);
  for (const shared of next.sharedActivities) byKey.set(shared.activityKey, next);
  const visit = (key: string, active: Set<string>, done: Set<string>) => {
    const current = byKey.get(key);
    if (!current) return;
    if (active.has(current.activityKey)) fail("DEPENDENCY_CYCLE", "Le dipendenze formano un ciclo.");
    if (done.has(current.activityKey)) return;
    active.add(current.activityKey);
    current.dependencyKeys.forEach((dependency) => visit(dependency, active, done));
    active.delete(current.activityKey);
    done.add(current.activityKey);
  };
  visit(next.activityKey, new Set(), new Set());
}

function assertDraftMatches(spec: ActivitySpec, templateKey: string, draft: ActDraft | undefined, version: number): ActDraft {
  const document = spec.documents.find((item) => item.templateKey === templateKey);
  if (!document || !draft || draft.current.version !== version || draft.current.status === "ARCHIVIATA") {
    fail("INVALID_DRAFT", "La bozza o la versione selezionata non è disponibile per questa attività.");
  }
  const matches = actDraftMatchesTemplate(draft, {
    templateKey,
    issueSemanticKey: spec.issueSemanticKey,
    legacyTemplateKeys: document.legacyTemplateKeys,
  });
  if (!matches) fail("INVALID_DRAFT", "La bozza non è collegata a questa attività e tipologia di documento.");
  return draft;
}

function metadataOf(version: ActivityVersion): ActivityMetadata {
  const { savedAt, savedBy, auditHash, ...metadata } = version;
  void savedAt;
  void savedBy;
  void auditHash;
  return metadata;
}

export function applyActivityCommand(input: {
  procedimentoId: string;
  spec: ActivitySpec;
  specs: readonly ActivitySpec[];
  current: ActivityRecord | undefined;
  records: readonly ActivityRecord[];
  drafts: readonly ActDraft[];
  documentIds: ReadonlySet<string>;
  documentVersions: ReadonlyMap<string, ActivityDocumentVersion>;
  corpus: ActivityCorpusState;
  command: ActivityCommand;
  requestId: string;
  requestFingerprint: string;
  today: string;
  approvedProposalId?: string | null;
}): ActivityMetadata {
  const command = activityCommandSchema.parse(input.command);
  const { current, spec } = input;
  const previous = current?.current;
  const first = command.kind === "APPROVE" || command.kind === "ADOPT_APPROVAL"
    || command.kind === "REEVALUATE_PROPOSAL" || command.kind === "EXCLUDE";
  if (!previous && !first) fail("INVALID_TRANSITION", "Approvare o escludere l'attività prima di procedere.");
  if (previous && (command.kind === "APPROVE" || command.kind === "ADOPT_APPROVAL" || command.kind === "REEVALUATE_PROPOSAL")) {
    fail("INVALID_TRANSITION", "L'attività possiede già una cronologia.");
  }
  if (spec.necessity === "NOT_JUSTIFIED" && command.kind !== "EXCLUDE" && command.kind !== "CONFIGURE"
    && !(command.kind === "RECONFIRM" && previous?.status === "EXCLUDED")
    && !(command.kind === "REOPEN" && previous?.status === "COMPLETED")) {
    fail("NOT_JUSTIFIED", "L'iniziativa non è attualmente giustificata dagli elementi disponibili.");
  }
  if ((command.kind === "ADOPT_APPROVAL" || command.kind === "REEVALUATE_PROPOSAL")
    && input.approvedProposalId !== command.proposalId) {
    fail("APPROVAL_NOT_AVAILABLE", "La revisione della proposta non è disponibile per questa attività.");
  }
  if (current && activityNeedsReview(current, input.specs, input.corpus)
    && !["RECONFIRM", "BLOCK", "EXCLUDE", "REOPEN"].includes(command.kind)) {
    fail("STALE_SPEC", "Il quadro dell'attività è cambiato: riesaminare e confermare prima di proseguire.");
  }
  const next: ActivityMetadata = previous ? {
    ...metadataOf(previous),
    version: previous.version + 1,
    requestId: input.requestId,
    requestFingerprint: input.requestFingerprint,
    event: command.kind,
    eventNote: command.note,
  } : {
    schema: ACTIVITY_SCHEMA,
    procedimentoId: input.procedimentoId,
    activityKey: spec.activityKey,
    issueSemanticKey: spec.issueSemanticKey,
    issueText: spec.issueText,
    activityCode: spec.activityCode,
    title: spec.title,
    specFingerprint: spec.fingerprint,
    version: 1,
    requestId: input.requestId,
    requestFingerprint: input.requestFingerprint,
    event: command.kind,
    eventNote: command.note,
    approvalProposalId: command.kind === "ADOPT_APPROVAL" || command.kind === "REEVALUATE_PROPOSAL" ? command.proposalId : null,
    ...(command.kind === "REEVALUATE_PROPOSAL" ? {
      approvalReviewVersion: command.expectedReviewVersion,
      approvalReviewStatus: command.expectedProposalStatus,
    } : {}),
    status: command.kind === "EXCLUDE" ? "EXCLUDED" : "APPROVED",
    assignee: null,
    dueDate: null,
    dueDateReason: null,
    dueDateDocumentIds: [],
    dueDateFileVersions: [],
    dependencyKeys: [],
    sharedActivities: [],
    attachedDocumentIds: [],
    drafts: [],
    execution: null,
    outcome: null,
    completionNote: null,
    exclusionNote: command.kind === "EXCLUDE" ? command.note : null,
    ...(command.kind === "EXCLUDE" ? { exclusionCorpusFingerprint: input.corpus.fingerprint } : {}),
    blockedReason: null,
  };
  if (!previous) return activityMetadataSchema.parse(next);

  const terminal = previous.status === "COMPLETED" || previous.status === "EXCLUDED";
  if (terminal && !["RECONFIRM", "REOPEN"].includes(command.kind)
    && !(previous.status === "COMPLETED" && command.kind === "CONFIGURE")) {
    fail("INVALID_TRANSITION", "L'attività è chiusa: riaprirla motivatamente prima di modificarla.");
  }
  if (previous.blockedReason && !["CONFIGURE", "UNBLOCK", "RECONFIRM", "EXCLUDE"].includes(command.kind)) {
    fail("DEPENDENCY_BLOCKED", "L'attività è bloccata: registrare prima la rimozione del blocco.");
  }
  const pendingDependencies = current ? openActivityDependencies(current, input.records, input.specs, input.corpus) : [];
  const requireDependencies = () => {
    if (pendingDependencies.length) fail("DEPENDENCY_BLOCKED", "Vi sono attività presupposte non ancora completate.");
  };

  switch (command.kind) {
    case "TAKE_CHARGE":
      if (previous.status !== "APPROVED") fail("INVALID_TRANSITION", "L'attività non è in attesa di presa in carico.");
      next.status = "IN_PROGRESS";
      break;
    case "CONFIGURE": {
      const dependencies = unique(command.dependencyKeys);
      const sharedKeys = unique(command.sharedActivityKeys);
      if (dependencies.includes(spec.activityKey) || sharedKeys.includes(spec.activityKey)
        || dependencies.some((key) => !input.specs.some((item) => item.activityKey === key))
        || sharedKeys.some((key) => !input.specs.some((item) =>
          item.activityKey === key && item.issueSemanticKey !== spec.issueSemanticKey))) {
        fail("INVALID_DEPENDENCY", "Dipendenza o attività condivisa non valida nel fascicolo.");
      }
      if (sharedKeys.some((key) => {
        const existing = activityForKey(input.records, key);
        return existing && existing.activityKey !== current?.activityKey;
      })) {
        fail("SHARING_CONFLICT", "Un'attività selezionata ha già una propria cronologia: non può essere accorpata automaticamente.");
      }
      if (command.dueDate && (!command.dueDateVerified || !command.dueDateReason || !command.dueDateDocumentIds.length)) {
        fail("DUE_EVIDENCE_REQUIRED", "Il termine richiede una verifica motivata e almeno un documento di riferimento.");
      }
      if (!command.dueDate && (command.dueDateReason || command.dueDateDocumentIds.length)) {
        fail("DUE_EVIDENCE_REQUIRED", "Indicare il termine verificato oppure rimuovere i suoi riferimenti.");
      }
      assertKnownDocuments([...command.dueDateDocumentIds, ...command.attachedDocumentIds], input.documentIds);
      next.assignee = command.assignee || null;
      next.dueDate = command.dueDate;
      next.dueDateReason = command.dueDateReason || null;
      next.dueDateDocumentIds = unique(command.dueDateDocumentIds);
      next.dueDateFileVersions = verifiedDocumentVersions(command.dueDateDocumentIds, input.documentVersions);
      next.dependencyKeys = dependencies;
      next.sharedActivities = sharedKeys.map((key) => {
        const sharedSpec = input.specs.find((item) => item.activityKey === key);
        if (!sharedSpec) fail("INVALID_DEPENDENCY", "Attività condivisa non disponibile nel fascicolo.");
        return { activityKey: key, specFingerprint: sharedSpec.fingerprint };
      });
      next.attachedDocumentIds = unique(command.attachedDocumentIds);
      assertNoDependencyCycle(input.records, next);
      break;
    }
    case "PREPARE_DRAFT": {
      if (!["IN_PROGRESS", "DRAFT_PREPARATION", "DRAFT_VALIDATED"].includes(previous.status)) {
        fail("INVALID_TRANSITION", "Prendere in carico l'attività prima di collegare la bozza.");
      }
      const draft = assertDraftMatches(spec, command.templateKey, input.drafts.find((item) => item.draftKey === command.draftKey), command.draftVersion);
      next.drafts = [
        ...previous.drafts.filter((item) => item.templateKey !== command.templateKey),
        { templateKey: command.templateKey, draftKey: draft.draftKey, preparedVersion: draft.current.version, validatedVersion: null },
      ];
      next.status = "DRAFT_PREPARATION";
      break;
    }
    case "VALIDATE_DRAFT": {
      if (!["DRAFT_PREPARATION", "DRAFT_VALIDATED"].includes(previous.status)
        || !previous.drafts.some((item) => item.templateKey === command.templateKey && item.draftKey === command.draftKey)) {
        fail("INVALID_TRANSITION", "Collegare la bozza prima di registrarne la validazione.");
      }
      const draft = assertDraftMatches(spec, command.templateKey, input.drafts.find((item) => item.draftKey === command.draftKey), command.draftVersion);
      if (draft.current.status !== "APPROVATA_INTERNAMENTE") {
        fail("INVALID_DRAFT", "La versione della bozza deve essere prima approvata internamente nella sezione Atti.");
      }
      next.drafts = previous.drafts.map((item) => item.templateKey === command.templateKey
        ? { ...item, preparedVersion: draft.current.version, validatedVersion: draft.current.version }
        : item);
      next.status = spec.documents.every((document) => next.drafts.some((item) =>
        item.templateKey === document.templateKey && item.validatedVersion !== null))
        ? "DRAFT_VALIDATED" : "DRAFT_PREPARATION";
      break;
    }
    case "RECORD_EXECUTION": {
      requireDependencies();
      const correcting = ["EXECUTED", "OUTCOME_RECORDED"].includes(previous.status);
      if (!correcting && ((spec.documents.length > 0 && previous.status !== "DRAFT_VALIDATED")
        || (spec.documents.length === 0 && previous.status !== "IN_PROGRESS"))) {
        fail("INVALID_TRANSITION", "Completare la presa in carico e l'eventuale validazione dell'atto prima dell'esecuzione.");
      }
      for (const document of spec.documents) {
        const link = previous.drafts.find((item) => item.templateKey === document.templateKey);
        const draft = link && input.drafts.find((item) => item.draftKey === link.draftKey);
        if (!link || link.validatedVersion === null || !draft
          || draft.current.version !== link.validatedVersion || draft.current.status !== "APPROVATA_INTERNAMENTE") {
          fail("INVALID_DRAFT", "Una bozza validata è stata modificata o non è più approvata: validare la versione corrente.");
        }
      }
      if (command.date > input.today) fail("INVALID_DATE", "La data di esecuzione non può essere futura.");
      assertKnownDocuments(command.documentIds, input.documentIds);
      next.execution = {
        date: command.date, description: command.note, documentIds: unique(command.documentIds),
        fileVersions: verifiedDocumentVersions(command.documentIds, input.documentVersions),
      };
      next.outcome = null;
      next.completionNote = null;
      next.status = "EXECUTED";
      break;
    }
    case "RECORD_OUTCOME":
      if (!["EXECUTED", "OUTCOME_RECORDED"].includes(previous.status) || !previous.execution) fail("INVALID_TRANSITION", "Registrare prima l'esecuzione.");
      if (command.date > input.today || command.date < previous.execution.date) fail("INVALID_DATE", "La data del riscontro non è coerente con l'esecuzione.");
      if (command.alternativeTitle && !spec.alternatives.some((item) => item.title === command.alternativeTitle)) {
        fail("INVALID_ALTERNATIVE", "L'alternativa selezionata non appartiene al percorso corrente.");
      }
      assertKnownDocuments(command.documentIds, input.documentIds);
      next.outcome = {
        date: command.date, description: command.note, documentIds: unique(command.documentIds),
        fileVersions: verifiedDocumentVersions(command.documentIds, input.documentVersions),
        alternativeTitle: command.alternativeTitle || null,
      };
      next.status = "OUTCOME_RECORDED";
      break;
    case "VERIFY_COMPLETION":
      requireDependencies();
      if (previous.status !== "OUTCOME_RECORDED" || !previous.execution || !previous.outcome) {
        fail("INVALID_TRANSITION", "Esecuzione e riscontro documentati sono necessari prima della chiusura.");
      }
      assertKnownDocuments([...previous.execution.documentIds, ...previous.outcome.documentIds], input.documentIds);
      assertEvidenceUnchanged(previous.execution, input.documentVersions);
      assertEvidenceUnchanged(previous.outcome, input.documentVersions);
      if (!input.corpus.analysisCurrent && command.manualReview !== true) {
        fail("STALE_SPEC", "Il rapporto non è aggiornato: occorre una valutazione manuale esplicita del fascicolo corrente.");
      }
      next.completionNote = command.note;
      next.completionReviewMode = input.corpus.analysisCurrent ? "CURRENT_ANALYSIS" : "MANUAL_CORPUS";
      next.completionCorpusFingerprint = input.corpus.fingerprint;
      next.status = "COMPLETED";
      break;
    case "BLOCK":
      if (previous.blockedReason) fail("INVALID_TRANSITION", "L'attività è già bloccata.");
      next.blockedReason = command.note;
      break;
    case "UNBLOCK":
      if (!previous.blockedReason) fail("INVALID_TRANSITION", "Non risulta un blocco manuale da rimuovere.");
      next.blockedReason = null;
      break;
    case "EXCLUDE":
      if (["EXECUTED", "OUTCOME_RECORDED"].includes(previous.status)) {
        fail("INVALID_TRANSITION", "Un'attività già eseguita non può essere esclusa come mai giustificata.");
      }
      next.status = "EXCLUDED";
      next.exclusionNote = command.note;
      next.exclusionCorpusFingerprint = input.corpus.fingerprint;
      next.blockedReason = null;
      break;
    case "RECONFIRM":
      if (previous.status === "COMPLETED" && current && activityNeedsReview(current, input.specs, input.corpus)) {
        fail("STALE_SPEC", "Riaprire l'attività e verificare nuovamente esecuzione e riscontro nel fascicolo aggiornato.");
      }
      next.specFingerprint = spec.fingerprint;
      next.issueText = spec.issueText;
      next.title = spec.title;
      if (previous.status === "EXCLUDED") next.exclusionCorpusFingerprint = input.corpus.fingerprint;
      next.sharedActivities = previous.sharedActivities.map((shared) => {
        const sharedSpec = input.specs.find((item) => item.activityKey === shared.activityKey);
        if (!sharedSpec) fail("STALE_SPEC", "Una problematica condivisa non è più nel rapporto: riesaminare il collegamento.");
        return { activityKey: shared.activityKey, specFingerprint: sharedSpec.fingerprint };
      });
      break;
    case "REOPEN":
      if (!terminal) fail("INVALID_TRANSITION", "Solo un'attività chiusa può essere riaperta.");
      next.status = previous.status === "EXCLUDED" ? "APPROVED" : "IN_PROGRESS";
      next.specFingerprint = spec.fingerprint;
      next.drafts = previous.drafts.map((draft) => ({ ...draft, validatedVersion: null }));
      next.execution = null;
      next.outcome = null;
      next.completionNote = null;
      delete next.completionReviewMode;
      delete next.completionCorpusFingerprint;
      next.exclusionNote = null;
      delete next.exclusionCorpusFingerprint;
      next.blockedReason = null;
      break;
    case "APPROVE":
    case "ADOPT_APPROVAL":
    case "REEVALUATE_PROPOSAL":
      fail("INVALID_TRANSITION", "L'attività possiede già una cronologia.");
  }
  return activityMetadataSchema.parse(next);
}
