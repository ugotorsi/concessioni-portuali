"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure } from "@/server/audit/auditLog";
import { ACT_DRAFT_ENTITY, ACT_DRAFT_STATUSES, actDraftEntityId, stableActDraftKey } from "@/server/fascicolo-acts/model";
import { archiveIdenticalActDrafts, associateLegacyActDraft, listActAttachmentOptions, listActDraftVersions, saveActDraftVersion, type ActDraftActor, type ActDraftScope } from "@/server/fascicolo-acts/repository";
import { buildActTemplateCatalog, findActTemplate, reportPlanTemplateKey } from "@/server/fascicolo-acts/templates";
import { ActivityWorkflowError, buildActivitySpecs } from "@/server/fascicolo-operational-activities/model";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

const scopeSchema = z.object({ procedimentoId: z.string().trim().min(1).max(256) });

const createSchema = scopeSchema.extend({
  activityKey: z.string().regex(/^activity_[a-f0-9]{32}$/),
  expectedActivityVersion: z.coerce.number().int().positive(),
  expectedSpecFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedReportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedCorpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  templateKey: z.string().trim().min(1).max(160),
}).strict();

const saveSchema = scopeSchema.extend({
  draftKey: z.string().trim().min(1).max(64),
  expectedVersion: z.coerce.number().int().positive(),
  title: z.string(),
  body: z.string(),
  status: z.enum(ACT_DRAFT_STATUSES),
  assignee: z.string().optional(),
  dueDate: z.string().optional(),
  progress: z.coerce.number().int().min(0).max(100),
  dependencies: z.array(z.string()),
  attachments: z.array(z.string()),
  changeNote: z.string().optional(),
}).strict();

const restoreSchema = scopeSchema.extend({
  draftKey: z.string().trim().min(1).max(64),
  expectedVersion: z.coerce.number().int().positive(),
  restoreVersion: z.coerce.number().int().positive(),
}).strict();

const associateSchema = scopeSchema.extend({
  activityKey: z.string().regex(/^activity_[a-f0-9]{32}$/),
  expectedActivityVersion: z.coerce.number().int().positive(),
  expectedSpecFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedReportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedCorpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  templateKey: z.string().trim().min(1).max(160),
  draftKey: z.string().trim().min(1).max(64),
  expectedDraftVersion: z.coerce.number().int().positive(),
  note: z.string().trim().min(3).max(1_900),
  confirmed: z.literal("true"),
}).strict();

const archiveDuplicatesSchema = scopeSchema.extend({
  referenceDraftKey: z.string().trim().min(1).max(64),
  referenceExpectedVersion: z.coerce.number().int().positive(),
  referenceBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  duplicateDraftKeys: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
  duplicateExpectedVersions: z.array(z.coerce.number().int().positive()).min(1).max(100),
  duplicateBodySha256s: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(100),
  reason: z.string().trim().min(3).max(1_900),
  confirmed: z.literal("true"),
}).strict().superRefine((input, context) => {
  if (input.duplicateDraftKeys.length !== input.duplicateExpectedVersions.length
    || input.duplicateDraftKeys.length !== input.duplicateBodySha256s.length) {
    context.addIssue({ code: "custom", message: "ARCHIVE_DUPLICATES_INPUT_INVALID" });
  }
});

async function authorizedScope(procedimentoId: string): Promise<{ scope: ActDraftScope; actor: ActDraftActor; label: string; responsabile: string | null; unita: string | null }> {
  const role = await requireRole();
  const [user, tenantContext, procedimento] = await Promise.all([
    getCurrentUser(),
    getCurrentTenantContext(),
    prisma.procedimento.findUnique({
      where: { id: procedimentoId },
      select: {
        enteId: true,
        concessioneId: true,
        responsabileProcedimentoNome: true,
        unitaOrganizzativaResponsabile: true,
      },
    }),
  ]);
  if (!user || !tenantContext || !procedimento?.enteId) throw new Error("Procedimento, attore o tenant non disponibile.");
  requireTenantAccess(tenantContext, procedimento.enteId, { mode: "write", allowWhenEnteMissing: false });
  const scope = { tenantId: procedimento.enteId, procedimentoId, concessioneId: procedimento.concessioneId };
  const actor = { actorId: user.id, actorEmail: user.email, actorRole: role };
  if (!canManageProcedimenti(role)) {
    await auditFailure({
      azione: "FASCICOLO_ACT_DRAFT_BLOCKED",
      entita: ACT_DRAFT_ENTITY,
      entitaId: null,
      enteId: scope.tenantId,
      actor: { userId: user.id, userEmail: user.email, userRole: role },
      metadata: { procedimentoId, reason: "ROLE_NOT_AUTHORIZED" },
    });
    throw new Error("Profilo non autorizzato alla gestione degli atti.");
  }
  return {
    scope,
    actor,
    label: `Procedimento ${procedimentoId}`,
    responsabile: procedimento.responsabileProcedimentoNome,
    unita: procedimento.unitaOrganizzativaResponsabile,
  };
}

