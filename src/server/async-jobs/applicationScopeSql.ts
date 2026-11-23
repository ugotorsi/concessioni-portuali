import { Prisma } from "@/generated/prisma/client";

export function applicationProcedimentoScope(
  procedimentoAllowlist: readonly string[],
): Prisma.Sql {
  if (procedimentoAllowlist.length === 0) return Prisma.empty;
  return Prisma.sql`AND (
    "procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
    OR (
      "operation" IN (
        'NEUTRAL_INTAKE_EXTRACTION_V1',
        'NEUTRAL_INTAKE_CLASSIFICATION_V1',
        'LEGAL_REFERENCE_DISCOVERY_V1',
        'LEGAL_REFERENCE_MATCHING_V1'
      )
      AND EXISTS (
        SELECT 1 FROM "NeutralIntakeDestination" AS destination
        WHERE destination."neutralIntakeId" = "inputReference"->>'referenceId'
          AND destination."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
    OR (
      "operation" = 'LEGAL_REFERENCE_OFFICIAL_LOOKUP_V1'
      AND EXISTS (
        SELECT 1
        FROM "LegalReferenceMention" AS mention
        JOIN "NeutralIntakeExtractionAttempt" AS attempt
          ON attempt."id" = mention."extractionAttemptId"
        JOIN "NeutralIntakeDestination" AS destination
          ON destination."neutralIntakeId" = attempt."neutralIntakeId"
        WHERE mention."id" = "inputReference"->>'referenceId'
          AND destination."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
    OR (
      "operation" = 'LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_V1'
      AND EXISTS (
        SELECT 1
        FROM "LegalReferenceOfficialLookup" AS lookup
        JOIN "LegalReferenceMention" AS mention ON mention."id" = lookup."mentionId"
        JOIN "NeutralIntakeExtractionAttempt" AS attempt
          ON attempt."id" = mention."extractionAttemptId"
        JOIN "NeutralIntakeDestination" AS destination
          ON destination."neutralIntakeId" = attempt."neutralIntakeId"
        WHERE lookup."id" = "inputReference"->>'referenceId'
          AND destination."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
    OR (
      "operation" = 'FASCICOLO.AUTOMATIC_ANALYSIS_V1'
      AND "inputReference"#>>'{metadata,procedimentoId}' IN (${Prisma.join(procedimentoAllowlist)})
    )
    OR (
      "operation" = 'LEGAL_RESEARCH.EXECUTE_V1'
      AND EXISTS (
        SELECT 1
        FROM "AutomaticFascicoloReportMission" AS report_mission
        JOIN "AutomaticFascicoloReport" AS report
          ON report."id" = report_mission."reportId"
        WHERE report_mission."missionId" = "inputReference"->>'referenceId'
          AND report."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
  )`;
}

export function childApplicationProcedimentoScope(
  procedimentoAllowlist: readonly string[],
): Prisma.Sql {
  if (procedimentoAllowlist.length === 0) return Prisma.empty;
  return Prisma.sql`AND (
    child."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
    OR (
      child."operation" IN (
        'NEUTRAL_INTAKE_EXTRACTION_V1',
        'NEUTRAL_INTAKE_CLASSIFICATION_V1',
        'LEGAL_REFERENCE_DISCOVERY_V1',
        'LEGAL_REFERENCE_MATCHING_V1'
      )
      AND EXISTS (
        SELECT 1 FROM "NeutralIntakeDestination" AS destination
        WHERE destination."neutralIntakeId" = child."inputReference"->>'referenceId'
          AND destination."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
    OR (
      child."operation" = 'LEGAL_REFERENCE_OFFICIAL_LOOKUP_V1'
      AND EXISTS (
        SELECT 1
        FROM "LegalReferenceMention" AS mention
        JOIN "NeutralIntakeExtractionAttempt" AS attempt
          ON attempt."id" = mention."extractionAttemptId"
        JOIN "NeutralIntakeDestination" AS destination
          ON destination."neutralIntakeId" = attempt."neutralIntakeId"
        WHERE mention."id" = child."inputReference"->>'referenceId'
          AND destination."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
    OR (
      child."operation" = 'LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_V1'
      AND EXISTS (
        SELECT 1
        FROM "LegalReferenceOfficialLookup" AS lookup
        JOIN "LegalReferenceMention" AS mention ON mention."id" = lookup."mentionId"
        JOIN "NeutralIntakeExtractionAttempt" AS attempt
          ON attempt."id" = mention."extractionAttemptId"
        JOIN "NeutralIntakeDestination" AS destination
          ON destination."neutralIntakeId" = attempt."neutralIntakeId"
        WHERE lookup."id" = child."inputReference"->>'referenceId'
          AND destination."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
    OR (
      child."operation" = 'FASCICOLO.AUTOMATIC_ANALYSIS_V1'
      AND child."inputReference"#>>'{metadata,procedimentoId}' IN (${Prisma.join(procedimentoAllowlist)})
    )
    OR (
      child."operation" = 'LEGAL_RESEARCH.EXECUTE_V1'
      AND EXISTS (
        SELECT 1
        FROM "AutomaticFascicoloReportMission" AS report_mission
        JOIN "AutomaticFascicoloReport" AS report
          ON report."id" = report_mission."reportId"
        WHERE report_mission."missionId" = child."inputReference"->>'referenceId'
          AND report."procedimentoId" IN (${Prisma.join(procedimentoAllowlist)})
      )
    )
  )`;
}
