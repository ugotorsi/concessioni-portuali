import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { legalRulePackManifestSchema, type LegalRulePackManifest } from "@/server/legal-rules/manifest";

interface EntityCounters {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ImportSummary {
  authorities: EntityCounters;
  ports: EntityCounters;
  sources: EntityCounters;
  rules: EntityCounters;
  relations: EntityCounters;
  gaps: EntityCounters;
}

export interface ImportLegalRulePackResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  warnings: string[];
  sourceCount: number;
  ruleCount: number;
  relationCount: number;
  gapCount: number;
  summary: ImportSummary;
}

function emptyCounters(): EntityCounters {
  return { inserted: 0, updated: 0, skipped: 0, errors: 0 };
}

function buildEmptySummary(): ImportSummary {
  return {
    authorities: emptyCounters(),
    ports: emptyCounters(),
    sources: emptyCounters(),
    rules: emptyCounters(),
    relations: emptyCounters(),
    gaps: emptyCounters(),
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
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

function mapDocumentTypeToSourceType(documentType: string):
  | "LEGGE"
  | "DECRETO"
  | "REGOLAMENTO"
  | "DELIBERA"
  | "ORDINANZA"
  | "PIANO"
  | "PARERE"
  | "TARIFFA"
  | "PLANIMETRIA"
  | "ALTRO" {
  switch (documentType) {
    case "LAW":
      return "LEGGE";
    case "DECREE":
      return "DECRETO";
    case "AUTHORITY_REGULATION":
      return "REGOLAMENTO";
    case "ORDINANCE":
      return "ORDINANZA";
    case "TARIFF":
      return "TARIFFA";
    case "PLANNING_INSTRUMENT":
      return "PIANO";
    case "ART_OPINION":
      return "PARERE";
    case "SUPPORTING_MAP":
      return "PLANIMETRIA";
    default:
      return "ALTRO";
  }
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
  const contentWithoutBom = content.replace(/^\uFEFF/, "");
  const raw = JSON.parse(contentWithoutBom) as unknown;
  return legalRulePackManifestSchema.parse(raw);
}

function toSafeManifestPath(manifestPath: string): string {
  const normalized = path.normalize(manifestPath);
  const relative = path.relative(process.cwd(), normalized).replace(/\\/g, "/");
  if (relative.startsWith("..")) {
    return path.basename(normalized);
  }

  return relative;
}

export async function importLegalRulePack(manifestPath: string): Promise<ImportLegalRulePackResult> {
  const manifest = await loadManifest(manifestPath);
  const warnings: string[] = [];
  const summary = buildEmptySummary();
  const normalizedManifestPath = path.normalize(manifestPath);
  const safeManifestPath = toSafeManifestPath(normalizedManifestPath);
  const baseDir = path.dirname(normalizedManifestPath);

  const ente = await prisma.ente.findUnique({
    where: { codice: manifest.tenantEnteCode },
    select: { id: true },
  });

  if (!ente) {
    throw new Error(`Tenant ente with code ${manifest.tenantEnteCode} not found.`);
  }

  const run = await prisma.importRun.create({
    data: {
      packCode: manifest.packCode,
      packVersion: manifest.packVersion,
      manifestPath: safeManifestPath,
      status: "IN_PROGRESS",
      enteId: ente.id,
      authorityId: null,
      portId: null,
      warnings: [],
    },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const authorityByKey = new Map<string, { id: string; code: string }>();
      const portByKey = new Map<string, { id: string; code: string; authorityId: string | null }>();

      for (const authority of manifest.authorities) {
        const existing = await tx.authority.findUnique({
          where: { code: authority.code },
          select: { id: true, name: true, level: true, code: true },
        });

        if (!existing) {
          const created = await tx.authority.create({
            data: {
              code: authority.code,
              name: authority.name,
              level: authority.level,
            },
            select: { id: true, code: true },
          });
          summary.authorities.inserted += 1;
          authorityByKey.set(authority.authorityKey, created);
          continue;
        }

        const hasChanges = existing.name !== authority.name || existing.level !== authority.level;
        if (hasChanges) {
          await tx.authority.update({
            where: { id: existing.id },
            data: { name: authority.name, level: authority.level },
          });
          summary.authorities.updated += 1;
        } else {
          summary.authorities.skipped += 1;
        }

        authorityByKey.set(authority.authorityKey, { id: existing.id, code: existing.code });
      }

      for (const port of manifest.ports) {
        const authority = authorityByKey.get(port.authorityKey);
        if (!authority) {
          summary.ports.errors += 1;
          throw new Error(`Port ${port.portKey} references missing authority ${port.authorityKey}.`);
        }

        const existing = await tx.port.findUnique({
          where: { code: port.code },
          select: { id: true, name: true, enteId: true, authorityId: true, code: true },
        });

        if (!existing) {
          const created = await tx.port.create({
            data: {
              code: port.code,
              name: port.name,
              enteId: ente.id,
              authorityId: authority.id,
            },
            select: { id: true, code: true, authorityId: true },
          });
          summary.ports.inserted += 1;
          portByKey.set(port.portKey, created);
          continue;
        }

        const hasChanges = existing.name !== port.name || existing.enteId !== ente.id || existing.authorityId !== authority.id;
        if (hasChanges) {
          await tx.port.update({
            where: { id: existing.id },
            data: {
              name: port.name,
              enteId: ente.id,
              authorityId: authority.id,
            },
          });
          summary.ports.updated += 1;
        } else {
          summary.ports.skipped += 1;
        }

        portByKey.set(port.portKey, { id: existing.id, code: existing.code, authorityId: authority.id });
      }

      for (const area of manifest.portAreas) {
        const port = portByKey.get(area.portKey);
        if (!port) {
          throw new Error(`Port area ${area.portAreaKey} references missing port ${area.portKey}.`);
        }

        await tx.portArea.upsert({
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

      const duplicateByTarget = new Map<string, string>();
      for (const duplicate of manifest.duplicates) {
        duplicateByTarget.set(duplicate.duplicateOfStableKey, duplicate.duplicateFilename);
      }

      const sourceByStableKey = new Map<string, { id: string }>();

      for (const source of manifest.sources) {
        const authority = authorityByKey.get(source.authorityKey);
        const primaryPort = portByKey.get(source.portKeys[0]!);

        if (!authority || !primaryPort) {
          summary.sources.errors += 1;
          throw new Error(`Source ${source.stableKey} references unknown authority/port.`);
        }

        const candidatePath = path.resolve(baseDir, source.relativePath);
        const fileMetadata = await tryReadFileMetadata(candidatePath);
        if (!fileMetadata) {
          warnings.push(`File missing for source ${source.stableKey}: ${source.relativePath}`);
        } else {
          if (fileMetadata.checksumSha256 !== source.checksum) {
            warnings.push(`Checksum mismatch for source ${source.stableKey}: manifest value preserved.`);
          }
          if (fileMetadata.sizeBytes !== source.size) {
            warnings.push(`Size mismatch for source ${source.stableKey}: manifest value preserved.`);
          }
        }

        const payload = {
          sourceKey: source.stableKey,
          title: source.title,
          sourceType: mapDocumentTypeToSourceType(source.documentType),
          status: source.status,
          role: source.role,
          legalRank: source.legalRank,
          territorialScope: source.territorialScope,
          confidence: source.confidence,
          issuingBody: source.issuingBody,
          sourceNumber: source.sourceNumber ?? null,
          sourceDate: source.sourceDate ? new Date(source.sourceDate) : null,
          sourceOrigin: source.sourceOrigin,
          portAreaCode: source.portAreaKey ?? null,
          tags: source.tags,
          humanReviewRequired: true,
          isConformative: source.isConformative,
          isExtractable: source.isExtractable,
          duplicateOfSourceKey: null,
          publicationDate: source.sourceDate ? new Date(source.sourceDate) : null,
          effectiveFrom: source.effectiveFrom ? new Date(source.effectiveFrom) : null,
          effectiveTo: source.effectiveTo ? new Date(source.effectiveTo) : null,
          notes: source.notes ?? null,
          fileName: source.filename,
          filePath: source.relativePath,
          fileChecksumSha256: source.checksum,
          fileMimeType: inferMimeType(source.filename),
          fileSizeBytes: source.size,
          enteId: ente.id,
          authorityId: authority.id,
          portId: primaryPort.id,
          importRunId: run.id,
        };

        const existing = await tx.legalSource.findUnique({
          where: { sourceKey: source.stableKey },
          select: {
            id: true,
            sourceKey: true,
            title: true,
            sourceType: true,
            status: true,
            role: true,
            legalRank: true,
            territorialScope: true,
            confidence: true,
            issuingBody: true,
            sourceNumber: true,
            sourceDate: true,
            sourceOrigin: true,
            portAreaCode: true,
            tags: true,
            humanReviewRequired: true,
            isConformative: true,
            isExtractable: true,
            duplicateOfSourceKey: true,
            publicationDate: true,
            effectiveFrom: true,
            effectiveTo: true,
            notes: true,
            fileName: true,
            filePath: true,
            fileChecksumSha256: true,
            fileMimeType: true,
            fileSizeBytes: true,
            enteId: true,
            authorityId: true,
            portId: true,
            importRunId: true,
          },
        });

        if (!existing) {
          const created = await tx.legalSource.create({
            data: payload,
            select: { id: true },
          });
          summary.sources.inserted += 1;
          sourceByStableKey.set(source.stableKey, created);
          continue;
        }

        const existingComparable = {
          ...existing,
          sourceDate: existing.sourceDate?.toISOString() ?? null,
          publicationDate: existing.publicationDate?.toISOString() ?? null,
          effectiveFrom: existing.effectiveFrom?.toISOString() ?? null,
          effectiveTo: existing.effectiveTo?.toISOString() ?? null,
        };
        const payloadComparable = {
          ...payload,
          sourceDate: payload.sourceDate?.toISOString() ?? null,
          publicationDate: payload.publicationDate?.toISOString() ?? null,
          effectiveFrom: payload.effectiveFrom?.toISOString() ?? null,
          effectiveTo: payload.effectiveTo?.toISOString() ?? null,
        };

        if (stableStringify(existingComparable) === stableStringify(payloadComparable)) {
          summary.sources.skipped += 1;
        } else {
          await tx.legalSource.update({
            where: { id: existing.id },
            data: payload,
          });
          summary.sources.updated += 1;
        }

        sourceByStableKey.set(source.stableKey, { id: existing.id });
      }

      if (duplicateByTarget.size > 0) {
        for (const [targetStableKey, duplicateFileName] of duplicateByTarget.entries()) {
          const target = sourceByStableKey.get(targetStableKey);
          if (!target) {
            continue;
          }
          await tx.legalSource.update({
            where: { id: target.id },
            data: {
              notes: `Duplicate local file excluded: ${duplicateFileName}`,
            },
          });
        }
      }

      const ruleById = new Map<string, { id: string }>();
      for (const rule of manifest.rules) {
        const source = sourceByStableKey.get(rule.sourceStableKey);
        if (!source) {
          summary.rules.errors += 1;
          throw new Error(`Rule ${rule.ruleId} references missing source ${rule.sourceStableKey}.`);
        }

        const payload = {
          sourceId: source.id,
          ruleCode: rule.ruleId,
          title: rule.title,
          summary: rule.summary,
          category: rule.category,
          status: rule.status,
          priority: rule.priority,
          enteId: ente.id,
          portId: null,
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
          humanReviewRequired: true,
        };

        const existing = await tx.legalRule.findUnique({
          where: {
            sourceId_ruleCode: {
              sourceId: source.id,
              ruleCode: rule.ruleId,
            },
          },
          select: {
            id: true,
            title: true,
            summary: true,
            category: true,
            status: true,
            priority: true,
            enteId: true,
            portId: true,
            matchConcessionVertical: true,
            matchObjectType: true,
            matchAttivita: true,
            matchAwardingProcedure: true,
            matchFeeRegime: true,
            matchComparativeStatus: true,
            requiresRilevanzaArt47: true,
            matchArt47Letter: true,
            requiresMorosita: true,
            requiresPolizzaValida: true,
            outputSeverity: true,
            outcomeTitle: true,
            outcomeSummary: true,
            disclaimer: true,
            humanReviewRequired: true,
          },
        });

        if (!existing) {
          const created = await tx.legalRule.create({
            data: payload,
            select: { id: true },
          });
          summary.rules.inserted += 1;
          ruleById.set(rule.ruleId, created);
          continue;
        }

        if (stableStringify(existing) === stableStringify(payload)) {
          summary.rules.skipped += 1;
        } else {
          await tx.legalRule.update({ where: { id: existing.id }, data: payload });
          summary.rules.updated += 1;
        }

        ruleById.set(rule.ruleId, { id: existing.id });
      }

      for (const relation of manifest.relations) {
        const fromSource = sourceByStableKey.get(relation.fromSourceStableKey);
        const toSource = sourceByStableKey.get(relation.toSourceStableKey);

        if (!fromSource || !toSource) {
          summary.relations.errors += 1;
          warnings.push(`Skipped relation ${relation.relationId}: dangling source reference.`);
          continue;
        }

        const existing = await tx.sourceRelation.findUnique({
          where: {
            fromSourceId_toSourceId_relationType: {
              fromSourceId: fromSource.id,
              toSourceId: toSource.id,
              relationType: relation.relationType,
            },
          },
          select: { id: true, note: true },
        });

        if (!existing) {
          await tx.sourceRelation.create({
            data: {
              fromSourceId: fromSource.id,
              toSourceId: toSource.id,
              relationType: relation.relationType,
              note: relation.note ?? relation.relationId,
            },
          });
          summary.relations.inserted += 1;
          continue;
        }

        const desiredNote = relation.note ?? relation.relationId;
        if (existing.note === desiredNote) {
          summary.relations.skipped += 1;
        } else {
          await tx.sourceRelation.update({
            where: { id: existing.id },
            data: { note: desiredNote },
          });
          summary.relations.updated += 1;
        }
      }

      for (const gap of manifest.gaps) {
        const linkedRule = gap.linkedRuleCode ? ruleById.get(gap.linkedRuleCode) : null;
        if (gap.linkedRuleCode && !linkedRule) {
          summary.gaps.errors += 1;
          warnings.push(`Gap ${gap.gapKey} references missing rule ${gap.linkedRuleCode}.`);
        }

        const payload = {
          gapKey: gap.gapKey,
          title: gap.title,
          description: gap.description,
          severity: gap.severity,
          status: gap.status,
          requiredDocumentTypes: gap.requiredDocumentTypes,
          notes: gap.notes ?? null,
          humanReviewRequired: true,
          enteId: ente.id,
          portId: null,
          ruleId: linkedRule?.id ?? null,
        };

        const existing = await tx.documentGap.findUnique({
          where: { gapKey: gap.gapKey },
          select: {
            id: true,
            title: true,
            description: true,
            severity: true,
            status: true,
            requiredDocumentTypes: true,
            notes: true,
            humanReviewRequired: true,
            enteId: true,
            portId: true,
            ruleId: true,
          },
        });

        if (!existing) {
          await tx.documentGap.create({ data: payload });
          summary.gaps.inserted += 1;
          continue;
        }

        if (stableStringify(existing) === stableStringify(payload)) {
          summary.gaps.skipped += 1;
        } else {
          await tx.documentGap.update({ where: { id: existing.id }, data: payload });
          summary.gaps.updated += 1;
        }
      }

      const hasErrors = Object.values(summary).some((counter) => counter.errors > 0);
      const status = hasErrors ? "FAILED" : "SUCCESS";

      await tx.importRun.update({
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

      return status;
    });

    return {
      runId: run.id,
      status: result,
      warnings,
      sourceCount: manifest.sources.length,
      ruleCount: manifest.rules.length,
      relationCount: manifest.relations.length,
      gapCount: manifest.gaps.length,
      summary,
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
