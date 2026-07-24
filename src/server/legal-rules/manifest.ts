import { z } from "zod";

const authorityLevelValues = ["UE", "NAZIONALE", "REGIONALE", "LOCALE", "ADSP", "ALTRO"] as const;
const documentTypeValues = [
  "LAW",
  "DECREE",
  "AUTHORITY_REGULATION",
  "ORDINANCE",
  "TARIFF",
  "PLANNING_INSTRUMENT",
  "PROCEDURE_DOCUMENT",
  "ENVIRONMENTAL_ACT",
  "ART_OPINION",
  "SUPPORTING_MAP",
  "TECHNICAL_NOTE",
  "OTHER",
] as const;
const legalRankValues = [
  "NATIONAL_LAW",
  "AUTHORITY_REGULATION",
  "PORT_ORDINANCE",
  "PLANNING_INSTRUMENT",
  "PROCEDURE_DOCUMENT",
  "ENVIRONMENTAL_ACT",
  "TECHNICAL_GUIDANCE",
  "ADVISORY_OPINION",
  "CARTOGRAPHIC_SUPPORT",
  "OTHER",
] as const;
const legalSourceStatusValues = [
  "CURRENT",
  "CURRENT_SUBJECT_TO_REVIEW",
  "HISTORICAL",
  "SUPERSEDED",
  "PARTIALLY_SUPERSEDED",
  "PENDING_VALIDITY_CHECK",
  "DRAFT_OR_ONGOING_PROCEDURE",
  "CASE_SPECIFIC",
  "MISSING_SOURCE",
] as const;
const legalSourceRoleValues = [
  "NORMATIVE",
  "PROCEDURAL",
  "PROGRAMMATIC",
  "STRATEGIC",
  "ENVIRONMENTAL",
  "ADVISORY",
  "TECHNICAL_GUIDANCE",
  "SUPPORTING_MAP",
  "PREPARATORY",
  "CASE_SPECIFIC",
] as const;
const confidenceValues = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"] as const;
const territorialScopeValues = ["NATIONAL", "AUTHORITY", "PORT", "PORT_AREA"] as const;
const sourceOriginValues = ["LOCAL_CORPUS", "EXTERNAL_REFERENCE", "USER_PROVIDED"] as const;
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

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("./") || normalized.includes(":/")) {
    return false;
  }

  return !normalized.split("/").includes("..");
}

const keySchema = z.string().min(3).max(120).regex(/^[A-Z0-9][A-Z0-9._-]*$/);

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
  humanReviewRequired: z.literal(true),
});

