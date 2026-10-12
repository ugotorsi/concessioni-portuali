import { z } from "zod";
import {
  DOCUMENT_CANALE_VALUES,
  DOCUMENT_DIREZIONE_VALUES,
  normalizeProtocolloMetadata,
  type DocumentoCanaleValue,
  type DocumentoDirezioneValue,
} from "@/server/documents/protocollo";

export const DOCUMENT_TIPOLOGIA_VALUES = [
  "TITOLO_CONCESSORIO",
  "PROROGA",
  "RINNOVO",
  "SUBINGRESSO",
  "PLANIMETRIA",
  "POLIZZA",
  "FIDEIUSSIONE",
  "CAUZIONE",
  "PAGAMENTO",
  "VERBALE",
  "DIFFIDA",
  "CONTESTAZIONE",
  "DETERMINA",
  "NOTA",
  "ALTRO",
] as const;

export const DOCUMENT_SOURCE_VALUES = ["UPLOAD_UTENTE", "PEC_METADATA", "PROTOCOLLO_INTERNO", "MIGRAZIONE", "ALTRO"] as const;
export const DOCUMENT_STATUS_VALUES = ["ATTIVO", "ARCHIVIATO"] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
] as const;

const DEFAULT_MAX_MB = 15;

export function getDocumentMaxBytes(): number {
  const raw = process.env.DOCUMENT_MAX_FILE_MB?.trim();
  if (!raw) {
    return DEFAULT_MAX_MB * 1024 * 1024;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_MB * 1024 * 1024;
  }

  return parsed * 1024 * 1024;
}

export function validateUploadDescriptor(input: { size: number; type: string }): void {
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new Error("Il file selezionato è vuoto.");
  }
  if (input.size > getDocumentMaxBytes()) {
    throw new Error("Dimensione file eccedente il limite configurato.");
  }
  const normalizedMime = input.type.trim().toLowerCase();
  if (!(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(normalizedMime)) {
    throw new Error("Formato file non consentito.");
  }
}

export function detectDocumentMimeType(body: Buffer, declaredMimeType: string): string {
  const declared = declaredMimeType.trim().toLowerCase();
  if (body.subarray(0, 5).equals(Buffer.from("%PDF-"))) return "application/pdf";
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF"
    && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (declared === "text/plain" || declared === "text/csv") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(body);
      if (!body.includes(0)) return declared;
    } catch {
      // Binary content is rejected below.
    }
  }
  throw new Error("Il contenuto del file non corrisponde a un formato consentito.");
}

const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const uploadMetadataSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .max(180, "Nome documento troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    tipologia: z.enum(DOCUMENT_TIPOLOGIA_VALUES, { message: "Tipologia documento non valida." }),
    descrizione: z
      .string()
      .trim()
      .max(1000, "Descrizione troppo lunga.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    dataDocumento: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    source: z.enum(DOCUMENT_SOURCE_VALUES, { message: "Fonte documento obbligatoria." }),
    status: z.enum(DOCUMENT_STATUS_VALUES, { message: "Stato documento obbligatorio." }),
    direzione: z
      .enum(DOCUMENT_DIREZIONE_VALUES)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    canale: z
      .enum(DOCUMENT_CANALE_VALUES)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    numeroProtocollo: z
      .string()
      .trim()
      .max(120, "Numero protocollo troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    dataProtocollo: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    mittente: z
      .string()
      .trim()
      .max(240, "Mittente troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    destinatario: z
      .string()
      .trim()
      .max(240, "Destinatario troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    pecMessageId: z
      .string()
      .trim()
      .max(240, "Message-ID PEC troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    pecRicevutaAccettazioneId: z
      .string()
      .trim()
      .max(240, "ID ricevuta accettazione troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    pecRicevutaConsegnaId: z
      .string()
      .trim()
      .max(240, "ID ricevuta consegna troppo lungo.")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    concessioneId: optionalId,
    criticitaId: optionalId,
    procedimentoId: optionalId,
    fascicoloIntakeId: optionalId,
    sopralluogoId: optionalId,
    pagamentoId: optionalId,
    reportId: optionalId,
  })
  .superRefine((value, context) => {
    const links = [
      value.concessioneId,
      value.criticitaId,
      value.procedimentoId,
      value.fascicoloIntakeId,
      value.sopralluogoId,
      value.pagamentoId,
      value.reportId,
    ].filter(Boolean);

    if (links.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Collega il documento ad almeno un'entità istruttoria.",
        path: ["concessioneId"],
      });
    }

    if (value.dataDocumento) {
      const parsed = new Date(value.dataDocumento);
      if (Number.isNaN(parsed.getTime())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Data documento non valida.",
          path: ["dataDocumento"],
        });
      }
    }

    try {
      normalizeProtocolloMetadata({
        direzione: value.direzione,
        canale: value.canale,
        numeroProtocollo: value.numeroProtocollo,
        dataProtocollo: value.dataProtocollo,
        mittente: value.mittente,
        destinatario: value.destinatario,
        pecMessageId: value.pecMessageId,
        pecRicevutaAccettazioneId: value.pecRicevutaAccettazioneId,
        pecRicevutaConsegnaId: value.pecRicevutaConsegnaId,
      });
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Metadati protocollo/PEC non validi.",
        path: ["numeroProtocollo"],
      });
    }
  });

