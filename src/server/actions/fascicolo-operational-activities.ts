"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure } from "@/server/audit/auditLog";
import {
  DocumentReadAuthorizationError,
  DocumentReadIntegrityError,
  readAuthorizedVerifiedDocumentBytes,
} from "@/server/documents/authorizedVerifiedByteReader";
import {
  ACTIVITY_ENTITY,
  ActivityWorkflowError,
  activityCommandSchema,
  activityForKey,
  buildActivitySpecs,
  type ActivityCommand,
  type ActivityDocumentVersion,
} from "@/server/fascicolo-operational-activities/model";
import { appendActivityCommand, listOperationalActivities } from "@/server/fascicolo-operational-activities/repository";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

const requestSchema = z.object({
  procedimentoId: z.string().trim().min(1).max(256),
  activityKey: z.string().regex(/^activity_[a-f0-9]{32}$/),
  expectedVersion: z.coerce.number().int().nonnegative(),
  expectedSpecFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedReportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedCorpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
}).strict();

function formText(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Il campo dell'attività deve contenere testo.");
  return value.trim();
}

function formValues(form: FormData, key: string): string[] {
  return form.getAll(key).map((value) => {
    if (typeof value !== "string") throw new Error("Il campo dell'attività deve contenere testo.");
    return value;
  });
}

function formCommand(form: FormData): ActivityCommand {
  const kind = formText(form, "kind");
  const note = formText(form, "note");
  const confirmed = formText(form, "confirmed") === "true";
  switch (kind) {
    case "APPROVE":
    case "EXCLUDE":
    case "RECONFIRM":
    case "REOPEN":
      return activityCommandSchema.parse({ kind, note, confirmed });
    case "ADOPT_APPROVAL":
      return activityCommandSchema.parse({ kind, note, confirmed, proposalId: formText(form, "proposalId") });
    case "REEVALUATE_PROPOSAL":
      return activityCommandSchema.parse({
        kind, note, confirmed, proposalId: formText(form, "proposalId"),
        expectedReviewVersion: z.coerce.number().int().nonnegative().parse(formText(form, "expectedReviewVersion")),
        expectedProposalStatus: formText(form, "expectedProposalStatus"),
      });
    case "TAKE_CHARGE":
    case "BLOCK":
    case "UNBLOCK":
    case "VERIFY_COMPLETION":
      return activityCommandSchema.parse(kind === "VERIFY_COMPLETION"
        ? { kind, note, confirmed, manualReview: formText(form, "manualReview") === "true" }
        : { kind, note });
    case "CONFIGURE":
      return activityCommandSchema.parse({
        kind,
        note,
        assignee: formText(form, "assignee") || null,
        dueDate: formText(form, "dueDate") || null,
        dueDateReason: formText(form, "dueDateReason") || null,
        dueDateDocumentIds: formValues(form, "dueDateDocumentIds"),
        dueDateVerified: formText(form, "dueDateVerified") === "true",
        dependencyKeys: formValues(form, "dependencyKeys"),
        sharedActivityKeys: formValues(form, "sharedActivityKeys"),
        attachedDocumentIds: formValues(form, "attachedDocumentIds"),
      });
    case "PREPARE_DRAFT":
    case "VALIDATE_DRAFT":
      return activityCommandSchema.parse({
        kind,
        note,
        templateKey: formText(form, "templateKey"),
        draftKey: formText(form, "draftKey"),
        draftVersion: z.coerce.number().int().positive().parse(formText(form, "draftVersion")),
      });
    case "RECORD_EXECUTION":
    case "RECORD_OUTCOME":
      return activityCommandSchema.parse({
        kind,
        note,
        date: formText(form, "date"),
        documentIds: formValues(form, "documentIds"),
        ...(kind === "RECORD_OUTCOME" ? { alternativeTitle: formText(form, "alternativeTitle") || null } : {}),
      });
    default:
      throw new Error("Operazione sull'attività non riconosciuta.");
  }
}

