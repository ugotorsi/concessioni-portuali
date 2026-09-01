import type { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot";
import {
  projectAiFascicoloOutboundV1,
  type AiFascicoloOutboundAliasKind,
  type AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";
import type {
  AiFascicoloAuthoritativeEvidenceInputV1,
  AiFascicoloAuthoritativeLocalEvidenceV1,
} from "@/server/ai/fascicoloTrustedReview";

type Snapshot = Awaited<ReturnType<typeof buildAiFascicoloSnapshotV1>>;
type Projection = AiFascicoloOutboundProjectionResultV1;
type EvidenceErrorCode =
  | "SNAPSHOT_PROJECTION_MISMATCH"
  | "MISSING_CANONICAL_MAPPING"
  | "DUPLICATE_EVIDENCE_TARGET"
  | "UNSUPPORTED_EVIDENCE_FIELD"
  | "INVALID_LOCAL_VALUE";

type RecordValue = Record<string, unknown>;
type FieldReaders = Readonly<Record<string, (source: RecordValue) => unknown>>;

interface LocalEntity {
  readonly kind: AiFascicoloOutboundAliasKind;
  readonly canonicalId: string;
  readonly source: RecordValue;
  readonly displayLabel: string;
}

export class AiFascicoloAuthoritativeEvidenceError extends Error {
  constructor(readonly code: EvidenceErrorCode) {
    super(code);
    this.name = "AiFascicoloAuthoritativeEvidenceError";
  }
}

function fail(code: EvidenceErrorCode): never {
  throw new AiFascicoloAuthoritativeEvidenceError(code);
}

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("INVALID_LOCAL_VALUE");
  }
  return value as RecordValue;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : fail("INVALID_LOCAL_VALUE");
}

function requiredString(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail("INVALID_LOCAL_VALUE");
}

function optionalLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function cloneLocalValue(value: unknown): AiFascicoloAuthoritativeLocalEvidenceV1["value"] {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fail("INVALID_LOCAL_VALUE");
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneLocalValue(item));
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail("INVALID_LOCAL_VALUE");
  }
  const result: Record<string, AiFascicoloAuthoritativeLocalEvidenceV1["value"]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      return fail("INVALID_LOCAL_VALUE");
    }
    result[key] = cloneLocalValue(item);
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : fail("INVALID_LOCAL_VALUE");
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const object = record(value);
  return `{${Object.keys(object)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function direct(...fields: readonly string[]): FieldReaders {
  return Object.fromEntries(fields.map((field) => [field, (source: RecordValue) => source[field]]));
}

const PROCEDIMENTO_FIELDS = direct(
  "dataAvvio",
  "dataScadenzaContraddittorio",
  "dataProvvedimentoFinale",
  "responsabileAssegnatoAt",
  "comunicazioneAvvioInviata",
  "dataComunicazioneAvvio",
  "termineMemorieGiorni",
  "termineMemorieScadenza",
  "memorieRicevute",
  "dataRicezioneMemorie",
  "audizioneRichiesta",
  "audizioneSvolta",
  "dataAudizione",
  "sopralluogoIstruttorioSvolto",
  "contestazioneFormaleInviata",
  "dataContestazioneFormale",
  "controdeduzioniValutate",
  "preavvisoRigettoApplicabile",
  "dataPreavvisoRigetto",
  "termineOsservazioniPreavviso",
  "osservazioniPreavvisoRicevute",
  "dataOsservazioniPreavviso",
);
const CONCESSIONE_FIELDS = direct("dataRilascio", "dataScadenza");
const ASSIGNMENT_FIELDS: FieldReaders = {
  functionalRole: () => "RESPONSABILE_PROCEDIMENTO",
  organizationalUnit: (source) => source.unitaOrganizzativa,
  decorrenza: (source) => source.decorrenza,
  cessazione: (source) => source.cessazione,
  comunicataAt: (source) => source.comunicataAt,
};
const REQUIREMENT_FIELDS = direct("createdAt", "reviewedAt");
const EVIDENCE_FIELDS: FieldReaders = {
  requirementAlias: (source) => source.proposalId,
  documentAlias: (source) => source.documentoId,
  createdAt: (source) => source.createdAt,
  revokedAt: (source) => source.revokedAt,
};
const HUMAN_REVIEW_FIELDS: FieldReaders = {
  evidenceAlias: (source) => source.evidenceId,
  createdAt: (source) => source.createdAt,
};
const CHECKLIST_EVIDENCE_FIELDS: FieldReaders = {
  documentAlias: (source) => source.documentoId,
  createdAt: (source) => source.createdAt,
  reviewedAt: (source) => source.reviewedAt,
};
const OBSERVATION_FIELDS: FieldReaders = {
  documentAlias: (source) => source.documentoId,
  detectedAt: (source) => source.detectedAt,
  reviewedAt: (source) => source.reviewedAt,
  currentConditionDetected: (source) => source.currentConditionDetected,
};
const DOCUMENT_FIELDS = direct("dataDocumento");
const ISSUE_FIELDS = direct("dataRilevazione", "rilevanzaArt47");
const PAYMENT_FIELDS = direct("annoRiferimento", "dataScadenza");
const DEADLINE_FIELDS = direct("dataScadenza");
const INSPECTION_FIELDS = direct("data", "conformitaPlanimetrica");
const IDENTITY_NON_ENTITY_FIELDS = direct("procedimentoAlias", "enteAlias");
const CHECKLIST_NON_ENTITY_FIELDS = direct("complete", "completedItems", "totalItems", "percentage");
const COVERAGE_NON_ENTITY_FIELDS = direct("coverage");
const FINAL_ACT_FIELDS: FieldReaders = {
  contextOnly: (source) => source.contextOnly,
  dataAtto: (source) => source.dataAtto,
  dataEfficacia: (source) => source.dataEfficacia,
  effettoApplicatoAt: (source) => source.effettoApplicatoAt,
  documentAlias: (source) => source.documentoId,
};

function entityKey(kind: AiFascicoloOutboundAliasKind, canonicalId: string): string {
  return `${kind}\u0000${canonicalId}`;
}

function addLocalEntity(
  target: Map<string, LocalEntity>,
  kind: AiFascicoloOutboundAliasKind,
  value: unknown,
  labelField?: string,
): void {
  const source = record(value);
  const canonicalId = requiredString(source.id);
  const key = entityKey(kind, canonicalId);
  if (target.has(key)) {
    fail("DUPLICATE_EVIDENCE_TARGET");
  }
  target.set(key, {
    kind,
    canonicalId,
    source,
    displayLabel: optionalLabel(labelField ? source[labelField] : undefined, canonicalId),
  });
}

function buildLocalEntityIndex(content: RecordValue): ReadonlyMap<string, LocalEntity> {
  const entities = new Map<string, LocalEntity>();
  const identity = record(content.identityContext);
  const procedimento = record(content.procedimento);
  addLocalEntity(entities, "PROCEDIMENTO", procedimento);
  addLocalEntity(entities, "ENTE", { id: identity.canonicalEnteId });
  addLocalEntity(entities, "CONCESSIONE", content.concessione, "numeroAtto");
  addLocalEntity(entities, "CONCESSIONARIO", content.concessionario, "denominazione");
  for (const item of array(procedimento.responsibilityAssignments)) {
    addLocalEntity(entities, "RESPONSIBILITY_ASSIGNMENT", item, "responsabileNome");
  }
  for (const item of array(content.requirements)) {
    addLocalEntity(entities, "REQUIREMENT", item, "gapLabelSnapshot");
  }
  for (const item of array(content.evidence)) {
    addLocalEntity(entities, "EVIDENCE", item);
  }
  for (const item of array(content.humanReviewReceipts)) {
    addLocalEntity(entities, "HUMAN_REVIEW", item);
  }
  const checklist = record(content.checklist);
  for (const item of array(checklist.evidence)) {
    addLocalEntity(entities, "CHECKLIST_EVIDENCE", item, "checklistItemCode");
  }
  for (const item of array(content.fascicoloObservations)) {
    addLocalEntity(entities, "OBSERVATION", item, "text");
  }
  for (const item of array(content.documents)) {
    addLocalEntity(entities, "DOCUMENT", item, "nome");
  }
  for (const item of array(record(content.criticita).items)) {
    addLocalEntity(entities, "ISSUE", item, "descrizione");
  }
  for (const item of array(record(content.pagamenti).items)) {
    addLocalEntity(entities, "PAYMENT", item);
  }
  for (const item of array(record(content.scadenze).items)) {
    addLocalEntity(entities, "DEADLINE", item, "descrizione");
  }
  for (const item of array(record(content.sopralluoghi).items)) {
    addLocalEntity(entities, "INSPECTION", item);
  }
  if (content.finalActContext !== null) {
    addLocalEntity(entities, "FINAL_ACT", content.finalActContext, "numeroAtto");
  }
  return entities;
}

function assertExactFields(
  outbound: RecordValue,
  readers: FieldReaders,
  structuralFields: readonly string[] = ["alias"],
): void {
  const structural = new Set(structuralFields);
  const actual = Object.keys(outbound).filter((field) => !structural.has(field)).sort(compareText);
  const expected = Object.keys(readers).sort(compareText);
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail("UNSUPPORTED_EVIDENCE_FIELD");
  }
}

function mappingIndex(projection: Projection): ReadonlyMap<string, Projection["localOnly"]["localAliasMapping"][number]> {
  const mappings = new Map<string, Projection["localOnly"]["localAliasMapping"][number]>();
  const identities = new Set<string>();
  for (const mapping of projection.localOnly.localAliasMapping) {
    if (mappings.has(mapping.alias) || identities.has(entityKey(mapping.kind, mapping.canonicalId))) {
      fail("DUPLICATE_EVIDENCE_TARGET");
    }
    mappings.set(mapping.alias, mapping);
    identities.add(entityKey(mapping.kind, mapping.canonicalId));
  }
  return mappings;
}

export function buildAiFascicoloAuthoritativeEvidenceV1(input: {
  readonly snapshot: Snapshot;
  readonly projection: Projection;
}): AiFascicoloAuthoritativeEvidenceInputV1 {
  if (input.projection.localOnly.sourceSnapshotContentHash !== input.snapshot.metadata.contentHash) {
    fail("SNAPSHOT_PROJECTION_MISMATCH");
  }

  const snapshotContent = record(input.snapshot.content);
  const outboundContent = record(input.projection.providerBound.outboundProjection.content);
  const localEntities = buildLocalEntityIndex(snapshotContent);
  const mappings = mappingIndex(input.projection);
  const consumedAliases = new Set<string>();
  const entityTargets: Array<AiFascicoloAuthoritativeEvidenceInputV1["entities"][number]> = [];
  const targetKeys = new Set<string>();

  const addEntity = (
    alias: unknown,
    kind: AiFascicoloOutboundAliasKind,
    outbound: unknown,
    readers: FieldReaders,
    structuralFields?: readonly string[],
  ): void => {
    const normalizedAlias = requiredString(alias);
    const mapping = mappings.get(normalizedAlias);
    if (!mapping || mapping.kind !== kind) {
      fail("MISSING_CANONICAL_MAPPING");
    }
    const local = localEntities.get(entityKey(kind, mapping.canonicalId));
    if (!local) {
      fail("MISSING_CANONICAL_MAPPING");
    }
    consumedAliases.add(normalizedAlias);
    const outboundRecord = record(outbound);
    assertExactFields(outboundRecord, readers, structuralFields);

    const addTarget = (validatedFieldPath: string | null, value: unknown): void => {
      const key = `${kind}\u0000${mapping.canonicalId}\u0000${validatedFieldPath ?? ""}`;
      if (targetKeys.has(key)) {
        fail("DUPLICATE_EVIDENCE_TARGET");
      }
      targetKeys.add(key);
      entityTargets.push({
        kind,
        canonicalId: mapping.canonicalId,
        validatedFieldPath,
        local: {
          displayLabel: local.displayLabel,
          value: cloneLocalValue(value),
        },
      });
    };

    addTarget(null, mapping.canonicalId);
    for (const [field, readValue] of Object.entries(readers)) {
      addTarget(field, readValue(local.source));
    }
  };

  const identity = record(outboundContent.identityContext);
  const procedimento = record(outboundContent.procedimento);
  assertExactFields(identity, IDENTITY_NON_ENTITY_FIELDS, []);
  addEntity(
    procedimento.alias,
    "PROCEDIMENTO",
    procedimento,
    PROCEDIMENTO_FIELDS,
    ["alias", "responsibilityAssignments"],
  );
  addEntity(identity.enteAlias, "ENTE", identity, {}, ["procedimentoAlias", "enteAlias"]);
  const concessione = record(outboundContent.concessione);
  addEntity(concessione.alias, "CONCESSIONE", concessione, CONCESSIONE_FIELDS);
  const concessionario = record(outboundContent.concessionario);
  addEntity(concessionario.alias, "CONCESSIONARIO", concessionario, {});

  const addCollection = (value: unknown, kind: AiFascicoloOutboundAliasKind, readers: FieldReaders): void => {
    for (const item of array(value)) {
      const outbound = record(item);
      addEntity(outbound.alias, kind, outbound, readers);
    }
  };
  addCollection(procedimento.responsibilityAssignments, "RESPONSIBILITY_ASSIGNMENT", ASSIGNMENT_FIELDS);
  addCollection(outboundContent.requirements, "REQUIREMENT", REQUIREMENT_FIELDS);
  addCollection(outboundContent.evidence, "EVIDENCE", EVIDENCE_FIELDS);
  addCollection(outboundContent.humanReview, "HUMAN_REVIEW", HUMAN_REVIEW_FIELDS);
  const checklistOutbound = record(outboundContent.checklist);
  assertExactFields(checklistOutbound, CHECKLIST_NON_ENTITY_FIELDS, ["evidence"]);
  addCollection(checklistOutbound.evidence, "CHECKLIST_EVIDENCE", CHECKLIST_EVIDENCE_FIELDS);
  addCollection(outboundContent.observations, "OBSERVATION", OBSERVATION_FIELDS);
  addCollection(outboundContent.documents, "DOCUMENT", DOCUMENT_FIELDS);
  const criticitaOutbound = record(outboundContent.criticita);
  const pagamentiOutbound = record(outboundContent.pagamenti);
  const scadenzeOutbound = record(outboundContent.scadenze);
  const sopralluoghiOutbound = record(outboundContent.sopralluoghi);
  for (const group of [
    criticitaOutbound,
    pagamentiOutbound,
    scadenzeOutbound,
    sopralluoghiOutbound,
  ]) {
    assertExactFields(group, COVERAGE_NON_ENTITY_FIELDS, ["items"]);
  }
  addCollection(criticitaOutbound.items, "ISSUE", ISSUE_FIELDS);
  addCollection(pagamentiOutbound.items, "PAYMENT", PAYMENT_FIELDS);
  addCollection(scadenzeOutbound.items, "DEADLINE", DEADLINE_FIELDS);
  addCollection(sopralluoghiOutbound.items, "INSPECTION", INSPECTION_FIELDS);
  if (outboundContent.finalActContext !== null) {
    const finalAct = record(outboundContent.finalActContext);
    addEntity(finalAct.alias, "FINAL_ACT", finalAct, FINAL_ACT_FIELDS);
  }

  if (consumedAliases.size !== mappings.size) {
    fail("MISSING_CANONICAL_MAPPING");
  }

  const expectedProjection = projectAiFascicoloOutboundV1(input.snapshot);
  if (
    expectedProjection.providerBound.outboundProjectionHash
      !== input.projection.providerBound.outboundProjectionHash
    || expectedProjection.providerBound.outboundProjectionHashAlgorithm
      !== input.projection.providerBound.outboundProjectionHashAlgorithm
    || stableJson(expectedProjection.providerBound.outboundProjection)
      !== stableJson(input.projection.providerBound.outboundProjection)
    || stableJson(expectedProjection.localOnly.localAliasMapping)
      !== stableJson(input.projection.localOnly.localAliasMapping)
  ) {
    fail("SNAPSHOT_PROJECTION_MISMATCH");
  }

  const nonEntityContextId = requiredString(record(snapshotContent.identityContext).procedimentoId);
  const nonEntityTargets: Array<AiFascicoloAuthoritativeEvidenceInputV1["nonEntities"][number]> = [];
  const addNonEntity = (validatedFieldPath: string, displayLabel: string, value: unknown): void => {
    nonEntityTargets.push({
      contextId: nonEntityContextId,
      validatedFieldPath,
      local: { displayLabel, value: cloneLocalValue(value) },
    });
  };
  const snapshotChecklist = record(snapshotContent.checklist);
  addNonEntity("identityContext.procedimentoAlias", nonEntityContextId, nonEntityContextId);
  const canonicalEnteId = requiredString(record(snapshotContent.identityContext).canonicalEnteId);
  addNonEntity("identityContext.enteAlias", canonicalEnteId, canonicalEnteId);
  addNonEntity("checklist.complete", "checklist.complete", snapshotChecklist.checklistContraddittorioCompleta);
  addNonEntity("checklist.completedItems", "checklist.completedItems", snapshotChecklist.checklistCompletedItems);
  addNonEntity("checklist.totalItems", "checklist.totalItems", snapshotChecklist.checklistTotalItems);
  addNonEntity("checklist.percentage", "checklist.percentage", snapshotChecklist.checklistPercentage);
  for (const group of ["criticita", "pagamenti", "scadenze", "sopralluoghi"] as const) {
    addNonEntity(`${group}.coverage`, `${group}.coverage`, record(snapshotContent[group]).coverage);
  }

  entityTargets.sort((left, right) => (
    compareText(left.kind, right.kind)
    || compareText(left.canonicalId, right.canonicalId)
    || compareText(left.validatedFieldPath ?? "", right.validatedFieldPath ?? "")
  ));
  nonEntityTargets.sort((left, right) => (
    compareText(left.contextId, right.contextId)
    || compareText(left.validatedFieldPath, right.validatedFieldPath)
  ));

  return deepFreeze({
    nonEntityContextId,
    entities: entityTargets,
    nonEntities: nonEntityTargets,
  });
}
