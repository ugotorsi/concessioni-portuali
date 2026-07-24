import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { legalRulePackManifestSchema, type LegalRulePackManifest } from "@/server/legal-rules/manifest";

export interface ImportLegalRulePackResult {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  warnings: string[];
  sourceCount: number;
  ruleCount: number;
  relationCount: number;
  gapCount: number;
}

function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

async function tryReadFileMetadata(absolutePath: string): Promise<{
  checksumSha256: string;
  sizeBytes: number;
} | null> {
  try {
    const buffer = await fs.readFile(absolutePath);
    return {
      checksumSha256: createHash("sha256").update(buffer).digest("hex"),
      sizeBytes: buffer.length,
    };
  } catch {
    return null;
  }
}

async function loadManifest(manifestPath: string): Promise<LegalRulePackManifest> {
  const content = await fs.readFile(manifestPath, "utf8");
  const raw = JSON.parse(content) as unknown;
  return legalRulePackManifestSchema.parse(raw);
}

export async function importLegalRulePack(manifestPath: string): Promise<ImportLegalRulePackResult> {
  const manifest = await loadManifest(manifestPath);
  const warnings: string[] = [];
  const normalizedManifestPath = path.normalize(manifestPath);
  const baseDir = path.dirname(normalizedManifestPath);

  const ente = await prisma.ente.findUnique({
    where: { codice: manifest.tenantEnteCode },
    select: { id: true },
  });

  if (!ente) {
    throw new Error(`Tenant ente with code ${manifest.tenantEnteCode} not found.`);
  }

  const authority = await prisma.authority.upsert({
    where: { code: manifest.authority.code },
    create: {
      code: manifest.authority.code,
      name: manifest.authority.name,
      level: manifest.authority.level,
    },
    update: {
      name: manifest.authority.name,
      level: manifest.authority.level,
    },
  });

  const port = await prisma.port.upsert({
    where: { code: manifest.port.code },
    create: {
      code: manifest.port.code,
      name: manifest.port.name,
      enteId: ente.id,
      authorityId: authority.id,
    },
    update: {
      name: manifest.port.name,
      enteId: ente.id,
      authorityId: authority.id,
    },
  });

  for (const area of manifest.areas) {
    await prisma.portArea.upsert({
      where: {
        portId_code: {
          portId: port.id,
          code: area.code,
        },
      },
      create: {
        portId: port.id,
        code: area.code,
        name: area.name,
        note: area.note ?? null,
      },
      update: {
        name: area.name,
        note: area.note ?? null,
      },
    });
  }

  const run = await prisma.importRun.create({
    data: {
      packCode: manifest.packCode,
      packVersion: manifest.packVersion,
      manifestPath: normalizedManifestPath,
      status: "IN_PROGRESS",
      enteId: ente.id,
      authorityId: authority.id,
      portId: port.id,
      warnings: [],
    },
  });

  try {
    const sourceByKey = new Map<string, { id: string }>();

    for (const source of manifest.sources) {
      const candidatePath = source.filePath ? path.resolve(baseDir, source.filePath) : null;
      const fileMetadata = candidatePath ? await tryReadFileMetadata(candidatePath) : null;

      if (source.filePath && !fileMetadata) {
        warnings.push(`File non trovato per sourceKey ${source.sourceKey}: ${source.filePath}`);
      }

      const upserted = await prisma.legalSource.upsert({
        where: { sourceKey: source.sourceKey },
        create: {
          sourceKey: source.sourceKey,
          title: source.title,
          sourceType: source.sourceType,
          status: source.status,
          publicationDate: source.publicationDate ? new Date(source.publicationDate) : null,
          effectiveFrom: source.effectiveFrom ? new Date(source.effectiveFrom) : null,
          effectiveTo: source.effectiveTo ? new Date(source.effectiveTo) : null,
          notes: source.notes ?? null,
          fileName: source.fileName ?? null,
          filePath: source.filePath ?? null,
          fileChecksumSha256: fileMetadata?.checksumSha256 ?? null,
          fileMimeType: source.fileName ? inferMimeType(source.fileName) : null,
          fileSizeBytes: fileMetadata?.sizeBytes ?? null,
          enteId: ente.id,
          authorityId: authority.id,
          portId: port.id,
          importRunId: run.id,
        },
        update: {
          title: source.title,
          sourceType: source.sourceType,
          status: source.status,
          publicationDate: source.publicationDate ? new Date(source.publicationDate) : null,
          effectiveFrom: source.effectiveFrom ? new Date(source.effectiveFrom) : null,
          effectiveTo: source.effectiveTo ? new Date(source.effectiveTo) : null,
          notes: source.notes ?? null,
          fileName: source.fileName ?? null,
          filePath: source.filePath ?? null,
          fileChecksumSha256: fileMetadata?.checksumSha256 ?? null,
          fileMimeType: source.fileName ? inferMimeType(source.fileName) : null,
          fileSizeBytes: fileMetadata?.sizeBytes ?? null,
          enteId: ente.id,
          authorityId: authority.id,
          portId: port.id,
          importRunId: run.id,
        },
        select: { id: true },
      });

      sourceByKey.set(source.sourceKey, upserted);
    }

    const ruleByCode = new Map<string, { id: string; sourceId: string }>();

    for (const rule of manifest.rules) {
      const source = sourceByKey.get(rule.sourceKey);
      if (!source) {
        throw new Error(`Rule ${rule.ruleCode} references missing sourceKey ${rule.sourceKey}.`);
      }

      const upsertedRule = await prisma.legalRule.upsert({
        where: {
          sourceId_ruleCode: {
            sourceId: source.id,
            ruleCode: rule.ruleCode,
          },
        },
        create: {
          sourceId: source.id,
          ruleCode: rule.ruleCode,
          title: rule.title,
          summary: rule.summary,
          category: rule.category,
          status: rule.status,
          priority: rule.priority,
          enteId: ente.id,
          portId: port.id,
          matchConcessionVertical: (rule.matcher.concessionVertical ?? null) as never,
          matchObjectType: (rule.matcher.concessionObjectType ?? null) as never,
          matchAttivita: (rule.matcher.attivita ?? null) as never,
          matchAwardingProcedure: (rule.matcher.awardingProcedureType ?? null) as never,
          matchFeeRegime: (rule.matcher.feeRegime ?? null) as never,
          matchComparativeStatus: (rule.matcher.comparativeProcedureStatus ?? null) as never,
          requiresRilevanzaArt47: rule.matcher.requiresRilevanzaArt47 ?? null,
          matchArt47Letter: (rule.matcher.letteraArt47 ?? null) as never,
          requiresMorosita: rule.matcher.requiresMorosita ?? null,
          requiresPolizzaValida: rule.matcher.requiresPolizzaValida ?? null,
          outputSeverity: rule.outcome.outputSeverity,
          outcomeTitle: rule.outcome.outcomeTitle,
          outcomeSummary: rule.outcome.outcomeSummary,
          disclaimer: rule.outcome.disclaimer ?? null,
          humanReviewRequired: rule.outcome.humanReviewRequired,
        },
        update: {
          title: rule.title,
          summary: rule.summary,
          category: rule.category,
          status: rule.status,
          priority: rule.priority,
          enteId: ente.id,
          portId: port.id,
          matchConcessionVertical: (rule.matcher.concessionVertical ?? null) as never,
          matchObjectType: (rule.matcher.concessionObjectType ?? null) as never,
          matchAttivita: (rule.matcher.attivita ?? null) as never,
          matchAwardingProcedure: (rule.matcher.awardingProcedureType ?? null) as never,
          matchFeeRegime: (rule.matcher.feeRegime ?? null) as never,
          matchComparativeStatus: (rule.matcher.comparativeProcedureStatus ?? null) as never,
          requiresRilevanzaArt47: rule.matcher.requiresRilevanzaArt47 ?? null,
          matchArt47Letter: (rule.matcher.letteraArt47 ?? null) as never,
          requiresMorosita: rule.matcher.requiresMorosita ?? null,
          requiresPolizzaValida: rule.matcher.requiresPolizzaValida ?? null,
          outputSeverity: rule.outcome.outputSeverity,
          outcomeTitle: rule.outcome.outcomeTitle,
          outcomeSummary: rule.outcome.outcomeSummary,
          disclaimer: rule.outcome.disclaimer ?? null,
          humanReviewRequired: rule.outcome.humanReviewRequired,
        },
        select: { id: true, sourceId: true },
      });

      ruleByCode.set(rule.ruleCode, upsertedRule);
    }

    for (const relation of manifest.relations) {
      const fromSource = sourceByKey.get(relation.fromSourceKey);
      const toSource = sourceByKey.get(relation.toSourceKey);

      if (!fromSource || !toSource) {
        warnings.push(
          `Relazione saltata ${relation.fromSourceKey} -> ${relation.toSourceKey}: sourceKey non risolta.`,
        );
        continue;
      }

      await prisma.sourceRelation.upsert({
        where: {
          fromSourceId_toSourceId_relationType: {
            fromSourceId: fromSource.id,
            toSourceId: toSource.id,
            relationType: relation.relationType,
          },
        },
        create: {
          fromSourceId: fromSource.id,
          toSourceId: toSource.id,
          relationType: relation.relationType,
          note: relation.note ?? null,
        },
        update: {
          note: relation.note ?? null,
        },
      });
    }

    for (const gap of manifest.gaps) {
      const linkedRuleId = gap.linkedRuleCode ? (ruleByCode.get(gap.linkedRuleCode)?.id ?? null) : null;

      if (gap.linkedRuleCode && !linkedRuleId) {
        warnings.push(`Gap ${gap.gapKey} non collegato: ruleCode ${gap.linkedRuleCode} non trovata.`);
      }

      await prisma.documentGap.upsert({
        where: { gapKey: gap.gapKey },
        create: {
          gapKey: gap.gapKey,
          title: gap.title,
          description: gap.description,
          severity: gap.severity,
          status: gap.status,
          requiredDocumentTypes: gap.requiredDocumentTypes,
          notes: gap.notes ?? null,
          humanReviewRequired: true,
          enteId: ente.id,
          portId: port.id,
          ruleId: linkedRuleId,
        },
        update: {
          title: gap.title,
          description: gap.description,
          severity: gap.severity,
          status: gap.status,
          requiredDocumentTypes: gap.requiredDocumentTypes,
          notes: gap.notes ?? null,
          humanReviewRequired: true,
          enteId: ente.id,
          portId: port.id,
          ruleId: linkedRuleId,
        },
      });
    }

    const status = warnings.length > 0 ? "PARTIAL" : "SUCCESS";

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status,
        sourceCount: manifest.sources.length,
        ruleCount: manifest.rules.length,
        relationCount: manifest.relations.length,
        gapCount: manifest.gaps.length,
        warnings,
        finishedAt: new Date(),
      },
    });

    return {
      runId: run.id,
      status,
      warnings,
      sourceCount: manifest.sources.length,
      ruleCount: manifest.rules.length,
      relationCount: manifest.relations.length,
      gapCount: manifest.gaps.length,
    };
  } catch (error) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        warnings,
        errorMessage: error instanceof Error ? error.message : "Errore import sconosciuto.",
        finishedAt: new Date(),
      },
    });

    throw error;
  }
}
