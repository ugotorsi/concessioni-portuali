"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import {
  buildP1C1ScreeningFingerprint,
  evaluateP1C1DocumentRequirement,
} from "@/server/fascicolo-document-requirements/matcher";
import {
  GAP_KEY,
  MATCHER_ALGORITHM_VERSION,
  P1C1_RULE_DEFINITION,
  RELEVANT_PROVISIONS,
  RULE_CODE,
  RULE_CONTRACT_VERSION,
  SOURCE_KEY,
} from "@/server/fascicolo-document-requirements/types";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const createSchema = z.object({ procedimentoId: z.string().min(1) }).strict();
const reviewSchema = z.object({
  proposalId: z.string().trim().min(1),
  targetStatus: z.enum(["VALIDATO", "RIFIUTATO"]),
  reviewNote: z.string().trim().optional(),
}).strict();

function resolvePersistedUserId(currentUserId: string): string | null {
  return currentUserId === STAGING_PREVIEW_ADMIN_ID ? null : currentUserId;
}

export async function createFascicoloDocumentRequirementProposal(input: { procedimentoId: string }) {
  const parsed = createSchema.parse(input);
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla proposta di requisiti documentali.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: parsed.procedimentoId },
    select: {
      id: true,
      concessioneId: true,
      concessione: {
        select: {
          enteId: true,
          normaRiferimento: true,
          portActivityLegalType: true,
        },
      },
    },
  });
  const canonicalEnteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !canonicalEnteId) {
    throw new Error("Procedimento o tenant canonico non disponibile.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const matchResult = evaluateP1C1DocumentRequirement({
    normaRiferimento: procedimento.concessione.normaRiferimento,
    portActivityLegalType: procedimento.concessione.portActivityLegalType,
  });
  if (!matchResult.eligible) {
    return { eligible: false as const, created: false as const, proposal: null };
  }

  const source = await prisma.legalSource.findUnique({
    where: { sourceKey: SOURCE_KEY },
    select: {
      id: true,
      sourceKey: true,
      title: true,
      enteId: true,
      authorityId: true,
      portId: true,
      sourceType: true,
      role: true,
      legalRank: true,
      territorialScope: true,
      status: true,
      isConformative: true,
      humanReviewRequired: true,
    },
  });
  if (
    !source ||
    source.sourceKey !== SOURCE_KEY ||
    source.enteId !== null ||
    source.authorityId !== null ||
    source.portId !== null ||
    source.sourceType !== "LEGGE" ||
    source.role !== "NORMATIVE" ||
    source.legalRank !== "NATIONAL_LAW" ||
    source.territorialScope !== "NATIONAL" ||
    source.status !== "CURRENT_SUBJECT_TO_REVIEW" ||
    !source.isConformative ||
    !source.humanReviewRequired
  ) {
    throw new Error("Configurazione catalogo P1-C1 non valida.");
  }

  const rule = await prisma.legalRule.findUnique({
    where: { sourceId_ruleCode: { sourceId: source.id, ruleCode: RULE_CODE } },
    select: {
      id: true,
      sourceId: true,
      ruleCode: true,
      status: true,
      enteId: true,
      portId: true,
      category: true,
      humanReviewRequired: true,
    },
  });
  if (
    !rule ||
    rule.sourceId !== source.id ||
    rule.ruleCode !== RULE_CODE ||
    rule.status !== "BOZZA" ||
    rule.enteId !== null ||
    rule.portId !== null ||
    rule.category !== "DOCUMENTAZIONE" ||
    !rule.humanReviewRequired
  ) {
    throw new Error("Configurazione catalogo P1-C1 non valida.");
  }

  const gap = await prisma.documentGap.findUnique({
    where: { gapKey: GAP_KEY },
    select: {
      id: true,
      gapKey: true,
      title: true,
      description: true,
      ruleId: true,
      status: true,
      enteId: true,
      portId: true,
      requiredDocumentTypes: true,
      humanReviewRequired: true,
    },
  });
  if (
    !gap ||
    gap.gapKey !== GAP_KEY ||
    gap.ruleId !== rule.id ||
    gap.status !== "APERTA" ||
    gap.enteId !== null ||
    gap.portId !== null ||
    !Array.isArray(gap.requiredDocumentTypes) ||
    gap.requiredDocumentTypes.length !== 0 ||
    !gap.humanReviewRequired
  ) {
    throw new Error("Configurazione catalogo P1-C1 non valida.");
  }

  const screeningFingerprint = buildP1C1ScreeningFingerprint({
    enteId: canonicalEnteId,
    procedimentoId: procedimento.id,
    concessioneId: procedimento.concessioneId,
    normaRiferimento: procedimento.concessione.normaRiferimento,
    portActivityLegalType: procedimento.concessione.portActivityLegalType,
  });
  const createdByUserId = resolvePersistedUserId(currentUser.id);
  const proposalData = {
    enteId: canonicalEnteId,
    procedimentoId: procedimento.id,
    legalSourceId: source.id,
    legalRuleId: rule.id,
    documentGapId: gap.id,
    matcherAlgorithmVersion: MATCHER_ALGORITHM_VERSION,
    screeningFingerprint,
    canonicalArt18Snapshot: procedimento.concessione.normaRiferimento,
    portActivityLegalTypeSnapshot: "OPERAZIONI_PORTUALI" as const,
    sourceStableKeySnapshot: source.sourceKey,
    sourceTitleSnapshot: source.title,
    sourceRelevantProvisionsSnapshot: [...RELEVANT_PROVISIONS],
    ruleCodeSnapshot: rule.ruleCode,
    ruleContractVersionSnapshot: RULE_CONTRACT_VERSION,
    legalRuleDefinitionSnapshot: P1C1_RULE_DEFINITION,
    gapKeySnapshot: gap.gapKey,
    gapLabelSnapshot: gap.title,
    gapDescriptionSnapshot: gap.description,
    matchedCriteriaSnapshot: matchResult.matchedCriteria as unknown as Prisma.InputJsonValue,
    createdByUserId,
    createdByActorId: currentUser.id,
    createdByEmail: currentUser.email,
    createdByRole: role,
  } satisfies Prisma.FascicoloDocumentRequirementProposalCreateManyInput;

  return prisma.$transaction(async (tx) => {
    const inserted = await tx.fascicoloDocumentRequirementProposal.createMany({
      data: [proposalData],
      skipDuplicates: true,
    });
    const proposal = await tx.fascicoloDocumentRequirementProposal.findUniqueOrThrow({
      where: {
        enteId_procedimentoId_screeningFingerprint: {
          enteId: canonicalEnteId,
          procedimentoId: procedimento.id,
          screeningFingerprint,
        },
      },
    });

    if (inserted.count === 1) {
      await createAuditLogInTransaction(tx, {
        azione: "FASCICOLO_DOCUMENT_REQUIREMENT_PROPOSAL_CREATE",
        entita: "FascicoloDocumentRequirementProposal",
        entitaId: proposal.id,
        enteId: canonicalEnteId,
        concessioneId: procedimento.concessioneId,
        esito: "SUCCESS",
        actor: { userId: createdByUserId, userEmail: currentUser.email, userRole: role },
        metadata: {
          screeningFingerprint,
          matcherAlgorithmVersion: MATCHER_ALGORITHM_VERSION,
          ruleContractVersion: RULE_CONTRACT_VERSION,
          sourceStableKey: source.sourceKey,
          ruleCode: rule.ruleCode,
          gapKey: gap.gapKey,
          normaRiferimento: procedimento.concessione.normaRiferimento,
          portActivityLegalType: procedimento.concessione.portActivityLegalType,
        },
      });
    }

    return { eligible: true as const, created: inserted.count === 1, proposal };
  });
}

