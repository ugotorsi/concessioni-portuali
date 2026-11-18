import "dotenv/config";

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import {
  buildNormaCompatibilityPlan,
  parseNormaFamilyMappingPolicy,
  type ArtifactCandidate,
  type CanonicalFamilyCandidate,
  type LegacyNormaFonteInput,
} from "../../src/server/legal-sources/norma-compatibility-planner";

interface CommandOptions {
  help: boolean;
  outputPath: string | null;
  normaFonteCodice: string | null;
}

function parseArgs(argv: string[]): CommandOptions {
  const options: CommandOptions = { help: false, outputPath: null, normaFonteCodice: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--output" || argument === "--norma-codice") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error(`${argument} requires a non-empty value.`);
      }
      if (argument === "--output") {
        options.outputPath = value;
      } else {
        options.normaFonteCodice = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}.`);
  }
  return options;
}

function printHelp(): void {
  console.log("Usage: tsx scripts/db/plan-norma-compatibility.ts [--norma-codice <exact-code>] [--output <path>]");
  console.log("Produces a read-only compatibility plan. Database records are never changed.");
}

function repositoryCommitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const policyPath = path.resolve("data/legal-source-compatibility/norma-family-mappings.json");
  const policy = parseNormaFamilyMappingPolicy(JSON.parse(await fs.readFile(policyPath, "utf8")));
  const selectedRules = policy.rules.filter(
    (rule) => !options.normaFonteCodice || rule.normaFonteCodice === options.normaFonteCodice,
  );
  const sourceKeys = [...new Set(selectedRules.map((rule) => rule.target.sourceKey))];
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const normaRows = await prisma.normaFonte.findMany({
      where: options.normaFonteCodice ? { codice: options.normaFonteCodice } : undefined,
      select: {
        id: true,
        codice: true,
        titolo: true,
        enteEmittente: true,
        ambito: true,
        descrizione: true,
        legalSourceId: true,
        versioni: {
          select: {
            id: true,
            versione: true,
            stato: true,
            dataEntrataVigore: true,
            dataFineVigore: true,
            urlTesto: true,
            sintesi: true,
            note: true,
            legalSourceVersionId: true,
            legalSourceVersion: {
              select: {
                id: true,
                sourceFamilyId: true,
                observedSha256: true,
                observedSizeBytes: true,
                observedMimeType: true,
              },
            },
          },
          orderBy: [{ versione: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ codice: "asc" }, { id: "asc" }],
    });
    const existingBridgeIds = normaRows
      .map((row) => row.legalSourceId)
      .filter((id): id is string => id !== null);
    const familyRows = await prisma.legalSource.findMany({
      where: {
        OR: [
          ...(sourceKeys.length > 0 ? [{ sourceKey: { in: sourceKeys } }] : []),
          ...(existingBridgeIds.length > 0 ? [{ id: { in: existingBridgeIds } }] : []),
        ],
      },
      select: {
        id: true,
        sourceKey: true,
        title: true,
        sourceType: true,
        sourceNumber: true,
        sourceDate: true,
        issuingBody: true,
        resourceSemanticType: true,
      },
      orderBy: [{ sourceKey: "asc" }, { id: "asc" }],
    });

    const normaFonti: LegacyNormaFonteInput[] = normaRows.map((row) => ({
      ...row,
      versioni: row.versioni.map((versione) => {
        const artifactCandidate: ArtifactCandidate | null = versione.legalSourceVersion
          ? {
              ...versione.legalSourceVersion,
              provisionReference: null,
              provenanceReference: null,
            }
          : null;
        return {
          id: versione.id,
          versione: versione.versione,
          stato: versione.stato,
          dataEntrataVigore: versione.dataEntrataVigore.toISOString(),
          dataFineVigore: versione.dataFineVigore?.toISOString() ?? null,
          urlTesto: versione.urlTesto,
          sintesi: versione.sintesi,
          note: versione.note,
          legalSourceVersionId: versione.legalSourceVersionId,
          artifactCandidate,
        };
      }),
    }));
    const canonicalFamilies: CanonicalFamilyCandidate[] = familyRows.map((row) => ({
      ...row,
      sourceDate: row.sourceDate?.toISOString() ?? null,
    }));
    const report = buildNormaCompatibilityPlan({
      policy,
      normaFonti,
      canonicalFamilies,
      scope: { normaFonteCodice: options.normaFonteCodice },
      repositoryCommitSha: repositoryCommitSha(),
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.outputPath) {
      await fs.mkdir(path.dirname(path.resolve(options.outputPath)), { recursive: true });
      await fs.writeFile(path.resolve(options.outputPath), output, "utf8");
    } else {
      process.stdout.write(output);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown planning failure.");
  process.exitCode = 1;
});