async function auditBlocked(scope: ActDraftScope, actor: ActDraftActor, draftKey: string | null, error: unknown) {
  await auditFailure({
    azione: "FASCICOLO_ACT_DRAFT_BLOCKED",
    entita: ACT_DRAFT_ENTITY,
    entitaId: draftKey ? actDraftEntityId(scope.procedimentoId, draftKey) : null,
    enteId: scope.tenantId,
    concessioneId: scope.concessioneId,
    actor: { userId: actor.actorId, userEmail: actor.actorEmail, userRole: actor.actorRole },
    metadata: {
      procedimentoId: scope.procedimentoId,
      reason: error instanceof Error ? error.message : "FASCICOLO_ACT_DRAFT_OPERATION_BLOCKED",
    },
  });
}

async function allowedAttachmentIds(procedimentoId: string): Promise<Set<string>> {
  return new Set((await listActAttachmentOptions(procedimentoId)).map((document) => document.id));
}

function actsPath(procedimentoId: string): string {
  return `/procedimenti/${procedimentoId}`;
}

export async function createActDraftAction(formData: FormData): Promise<void> {
  const input = createSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    activityKey: formData.get("activityKey"),
    expectedActivityVersion: formData.get("expectedActivityVersion"),
    expectedSpecFingerprint: formData.get("expectedSpecFingerprint"),
    expectedReportFingerprint: formData.get("expectedReportFingerprint"),
    expectedCorpusFingerprint: formData.get("expectedCorpusFingerprint"),
    templateKey: formData.get("templateKey"),
  });
  const authorized = await authorizedScope(input.procedimentoId);
  let savedDraft: Awaited<ReturnType<typeof saveActDraftVersion>> | null = null;
  let errorCode: string | null = null;
  try {
    const workflow = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
    const report = workflow?.structuredReport;
    if (!report || report.payload.tenantId !== authorized.scope.tenantId
      || report.reportFingerprint !== input.expectedReportFingerprint || workflow.analysisUpdate.status !== "CURRENT"
      || workflow.analysisUpdate.corpusFingerprint !== input.expectedCorpusFingerprint) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il quadro documentale o il rapporto non sono più attuali.");
    }
    const specs = buildActivitySpecs(report.payload);
    const spec = specs.find((item) => item.activityKey === input.activityKey);
    if (!spec || spec.fingerprint !== input.expectedSpecFingerprint || spec.necessity === "NOT_JUSTIFIED"
      || !spec.documents.some((item) => item.templateKey === input.templateKey)) {
      throw new ActivityWorkflowError("INVALID_DRAFT", "L'attività o il documento non sono disponibili nel percorso corrente.");
    }
    const catalog = buildActTemplateCatalog({
      payload: report.payload,
      context: { procedimentoLabel: authorized.label, responsabile: authorized.responsabile, unitaOrganizzativa: authorized.unita },
    });
    const template = findActTemplate(catalog, input.templateKey);
    if (!template || template.source !== "REPORT_PLAN" || template.issueSemanticKey !== spec.issueSemanticKey) {
      throw new ActivityWorkflowError("INVALID_DRAFT", "Modello di atto non disponibile per l'attività corrente.");
    }
    const possibleLegacyKeys = template.issueSemanticKey && template.activityTitle
      ? [
          `PLAN:${template.title}`,
          reportPlanTemplateKey(template.issueSemanticKey, template.activityTitle, template.title),
        ]
      : [];
    savedDraft = await saveActDraftVersion({
      scope: authorized.scope,
      draftKey: stableActDraftKey(template.templateKey, template.issueSemanticKey),
      expectedVersion: 0,
      idempotentCreate: true,
      creationIdentity: {
        legacyTemplateKeys: template.legacyTemplateKeys ?? [],
        ambiguousLegacyKeys: possibleLegacyKeys.filter((key) =>
          key !== template.templateKey && !template.legacyTemplateKeys?.includes(key)),
      },
      guidedContext: {
        knowledgeRevisionId: report.payload.knowledgeRevisionId,
        reportFingerprint: input.expectedReportFingerprint,
        expectedCorpusFingerprint: input.expectedCorpusFingerprint,
        specs,
        spec,
        expectedActivityVersion: input.expectedActivityVersion,
        templateKey: input.templateKey,
      },
      actor: authorized.actor,
      content: {
        templateKey: template.templateKey,
        issueSemanticKey: template.issueSemanticKey,
        title: template.title,
        body: template.body,
        status: "BOZZA",
        assignee: authorized.responsabile,
        dueDate: null,
        progress: 0,
        dependencies: [],
        attachments: [],
        changeNote: `Creata dal modello: ${template.title} (${template.legalBasis}).`,
      },
    });
  } catch (error) {
    errorCode = error instanceof ActivityWorkflowError ? error.code : "UNEXPECTED_ERROR";
    if (errorCode === "UNEXPECTED_ERROR") {
      console.error("guided_act_creation_failed", { procedimentoId: input.procedimentoId, error });
    }
    await auditBlocked(authorized.scope, authorized.actor, null, error);
  }
  revalidatePath(actsPath(input.procedimentoId));
  if (errorCode) {
    redirect(`${actsPath(input.procedimentoId)}?section=proposals&activity=${input.activityKey}&activityError=${encodeURIComponent(errorCode)}#activity-${input.activityKey}`);
  }
  const draftKey = savedDraft?.draftKey;
  if (!draftKey) throw new Error("La bozza non è stata individuata né creata.");
  redirect(`${actsPath(input.procedimentoId)}?section=acts#draft-${draftKey}`);
}

