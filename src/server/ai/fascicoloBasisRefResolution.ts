import type {
  AiFascicoloOutboundAliasKind,
  AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";

type ProviderBound = AiFascicoloOutboundProjectionResultV1["providerBound"];
type LocalAliasMapping = AiFascicoloOutboundProjectionResultV1["localOnly"]["localAliasMapping"];

const registryBrand: unique symbol = Symbol("AiFascicoloBasisRefRegistryV1");
const DANGEROUS_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_CANONICAL_ID_LENGTH = 1024;

export class AiFascicoloBasisRefResolutionError extends Error {
  readonly code = "BASISREF_NOT_GROUNDED" as const;

  constructor() {
    super("BASISREF_NOT_GROUNDED");
    this.name = "AiFascicoloBasisRefResolutionError";
  }
}

export interface AiFascicoloResolvedBasisRefV1 {
  readonly providerRef: string;
  readonly referenceType: "ENTITY" | "NON_ENTITY";
  readonly alias: string | null;
  readonly kind: AiFascicoloOutboundAliasKind | null;
  readonly validatedFieldPath: string | null;
  readonly canonicalId: string | null;
}

export interface AiFascicoloBasisRefRegistryV1 {
  readonly outboundProjectionHash: string;
  readonly outboundProjectionHashAlgorithm: ProviderBound["outboundProjectionHashAlgorithm"];
  readonly outboundSchemaVersion: ProviderBound["outboundProjection"]["schemaVersion"];
  readonly [registryBrand]: true;
}

interface RegistryState {
  readonly entries: ReadonlyMap<string, AiFascicoloResolvedBasisRefV1>;
}

const registryStates = new WeakMap<AiFascicoloBasisRefRegistryV1, RegistryState>();

function fail(): never {
  throw new AiFascicoloBasisRefResolutionError();
}

function freezeResolved(
  value: AiFascicoloResolvedBasisRefV1,
): AiFascicoloResolvedBasisRefV1 {
  return Object.freeze(value);
}

function isActuallySent(object: object, field: string): boolean {
  return Object.hasOwn(object, field) && Reflect.get(object, field) !== undefined;
}

function buildRegistry(
  providerBound: ProviderBound,
  localAliasMapping: LocalAliasMapping,
): AiFascicoloBasisRefRegistryV1 {
  const mappings = new Map<string, LocalAliasMapping[number]>();
  for (const mapping of localAliasMapping) {
    if (
      typeof mapping.alias !== "string"
      || mapping.alias.length === 0
      || typeof mapping.canonicalId !== "string"
      || mapping.canonicalId.length === 0
      || mapping.canonicalId.length > MAX_CANONICAL_ID_LENGTH
      || mappings.has(mapping.alias)
    ) {
      fail();
    }
    mappings.set(mapping.alias, mapping);
  }

  const entries = new Map<string, AiFascicoloResolvedBasisRefV1>();
  const usedMappings = new Set<string>();

  const addEntry = (
    providerRef: string,
    resolved: Omit<AiFascicoloResolvedBasisRefV1, "providerRef">,
  ): void => {
    if (entries.has(providerRef)) {
      fail();
    }
    entries.set(providerRef, freezeResolved({ providerRef, ...resolved }));
  };

  const addEntity = (
    alias: string,
    expectedKind: AiFascicoloOutboundAliasKind,
    object: object,
    fields: readonly string[],
  ): void => {
    const mapping = mappings.get(alias);
    if (!mapping || mapping.kind !== expectedKind || usedMappings.has(alias)) {
      fail();
    }
    usedMappings.add(alias);
    const base = {
      referenceType: "ENTITY" as const,
      alias,
      kind: expectedKind,
      canonicalId: mapping.canonicalId,
    };
    addEntry(alias, { ...base, validatedFieldPath: null });
    for (const field of fields) {
      if (isActuallySent(object, field)) {
        addEntry(`${alias}.${field}`, { ...base, validatedFieldPath: field });
      }
    }
  };

  const addNonEntity = (providerRef: string, object: object, field: string): void => {
    if (!isActuallySent(object, field)) {
      return;
    }
    addEntry(providerRef, {
      referenceType: "NON_ENTITY",
      alias: null,
      kind: null,
      validatedFieldPath: providerRef,
      canonicalId: null,
    });
  };

  const content = providerBound.outboundProjection.content;
  if (
    content.identityContext.procedimentoAlias !== "PROCEDIMENTO_A"
    || content.identityContext.enteAlias !== "ENTE_A"
    || content.procedimento.alias !== "PROCEDIMENTO_A"
    || content.concessione.alias !== "TITOLO_A"
    || content.concessionario.alias !== "CONCESSIONARIO_A"
  ) {
    fail();
  }

  addEntity("PROCEDIMENTO_A", "PROCEDIMENTO", content.procedimento, [
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
  ]);
  addEntity("ENTE_A", "ENTE", content.identityContext, []);
  addEntity("TITOLO_A", "CONCESSIONE", content.concessione, ["dataRilascio", "dataScadenza"]);
  addEntity("CONCESSIONARIO_A", "CONCESSIONARIO", content.concessionario, []);

  content.procedimento.responsibilityAssignments.forEach((item, index) => {
    if (item.alias !== `ASSIGNMENT_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "RESPONSIBILITY_ASSIGNMENT", item, [
      "functionalRole",
      "organizationalUnit",
      "decorrenza",
      "cessazione",
      "comunicataAt",
    ]);
  });
  content.requirements.forEach((item, index) => {
    if (item.alias !== `REQ_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "REQUIREMENT", item, ["createdAt", "reviewedAt"]);
  });
  content.evidence.forEach((item, index) => {
    if (item.alias !== `EVID_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "EVIDENCE", item, [
      "requirementAlias",
      "documentAlias",
      "createdAt",
      "revokedAt",
    ]);
  });
  content.humanReview.forEach((item, index) => {
    if (item.alias !== `REVIEW_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "HUMAN_REVIEW", item, ["evidenceAlias", "createdAt"]);
  });
  content.checklist.evidence.forEach((item, index) => {
    if (item.alias !== `CHECK_EVID_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "CHECKLIST_EVIDENCE", item, [
      "documentAlias",
      "createdAt",
      "reviewedAt",
    ]);
  });
  content.observations.forEach((item, index) => {
    if (item.alias !== `OBS_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "OBSERVATION", item, [
      "documentAlias",
      "detectedAt",
      "reviewedAt",
      "currentConditionDetected",
    ]);
  });
  content.documents.forEach((item, index) => {
    if (item.alias !== `DOC_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "DOCUMENT", item, ["dataDocumento"]);
  });
  content.criticita.items.forEach((item, index) => {
    if (item.alias !== `ISSUE_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "ISSUE", item, ["dataRilevazione", "rilevanzaArt47"]);
  });
  content.pagamenti.items.forEach((item, index) => {
    if (item.alias !== `PAYMENT_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "PAYMENT", item, ["annoRiferimento", "dataScadenza"]);
  });
  content.scadenze.items.forEach((item, index) => {
    if (item.alias !== `DEADLINE_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "DEADLINE", item, ["dataScadenza"]);
  });
  content.sopralluoghi.items.forEach((item, index) => {
    if (item.alias !== `INSPECTION_${index + 1}`) {
      fail();
    }
    addEntity(item.alias, "INSPECTION", item, ["data", "conformitaPlanimetrica"]);
  });
  if (content.finalActContext !== null) {
    if (content.finalActContext.alias !== "FINAL_ACT_A") {
      fail();
    }
    addEntity("FINAL_ACT_A", "FINAL_ACT", content.finalActContext, [
      "contextOnly",
      "dataAtto",
      "dataEfficacia",
      "effettoApplicatoAt",
      "documentAlias",
    ]);
  }

  addNonEntity("identityContext.procedimentoAlias", content.identityContext, "procedimentoAlias");
  addNonEntity("identityContext.enteAlias", content.identityContext, "enteAlias");
  addNonEntity("checklist.complete", content.checklist, "complete");
  addNonEntity("checklist.completedItems", content.checklist, "completedItems");
  addNonEntity("checklist.totalItems", content.checklist, "totalItems");
  addNonEntity("checklist.percentage", content.checklist, "percentage");
  addNonEntity("criticita.coverage", content.criticita, "coverage");
  addNonEntity("pagamenti.coverage", content.pagamenti, "coverage");
  addNonEntity("scadenze.coverage", content.scadenze, "coverage");
  addNonEntity("sopralluoghi.coverage", content.sopralluoghi, "coverage");

  if (usedMappings.size !== mappings.size) {
    fail();
  }

  const registry = {
    outboundProjectionHash: providerBound.outboundProjectionHash,
    outboundProjectionHashAlgorithm: providerBound.outboundProjectionHashAlgorithm,
    outboundSchemaVersion: providerBound.outboundProjection.schemaVersion,
  } as AiFascicoloBasisRefRegistryV1;
  Object.defineProperty(registry, registryBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  registryStates.set(registry, { entries });
  return Object.freeze(registry);
}

export function buildAiFascicoloBasisRefRegistryV1(input: {
  readonly providerBound: ProviderBound;
  readonly localAliasMapping: LocalAliasMapping;
}): AiFascicoloBasisRefRegistryV1 {
  try {
    return buildRegistry(input.providerBound, input.localAliasMapping);
  } catch (error) {
    if (error instanceof AiFascicoloBasisRefResolutionError) {
      throw error;
    }
    return fail();
  }
}

function assertNoDangerousSegments(providerRef: string): void {
  for (const segment of providerRef.split(".")) {
    if (DANGEROUS_SEGMENTS.has(segment)) {
      fail();
    }
  }
}

export function resolveAiFascicoloBasisRefV1(
  registry: AiFascicoloBasisRefRegistryV1,
  providerRef: string,
): AiFascicoloResolvedBasisRefV1 {
  try {
    if (typeof providerRef !== "string") {
      return fail();
    }
    assertNoDangerousSegments(providerRef);
    const state = registryStates.get(registry);
    const resolved = state?.entries.get(providerRef);
    return resolved ?? fail();
  } catch (error) {
    if (error instanceof AiFascicoloBasisRefResolutionError) {
      throw error;
    }
    return fail();
  }
}

export function resolveAiFascicoloStatementBasisRefsV1(
  registry: AiFascicoloBasisRefRegistryV1,
  providerRefs: readonly string[],
): readonly AiFascicoloResolvedBasisRefV1[] {
  try {
    if (!Array.isArray(providerRefs)) {
      return fail();
    }
    const seen = new Set<string>();
    const resolved: AiFascicoloResolvedBasisRefV1[] = [];
    for (const providerRef of providerRefs) {
      if (typeof providerRef !== "string" || seen.has(providerRef)) {
        return fail();
      }
      seen.add(providerRef);
      resolved.push(resolveAiFascicoloBasisRefV1(registry, providerRef));
    }
    return Object.freeze(resolved);
  } catch (error) {
    if (error instanceof AiFascicoloBasisRefResolutionError) {
      throw error;
    }
    return fail();
  }
}
