import { z } from "zod";

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

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
]);

const DEFAULT_MAX_MB = 15;

function getDocumentMaxBytes(): number {
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
    concessioneId: optionalId,
    criticitaId: optionalId,
    procedimentoId: optionalId,
    sopralluogoId: optionalId,
    pagamentoId: optionalId,
    reportId: optionalId,
  })
  .superRefine((value, context) => {
    const links = [
      value.concessioneId,
      value.criticitaId,
      value.procedimentoId,
      value.sopralluogoId,
      value.pagamentoId,
      value.reportId,
    ].filter(Boolean);

    if (links.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Collega il documento ad almeno una entita istruttoria.",
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
  });

export interface ParsedUploadDocumentInput {
  nome: string;
  tipologia: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number];
  descrizione?: string;
  dataDocumento?: Date;
  file: File;
  concessioneId?: string;
  criticitaId?: string;
  procedimentoId?: string;
  sopralluogoId?: string;
  pagamentoId?: string;
  reportId?: string;
}

export function validateUploadFile(file: File): void {
  if (!(file instanceof File)) {
    throw new Error("File documento mancante.");
  }

  if (file.size <= 0) {
    throw new Error("Il file selezionato e vuoto.");
  }

  if (file.size > getDocumentMaxBytes()) {
    throw new Error("Dimensione file eccedente il limite configurato.");
  }

  const normalizedMime = file.type.trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new Error("Formato file non consentito.");
  }
}

export function parseUploadDocumentFormData(formData: FormData): ParsedUploadDocumentInput {
  const parsed = uploadMetadataSchema.safeParse({
    nome: formData.get("nome")?.toString(),
    tipologia: formData.get("tipologia"),
    descrizione: formData.get("descrizione")?.toString(),
    dataDocumento: formData.get("dataDocumento")?.toString(),
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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("File documento mancante.");
  }

  validateUploadFile(file);

  return {
    nome: parsed.data.nome ?? file.name,
    tipologia: parsed.data.tipologia,
    descrizione: parsed.data.descrizione,
    dataDocumento: parsed.data.dataDocumento ? new Date(parsed.data.dataDocumento) : undefined,
    file,
    concessioneId: parsed.data.concessioneId,
    criticitaId: parsed.data.criticitaId,
    procedimentoId: parsed.data.procedimentoId,
    sopralluogoId: parsed.data.sopralluogoId,
    pagamentoId: parsed.data.pagamentoId,
    reportId: parsed.data.reportId,
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
