export const DOCUMENT_DIREZIONE_VALUES = ["ENTRATA", "USCITA", "INTERNO"] as const;
export const DOCUMENT_CANALE_VALUES = ["UPLOAD", "PEC", "PROTOCOLLO_INTERNO", "ALTRO"] as const;

export type DocumentoDirezioneValue = (typeof DOCUMENT_DIREZIONE_VALUES)[number];
export type DocumentoCanaleValue = (typeof DOCUMENT_CANALE_VALUES)[number];

export interface ProtocolloMetadataInput {
  direzione?: string;
  canale?: string;
  numeroProtocollo?: string;
  dataProtocollo?: string;
  mittente?: string;
  destinatario?: string;
  pecMessageId?: string;
  pecRicevutaAccettazioneId?: string;
  pecRicevutaConsegnaId?: string;
}

export interface NormalizedProtocolloMetadata {
  direzione?: DocumentoDirezioneValue;
  canale?: DocumentoCanaleValue;
  numeroProtocollo?: string;
  dataProtocollo?: Date;
  mittente?: string;
  destinatario?: string;
  pecMessageId?: string;
  pecRicevutaAccettazioneId?: string;
  pecRicevutaConsegnaId?: string;
  pecWarningMancataRicevuta: boolean;
}

function cleanOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeProtocolloNumber(value?: string): string | undefined {
  const normalized = cleanOptional(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.replace(/\s+/g, " ").toUpperCase();
}

export function getPecReceiptWarning(input: {
  canale?: DocumentoCanaleValue;
  pecRicevutaAccettazioneId?: string;
  pecRicevutaConsegnaId?: string;
}): boolean {
  if (input.canale !== "PEC") {
    return false;
  }

  return !(input.pecRicevutaAccettazioneId && input.pecRicevutaConsegnaId);
}

export function normalizeProtocolloMetadata(input: ProtocolloMetadataInput): NormalizedProtocolloMetadata {
  const direzione = cleanOptional(input.direzione) as DocumentoDirezioneValue | undefined;
  const canale = cleanOptional(input.canale) as DocumentoCanaleValue | undefined;
  const numeroProtocollo = normalizeProtocolloNumber(input.numeroProtocollo);
  const dataProtocolloRaw = cleanOptional(input.dataProtocollo);
  const dataProtocollo = dataProtocolloRaw ? new Date(dataProtocolloRaw) : undefined;

  if (dataProtocolloRaw && Number.isNaN(dataProtocollo?.getTime())) {
    throw new Error("Data protocollo non valida.");
  }

  if ((numeroProtocollo && !dataProtocollo) || (!numeroProtocollo && dataProtocollo)) {
    throw new Error("Numero e data protocollo devono essere valorizzati insieme.");
  }

  const pecMessageId = cleanOptional(input.pecMessageId);
  const pecRicevutaAccettazioneId = cleanOptional(input.pecRicevutaAccettazioneId);
  const pecRicevutaConsegnaId = cleanOptional(input.pecRicevutaConsegnaId);

  if (canale === "PEC" && !pecMessageId) {
    throw new Error("Per canale PEC indica almeno il Message-ID.");
  }

  return {
    direzione,
    canale,
    numeroProtocollo,
    dataProtocollo,
    mittente: cleanOptional(input.mittente),
    destinatario: cleanOptional(input.destinatario),
    pecMessageId,
    pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId,
    pecWarningMancataRicevuta: getPecReceiptWarning({
      canale,
      pecRicevutaAccettazioneId,
      pecRicevutaConsegnaId,
    }),
  };
}
