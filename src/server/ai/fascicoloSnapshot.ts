import { createHash } from "node:crypto";

import { canUseAI, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { getChecklistEvidenceData } from "@/server/queries/checklist-evidence";
import { getFascicoloDocumentRequirementEvidenceData } from "@/server/queries/fascicolo-document-requirement-evidence";
import { getFascicoloDocumentRequirementProposals } from "@/server/queries/fascicolo-document-requirements";
import { getFascicoloObservations } from "@/server/queries/fascicolo-observations";
import { getProcedimentoDetail } from "@/server/queries/procedimenti";

export const AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION = "ai-fascicolo-snapshot/v1" as const;
export const AI_FASCICOLO_SNAPSHOT_CONTENT_HASH_ALGORITHM = "sha256" as const;

type SnapshotErrorCode =
  | "UNAUTHENTICATED"
  | "AI_ROLE_FORBIDDEN"
  | "PROCEDIMENTO_NOT_FOUND"
  | "TENANT_ACCESS_DENIED"
  | "SOURCE_INCONSISTENCY";

export class AiFascicoloSnapshotError extends Error {
  constructor(readonly code: SnapshotErrorCode) {
    super(code);
    this.name = "AiFascicoloSnapshotError";
  }
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

function iso(value: unknown): string | null {
  if (value === undefined) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  if (value === null) {
    return null;
  }

  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  return date.toISOString();
}

function requiredIso(value: unknown): string {
  const normalized = iso(value);
  if (normalized === null) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  return normalized;
}

function requiredValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : normalizeText(value);
}

function decimalString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }

  const decimal = typeof value === "string"
    ? value
    : typeof value === "bigint"
      ? value.toString()
      : typeof value === "object" && value.toString !== Object.prototype.toString
        ? value.toString()
        : null;
  if (decimal === null || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal)) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  return decimal;
}

function normalizeCanonical(value: unknown): JsonValue {
  if (value === undefined) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeCanonical);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, normalizeCanonical(item)]),
    );
  }
  throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableDate(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return compareText(left, right);
}

function stableSerialize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