export async function updateOperationalActivityAction(form: FormData): Promise<void> {
  const input = requestSchema.parse({
    procedimentoId: formText(form, "procedimentoId"),
    activityKey: formText(form, "activityKey"),
    expectedVersion: formText(form, "expectedVersion"),
    expectedSpecFingerprint: formText(form, "expectedSpecFingerprint"),
    expectedReportFingerprint: formText(form, "expectedReportFingerprint"),
    expectedCorpusFingerprint: formText(form, "expectedCorpusFingerprint"),
    requestId: formText(form, "requestId"),
  });
  const role = await requireRole();
  const [user, tenantContext, procedimento] = await Promise.all([
    getCurrentUser(),
    getCurrentTenantContext(),
    prisma.procedimento.findUnique({
      where: { id: input.procedimentoId },
      select: { enteId: true, concessioneId: true },
    }),
  ]);
  if (!user || !tenantContext || !procedimento?.enteId) throw new Error("Procedimento, attore o ente non disponibile.");
  requireTenantAccess(tenantContext, procedimento.enteId, { mode: "write", allowWhenEnteMissing: false });
  const scope = {
    tenantId: procedimento.enteId,
    procedimentoId: input.procedimentoId,
    concessioneId: procedimento.concessioneId,
  };
  const actor = { actorId: user.id, actorEmail: user.email, actorRole: role };
  let errorCode: string | null = null;
  try {
    if (!canManageProcedimenti(role)) throw new ActivityWorkflowError("AUTHORITY_MISMATCH", "Profilo non autorizzato alla gestione delle attività.");
    const command = formCommand(form);
    const workflow = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
    const report = workflow?.structuredReport;
    if (!report || report.payload.tenantId !== scope.tenantId
      || report.reportFingerprint !== input.expectedReportFingerprint) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il rapporto è cambiato: ricaricare la pagina.");
    }
    if (workflow.analysisUpdate.corpusFingerprint !== input.expectedCorpusFingerprint) {
      throw new ActivityWorkflowError("STALE_SPEC", "Il fascicolo è cambiato: ricaricare e verificare i documenti.");
    }
    if (workflow.analysisUpdate.status !== "CURRENT"
      && (["APPROVE", "ADOPT_APPROVAL", "REEVALUATE_PROPOSAL", "RECONFIRM"].includes(command.kind)
        || (command.kind === "VERIFY_COMPLETION" && command.manualReview !== true))) {
      throw new ActivityWorkflowError("STALE_SPEC", "L'analisi documentale deve essere aggiornata prima della valutazione o della chiusura.");
    }
    const verifiedDocuments: ActivityDocumentVersion[] = [];
    if (["CONFIGURE", "RECORD_EXECUTION", "RECORD_OUTCOME", "VERIFY_COMPLETION"].includes(command.kind)) {
      const current = activityForKey(await listOperationalActivities(scope), input.activityKey);
      const isRetry = current?.history.some((version) => version.requestId === input.requestId);
      const ids = command.kind === "CONFIGURE" ? command.dueDateDocumentIds
        : command.kind === "RECORD_EXECUTION" || command.kind === "RECORD_OUTCOME" ? command.documentIds
          : command.kind === "VERIFY_COMPLETION"
            ? [...(current?.current.execution?.documentIds ?? []), ...(current?.current.outcome?.documentIds ?? [])]
            : [];
      const uniqueIds = [...new Set(ids)];
      if (!isRetry && uniqueIds.length) {
        const owned = await prisma.documento.findMany({
          where: { id: { in: uniqueIds }, procedimentoId: scope.procedimentoId, enteId: scope.tenantId },
          select: { id: true },
        });
        if (owned.length !== uniqueIds.length) {
          throw new ActivityWorkflowError("UNKNOWN_DOCUMENT", "Uno o più documenti non appartengono al procedimento.");
        }
        for (const documentId of uniqueIds) {
          let result;
          try {
            result = await readAuthorizedVerifiedDocumentBytes({ documentoId: documentId });
          } catch (error) {
            if (error instanceof DocumentReadIntegrityError || error instanceof DocumentReadAuthorizationError) {
              throw new ActivityWorkflowError("EVIDENCE_UNAVAILABLE", "Un file documentale non è accessibile o non ha superato la verifica di integrità.");
            }
            throw error;
          }
          if (result.status !== "AVAILABLE_VERIFIED") {
            throw new ActivityWorkflowError("EVIDENCE_UNAVAILABLE", "Un file documentale non è disponibile o non ha una versione verificata.");
          }
          verifiedDocuments.push({ documentId, fileVersionId: result.fileVersionId, sha256: result.sha256 });
        }
      }
    }
    await appendActivityCommand({
      scope,
      actor,
      knowledgeRevisionId: report.payload.knowledgeRevisionId,
      reportFingerprint: report.reportFingerprint,
      specs: buildActivitySpecs(report.payload),
      activityKey: input.activityKey,
      expectedSpecFingerprint: input.expectedSpecFingerprint,
      expectedCorpusFingerprint: input.expectedCorpusFingerprint,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
      command,
      verifiedDocuments,
    });
  } catch (error) {
    errorCode = error instanceof ActivityWorkflowError ? error.code
      : error instanceof z.ZodError ? "INVALID_INPUT" : "UNEXPECTED_ERROR";
    if (errorCode === "UNEXPECTED_ERROR") {
      console.error("operational_activity_update_failed", { procedimentoId: input.procedimentoId, error });
    }
    await auditFailure({
      azione: "FASCICOLO_OPERATIONAL_ACTIVITY_BLOCKED",
      entita: ACTIVITY_ENTITY,
      entitaId: `${input.procedimentoId}::${input.activityKey}`,
      enteId: scope.tenantId,
      concessioneId: scope.concessioneId,
      actor: { userId: actor.actorId, userEmail: actor.actorEmail, userRole: actor.actorRole },
      metadata: { procedimentoId: input.procedimentoId, reason: errorCode },
    });
  }
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
  const errorQuery = errorCode ? `&activityError=${encodeURIComponent(errorCode)}` : "";
  redirect(`/procedimenti/${input.procedimentoId}?section=proposals&activity=${input.activityKey}${errorQuery}#activity-${input.activityKey}`);
}
