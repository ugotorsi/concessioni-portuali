import "dotenv/config";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import type { Prisma } from "../../src/generated/prisma/client";
import {
  parseBlock2BCommandOptions,
  runReviewedFamilyBridge,
  verifyReviewedEvidence,
  type Block2BDatabase,
  type Block2BTransaction,
  type CanonicalChildCounts,
  type PlannerSnapshot,
  type ReviewedFamilyBridgeContract,
} from "../../src/server/legal-sources/norma-compatibility-applier";

export { parseBlock2BCommandOptions } from "../../src/server/legal-sources/norma-compatibility-applier";

const POLICY_PATH = "data/legal-source-compatibility/norma-family-mappings.json";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function makeTransaction(transaction: Prisma.TransactionClient): Block2BTransaction {
  return {
    async getDatabaseIdentity() {
      const rows = await transaction.$queryRaw<Array<{ database: string; user: string }>>`
        SELECT current_database() AS database, current_user AS user
      `;
      if (rows.length !== 1) throw new Error("Database identity query returned an unexpected row count.");
      return rows[0];
    },
    async getPlannerSnapshot(sourceKeys, scopeCode): Promise<PlannerSnapshot> {
      const normaRows = await transaction.normaFonte.findMany({
        where: scopeCode ? { codice: scopeCode } : undefined,
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
      const existingBridgeIds = normaRows.flatMap((row) => row.legalSourceId ? [row.legalSourceId] : []);
      const familyRows = await transaction.legalSource.findMany({
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
      return {
        normaFonti: normaRows.map((row) => ({
          ...row,
          versioni: row.versioni.map((versione) => ({
            id: versione.id,
            versione: versione.versione,
            stato: versione.stato,
            dataEntrataVigore: versione.dataEntrataVigore.toISOString(),
            dataFineVigore: versione.dataFineVigore?.toISOString() ?? null,
            urlTesto: versione.urlTesto,
            sintesi: versione.sintesi,
            note: versione.note,
            legalSourceVersionId: versione.legalSourceVersionId,
            artifactCandidate: versione.legalSourceVersion
              ? {
                  ...versione.legalSourceVersion,
                  provisionReference: null,
                  provenanceReference: null,
                }
              : null,
          })),
        })),
        canonicalFamilies: familyRows.map((row) => ({
          ...row,
          sourceDate: row.sourceDate?.toISOString() ?? null,
        })),
      };
    },
    findNormaFonte(id, codice) {
      return transaction.normaFonte.findMany({
        where: { id, codice },
        select: { id: true, codice: true, legalSourceId: true, updatedAt: true },
      });
    },
    findCanonicalLegalSource(id, sourceKey) {
      return transaction.$queryRaw<Array<{ id: string; sourceKey: string; canonicalPayload: string }>>`
        SELECT id, "sourceKey", (to_jsonb(ls) - ARRAY['id', 'createdAt', 'updatedAt'])::text AS "canonicalPayload"
        FROM "LegalSource" AS ls
        WHERE id = ${id} AND "sourceKey" = ${sourceKey}
      `;
    },
    countOtherFamilyBridges(targetNormaFonteId) {
      return transaction.normaFonte.count({
        where: { id: { not: targetNormaFonteId }, legalSourceId: { not: null } },
      });
    },
    findNormaFonteBridges(codici) {
      return transaction.normaFonte.findMany({
        where: { codice: { in: codici } },
        select: { codice: true, legalSourceId: true },
        orderBy: { codice: "asc" },
      });
    },
    async getCanonicalChildCounts(): Promise<CanonicalChildCounts> {
      const [legalExpressionVersion, legalSourceVersion, legalSourceAcquisition, legalSourceIdentityAssertion]
        = await Promise.all([
          transaction.legalExpressionVersion.count(),
          transaction.legalSourceVersion.count(),
          transaction.legalSourceAcquisition.count(),
          transaction.legalSourceIdentityAssertion.count(),
        ]);
      return { legalExpressionVersion, legalSourceVersion, legalSourceAcquisition, legalSourceIdentityAssertion };
    },
    async updateNormaFonteBridge(input) {
      const result = await transaction.normaFonte.updateMany({
        where: {
          id: input.id,
          codice: input.codice,
          legalSourceId: input.expectedCurrentLegalSourceId,
          updatedAt: input.expectedUpdatedAt,
        },
        data: { legalSourceId: input.targetLegalSourceId },
      });
      return result.count;
    },
  };
}

export interface PrismaTransactionRunner {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export function makeDatabase(prisma: PrismaTransactionRunner): Block2BDatabase {
  return {
    serializableTransaction: (operation) => prisma.$transaction(
      (transaction) => operation(makeTransaction(transaction)),
      { isolationLevel: "Serializable" },
    ),
  };
}

export async function main(): Promise<void> {
  const options = parseBlock2BCommandOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

  const reportBytes = readFileSync(path.resolve(options.reportPath));
  const contract = JSON.parse(
    readFileSync(path.resolve(options.contractPath), "utf8"),
  ) as ReviewedFamilyBridgeContract;
  const rawPolicy = JSON.parse(readFileSync(path.resolve(POLICY_PATH), "utf8"));
  const repositoryCommitSha = git("rev-parse", "HEAD");
  const policyHeadBlobOid = git("rev-parse", `HEAD:${POLICY_PATH}`);
  const policyWorktreeBlobOid = git("hash-object", "--", POLICY_PATH);
  const evidence = verifyReviewedEvidence({
    contract,
    reportBytes,
    rawPolicy,
    repository: { repositoryCommitSha, policyHeadBlobOid, policyWorktreeBlobOid },
  });

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const receipt = await runReviewedFamilyBridge({
      database: makeDatabase(prisma),
      evidence,
      apply: options.apply,
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

const directlyInvoked = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (directlyInvoked) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown Block 2B failure.");
    process.exitCode = 1;
  });
}