export async function associateLegacyActDraftAction(formData: FormData): Promise<void> {
  const input = associateSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    activityKey: formData.get("activityKey"),
    expectedActivityVersion: formData.get("expectedActivityVersion"),
    expectedSpecFingerprint: formData.get("expectedSpecFingerprint"),
    expectedReportFingerprint: formData.get("expectedReportFingerprint"),
    expectedCorpusFingerprint: formData.get("expectedCorpusFingerprint"),
    templateKey: formData.get("templateKey"),
    draftKey: formData.get("draftKey"),
    expectedDraftVersion: formData.get("expectedDraftVersion"),
    note: formData.get("note"),
    confirmed: formData.get("confirmed"),
  });
  const authorized = await authorizedScope(input.procedimentoId);
  let errorCode: string | null = null;
  try {
    const workflow = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
    const report = workflow?.structuredReport;
    if (!report || report.payload.tenantId !== authorized.scope.tenantId
      || report.reportFingerprint !== input.expectedReportFingerprint || workflow.analysisUpdate.status !== "CURRENT"
      || workflow.analysisUpdate.corpusFingerprint !== input.expectedCorpusFingerprint) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il quadro documentale o il rapporto non sono più attuali.");
    }
    const specs = buildActivitySpecs(report.payload);
    const spec = specs.find((item) => item.activityKey === input.activityKey);
    const document = spec?.documents.find((item) => item.templateKey === input.templateKey);
    if (!spec || !document || spec.fingerprint !== input.expectedSpecFingerprint || spec.necessity === "NOT_JUSTIFIED") {
      throw new ActivityWorkflowError("STALE_SPEC", "L'attività o il documento non sono disponibili nel percorso corrente.");
    }
    const legacyKeys = [
      `PLAN:${document.title}`,
      reportPlanTemplateKey(spec.issueSemanticKey, spec.title, document.title),
    ].filter((key) => key !== document.templateKey && !document.legacyTemplateKeys.includes(key));
    await associateLegacyActDraft({
      scope: authorized.scope,
      actor: authorized.actor,
      knowledgeRevisionId: report.payload.knowledgeRevisionId,
      reportFingerprint: input.expectedReportFingerprint,
      expectedCorpusFingerprint: input.expectedCorpusFingerprint,
      specs,
      spec,
      expectedActivityVersion: input.expectedActivityVersion,
      draftKey: input.draftKey,
      expectedDraftVersion: input.expectedDraftVersion,
      templateKey: input.templateKey,
      legacyKeys,
      note: input.note,
    });
  } catch (error) {
    errorCode = error instanceof ActivityWorkflowError ? error.code : "UNEXPECTED_ERROR";
    if (errorCode === "UNEXPECTED_ERROR") {
      console.error("legacy_act_association_failed", { procedimentoId: input.procedimentoId, error });
    }
    await auditBlocked(authorized.scope, authorized.actor, input.draftKey, error);
  }
  revalidatePath(actsPath(input.procedimentoId));
  const errorQuery = errorCode ? `&activityError=${encodeURIComponent(errorCode)}` : "";
  redirect(`${actsPath(input.procedimentoId)}?section=proposals&activity=${input.activityKey}${errorQuery}#activity-${input.activityKey}`);
}

