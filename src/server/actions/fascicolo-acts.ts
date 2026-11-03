"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure } from "@/server/audit/auditLog";
import { ACT_DRAFT_ENTITY, ACT_DRAFT_STATUSES, actDraftEntityId } from "@/server/fascicolo-acts/model";
import { listActAttachmentOptions, listActDraftVersions, saveActDraftVersion, type ActDraftActor, type ActDraftScope } from "@/server/fascicolo-acts/repository";
import { buildActTemplateCatalog, findActTemplate } from "@/server/fascicolo-acts/templates";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

const scopeSchema = z.object({ procedimentoId: z.string().trim().min(1).max(256) });

const createSchema = scopeSchema.extend({ templateKey: z.string().trim().min(1).max(160) }).strict();

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
    templateKey: formData.get("templateKey"),
  });
  const authorized = await authorizedScope(input.procedimentoId);
  try {
    const workflow = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
    const catalog = buildActTemplateCatalog({
      payload: workflow?.structuredReport?.payload ?? null,
      context: { procedimentoLabel: authorized.label, responsabile: authorized.responsabile, unitaOrganizzativa: authorized.unita },
    });
    const template = findActTemplate(catalog, input.templateKey);
    if (!template) throw new Error("Modello di atto non disponibile per il procedimento corrente.");
    await saveActDraftVersion({
      scope: authorized.scope,
      draftKey: null,
      expectedVersion: 0,
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
    await auditBlocked(authorized.scope, authorized.actor, null, error);
    throw error;
  }
  revalidatePath(actsPath(input.procedimentoId));
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
    if (!source) throw new Error("Versione da ripristinare non disponibile.");
    await saveActDraftVersion({
      scope: authorized.scope,
      draftKey: input.draftKey,
      expectedVersion: input.expectedVersion,
      actor: authorized.actor,
      content: {
        templateKey: source.templateKey,
        issueSemanticKey: source.issueSemanticKey,
        title: source.title,
        body: source.body,
        status: source.status === "ARCHIVIATA" ? "BOZZA" : source.status,
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
