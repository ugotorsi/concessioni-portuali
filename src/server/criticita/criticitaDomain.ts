import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { DemoRole } from "@/lib/auth";
import {
  CRITICITA_ART47_LETTERA_VALUES,
  CRITICITA_ESITO_REGOLARIZZAZIONE_VALUES,
  CRITICITA_FONTE_VALUES,
  CRITICITA_GRAVITA_VALUES,
  CRITICITA_RISCHIO_DECADENZA_VALUES,
  CRITICITA_TIPOLOGIA_VALUES,
} from "@/server/queries/criticita";

export const criticitaInstructionSchema = z
  .object({
    descrizione: z.string().trim().min(10, "Inserisci una descrizione più dettagliata."),
    noteIstruttorie: z.string().trim().optional(),
    rilevanzaArt47: z.enum(["true", "false"]).transform((value) => value === "true"),
    letteraArt47: z.enum(CRITICITA_ART47_LETTERA_VALUES).optional(),
    rischioDecadenza: z.enum(CRITICITA_RISCHIO_DECADENZA_VALUES).optional(),
    motivazioneArt47: z.string().trim().optional(),
    azioneIstruttoriaArt47: z.string().trim().optional(),
    regolarizzata: z.enum(["true", "false"]).transform((value) => value === "true"),
    dataRegolarizzazione: z.string().trim().optional(),
    descrizioneRegolarizzazione: z.string().trim().optional(),
    esitoRegolarizzazione: z.enum(CRITICITA_ESITO_REGOLARIZZAZIONE_VALUES).optional(),
    verificataRegolarizzazione: z.enum(["true", "false"]).transform((value) => value === "true"),
    dataVerificaRegolarizzazione: z.string().trim().optional(),
    noteVerificaRegolarizzazione: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.rilevanzaArt47) return;

    if (!value.letteraArt47) {
      ctx.addIssue({ code: "custom", message: "Se art. 47 e rilevante seleziona la lettera applicabile.", path: ["letteraArt47"] });
    }
    if (!value.rischioDecadenza) {
      ctx.addIssue({ code: "custom", message: "Se art. 47 e rilevante seleziona il livello di rischio.", path: ["rischioDecadenza"] });
    }
    if (!value.motivazioneArt47 || value.motivazioneArt47.length < 10) {
      ctx.addIssue({ code: "custom", message: "Inserisci una motivazione art. 47 di almeno 10 caratteri.", path: ["motivazioneArt47"] });
    }
    if (value.regolarizzata) {
      const hasData = Boolean(value.dataRegolarizzazione && value.dataRegolarizzazione.length > 0);
      const hasDescrizione = Boolean(value.descrizioneRegolarizzazione && value.descrizioneRegolarizzazione.length >= 10);
      if (!hasData && !hasDescrizione) {
        ctx.addIssue({
          code: "custom",
          message: "Se la criticità è regolarizzata indica data o descrizione (minimo 10 caratteri).",
          path: ["descrizioneRegolarizzazione"],
        });
      }
    }
    if (value.verificataRegolarizzazione && !value.dataVerificaRegolarizzazione) {
      ctx.addIssue({
        code: "custom",
        message: "Se la regolarizzazione è verificata indica la data verifica.",
        path: ["dataVerificaRegolarizzazione"],
      });
    }
  });

export const createCriticitaSchema = criticitaInstructionSchema.extend({
  concessioneId: z.string().min(1, "Seleziona una concessione."),
  tipologia: z.enum(CRITICITA_TIPOLOGIA_VALUES, { message: "Tipologia non valida." }),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravità non valida." }),
  fonte: z.enum(CRITICITA_FONTE_VALUES, { message: "Fonte non valida." }),
});

export const promoteFascicoloSignalCriticitaSchema = criticitaInstructionSchema.extend({
  tipologia: z.enum(CRITICITA_TIPOLOGIA_VALUES, { message: "Tipologia non valida." }),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravità non valida." }),
});

const tecnicoTipologie = new Set(["TECNICA", "MANUTENTIVA", "SICUREZZA", "OCCUPAZIONE_DIFFORME", "USO_NON_CONFORME"]);
const economicoTipologie = new Set(["ECONOMICA", "MOROSITA"]);

type InstructionInput = z.infer<typeof criticitaInstructionSchema>;
type Tipologia = (typeof CRITICITA_TIPOLOGIA_VALUES)[number];
type Gravita = (typeof CRITICITA_GRAVITA_VALUES)[number];
type Fonte = (typeof CRITICITA_FONTE_VALUES)[number];

export function toOptional(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function ensureTipologiaByRole(role: DemoRole, tipologia: string): void {
  if (role === "TECNICO" && !tecnicoTipologie.has(tipologia)) {
    throw new Error("Il profilo Tecnico può gestire solo criticità tecniche.");
  }
  if (role === "ECONOMICO" && !economicoTipologie.has(tipologia)) {
    throw new Error("Il profilo Economico può gestire solo criticità economiche o morosità.");
  }
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeArt47Fields(input: InstructionInput) {
  if (!input.rilevanzaArt47) {
    return {
      rilevanzaArt47: false,
      letteraArt47: null,
      rischioDecadenza: null,
      motivazioneArt47: null,
      azioneIstruttoriaArt47: null,
    };
  }
  return {
    rilevanzaArt47: true,
    letteraArt47: input.letteraArt47 ?? null,
    rischioDecadenza: input.rischioDecadenza ?? null,
    motivazioneArt47: input.motivazioneArt47 ?? null,
    azioneIstruttoriaArt47: input.azioneIstruttoriaArt47 ?? null,
  };
}

function normalizeRegolarizzazioneFields(input: InstructionInput) {
  if (!input.regolarizzata) {
    return {
      regolarizzata: false,
      dataRegolarizzazione: null,
      descrizioneRegolarizzazione: null,
      esitoRegolarizzazione: null,
      verificataRegolarizzazione: false,
      dataVerificaRegolarizzazione: null,
      noteVerificaRegolarizzazione: null,
    };
  }
  return {
    regolarizzata: true,
    dataRegolarizzazione: parseOptionalDate(input.dataRegolarizzazione),
    descrizioneRegolarizzazione: input.descrizioneRegolarizzazione ?? null,
    esitoRegolarizzazione: input.esitoRegolarizzazione ?? null,
    verificataRegolarizzazione: input.verificataRegolarizzazione,
    dataVerificaRegolarizzazione: input.verificataRegolarizzazione ? parseOptionalDate(input.dataVerificaRegolarizzazione) : null,
    noteVerificaRegolarizzazione: input.verificataRegolarizzazione ? input.noteVerificaRegolarizzazione ?? null : null,
  };
}

export function buildCriticitaInstructionData(input: InstructionInput) {
  return {
    descrizione: input.descrizione,
    azioneConsigliata: input.noteIstruttorie,
    ...normalizeArt47Fields(input),
    ...normalizeRegolarizzazioneFields(input),
  };
}

export function buildCriticitaCreateData(
  input: InstructionInput & { tipologia: Tipologia; gravita: Gravita },
  fixed: { concessioneId: string; fonte: Fonte; now?: Date },
): Prisma.CriticitaUncheckedCreateInput {
  return {
    concessioneId: fixed.concessioneId,
    tipologia: input.tipologia,
    gravita: input.gravita,
    fonte: fixed.fonte,
    ...buildCriticitaInstructionData(input),
    stato: "APERTA",
    dataUltimoAggiornamento: fixed.now ?? new Date(),
  };
}