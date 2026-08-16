import { createHash } from "node:crypto";

import { AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION } from "@/server/ai/fascicoloSnapshotContract";
import type { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot";

export const AI_FASCICOLO_OUTBOUND_V1_SCHEMA_VERSION = "ai-fascicolo-outbound/v1" as const;
export const AI_FASCICOLO_OUTBOUND_HASH_ALGORITHM = "sha256" as const;

const MAX_INTERNAL_ID_LENGTH = 1024;

type AiFascicoloSnapshotV1 = Awaited<ReturnType<typeof buildAiFascicoloSnapshotV1>>;

type ProjectionErrorCode =
  | "INVALID_SOURCE_SNAPSHOT"
  | "OUTBOUND_PROJECTION_INCONSISTENCY"
  | "OUTBOUND_FIELD_TOO_LARGE";

export class AiFascicoloOutboundProjectionError extends Error {
  constructor(readonly code: ProjectionErrorCode) {
    super(code);
    this.name = "AiFascicoloOutboundProjectionError";
  }
}

export type AiFascicoloOutboundAliasKind =
  | "PROCEDIMENTO"
  | "ENTE"
  | "CONCESSIONE"
  | "CONCESSIONARIO"
  | "RESPONSIBILITY_ASSIGNMENT"
  | "REQUIREMENT"
  | "EVIDENCE"
  | "HUMAN_REVIEW"
  | "CHECKLIST_EVIDENCE"
  | "OBSERVATION"
  | "DOCUMENT"
  | "ISSUE"
  | "PAYMENT"
  | "DEADLINE"
  | "INSPECTION"
  | "FINAL_ACT";

export interface AiFascicoloOutboundAliasMappingEntry {
  readonly alias: string;
  readonly kind: AiFascicoloOutboundAliasKind;
  readonly canonicalId: string;
}

export interface AiFascicoloOutboundProjectionV1 {
  readonly schemaVersion: typeof AI_FASCICOLO_OUTBOUND_V1_SCHEMA_VERSION;
  readonly content: {
    readonly identityContext: {
      readonly procedimentoAlias: "PROCEDIMENTO_A";
      readonly enteAlias: "ENTE_A";
    };
    readonly procedimento: {
      readonly alias: "PROCEDIMENTO_A";
      readonly dataAvvio: string | null;
      readonly dataScadenzaContraddittorio: string | null;
      readonly dataProvvedimentoFinale: string | null;
      readonly responsabileAssegnatoAt: string | null;
      readonly comunicazioneAvvioInviata: boolean;
      readonly dataComunicazioneAvvio: string | null;
      readonly termineMemorieGiorni: number | null;
      readonly termineMemorieScadenza: string | null;
      readonly memorieRicevute: boolean;
      readonly dataRicezioneMemorie: string | null;
      readonly audizioneRichiesta: boolean;
      readonly audizioneSvolta: boolean;
      readonly dataAudizione: string | null;
      readonly sopralluogoIstruttorioSvolto: boolean;
      readonly contestazioneFormaleInviata: boolean;
      readonly dataContestazioneFormale: string | null;
      readonly controdeduzioniValutate: boolean;
      readonly preavvisoRigettoApplicabile: boolean;
      readonly dataPreavvisoRigetto: string | null;
      readonly termineOsservazioniPreavviso: string | null;
      readonly osservazioniPreavvisoRicevute: boolean;
      readonly dataOsservazioniPreavviso: string | null;
      readonly responsibilityAssignments: readonly {
        readonly alias: string;
        readonly functionalRole: "RESPONSABILE_PROCEDIMENTO";
        readonly organizationalUnit: "UNIT_A";
        readonly decorrenza: string;
        readonly cessazione: string | null;
        readonly comunicataAt: string | null;
      }[];
    };
    readonly concessione: {
      readonly alias: "TITOLO_A";
      readonly dataRilascio: string;
      readonly dataScadenza: string;
    };
    readonly concessionario: {
      readonly alias: "CONCESSIONARIO_A";
    };
    readonly requirements: readonly {
      readonly alias: string;
      readonly createdAt: string;
      readonly reviewedAt: string | null;
    }[];
    readonly evidence: readonly {
      readonly alias: string;
      readonly requirementAlias: string;
      readonly documentAlias: string;
      readonly createdAt: string;
      readonly revokedAt: string | null;
    }[];
    readonly humanReview: readonly {
      readonly alias: string;
      readonly evidenceAlias: string;
      readonly createdAt: string;
    }[];
    readonly checklist: {
      readonly complete: boolean;
      readonly completedItems: number;
      readonly totalItems: number;
      readonly percentage: number;
      readonly evidence: readonly {
        readonly alias: string;
        readonly documentAlias: string;
        readonly createdAt: string;
        readonly reviewedAt: string | null;
      }[];
    };
    readonly observations: readonly {
      readonly alias: string;
      readonly documentAlias: string;
      readonly detectedAt: string;
      readonly reviewedAt: string | null;
      readonly currentConditionDetected: boolean;
    }[];
    readonly documents: readonly {
      readonly alias: string;
      readonly dataDocumento: string | null;
    }[];
    readonly criticita: {
      readonly coverage: "SELECTED";
      readonly items: readonly {
        readonly alias: string;
        readonly dataRilevazione: string;
        readonly rilevanzaArt47: boolean | null;
      }[];
    };
    readonly pagamenti: {
      readonly coverage: "SELECTED";
      readonly items: readonly {
        readonly alias: string;
        readonly annoRiferimento: number;
        readonly dataScadenza: string;
      }[];
    };
    readonly scadenze: {
      readonly coverage: "SELECTED";
      readonly items: readonly {
        readonly alias: string;
        readonly dataScadenza: string;
      }[];
    };
    readonly sopralluoghi: {
      readonly coverage: "SELECTED";
      readonly items: readonly {
        readonly alias: string;
        readonly data: string;
        readonly conformitaPlanimetrica: boolean | null;
      }[];
    };
    readonly finalActContext: {
      readonly alias: "FINAL_ACT_A";
      readonly contextOnly: true;
      readonly dataAtto: string;
      readonly dataEfficacia: string;
      readonly effettoApplicatoAt: string | null;
      readonly documentAlias: string | null;
    } | null;
  };
}

export interface AiFascicoloOutboundProjectionResultV1 {
  readonly providerBound: {
    readonly outboundProjection: AiFascicoloOutboundProjectionV1;
    readonly outboundProjectionHash: string;
    readonly outboundProjectionHashAlgorithm: typeof AI_FASCICOLO_OUTBOUND_HASH_ALGORITHM;
  };
  readonly localOnly: {
    readonly sourceSnapshotContentHash: string;
    readonly localAliasMapping: readonly AiFascicoloOutboundAliasMappingEntry[];
  };
}

function fail(code: ProjectionErrorCode): never {
  throw new AiFascicoloOutboundProjectionError(code);
}

function normalizeTechnicalString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }
  const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC");
  if (normalized.length === 0) {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }
  if (normalized.length > maxLength) {
    return fail("OUTBOUND_FIELD_TOO_LARGE");
  }
  return normalized;
}