export interface ParsedUploadDocumentMetadata {
  nome?: string;
  tipologia: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number];
  descrizione?: string;
  dataDocumento?: Date;
  source: (typeof DOCUMENT_SOURCE_VALUES)[number];
  status: (typeof DOCUMENT_STATUS_VALUES)[number];
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
  concessioneId?: string;
  criticitaId?: string;
  procedimentoId?: string;
  sopralluogoId?: string;
  pagamentoId?: string;
  reportId?: string;
}

export interface ParsedUploadDocumentInput extends ParsedUploadDocumentMetadata {
  nome: string;
  file: File;
}

export function validateUploadFile(file: File): void {
  if (!(file instanceof File)) {
    throw new Error("File documento mancante.");
  }
  validateUploadDescriptor(file);
}

interface UploadMetadataSource {
  get(name: string): FormDataEntryValue | null;
}

export function parseUploadDocumentMetadata(formData: UploadMetadataSource): ParsedUploadDocumentMetadata {
  const parsed = uploadMetadataSchema.safeParse({
    nome: formData.get("nome")?.toString(),
    tipologia: formData.get("tipologia"),
    descrizione: formData.get("descrizione")?.toString(),
    dataDocumento: formData.get("dataDocumento")?.toString(),
    source: formData.get("source"),
    status: formData.get("status"),
    direzione: formData.get("direzione")?.toString(),
    canale: formData.get("canale")?.toString(),
    numeroProtocollo: formData.get("numeroProtocollo")?.toString(),
    dataProtocollo: formData.get("dataProtocollo")?.toString(),
    mittente: formData.get("mittente")?.toString(),
    destinatario: formData.get("destinatario")?.toString(),
    pecMessageId: formData.get("pecMessageId")?.toString(),
    pecRicevutaAccettazioneId: formData.get("pecRicevutaAccettazioneId")?.toString(),
    pecRicevutaConsegnaId: formData.get("pecRicevutaConsegnaId")?.toString(),
    concessioneId: formData.get("concessioneId")?.toString(),
    criticitaId: formData.get("criticitaId")?.toString(),
    procedimentoId: formData.get("procedimentoId")?.toString(),
    sopralluogoId: formData.get("sopralluogoId")?.toString(),
    pagamentoId: formData.get("pagamentoId")?.toString(),
    reportId: formData.get("reportId")?.toString(),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati documento non validi.");
  }

  const protocolloMetadata = normalizeProtocolloMetadata({
    direzione: parsed.data.direzione,
    canale: parsed.data.canale,
    numeroProtocollo: parsed.data.numeroProtocollo,
    dataProtocollo: parsed.data.dataProtocollo,
    mittente: parsed.data.mittente,
    destinatario: parsed.data.destinatario,
    pecMessageId: parsed.data.pecMessageId,
    pecRicevutaAccettazioneId: parsed.data.pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId: parsed.data.pecRicevutaConsegnaId,
  });

  return {
    nome: parsed.data.nome,
    tipologia: parsed.data.tipologia,
    descrizione: parsed.data.descrizione,
    dataDocumento: parsed.data.dataDocumento ? new Date(parsed.data.dataDocumento) : undefined,
    source: parsed.data.source,
    status: parsed.data.status,
    direzione: protocolloMetadata.direzione,
    canale: protocolloMetadata.canale,
    numeroProtocollo: protocolloMetadata.numeroProtocollo,
    dataProtocollo: protocolloMetadata.dataProtocollo,
    mittente: protocolloMetadata.mittente,
    destinatario: protocolloMetadata.destinatario,
    pecMessageId: protocolloMetadata.pecMessageId,
    pecRicevutaAccettazioneId: protocolloMetadata.pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId: protocolloMetadata.pecRicevutaConsegnaId,
    pecWarningMancataRicevuta: protocolloMetadata.pecWarningMancataRicevuta,
    concessioneId: parsed.data.concessioneId,
    criticitaId: parsed.data.criticitaId,
    procedimentoId: parsed.data.procedimentoId,
    sopralluogoId: parsed.data.sopralluogoId,
    pagamentoId: parsed.data.pagamentoId,
    reportId: parsed.data.reportId,
  };
}

export function parseUploadDocumentFormData(formData: FormData): ParsedUploadDocumentInput {
  const metadata = parseUploadDocumentMetadata(formData);
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("File documento mancante.");
  }
  validateUploadFile(file);
  return {
    ...metadata,
    nome: metadata.nome ?? file.name,
    file,
  };
}

export function buildLinkedEntityMetadata(input: ParsedUploadDocumentInput) {
  return {
    concessioneId: input.concessioneId ?? null,
    criticitaId: input.criticitaId ?? null,
    procedimentoId: input.procedimentoId ?? null,
    sopralluogoId: input.sopralluogoId ?? null,
    pagamentoId: input.pagamentoId ?? null,
    reportId: input.reportId ?? null,
  };
}
