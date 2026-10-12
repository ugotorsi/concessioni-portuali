export const PEC_RECEIPT_OBSERVATION_RULE_CODE = "P1-PEC-RECEIPT-001";
export const PEC_RECEIPT_OBSERVATION_RULE_VERSION = 1;

export const PEC_RECEIPT_OBSERVATION_TEXT = "Ricevuta PEC non registrata nel fascicolo";
export const PEC_RECEIPT_OBSERVATION_DISCLAIMER =
  "Osservazione tecnica di completezza documentale. Non accerta la validità, il perfezionamento o l'efficacia giuridica della comunicazione e non determina l'esito del procedimento.";

export interface PecReceiptObservationDocument {
  id: string;
  procedimentoId: string | null;
  enteId: string | null;
  statoDocumento: string;
  canale: string | null;
  pecRicevutaAccettazioneId: string | null;
  pecRicevutaConsegnaId: string | null;
  pecWarningMancataRicevuta: boolean;
}

export interface PecReceiptFactsSnapshot extends Record<string, string | boolean | null> {
  canale: string | null;
  pecRicevutaAccettazioneId: string | null;
  pecRicevutaConsegnaId: string | null;
  pecWarningMancataRicevuta: boolean;
}