function normalizeDate(value: unknown): string {
  const normalized = normalizeTechnicalString(value, 64);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }
  return normalized;
}

function normalizeNullableDate(value: unknown): string | null {
  return value === null ? null : normalizeDate(value);
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail("INVALID_SOURCE_SNAPSHOT");
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null ? null : requiredBoolean(value);
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail("INVALID_SOURCE_SNAPSHOT");
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : fail("INVALID_SOURCE_SNAPSHOT");
}

function nullableSafeInteger(value: unknown): number | null {
  return value === null ? null : safeInteger(value);
}

function canonicalId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INTERNAL_ID_LENGTH) {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedByCanonicalId<T extends { readonly id: unknown }>(values: unknown): readonly T[] {
  if (!Array.isArray(values)) {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }
  const sorted = [...values] as T[];
  sorted.sort((left, right) => compareText(canonicalId(left.id), canonicalId(right.id)));
  for (let index = 0; index < sorted.length; index += 1) {
    const id = canonicalId(sorted[index].id);
    if (index > 0 && id === canonicalId(sorted[index - 1].id)) {
      return fail("OUTBOUND_PROJECTION_INCONSISTENCY");
    }
  }
  return sorted;
}

function aliasMap<T extends { readonly id: unknown }>(
  values: readonly T[],
  prefix: string,
): ReadonlyMap<string, string> {
  return new Map(values.map((value, index) => [canonicalId(value.id), `${prefix}_${index + 1}`]));
}

function resolveAlias(mapping: ReadonlyMap<string, string>, id: unknown): string {
  const alias = mapping.get(canonicalId(id));
  return alias ?? fail("OUTBOUND_PROJECTION_INCONSISTENCY");
}

function resolveNullableAlias(mapping: ReadonlyMap<string, string>, id: unknown): string | null {
  return id === null ? null : resolveAlias(mapping, id);
}

function requireSelected(value: unknown): "SELECTED" {
  return value === "SELECTED" ? value : fail("INVALID_SOURCE_SNAPSHOT");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : fail("INVALID_SOURCE_SNAPSHOT");
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as { readonly [key: string]: unknown };
    return `{${Object.keys(object)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
      .join(",")}}`;
  }
  return fail("INVALID_SOURCE_SNAPSHOT");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

function addMapping(
  target: AiFascicoloOutboundAliasMappingEntry[],
  aliases: Set<string>,
  alias: string,
  kind: AiFascicoloOutboundAliasKind,
  id: unknown,
): void {
  if (aliases.has(alias)) {
    fail("OUTBOUND_PROJECTION_INCONSISTENCY");
  }
  aliases.add(alias);
  target.push({ alias, kind, canonicalId: canonicalId(id) });
}

function buildAiFascicoloOutboundV1(
  snapshot: AiFascicoloSnapshotV1,
): AiFascicoloOutboundProjectionResultV1 {
  if (
    !snapshot
    || typeof snapshot !== "object"
    || snapshot.metadata?.schemaVersion !== AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION
    || !snapshot.content
  ) {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }

  const sourceSnapshotContentHash = normalizeTechnicalString(snapshot.metadata.contentHash, 128);
  if (!/^[a-f0-9]{64}$/.test(sourceSnapshotContentHash)) {
    return fail("INVALID_SOURCE_SNAPSHOT");
  }

  const source = snapshot.content;
  const procedimentoId = canonicalId(source.identityContext.procedimentoId);
  if (procedimentoId !== canonicalId(source.procedimento.id)) {
    return fail("OUTBOUND_PROJECTION_INCONSISTENCY");
  }

  const assignments = sortedByCanonicalId<typeof source.procedimento.responsibilityAssignments[number]>(
    source.procedimento.responsibilityAssignments,
  );
  const requirements = sortedByCanonicalId<typeof source.requirements[number]>(source.requirements);
  const evidence = sortedByCanonicalId<typeof source.evidence[number]>(source.evidence);
  const humanReviews = sortedByCanonicalId<typeof source.humanReviewReceipts[number]>(source.humanReviewReceipts);
  const checklistEvidence = sortedByCanonicalId<typeof source.checklist.evidence[number]>(source.checklist.evidence);
  const observations = sortedByCanonicalId<typeof source.fascicoloObservations[number]>(source.fascicoloObservations);
  const documents = sortedByCanonicalId<typeof source.documents[number]>(source.documents);
  const issues = sortedByCanonicalId<typeof source.criticita.items[number]>(source.criticita.items);
  const payments = sortedByCanonicalId<typeof source.pagamenti.items[number]>(source.pagamenti.items);
  const deadlines = sortedByCanonicalId<typeof source.scadenze.items[number]>(source.scadenze.items);
  const inspections = sortedByCanonicalId<typeof source.sopralluoghi.items[number]>(source.sopralluoghi.items);

  const assignmentAliases = aliasMap(assignments, "ASSIGNMENT");
  const requirementAliases = aliasMap(requirements, "REQ");
  const evidenceAliases = aliasMap(evidence, "EVID");
  const humanReviewAliases = aliasMap(humanReviews, "REVIEW");
  const checklistEvidenceAliases = aliasMap(checklistEvidence, "CHECK_EVID");
  const observationAliases = aliasMap(observations, "OBS");
  const documentAliases = aliasMap(documents, "DOC");
  const issueAliases = aliasMap(issues, "ISSUE");
  const paymentAliases = aliasMap(payments, "PAYMENT");
  const deadlineAliases = aliasMap(deadlines, "DEADLINE");
  const inspectionAliases = aliasMap(inspections, "INSPECTION");

  const mapping: AiFascicoloOutboundAliasMappingEntry[] = [];
  const usedAliases = new Set<string>();
  addMapping(mapping, usedAliases, "PROCEDIMENTO_A", "PROCEDIMENTO", procedimentoId);
  addMapping(mapping, usedAliases, "ENTE_A", "ENTE", source.identityContext.canonicalEnteId);
  addMapping(mapping, usedAliases, "TITOLO_A", "CONCESSIONE", source.concessione.id);
  addMapping(mapping, usedAliases, "CONCESSIONARIO_A", "CONCESSIONARIO", source.concessionario.id);
  for (const item of assignments) {
    addMapping(mapping, usedAliases, resolveAlias(assignmentAliases, item.id), "RESPONSIBILITY_ASSIGNMENT", item.id);
  }
  for (const item of requirements) {
    addMapping(mapping, usedAliases, resolveAlias(requirementAliases, item.id), "REQUIREMENT", item.id);
  }
  for (const item of evidence) {
    addMapping(mapping, usedAliases, resolveAlias(evidenceAliases, item.id), "EVIDENCE", item.id);
  }
  for (const item of humanReviews) {
    addMapping(mapping, usedAliases, resolveAlias(humanReviewAliases, item.id), "HUMAN_REVIEW", item.id);
  }
  for (const item of checklistEvidence) {
    addMapping(mapping, usedAliases, resolveAlias(checklistEvidenceAliases, item.id), "CHECKLIST_EVIDENCE", item.id);
  }
  for (const item of observations) {
    addMapping(mapping, usedAliases, resolveAlias(observationAliases, item.id), "OBSERVATION", item.id);
  }
  for (const item of documents) {
    addMapping(mapping, usedAliases, resolveAlias(documentAliases, item.id), "DOCUMENT", item.id);
  }
  for (const item of issues) {
    addMapping(mapping, usedAliases, resolveAlias(issueAliases, item.id), "ISSUE", item.id);
  }
  for (const item of payments) {
    addMapping(mapping, usedAliases, resolveAlias(paymentAliases, item.id), "PAYMENT", item.id);
  }
  for (const item of deadlines) {
    addMapping(mapping, usedAliases, resolveAlias(deadlineAliases, item.id), "DEADLINE", item.id);
  }
  for (const item of inspections) {
    addMapping(mapping, usedAliases, resolveAlias(inspectionAliases, item.id), "INSPECTION", item.id);
  }
  if (source.finalActContext !== null) {
    addMapping(mapping, usedAliases, "FINAL_ACT_A", "FINAL_ACT", source.finalActContext.id);
  }

  const outboundProjection: AiFascicoloOutboundProjectionV1 = {
    schemaVersion: AI_FASCICOLO_OUTBOUND_V1_SCHEMA_VERSION,
    content: {
      identityContext: {
        procedimentoAlias: "PROCEDIMENTO_A",
        enteAlias: "ENTE_A",
      },
      procedimento: {
        alias: "PROCEDIMENTO_A",
        dataAvvio: normalizeNullableDate(source.procedimento.dataAvvio),
        dataScadenzaContraddittorio: normalizeNullableDate(source.procedimento.dataScadenzaContraddittorio),
        dataProvvedimentoFinale: normalizeNullableDate(source.procedimento.dataProvvedimentoFinale),
        responsabileAssegnatoAt: normalizeNullableDate(source.procedimento.responsabileAssegnatoAt),
        comunicazioneAvvioInviata: requiredBoolean(source.procedimento.comunicazioneAvvioInviata),
        dataComunicazioneAvvio: normalizeNullableDate(source.procedimento.dataComunicazioneAvvio),
        termineMemorieGiorni: nullableSafeInteger(source.procedimento.termineMemorieGiorni),
        termineMemorieScadenza: normalizeNullableDate(source.procedimento.termineMemorieScadenza),
        memorieRicevute: requiredBoolean(source.procedimento.memorieRicevute),
        dataRicezioneMemorie: normalizeNullableDate(source.procedimento.dataRicezioneMemorie),
        audizioneRichiesta: requiredBoolean(source.procedimento.audizioneRichiesta),
        audizioneSvolta: requiredBoolean(source.procedimento.audizioneSvolta),
        dataAudizione: normalizeNullableDate(source.procedimento.dataAudizione),
        sopralluogoIstruttorioSvolto: requiredBoolean(source.procedimento.sopralluogoIstruttorioSvolto),
        contestazioneFormaleInviata: requiredBoolean(source.procedimento.contestazioneFormaleInviata),
        dataContestazioneFormale: normalizeNullableDate(source.procedimento.dataContestazioneFormale),
        controdeduzioniValutate: requiredBoolean(source.procedimento.controdeduzioniValutate),
        preavvisoRigettoApplicabile: requiredBoolean(source.procedimento.preavvisoRigettoApplicabile),
        dataPreavvisoRigetto: normalizeNullableDate(source.procedimento.dataPreavvisoRigetto),
        termineOsservazioniPreavviso: normalizeNullableDate(source.procedimento.termineOsservazioniPreavviso),
        osservazioniPreavvisoRicevute: requiredBoolean(source.procedimento.osservazioniPreavvisoRicevute),
        dataOsservazioniPreavviso: normalizeNullableDate(source.procedimento.dataOsservazioniPreavviso),
        responsibilityAssignments: assignments.map((item) => ({
          alias: resolveAlias(assignmentAliases, item.id),
          functionalRole: "RESPONSABILE_PROCEDIMENTO",
          organizationalUnit: "UNIT_A",
          decorrenza: normalizeDate(item.decorrenza),
          cessazione: normalizeNullableDate(item.cessazione),
          comunicataAt: normalizeNullableDate(item.comunicataAt),
        })),
      },
      concessione: {
        alias: "TITOLO_A",
        dataRilascio: normalizeDate(source.concessione.dataRilascio),
        dataScadenza: normalizeDate(source.concessione.dataScadenza),
      },
      concessionario: {
        alias: "CONCESSIONARIO_A",
      },
      requirements: requirements.map((item) => ({
        alias: resolveAlias(requirementAliases, item.id),
        createdAt: normalizeDate(item.createdAt),
        reviewedAt: normalizeNullableDate(item.reviewedAt),
      })),
      evidence: evidence.map((item) => ({
        alias: resolveAlias(evidenceAliases, item.id),
        requirementAlias: resolveAlias(requirementAliases, item.proposalId),
        documentAlias: resolveAlias(documentAliases, item.documentoId),
        createdAt: normalizeDate(item.createdAt),
        revokedAt: normalizeNullableDate(item.revokedAt),
      })),
      humanReview: humanReviews.map((item) => ({
        alias: resolveAlias(humanReviewAliases, item.id),
        evidenceAlias: resolveAlias(evidenceAliases, item.evidenceId),
        createdAt: normalizeDate(item.createdAt),
      })),
      checklist: {
        complete: requiredBoolean(source.checklist.checklistContraddittorioCompleta),
        completedItems: safeInteger(source.checklist.checklistCompletedItems),
        totalItems: safeInteger(source.checklist.checklistTotalItems),
        percentage: finiteNumber(source.checklist.checklistPercentage),
        evidence: checklistEvidence.map((item) => ({
          alias: resolveAlias(checklistEvidenceAliases, item.id),
          documentAlias: resolveAlias(documentAliases, item.documentoId),
          createdAt: normalizeDate(item.createdAt),
          reviewedAt: normalizeNullableDate(item.reviewedAt),
        })),
      },
      observations: observations.map((item) => ({
        alias: resolveAlias(observationAliases, item.id),
        documentAlias: resolveAlias(documentAliases, item.documentoId),
        detectedAt: normalizeDate(item.detectedAt),
        reviewedAt: normalizeNullableDate(item.reviewedAt),
        currentConditionDetected: requiredBoolean(item.currentConditionDetected),
      })),
      documents: documents.map((item) => ({
        alias: resolveAlias(documentAliases, item.id),
        dataDocumento: normalizeNullableDate(item.dataDocumento),
      })),
      criticita: {
        coverage: requireSelected(source.criticita.coverage),
        items: issues.map((item) => ({
          alias: resolveAlias(issueAliases, item.id),
          dataRilevazione: normalizeDate(item.dataRilevazione),
          rilevanzaArt47: nullableBoolean(item.rilevanzaArt47),
        })),
      },
      pagamenti: {
        coverage: requireSelected(source.pagamenti.coverage),
        items: payments.map((item) => ({
          alias: resolveAlias(paymentAliases, item.id),
          annoRiferimento: safeInteger(item.annoRiferimento),
          dataScadenza: normalizeDate(item.dataScadenza),
        })),
      },
      scadenze: {
        coverage: requireSelected(source.scadenze.coverage),
        items: deadlines.map((item) => ({
          alias: resolveAlias(deadlineAliases, item.id),
          dataScadenza: normalizeDate(item.dataScadenza),
        })),
      },
      sopralluoghi: {
        coverage: requireSelected(source.sopralluoghi.coverage),
        items: inspections.map((item) => ({
          alias: resolveAlias(inspectionAliases, item.id),
          data: normalizeDate(item.data),
          conformitaPlanimetrica: nullableBoolean(item.conformitaPlanimetrica),
        })),
      },
      finalActContext: source.finalActContext === null
        ? null
        : {
            alias: "FINAL_ACT_A",
            contextOnly: source.finalActContext.contextOnly === true
              ? true
              : fail("INVALID_SOURCE_SNAPSHOT"),
            dataAtto: normalizeDate(source.finalActContext.dataAtto),
            dataEfficacia: normalizeDate(source.finalActContext.dataEfficacia),
            effettoApplicatoAt: normalizeNullableDate(source.finalActContext.effettoApplicatoAt),
            documentAlias: resolveNullableAlias(documentAliases, source.finalActContext.documentoId),
          },
    },
  };

  const normalizedProjection = deepFreeze(outboundProjection);
  const outboundProjectionHash = createHash(AI_FASCICOLO_OUTBOUND_HASH_ALGORITHM)
    .update(stableSerialize(normalizedProjection))
    .digest("hex");
  const providerBound = deepFreeze({
    outboundProjection: normalizedProjection,
    outboundProjectionHash,
    outboundProjectionHashAlgorithm: AI_FASCICOLO_OUTBOUND_HASH_ALGORITHM,
  });
  const localOnly = deepFreeze({
    sourceSnapshotContentHash,
    localAliasMapping: [...mapping].sort((left, right) => compareText(left.alias, right.alias)),
  });

  const result = { providerBound } as AiFascicoloOutboundProjectionResultV1;
  Object.defineProperty(result, "localOnly", {
    value: localOnly,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result);
}

export function projectAiFascicoloOutboundV1(
  snapshot: AiFascicoloSnapshotV1,
): AiFascicoloOutboundProjectionResultV1 {
  try {
    return buildAiFascicoloOutboundV1(snapshot);
  } catch (error) {
    if (error instanceof AiFascicoloOutboundProjectionError) {
      throw error;
    }
    throw new AiFascicoloOutboundProjectionError("INVALID_SOURCE_SNAPSHOT");
  }
}
