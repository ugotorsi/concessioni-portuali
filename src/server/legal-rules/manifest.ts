import { z } from "zod";

const legalSourceTypeValues = [
  "LEGGE",
  "DECRETO",
  "REGOLAMENTO",
  "DELIBERA",
  "ORDINANZA",
  "PIANO",
  "PARERE",
  "TARIFFA",
  "PLANIMETRIA",
  "ALTRO",
] as const;

const legalSourceStatusValues = ["VIGENTE", "SUPERATA", "BOZZA"] as const;
const sourceRelationTypeValues = ["MODIFICA", "ATTUA", "RICHIAMA", "DEROGA", "ALLEGA", "COORDINA"] as const;
const legalRuleCategoryValues = [
  "TITOLO",
  "PROCEDURA",
  "CANONE",
  "GARANZIA",
  "DOCUMENTAZIONE",
  "SUBINGRESSO",
  "SICUREZZA",
  "OCCUPAZIONE",
  "ALTRO",
] as const;
const legalRuleStatusValues = ["ATTIVA", "SUPERATA", "BOZZA"] as const;
const documentGapStatusValues = ["APERTA", "IN_GESTIONE", "RISOLTA", "ARCHIVIATA"] as const;
const authorityLevelValues = ["UE", "NAZIONALE", "REGIONALE", "LOCALE", "ADSP", "ALTRO"] as const;

const matcherSchema = z.object({
  concessionVertical: z.string().optional(),
  concessionObjectType: z.string().optional(),
  attivita: z.string().optional(),
  awardingProcedureType: z.string().optional(),
  feeRegime: z.string().optional(),
  comparativeProcedureStatus: z.string().optional(),
  requiresRilevanzaArt47: z.boolean().optional(),
  letteraArt47: z.string().optional(),
  requiresMorosita: z.boolean().optional(),
  requiresPolizzaValida: z.boolean().optional(),
});

const outcomeSchema = z.object({
  outputSeverity: z.enum(["URGENTE", "ALTA", "MEDIA", "BASSA"]),
  outcomeTitle: z.string().min(3),
  outcomeSummary: z.string().min(5),
  disclaimer: z.string().optional(),
  humanReviewRequired: z.boolean().default(true),
});

export const legalRulePackManifestSchema = z.object({
  packCode: z.string().min(3),
  packVersion: z.string().min(1),
  tenantEnteCode: z.string().min(3),
  authority: z.object({
    code: z.string().min(2),
    name: z.string().min(3),
    level: z.enum(authorityLevelValues),
  }),
  port: z.object({
    code: z.string().min(2),
    name: z.string().min(3),
  }),
  areas: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(2),
        note: z.string().optional(),
      }),
    )
    .default([]),
  sources: z.array(
    z.object({
      sourceKey: z.string().min(3),
      title: z.string().min(3),
      sourceType: z.enum(legalSourceTypeValues),
      status: z.enum(legalSourceStatusValues).default("VIGENTE"),
      publicationDate: z.string().datetime().optional(),
      effectiveFrom: z.string().datetime().optional(),
      effectiveTo: z.string().datetime().optional(),
      fileName: z.string().min(1).optional(),
      filePath: z.string().min(1).optional(),
      notes: z.string().optional(),
    }),
  ),
  rules: z.array(
    z.object({
      sourceKey: z.string().min(3),
      ruleCode: z.string().min(2),
      title: z.string().min(3),
      summary: z.string().min(5),
      category: z.enum(legalRuleCategoryValues),
      status: z.enum(legalRuleStatusValues).default("ATTIVA"),
      priority: z.number().int().min(1).max(999).default(100),
      matcher: matcherSchema.default({}),
      outcome: outcomeSchema,
    }),
  ),
  relations: z
    .array(
      z.object({
        fromSourceKey: z.string().min(3),
        toSourceKey: z.string().min(3),
        relationType: z.enum(sourceRelationTypeValues),
        note: z.string().optional(),
      }),
    )
    .default([]),
  gaps: z
    .array(
      z.object({
        gapKey: z.string().min(3),
        title: z.string().min(3),
        description: z.string().min(5),
        severity: z.enum(["URGENTE", "ALTA", "MEDIA", "BASSA"]).default("MEDIA"),
        status: z.enum(documentGapStatusValues).default("APERTA"),
        requiredDocumentTypes: z.array(z.string().min(1)).default([]),
        linkedRuleCode: z.string().min(2).optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
});

export type LegalRulePackManifest = z.infer<typeof legalRulePackManifestSchema>;
