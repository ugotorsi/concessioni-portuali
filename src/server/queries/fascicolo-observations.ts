import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import {
  PEC_RECEIPT_OBSERVATION_DISCLAIMER,
  PEC_RECEIPT_OBSERVATION_TEXT,
  type PecReceiptFactsSnapshot,
} from "@/server/fascicolo-observations/types";

function asPecReceiptFactsSnapshot(value: unknown): PecReceiptFactsSnapshot {
  const facts = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    canale: typeof facts.canale === "string" ? facts.canale : null,
    pecRicevutaAccettazioneId:
      typeof facts.pecRicevutaAccettazioneId === "string" ? facts.pecRicevutaAccettazioneId : null,
    pecRicevutaConsegnaId:
      typeof facts.pecRicevutaConsegnaId === "string" ? facts.pecRicevutaConsegnaId : null,
    pecWarningMancataRicevuta: facts.pecWarningMancataRicevuta === true,
  };
}

export async function getFascicoloObservations(procedimentoId: string) {
  const tenantContext = await getCurrentTenantContext();
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { concessione: { select: { enteId: true } } },
  });

  const enteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !enteId) {
    return [];
  }

  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, enteId, { mode: "read", allowWhenEnteMissing: false });
    } catch {
      return [];
    }
  }

  const observations = await prisma.fascicoloObservation.findMany({
    where: { procedimentoId, enteId },
    orderBy: [{ detectedAt: "desc" }],
    include: {
      documento: {
        select: {
          id: true,
          nome: true,
          pecWarningMancataRicevuta: true,
        },
      },
    },
  });

  return observations.map((observation) => ({
    id: observation.id,
    status: observation.status,
    ruleCode: observation.ruleCode,
    ruleVersion: observation.ruleVersion,
    detectedAt: observation.detectedAt,
    reviewedAt: observation.reviewedAt,
    reviewNote: observation.reviewNote,
    factsSnapshot: asPecReceiptFactsSnapshot(observation.factsSnapshot),
    documento: observation.documento,
    currentConditionDetected: observation.documento.pecWarningMancataRicevuta,
    text: PEC_RECEIPT_OBSERVATION_TEXT,
    disclaimer: PEC_RECEIPT_OBSERVATION_DISCLAIMER,
  }));
}