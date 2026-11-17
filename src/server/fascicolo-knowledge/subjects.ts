import { randomUUID } from "node:crypto";

import type { KnowledgeSqlExecutor } from "./repository";
import {
  fascicoloSubjectCandidateSchema,
  fascicoloStrongIdentifierSchema,
  type FascicoloStrongIdentifier,
  type FascicoloSubjectCandidate,
} from "./structuredContracts";

export interface FascicoloSubjectRecord {
  id: string;
  tenantId: string;
  canonicalName: string;
  normalizedName: string;
  subjectType: FascicoloSubjectCandidate["subjectType"];
  strongIdentifiers: readonly FascicoloStrongIdentifier[];
  aliases: readonly string[];
  mergedIntoId: string | null;
  createdAt: Date;
}

export function normalizeSubjectName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeStrongIdentifier(identifier: FascicoloStrongIdentifier): FascicoloStrongIdentifier {
  const compact = identifier.value.normalize("NFKC").trim().replace(/\s+/g, "");
  return {
    type: identifier.type,
    value: identifier.type === "PEC" ? compact.toLowerCase() : compact.toUpperCase(),
  };
}

function identifierKey(identifier: FascicoloStrongIdentifier): string {
  const normalized = normalizeStrongIdentifier(identifier);
  return `${normalized.type}:${normalized.value}`;
}

function parsedIdentifiers(value: unknown): FascicoloStrongIdentifier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = fascicoloStrongIdentifierSchema.safeParse(item);
    return parsed.success ? [normalizeStrongIdentifier(parsed.data)] : [];
  });
}

function parsedAliases(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hydrate(row: Omit<FascicoloSubjectRecord, "strongIdentifiers" | "aliases"> & {
  strongIdentifiers: unknown;
  aliases: unknown;
}): FascicoloSubjectRecord {
  return { ...row, strongIdentifiers: parsedIdentifiers(row.strongIdentifiers), aliases: parsedAliases(row.aliases) };
}

function findMatch(existing: readonly FascicoloSubjectRecord[], candidate: FascicoloSubjectCandidate) {
  const normalizedName = normalizeSubjectName(candidate.canonicalName);
  return existing.find((subject) => subject.subjectType === candidate.subjectType
    && (subject.normalizedName === normalizedName
      || subject.aliases.some((alias) => normalizeSubjectName(alias) === normalizedName))) ?? null;
}

async function findStrongIdentifierMatch(
  tx: KnowledgeSqlExecutor,
  tenantId: string,
  identifiers: readonly FascicoloStrongIdentifier[],
): Promise<FascicoloSubjectRecord | null> {
  for (const identifier of identifiers) {
    const normalized = normalizeStrongIdentifier(identifier);
    const result = await tx.query<Omit<FascicoloSubjectRecord, "strongIdentifiers" | "aliases"> & {
      strongIdentifiers: unknown;
      aliases: unknown;
    }>(`
      SELECT s.* FROM "FascicoloSubjectIdentifier" i
      INNER JOIN "FascicoloSubject" s
        ON s."id" = i."subjectId" AND s."tenantId" = i."tenantId"
      WHERE i."tenantId" = $1 AND i."identifierType" = $2 AND i."normalizedValue" = $3
        AND s."mergedIntoId" IS NULL
    `, [tenantId, normalized.type, normalized.value]);
    if (result.rows[0]) return hydrate(result.rows[0]);
  }
  return null;
}

export async function resolveFascicoloSubjects(input: {
  tenantId: string;
  candidates: readonly FascicoloSubjectCandidate[];
}, tx: KnowledgeSqlExecutor, id: () => string = randomUUID): Promise<ReadonlyMap<string, FascicoloSubjectRecord>> {
  const tenant = await tx.query<{ id: string }>(`SELECT "id" FROM "Ente" WHERE "id" = $1`, [input.tenantId]);
  if (tenant.rows.length !== 1) throw new Error("SUBJECT_TENANT_NOT_FOUND");
  const rows = await tx.query<Omit<FascicoloSubjectRecord, "strongIdentifiers" | "aliases"> & {
    strongIdentifiers: unknown;
    aliases: unknown;
  }>(`
    SELECT * FROM "FascicoloSubject"
    WHERE "tenantId" = $1 AND "mergedIntoId" IS NULL
    ORDER BY "createdAt", "id"
    FOR UPDATE
  `, [input.tenantId]);
  const existing = rows.rows.map(hydrate);
  const resolved = new Map<string, FascicoloSubjectRecord>();
  for (const rawCandidate of input.candidates) {
    const candidate = fascicoloSubjectCandidateSchema.parse(rawCandidate);
    const strongIdentifiers = candidate.strongIdentifiers.map(normalizeStrongIdentifier)
      .sort((left, right) => identifierKey(left).localeCompare(identifierKey(right)));
    const match = strongIdentifiers.length > 0
      ? await findStrongIdentifierMatch(tx, input.tenantId, strongIdentifiers)
      : findMatch(existing, candidate);
    if (match) {
      resolved.set(candidate.localId, match);
      continue;
    }
    const subjectId = id();
    const aliases = [...new Set(candidate.aliases.map((alias) => alias.normalize("NFKC").trim()).filter(Boolean))].sort();
    const inserted = await tx.query<Omit<FascicoloSubjectRecord, "strongIdentifiers" | "aliases"> & {
      strongIdentifiers: unknown;
      aliases: unknown;
    }>(`
      INSERT INTO "FascicoloSubject" (
        "id", "tenantId", "canonicalName", "normalizedName", "subjectType", "strongIdentifiers", "aliases"
      ) VALUES ($1, $2, $3, $4, $5::"FascicoloSubjectType", $6::jsonb, $7::jsonb)
      RETURNING *
    `, [subjectId, input.tenantId, candidate.canonicalName, normalizeSubjectName(candidate.canonicalName),
      candidate.subjectType, JSON.stringify(strongIdentifiers), JSON.stringify(aliases)]);
    const subject = hydrate(inserted.rows[0]);
    let identifierConflict: FascicoloStrongIdentifier | null = null;
    for (const identifier of strongIdentifiers) {
      const identifierInsert = await tx.query<{ subjectId: string }>(`
        INSERT INTO "FascicoloSubjectIdentifier" (
          "id", "tenantId", "subjectId", "identifierType", "normalizedValue"
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("tenantId", "identifierType", "normalizedValue") DO NOTHING
        RETURNING "subjectId"
      `, [id(), input.tenantId, subjectId, identifier.type, identifier.value]);
      if (identifierInsert.rows.length === 0) {
        identifierConflict = identifier;
        break;
      }
    }
    if (identifierConflict) {
      await tx.query(`DELETE FROM "FascicoloSubject" WHERE "id" = $1 AND "tenantId" = $2`, [subjectId, input.tenantId]);
      const canonical = await findStrongIdentifierMatch(tx, input.tenantId, [identifierConflict]);
      if (!canonical) throw new Error("SUBJECT_IDENTIFIER_CONFLICT");
      resolved.set(candidate.localId, canonical);
      continue;
    }
    existing.push(subject);
    resolved.set(candidate.localId, subject);
  }
  return resolved;
}