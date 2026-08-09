import {
  PEC_RECEIPT_OBSERVATION_RULE_CODE,
  PEC_RECEIPT_OBSERVATION_RULE_VERSION,
  type PecReceiptFactsSnapshot,
  type PecReceiptObservationDocument,
} from "@/server/fascicolo-observations/types";

export function isPecReceiptObservationCandidate(
  documento: PecReceiptObservationDocument,
  procedimentoId: string,
  enteId: string,
): boolean {
  return (
    documento.statoDocumento === "ATTIVO" &&
    documento.procedimentoId === procedimentoId &&
    documento.enteId === enteId &&
    documento.pecWarningMancataRicevuta
  );
}

export function buildPecReceiptFactsSnapshot(documento: PecReceiptObservationDocument): PecReceiptFactsSnapshot {
  return {
    canale: documento.canale,
    pecRicevutaAccettazioneId: documento.pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId: documento.pecRicevutaConsegnaId,
    pecWarningMancataRicevuta: documento.pecWarningMancataRicevuta,
  };
}

export function buildPecReceiptObservationCandidate(
  documento: PecReceiptObservationDocument,
  procedimentoId: string,
  enteId: string,
) {
  if (!isPecReceiptObservationCandidate(documento, procedimentoId, enteId)) {
    return null;
  }

  return {
    enteId,
    procedimentoId,
    documentoId: documento.id,
    kind: "DOCUMENT_COMPLETENESS" as const,
    ruleCode: PEC_RECEIPT_OBSERVATION_RULE_CODE,
    ruleVersion: PEC_RECEIPT_OBSERVATION_RULE_VERSION,
    factsSnapshot: buildPecReceiptFactsSnapshot(documento),
  };
}