export const legalRulePackManifestSchema = z
  .object({
    packCode: z.string().min(3),
    packVersion: z.string().min(1),
    tenantEnteCode: z.string().min(3),
    authorities: z.array(
      z.object({
        authorityKey: keySchema,
        code: z.string().min(2),
        name: z.string().min(3),
        level: z.enum(authorityLevelValues),
      }),
    ),
    ports: z.array(
      z.object({
        portKey: keySchema,
        code: z.string().min(2),
        name: z.string().min(3),
        authorityKey: keySchema,
      }),
    ),
    portAreas: z
      .array(
        z.object({
          portAreaKey: keySchema,
          portKey: keySchema,
          code: z.string().min(1),
          name: z.string().min(2),
          note: z.string().optional(),
        }),
      )
      .default([]),
    sources: z.array(
      z.object({
        stableKey: keySchema,
        filename: z.string().min(1),
        relativePath: z.string().min(1),
        title: z.string().min(3),
        issuingBody: z.string().min(2),
        documentType: z.enum(documentTypeValues),
        sourceNumber: z.string().optional(),
        sourceDate: z.string().datetime().optional(),
        authorityKey: keySchema,
        portKeys: z.array(keySchema).min(1),
        portAreaKey: keySchema.optional(),
        legalRank: z.enum(legalRankValues),
        territorialScope: z.enum(territorialScopeValues),
        status: z.enum(legalSourceStatusValues),
        role: z.enum(legalSourceRoleValues),
        isConformative: z.boolean().default(true),
        isExtractable: z.boolean().default(true),
        sourceOrigin: z.enum(sourceOriginValues),
        confidence: z.enum(confidenceValues),
        humanReviewRequired: z.literal(true),
        effectiveFrom: z.string().datetime().optional(),
        effectiveTo: z.string().datetime().optional(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/i),
        size: z.number().int().nonnegative(),
        notes: z.string().optional(),
        tags: z.array(z.string().min(1)).default([]),
      }),
    ),
    rules: z.array(
      z.object({
        ruleId: keySchema,
        sourceStableKey: keySchema,
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
          relationId: keySchema,
          fromSourceStableKey: keySchema,
          toSourceStableKey: keySchema,
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
    duplicates: z
      .array(
        z.object({
          duplicateFilename: z.string().min(1),
          duplicateRelativePath: z.string().min(1),
          duplicateOfStableKey: keySchema,
          notes: z.string().optional(),
        }),
      )
      .default([]),
  })
  .superRefine((value, ctx) => {
    const authorityKeys = new Set(value.authorities.map((item) => item.authorityKey));
    const portKeys = new Set(value.ports.map((item) => item.portKey));
    const areaKeys = new Set(value.portAreas.map((item) => item.portAreaKey));
    const stableKeys = new Set<string>();
    const ruleIds = new Set<string>();
    const relationIds = new Set<string>();
    const gapKeys = new Set<string>();

    for (const port of value.ports) {
      if (!authorityKeys.has(port.authorityKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown authorityKey referenced by port: ${port.authorityKey}`,
          path: ["ports"],
        });
      }
    }

    for (const area of value.portAreas) {
      if (!portKeys.has(area.portKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown portKey referenced by port area: ${area.portKey}`,
          path: ["portAreas"],
        });
      }
    }

    for (const source of value.sources) {
      if (stableKeys.has(source.stableKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate stableKey in manifest: ${source.stableKey}`,
          path: ["sources"],
        });
      }

      stableKeys.add(source.stableKey);

      if (!authorityKeys.has(source.authorityKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown authorityKey in source ${source.stableKey}: ${source.authorityKey}`,
          path: ["sources"],
        });
      }

      for (const portKey of source.portKeys) {
        if (!portKeys.has(portKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown portKey in source ${source.stableKey}: ${portKey}`,
            path: ["sources"],
          });
        }
      }

      if (source.portAreaKey && !areaKeys.has(source.portAreaKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown portAreaKey in source ${source.stableKey}: ${source.portAreaKey}`,
          path: ["sources"],
        });
      }

      if (!isSafeRelativePath(source.relativePath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Source ${source.stableKey} must use a safe relativePath`,
          path: ["sources"],
        });
      }

      if (source.filename !== source.relativePath.split("/").at(-1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Filename/path mismatch for source ${source.stableKey}`,
          path: ["sources"],
        });
      }

      if (source.effectiveFrom && source.effectiveTo && new Date(source.effectiveTo) < new Date(source.effectiveFrom)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `effectiveTo precedes effectiveFrom for source ${source.stableKey}`,
          path: ["sources"],
        });
      }

      const isRaster = /\.(jpg|jpeg|png|webp)$/i.test(source.filename);
      if (isRaster && (source.isConformative || source.role !== "SUPPORTING_MAP")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Raster source ${source.stableKey} must be SUPPORTING_MAP and non-conformative`,
          path: ["sources"],
        });
      }
    }

    for (const rule of value.rules) {
      if (ruleIds.has(rule.ruleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate ruleId in manifest: ${rule.ruleId}`,
          path: ["rules"],
        });
      }
      ruleIds.add(rule.ruleId);

      if (!stableKeys.has(rule.sourceStableKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rule ${rule.ruleId} references unknown source stableKey ${rule.sourceStableKey}`,
          path: ["rules"],
        });
      }
    }

    for (const relation of value.relations) {
      if (relationIds.has(relation.relationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate relationId in manifest: ${relation.relationId}`,
          path: ["relations"],
        });
      }
      relationIds.add(relation.relationId);

      if (!stableKeys.has(relation.fromSourceStableKey) || !stableKeys.has(relation.toSourceStableKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Relation ${relation.relationId} references unknown source stableKey`,
          path: ["relations"],
        });
      }
    }

    for (const gap of value.gaps) {
      if (gapKeys.has(gap.gapKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate gapKey in manifest: ${gap.gapKey}`,
          path: ["gaps"],
        });
      }
      gapKeys.add(gap.gapKey);

      if (gap.linkedRuleCode && !ruleIds.has(gap.linkedRuleCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Gap ${gap.gapKey} references unknown ruleId ${gap.linkedRuleCode}`,
          path: ["gaps"],
        });
      }
    }

    for (const duplicate of value.duplicates) {
      if (!isSafeRelativePath(duplicate.duplicateRelativePath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate entry path must be relative: ${duplicate.duplicateRelativePath}`,
          path: ["duplicates"],
        });
      }

      if (!stableKeys.has(duplicate.duplicateOfStableKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate entry references unknown stableKey ${duplicate.duplicateOfStableKey}`,
          path: ["duplicates"],
        });
      }
    }
  });

export type LegalRulePackManifest = z.infer<typeof legalRulePackManifestSchema>;