export async function buildAiFascicoloSnapshotV1(procedimentoId: string) {
  const actor = await getCurrentUser();
  if (!actor) {
    throw new AiFascicoloSnapshotError("UNAUTHENTICATED");
  }
  if (!canUseAI(actor.role)) {
    throw new AiFascicoloSnapshotError("AI_ROLE_FORBIDDEN");
  }

  const canonicalProcedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: {
      id: true,
      concessioneId: true,
      concessione: { select: { enteId: true } },
    },
  });
  if (!canonicalProcedimento) {
    throw new AiFascicoloSnapshotError("PROCEDIMENTO_NOT_FOUND");
  }

  const canonicalEnteId = requiredValue(canonicalProcedimento.concessione).enteId;
  if (!canonicalEnteId) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    throw new AiFascicoloSnapshotError("TENANT_ACCESS_DENIED");
  }
  try {
    requireTenantAccess(tenantContext, canonicalEnteId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  } catch {
    throw new AiFascicoloSnapshotError("TENANT_ACCESS_DENIED");
  }

  const [detail, requirementData, evidenceData, checklistData, observations] = await Promise.all([
    getProcedimentoDetail(canonicalProcedimento.id),
    getFascicoloDocumentRequirementProposals(canonicalProcedimento.id),
    getFascicoloDocumentRequirementEvidenceData(canonicalProcedimento.id),
    getChecklistEvidenceData(canonicalProcedimento.id),
    getFascicoloObservations(canonicalProcedimento.id),
  ]);

  if (
    !detail
    || requirementData === undefined
    || evidenceData === undefined
    || checklistData === undefined
    || observations === undefined
  ) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }
  requiredValue(detail.procedimento);
  requiredValue(detail.concessione);
  requiredValue(detail.concessionario);

  if (
    detail.procedimento.id !== canonicalProcedimento.id
    || detail.concessione.id !== canonicalProcedimento.concessioneId
    || detail.canonicalEnteId !== canonicalEnteId
    || !requirementData.hasCanonicalTenant
    || !evidenceData.hasCanonicalTenant
    || !checklistData.hasCanonicalTenant
  ) {
    throw new AiFascicoloSnapshotError("SOURCE_INCONSISTENCY");
  }

  const proposals = requiredValue(requirementData.proposals);
  const associationsByProposalId = requiredValue(evidenceData.associationsByProposalId);
  const sourceChecklistEvidence = requiredValue(checklistData.evidence);
  const sourceObservations = requiredValue(observations);
  const sourceDocuments = requiredValue(detail.documentiPrincipali);
  const sourceAdditionalIssues = requiredValue(detail.altreCriticitaAperte);
  const sourcePayments = requiredValue(detail.pagamentiCritici);
  const sourceDeadlines = requiredValue(detail.scadenzeRilevanti);
  const sourceInspections = requiredValue(detail.sopralluoghiRecenti);
  const sourceAssignments = requiredValue(detail.procedimento.responsabileAssignments);
  const sourceChecklistMissingItems = requiredValue(detail.procedimento.checklistMissingItems);

  const requirements = proposals
    .map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      screeningFingerprint: proposal.screeningFingerprint,
      matcherAlgorithmVersion: proposal.matcherAlgorithmVersion,
      sourceStableKeySnapshot: proposal.sourceStableKeySnapshot,
      sourceTitleSnapshot: normalizeText(proposal.sourceTitleSnapshot),
      ruleCodeSnapshot: proposal.ruleCodeSnapshot,
      ruleContractVersionSnapshot: proposal.ruleContractVersionSnapshot,
      gapKeySnapshot: proposal.gapKeySnapshot,
      gapLabelSnapshot: normalizeText(proposal.gapLabelSnapshot),
      gapDescriptionSnapshot: normalizeText(proposal.gapDescriptionSnapshot),
      createdAt: requiredIso(proposal.createdAt),
      createdByActorId: proposal.createdByActorId,
      createdByRole: proposal.createdByRole,
      reviewedAt: iso(proposal.reviewedAt),
      reviewedByActorId: proposal.reviewedByActorId,
      reviewedByRole: proposal.reviewedByRole,
      reviewNote: nullableText(proposal.reviewNote),
    }))
    .sort((left, right) => compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id));

  const evidence = Object.values(associationsByProposalId)
    .flat()
    .map((association) => ({
      id: association.id,
      proposalId: association.proposalId,
      documentoId: association.documentoId,
      createdAt: requiredIso(association.createdAt),
      createdByActorId: association.createdByActorId,
      createdByRole: association.createdByRole,
      revokedAt: iso(association.revokedAt),
      revokedByActorId: association.revokedByActorId,
      revokedByRole: association.revokedByRole,
      revocationNote: nullableText(association.revocationNote),
    }))
    .sort((left, right) =>
      compareText(left.proposalId, right.proposalId)
      || compareText(left.createdAt, right.createdAt)
      || compareText(left.id, right.id),
    );

  const humanReviewReceipts = Object.values(associationsByProposalId)
    .flat()
    .flatMap((association) => {
      const review = requiredValue(association.review);
      return review === null
        ? []
        : [{
          id: review.id,
          evidenceId: association.id,
          createdAt: requiredIso(review.createdAt),
          reviewedByActorId: review.reviewedByActorId,
          reviewedByRole: review.reviewedByRole,
          reviewNote: nullableText(review.reviewNote),
        }];
    })
    .sort((left, right) =>
      compareText(left.evidenceId, right.evidenceId)
      || compareText(left.createdAt, right.createdAt)
      || compareText(left.id, right.id),
    );

  const checklistEvidence = sourceChecklistEvidence
    .map((item) => ({
      id: item.id,
      checklistItemCode: item.checklistItemCode,
      documentoId: requiredValue(item.documento).id,
      status: item.status,
      createdAt: requiredIso(item.createdAt),
      createdByActorId: item.createdByActorId,
      createdByRole: item.createdByRole,
      reviewedAt: iso(item.reviewedAt),
      reviewedByActorId: item.reviewedByActorId,
      reviewedByRole: item.reviewedByRole,
      reviewNote: nullableText(item.reviewNote),
    }))
    .sort((left, right) =>
      compareText(left.checklistItemCode, right.checklistItemCode)
      || compareText(left.createdAt, right.createdAt)
      || compareText(left.id, right.id),
    );

  const normalizedObservations = sourceObservations
    .map((observation) => ({
      id: observation.id,
      documentoId: requiredValue(observation.documento).id,
      status: observation.status,
      ruleCode: observation.ruleCode,
      ruleVersion: observation.ruleVersion,
      detectedAt: requiredIso(observation.detectedAt),
      reviewedAt: iso(observation.reviewedAt),
      reviewNote: nullableText(observation.reviewNote),
      currentConditionDetected: observation.currentConditionDetected,
      text: normalizeText(observation.text),
      disclaimer: normalizeText(observation.disclaimer),
    }))
    .sort((left, right) => compareText(left.detectedAt, right.detectedAt) || compareText(left.id, right.id));

  const documents = sourceDocuments
    .map((documento) => ({
      id: documento.id,
      nome: normalizeText(documento.nome),
      tipologia: documento.tipologia,
      statoDocumento: documento.statoDocumento,
      dataDocumento: iso(documento.dataDocumento),
      createdAt: requiredIso(documento.createdAt),
    }))
    .sort((left, right) =>
      compareNullableDate(left.dataDocumento, right.dataDocumento)
      || compareText(left.createdAt, right.createdAt)
      || compareText(left.id, right.id),
    );

  const criticitaById = new Map<string, {
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
    riferimentoNormativo: string | null;
    dataRilevazione: string;
    rilevanzaArt47: boolean | null;
    letteraArt47: string | null;
    rischioDecadenza: string | null;
  }>();
  const linkedIssue = requiredValue(detail.criticitaCollegata);
  if (linkedIssue !== null) {
    const item = linkedIssue;
    criticitaById.set(item.id, {
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: normalizeText(item.descrizione),
      riferimentoNormativo: nullableText(item.riferimentoNormativo),
      dataRilevazione: requiredIso(item.dataRilevazione),
      rilevanzaArt47: item.rilevanzaArt47,
      letteraArt47: item.letteraArt47,
      rischioDecadenza: item.rischioDecadenza,
    });
  }
  for (const item of sourceAdditionalIssues) {
    criticitaById.set(item.id, {
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: normalizeText(item.descrizione),
      riferimentoNormativo: null,
      dataRilevazione: requiredIso(item.dataRilevazione),
      rilevanzaArt47: null,
      letteraArt47: null,
      rischioDecadenza: null,
    });
  }
  const criticita = Array.from(criticitaById.values())
    .sort((left, right) => compareNullableDate(left.dataRilevazione, right.dataRilevazione) || compareText(left.id, right.id));

  const pagamenti = sourcePayments
    .map((item) => ({
      id: item.id,
      annoRiferimento: item.annoRiferimento,
      importoDovuto: decimalString(item.importoDovuto),
      importoVersato: decimalString(item.importoVersato),
      residuo: decimalString(item.residuo),
      stato: item.stato,
      dataScadenza: requiredIso(item.dataScadenza),
    }))
    .sort((left, right) =>
      left.annoRiferimento - right.annoRiferimento
      || compareNullableDate(left.dataScadenza, right.dataScadenza)
      || compareText(left.id, right.id),
    );

  const scadenze = sourceDeadlines
    .map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      dataScadenza: requiredIso(item.dataScadenza),
      descrizione: nullableText(item.descrizione),
    }))
    .sort((left, right) => compareNullableDate(left.dataScadenza, right.dataScadenza) || compareText(left.id, right.id));

  const sopralluoghi = sourceInspections
    .map((item) => ({
      id: item.id,
      data: requiredIso(item.data),
      esito: item.esito,
      conformitaPlanimetrica: item.conformitaPlanimetrica,
      descrizione: nullableText(item.descrizione),
    }))
    .sort((left, right) => compareNullableDate(left.data, right.data) || compareText(left.id, right.id));

  const responsibilityAssignments = sourceAssignments
    .map((assignment) => ({
      id: assignment.id,
      responsabileNome: normalizeText(assignment.responsabileNome),
      unitaOrganizzativa: normalizeText(assignment.unitaOrganizzativa),
      decorrenza: requiredIso(assignment.decorrenza),
      cessazione: iso(assignment.cessazione),
      motivoAssegnazione: nullableText(assignment.motivoAssegnazione),
      comunicataAt: iso(assignment.comunicataAt),
      registeredByUserId: assignment.registeredByUserId,
    }))
    .sort((left, right) => compareNullableDate(left.decorrenza, right.decorrenza) || compareText(left.id, right.id));

  const finalAct = requiredValue(detail.procedimento.decisioneConclusiva);
  const rawContent = {
    identityContext: {
      procedimentoId: canonicalProcedimento.id,
      canonicalEnteId,
    },
    procedimento: {
      id: detail.procedimento.id,
      tipologia: detail.procedimento.tipologia,
      stato: detail.procedimento.stato,
      origineProcedimento: detail.procedimento.origineProcedimento,
      procedimentoUfficio: detail.procedimento.procedimentoUfficio,
      riferimentoNormativo: nullableText(detail.procedimento.riferimentoNormativo),
      dataAvvio: iso(detail.procedimento.dataAvvio),
      dataScadenzaContraddittorio: iso(detail.procedimento.dataScadenzaContraddittorio),
      dataProvvedimentoFinale: iso(detail.procedimento.dataProvvedimentoFinale),
      checklistProfile: detail.procedimento.checklistProfile,
      noteIstruttorie: nullableText(detail.procedimento.noteIstruttorie),
      responsabileProcedimentoNome: nullableText(detail.procedimento.responsabileProcedimentoNome),
      unitaOrganizzativaResponsabile: nullableText(detail.procedimento.unitaOrganizzativaResponsabile),
      responsabileAssegnatoAt: iso(detail.procedimento.responsabileAssegnatoAt),
      responsibilityAssignments,
      comunicazioneAvvioInviata: detail.procedimento.comunicazioneAvvioInviata,
      dataComunicazioneAvvio: iso(detail.procedimento.dataComunicazioneAvvio),
      termineMemorieGiorni: detail.procedimento.termineMemorieGiorni,
      termineMemorieScadenza: iso(detail.procedimento.termineMemorieScadenza),
      memorieRicevute: detail.procedimento.memorieRicevute,
      dataRicezioneMemorie: iso(detail.procedimento.dataRicezioneMemorie),
      audizioneRichiesta: detail.procedimento.audizioneRichiesta,
      audizioneSvolta: detail.procedimento.audizioneSvolta,
      dataAudizione: iso(detail.procedimento.dataAudizione),
      sopralluogoIstruttorioSvolto: detail.procedimento.sopralluogoIstruttorioSvolto,
      contestazioneFormaleInviata: detail.procedimento.contestazioneFormaleInviata,
      dataContestazioneFormale: iso(detail.procedimento.dataContestazioneFormale),
      controdeduzioniValutate: detail.procedimento.controdeduzioniValutate,
      motivazioneValutazione: nullableText(detail.procedimento.motivazioneValutazione),
      propostaEsitoIstruttorio: detail.procedimento.propostaEsitoIstruttorio,
      preavvisoRigettoApplicabile: detail.procedimento.preavvisoRigettoApplicabile,
      statoPreavvisoRigetto: detail.procedimento.statoPreavvisoRigetto,
      dataPreavvisoRigetto: iso(detail.procedimento.dataPreavvisoRigetto),
      termineOsservazioniPreavviso: iso(detail.procedimento.termineOsservazioniPreavviso),
      osservazioniPreavvisoRicevute: detail.procedimento.osservazioniPreavvisoRicevute,
      dataOsservazioniPreavviso: iso(detail.procedimento.dataOsservazioniPreavviso),
      valutazioneOsservazioniPreavviso: nullableText(detail.procedimento.valutazioneOsservazioniPreavviso),
      motivazioneMancatoPreavviso: nullableText(detail.procedimento.motivazioneMancatoPreavviso),
      createdAt: requiredIso(detail.procedimento.createdAt),
    },
    concessione: {
      id: detail.concessione.id,
      numeroAtto: normalizeText(detail.concessione.numeroAtto),
      stato: detail.concessione.stato,
      dataRilascio: requiredIso(detail.concessione.dataRilascio),
      dataScadenza: requiredIso(detail.concessione.dataScadenza),
      tipologiaBene: detail.concessione.tipologiaBene,
      attivita: detail.concessione.attivita,
      ubicazione: nullableText(detail.concessione.ubicazione),
      canoneAnnuo: decimalString(detail.concessione.canoneAnnuo),
      categoriaCanone: nullableText(detail.concessione.categoriaCanone),
    },
    concessionario: {
      id: detail.concessionario.id,
      denominazione: normalizeText(detail.concessionario.denominazione),
    },
    requirements,
    evidence,
    humanReviewReceipts,
    checklist: {
      checklistProfile: detail.procedimento.checklistProfile,
      checklistContraddittorioCompleta: detail.procedimento.checklistContraddittorioCompleta,
      checklistCompletedItems: detail.procedimento.checklistCompletedItems,
      checklistTotalItems: detail.procedimento.checklistTotalItems,
      checklistPercentage: detail.procedimento.checklistPercentage,
      checklistMissingItems: [...sourceChecklistMissingItems].map(normalizeText).sort(compareText),
      checklistWarningLevel: detail.procedimento.checklistWarningLevel,
      noteChecklistContraddittorio: nullableText(detail.procedimento.noteChecklistContraddittorio),
      evidence: checklistEvidence,
    },
    fascicoloObservations: normalizedObservations,
    documents,
    criticita: { coverage: "SELECTED" as const, items: criticita },
    pagamenti: { coverage: "SELECTED" as const, items: pagamenti },
    scadenze: { coverage: "SELECTED" as const, items: scadenze },
    sopralluoghi: { coverage: "SELECTED" as const, items: sopralluoghi },
    finalActContext: finalAct === null
      ? null
      : {
          contextOnly: true as const,
          id: finalAct.id,
          tipoDecisione: finalAct.tipoDecisione,
          numeroAtto: normalizeText(finalAct.numeroAtto),
          protocolloAtto: nullableText(finalAct.protocolloAtto),
          dataAtto: requiredIso(finalAct.dataAtto),
          dataEfficacia: requiredIso(finalAct.dataEfficacia),
          organoCompetente: normalizeText(finalAct.organoCompetente),
          effettoTitolo: finalAct.effettoTitolo,
          statoEffetto: finalAct.statoEffetto,
          effettoApplicatoAt: iso(finalAct.effettoApplicatoAt),
          statoConcessionePrecedente: finalAct.statoConcessionePrecedente,
          statoConcessioneSuccessivo: finalAct.statoConcessioneSuccessivo,
          documentoId: finalAct.documentoId,
          registeredByUserId: finalAct.registeredByUserId,
          createdAt: requiredIso(finalAct.createdAt),
        },
  };

  const normalizedContent = normalizeCanonical(rawContent) as typeof rawContent;
  const contentHash = createHash(AI_FASCICOLO_SNAPSHOT_CONTENT_HASH_ALGORITHM)
    .update(stableSerialize({
      schemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
      content: normalizedContent,
    }))
    .digest("hex");

  return {
    content: normalizedContent,
    metadata: {
      schemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      generatedByActorId: actor.id,
      generatedByRole: actor.role,
      contentHashAlgorithm: AI_FASCICOLO_SNAPSHOT_CONTENT_HASH_ALGORITHM,
      contentHash,
    },
  };
}