export async function reviewFascicoloDocumentRequirementProposalAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla verifica umana dei requisiti documentali proposti.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const parsed = reviewSchema.parse({
    proposalId: formData.get("proposalId"),
    targetStatus: formData.get("targetStatus"),
    reviewNote: formData.get("reviewNote")?.toString(),
  });
  const normalizedReviewNote = parsed.reviewNote || null;
  if (parsed.targetStatus === "RIFIUTATO" && !normalizedReviewNote) {
    throw new Error("La nota di review e obbligatoria per il rifiuto.");
  }

  const proposal = await prisma.fascicoloDocumentRequirementProposal.findUnique({
    where: { id: parsed.proposalId },
    select: {
      id: true,
      status: true,
      enteId: true,
      procedimentoId: true,
      screeningFingerprint: true,
      ruleCodeSnapshot: true,
      gapKeySnapshot: true,
      procedimento: {
        select: {
          concessioneId: true,
          concessione: { select: { enteId: true } },
        },
      },
    },
  });
  const canonicalEnteId = proposal?.procedimento.concessione.enteId ?? null;
  if (!proposal || !canonicalEnteId || proposal.enteId !== canonicalEnteId) {
    throw new Error("Proposta non disponibile o non coerente con il tenant canonico.");
  }
  if (proposal.status !== "PROPOSTO") {
    throw new Error("Proposta gia revisionata o non piu disponibile per la verifica.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const reviewedByUserId = resolvePersistedUserId(currentUser.id);
  await prisma.$transaction(async (tx) => {
    const reviewedAt = new Date();
    const result = await tx.fascicoloDocumentRequirementProposal.updateMany({
      where: { id: proposal.id, enteId: canonicalEnteId, status: "PROPOSTO" },
      data: {
        status: parsed.targetStatus,
        reviewedAt,
        reviewedByUserId,
        reviewedByActorId: currentUser.id,
        reviewedByEmail: currentUser.email,
        reviewedByRole: role,
        reviewNote: normalizedReviewNote,
      },
    });
    if (result.count !== 1) {
      throw new Error("Proposta gia revisionata o modificata da un altro revisore.");
    }

    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_DOCUMENT_REQUIREMENT_PROPOSAL_REVIEW",
      entita: "FascicoloDocumentRequirementProposal",
      entitaId: proposal.id,
      enteId: canonicalEnteId,
      concessioneId: proposal.procedimento.concessioneId,
      esito: "SUCCESS",
      actor: { userId: reviewedByUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        proposalId: proposal.id,
        previousStatus: "PROPOSTO",
        newStatus: parsed.targetStatus,
        screeningFingerprint: proposal.screeningFingerprint,
        ruleCodeSnapshot: proposal.ruleCodeSnapshot,
        gapKeySnapshot: proposal.gapKeySnapshot,
        reviewNotePresent: normalizedReviewNote !== null,
      },
    });
  });

  revalidatePath(`/procedimenti/${proposal.procedimentoId}`);
}