export async function saveActDraftVersionAction(formData: FormData): Promise<void> {
  const input = saveSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    draftKey: formData.get("draftKey"),
    expectedVersion: formData.get("expectedVersion"),
    title: formData.get("title")?.toString() ?? "",
    body: formData.get("body")?.toString() ?? "",
    status: formData.get("status"),
    assignee: formData.get("assignee")?.toString(),
    dueDate: formData.get("dueDate")?.toString(),
    progress: formData.get("progress") ?? 0,
    dependencies: formData.getAll("dependencies").map(String),
    attachments: formData.getAll("attachments").map(String),
    changeNote: formData.get("changeNote")?.toString(),
  });
  const authorized = await authorizedScope(input.procedimentoId);
  try {
    const versions = await listActDraftVersions(authorized.scope);
    const current = versions
      .filter((version) => version.draftKey === input.draftKey)
      .sort((left, right) => right.version - left.version)[0];
    if (!current) throw new Error("Bozza non disponibile nel procedimento corrente.");
    const allowed = await allowedAttachmentIds(input.procedimentoId);
    if (input.attachments.some((id) => !allowed.has(id))) throw new Error("Allegato non appartenente al fascicolo.");
    await saveActDraftVersion({
      scope: authorized.scope,
      draftKey: input.draftKey,
      expectedVersion: input.expectedVersion,
      actor: authorized.actor,
      content: {
        templateKey: current.templateKey,
        issueSemanticKey: current.issueSemanticKey,
        title: input.title,
        body: input.body.replace(/\r\n/g, "\n"),
        status: input.status,
        assignee: input.assignee?.trim() || null,
        dueDate: input.dueDate?.trim() || null,
        progress: input.progress,
        dependencies: input.dependencies,
        attachments: input.attachments,
        changeNote: input.changeNote?.trim() || null,
      },
    });
  } catch (error) {
    await auditBlocked(authorized.scope, authorized.actor, input.draftKey, error);
    throw error;
  }
  revalidatePath(actsPath(input.procedimentoId));
}

export async function restoreActDraftVersionAction(formData: FormData): Promise<void> {
  const input = restoreSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    draftKey: formData.get("draftKey"),
    expectedVersion: formData.get("expectedVersion"),
    restoreVersion: formData.get("restoreVersion"),
  });
  const authorized = await authorizedScope(input.procedimentoId);
  try {
    const versions = await listActDraftVersions(authorized.scope);
    const source = versions.find((version) => version.draftKey === input.draftKey && version.version === input.restoreVersion);
    const current = versions.filter((version) => version.draftKey === input.draftKey)
      .sort((left, right) => right.version - left.version)[0];
    if (!source || !current) throw new Error("Versione da ripristinare non disponibile.");
    await saveActDraftVersion({
      scope: authorized.scope,
      draftKey: input.draftKey,
      expectedVersion: input.expectedVersion,
      actor: authorized.actor,
      content: {
        templateKey: current.templateKey,
        issueSemanticKey: current.issueSemanticKey,
        title: source.title,
        body: source.body,
        status: source.status === "ARCHIVIATA" ? "BOZZA"
          : source.status === "APPROVATA_INTERNAMENTE" ? "IN_REVISIONE" : source.status,
        assignee: source.assignee,
        dueDate: source.dueDate,
        progress: source.progress,
        dependencies: source.dependencies,
        attachments: source.attachments,
        changeNote: `Ripristino del contenuto della versione ${source.version}.`,
      },
    });
  } catch (error) {
    await auditBlocked(authorized.scope, authorized.actor, input.draftKey, error);
    throw error;
  }
  revalidatePath(actsPath(input.procedimentoId));
}

export async function archiveIdenticalActDraftsAction(formData: FormData): Promise<void> {
  const input = archiveDuplicatesSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    referenceDraftKey: formData.get("referenceDraftKey"),
    referenceExpectedVersion: formData.get("referenceExpectedVersion"),
    referenceBodySha256: formData.get("referenceBodySha256"),
    duplicateDraftKeys: formData.getAll("duplicateDraftKeys"),
    duplicateExpectedVersions: formData.getAll("duplicateExpectedVersions"),
    duplicateBodySha256s: formData.getAll("duplicateBodySha256s"),
    reason: formData.get("reason"),
    confirmed: formData.get("confirmed"),
  });
  const authorized = await authorizedScope(input.procedimentoId);
  try {
    await archiveIdenticalActDrafts({
      scope: authorized.scope,
      actor: authorized.actor,
      reference: {
        draftKey: input.referenceDraftKey,
        expectedVersion: input.referenceExpectedVersion,
        bodySha256: input.referenceBodySha256,
      },
      duplicates: input.duplicateDraftKeys.map((draftKey, index) => ({
        draftKey,
        expectedVersion: input.duplicateExpectedVersions[index]!,
        bodySha256: input.duplicateBodySha256s[index]!,
      })),
      reason: input.reason,
    });
  } catch (error) {
    await auditBlocked(authorized.scope, authorized.actor, input.referenceDraftKey, error);
    throw error;
  }
  revalidatePath(actsPath(input.procedimentoId));
}
