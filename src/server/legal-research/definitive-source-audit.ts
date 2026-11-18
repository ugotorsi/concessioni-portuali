import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import {
  createAuthorityCandidate,
  RESEARCH_BRIDGE_VERSION,
  type AuthorityCandidate,
} from "./bridge";
import { persistResearchQuestionResults } from "./question-results";
import {
  persistSourceChainAssessment,
  type PersistedSourceAssessment,
} from "./source-chain-persistence";
import { SOURCE_CHAIN_VERIFICATION_VERSION } from "./source-chain";

export const DEFINITIVE_SOURCE_AUDIT_VERSION = "NOETRA_V7_DEFINITIVE_SOURCE_AUDIT_V1" as const;

export type DefinitiveSourceAuditClassification =
  | "NON_VERIFICABILE"
  | "PERTINENTE_IN_ASTRATTO_NON_APPLICABILE_ALLO_STATO";

export interface DefinitiveSourceAuditItem {
  key: string;
  originalCandidateId: string;
  title: string;
  canonicalIdentifier: string;
  issuingBody: string;
  documentType: string;
  documentDate: string;
  sourceFamily: "GIUSTIZIA_AMMINISTRATIVA" | "EU_LEGISLATION";
  sourceUrl: string;
  sourceOrigin: "OpenGA" | "EUR-Lex";
  classification: DefinitiveSourceAuditClassification;
  relevantRule: string;
  applicabilityReason: string;
  limitation: string;
}

const OPEN_GA_TAR_SICILIA_CATANIA =
  "https://openga.giustizia-amministrativa.it/dataset/tar-sicilia-catania-sentenze";
const OPEN_GA_TAR_ABRUZZO_PESCARA =
  "https://openga.giustizia-amministrativa.it/dataset/tar-abruzzo-pescara-sentenze";
const OPEN_GA_TAR_LAZIO_ROMA =
  "https://openga.giustizia-amministrativa.it/dataset/tar-lazio-roma-sentenze";
const OPEN_GA_TAR_CAMPANIA_SALERNO =
  "https://openga.giustizia-amministrativa.it/dataset/tar-campania-salerno-sentenze";
const EUR_LEX_REGULATION_2017_352 =
  "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32017R0352";

export const DEFINITIVE_SOURCE_AUDIT_ITEMS: readonly DefinitiveSourceAuditItem[] = [
  {
    key: "tar-sicilia-catania-2351-2021",
    originalCandidateId: "authority-candidate:3ca562e4842d5840c8a4033dd51fb8d0b3f6f17d5dc7df67483d8f774bb6e0c1",
    title: "TAR Sicilia-Catania, sez. III, sentenza n. 2351/2021",
    canonicalIdentifier: "IT-GA:TAR-SICILIA-CATANIA:2021:2351",
    issuingBody: "TAR Sicilia-Catania, sezione III",
    documentType: "sentenza",
    documentDate: "2021-07-19",
    sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
    sourceUrl: OPEN_GA_TAR_SICILIA_CATANIA,
    sourceOrigin: "OpenGA",
    classification: "NON_VERIFICABILE",
    relevantRule: "Nessun principio giuridico attribuibile sulla sola base dei metadati ufficiali.",
    applicabilityReason:
      "L'oggetto ufficiale riguarda revoca e archiviazione di una concessione demaniale marittima, ma non dimostra una regola sui requisiti o sulla tempestiva acquisizione della polizza del fascicolo.",
    limitation:
      "OpenGA verifica identità, sezione, data, ricorso, esito e oggetto; manca il testo ufficiale integrale necessario per verificare ratio decidendi e passaggi pertinenti.",
  },
  {
    key: "tar-abruzzo-pescara-17-2019",
    originalCandidateId: "authority-candidate:8214659bd87f7edb03e852bae931753a4ff948b36de4fb9276b1622571829efe",
    title: "TAR Abruzzo-Pescara, sez. I, sentenza n. 17/2019",
    canonicalIdentifier: "IT-GA:TAR-ABRUZZO-PESCARA:2019:17",
    issuingBody: "TAR Abruzzo-Pescara, sezione I",
    documentType: "sentenza",
    documentDate: "2019-01-31",
    sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
    sourceUrl: OPEN_GA_TAR_ABRUZZO_PESCARA,
    sourceOrigin: "OpenGA",
    classification: "NON_VERIFICABILE",
    relevantRule: "Nessun principio giuridico attribuibile sulla sola base dei metadati ufficiali.",
    applicabilityReason:
      "L'oggetto ufficiale riguarda la decadenza di una diversa concessione demaniale marittima; non identifica una regola applicabile alla garanzia assicurativa di CP-058/2019.",
    limitation:
      "Il testo ufficiale integrale e la motivazione non sono stati acquisiti; il passaggio del provider non sostituisce una fonte primaria verificata.",
  },
  {
    key: "tar-lazio-roma-9229-2026",
    originalCandidateId: "authority-candidate:62423c11aced7ecde7bb1e25d4e258a6f0ce12cdc29d365455bc578515962555",
    title: "TAR Lazio-Roma, sez. V-ter, sentenza breve n. 9229/2026",
    canonicalIdentifier: "IT-GA:TAR-LAZIO-ROMA:2026:9229",
    issuingBody: "TAR Lazio-Roma, sezione V-ter",
    documentType: "sentenza breve",
    documentDate: "2026-05-18",
    sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
    sourceUrl: OPEN_GA_TAR_LAZIO_ROMA,
    sourceOrigin: "OpenGA",
    classification: "NON_VERIFICABILE",
    relevantRule: "Nessun principio giuridico attribuibile sulla sola base dei metadati ufficiali.",
    applicabilityReason:
      "L'oggetto ufficiale menziona polizze sostitutive e subentro in una concessione turistico-ricreativa, quindi è tematicamente vicino ma non prova la regola decisoria applicabile al diverso fascicolo.",
    limitation:
      "Manca il testo ufficiale integrale; non sono verificabili il contenuto dell'art. 9.4 richiamato dal provider, la ratio decidendi e la comparabilità delle clausole.",
  },
  {
    key: "tar-sicilia-catania-1859-2025",
    originalCandidateId: "authority-candidate:29706f89c000445bc2f5523c9a6af925ec3c9f5903737865b1a783a5faaad3f9",
    title: "TAR Sicilia-Catania, sez. III, sentenza n. 1859/2025",
    canonicalIdentifier: "IT-GA:TAR-SICILIA-CATANIA:2025:1859",
    issuingBody: "TAR Sicilia-Catania, sezione III",
    documentType: "sentenza",
    documentDate: "2025-06-10",
    sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
    sourceUrl: OPEN_GA_TAR_SICILIA_CATANIA,
    sourceOrigin: "OpenGA",
    classification: "NON_VERIFICABILE",
    relevantRule: "Nessun principio giuridico attribuibile sulla sola base dei metadati ufficiali.",
    applicabilityReason:
      "L'oggetto ufficiale riguarda il diniego di una concessione per attività cantieristica e non dimostra una regola sui requisiti assicurativi o sulla prova della loro acquisizione.",
    limitation:
      "Il testo ufficiale integrale non è stato acquisito; vicinanza istituzionale e materia demaniale non dimostrano applicabilità.",
  },
  {
    key: "tar-campania-salerno-11-2026",
    originalCandidateId: "authority-candidate:bbcb9b20980b71be29fa0c649814a1913854c9eb5d24d92dcd97734e33dbbb3b",
    title: "TAR Campania-Salerno, sez. III, sentenza n. 11/2026",
    canonicalIdentifier: "IT-GA:TAR-CAMPANIA-SALERNO:2026:11",
    issuingBody: "TAR Campania-Salerno, sezione III",
    documentType: "sentenza",
    documentDate: "2026-01-05",
    sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
    sourceUrl: OPEN_GA_TAR_CAMPANIA_SALERNO,
    sourceOrigin: "OpenGA",
    classification: "NON_VERIFICABILE",
    relevantRule: "Nessun principio giuridico attribuibile sulla sola base dei metadati ufficiali.",
    applicabilityReason:
      "L'oggetto ufficiale riguarda l'affidamento della stazione marittima passeggeri, ma non identifica una regola sulla polizza della concessione CP-058/2019.",
    limitation:
      "Manca il testo ufficiale integrale e non è dimostrata la comparabilità tra la procedura di affidamento esaminata e il procedimento di chiarimenti del fascicolo.",
  },
  {
    key: "reg-ue-2017-352-art-4",
    originalCandidateId: "authority-candidate:2b68d43636a0822bc78409693fd64802e282e21de687ec823afcbad910c9281e",
    title: "Regolamento (UE) 2017/352, articolo 4",
    canonicalIdentifier: "CELEX:32017R0352:ART_4",
    issuingBody: "Parlamento europeo e Consiglio dell'Unione europea",
    documentType: "regolamento UE",
    documentDate: "2017-02-15",
    sourceFamily: "EU_LEGISLATION",
    sourceUrl: EUR_LEX_REGULATION_2017_352,
    sourceOrigin: "EUR-Lex",
    classification: "PERTINENTE_IN_ASTRATTO_NON_APPLICABILE_ALLO_STATO",
    relevantRule:
      "L'ente di gestione o l'autorità competente può imporre ai prestatori di servizi portuali requisiti minimi, inclusi requisiti di assicurazione, purché trasparenti, obiettivi, non discriminatori e proporzionati.",
    applicabilityReason:
      "La fonte può rilevare se la polizza di CP-058/2019 è un requisito imposto al prestatore del servizio passeggeri ai sensi del regolamento.",
    limitation:
      "Il fascicolo non contiene l'atto concessorio o autorizzatorio che colleghi la prescrizione assicurativa al regime dei servizi portuali; la mera destinazione del locale a servizi passeggeri non basta.",
  },
  {
    key: "reg-ue-2017-352-art-5",
    originalCandidateId: "authority-candidate:c867a86c498455c90a3d78e8c3cfd0ec4e17eba2c43302f619e69f3b6d750e1b",
    title: "Regolamento (UE) 2017/352, articolo 5",
    canonicalIdentifier: "CELEX:32017R0352:ART_5",
    issuingBody: "Parlamento europeo e Consiglio dell'Unione europea",
    documentType: "regolamento UE",
    documentDate: "2017-02-15",
    sourceFamily: "EU_LEGISLATION",
    sourceUrl: EUR_LEX_REGULATION_2017_352,
    sourceOrigin: "EUR-Lex",
    classification: "PERTINENTE_IN_ASTRATTO_NON_APPLICABILE_ALLO_STATO",
    relevantRule:
      "La procedura di verifica dei requisiti minimi deve assicurare trattamento trasparente, obiettivo, non discriminatorio e proporzionato e una decisione motivata.",
    applicabilityReason:
      "La fonte può rilevare per valutare il procedimento seguito sull'eventuale requisito assicurativo previsto per il prestatore del servizio passeggeri.",
    limitation:
      "Mancano l'atto che introduce il requisito, la qualificazione del rapporto come servizio portuale e gli atti procedimentali necessari per verificare il rispetto dell'articolo 5.",
  },
] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}:${hash(value)}`.slice(0, 96);
}

export function toAuditedAuthorityCandidate(
  item: DefinitiveSourceAuditItem,
  executionRecordId: string,
): AuthorityCandidate {
  return createAuthorityCandidate({
    kind: "AUTHORITY_CANDIDATE",
    executionRecordId,
    toolId: "OFFICIAL_SOURCE_AUDIT",
    providerId: item.sourceOrigin === "OpenGA" ? "it.official.openga" : "eu.official.eur-lex",
    courtOrBody: item.issuingBody,
    documentType: item.documentType,
    documentDate: item.documentDate,
    officialIdentifier: item.canonicalIdentifier,
    title: item.title,
    sourceUrl: item.sourceUrl,
    providerDocumentId: item.canonicalIdentifier,
    exactReferenceMatch: true,
    relevantPassage: `${item.relevantRule} ${item.applicabilityReason}`,
    summary: `${item.classification}: ${item.limitation}`,
    supportDirection: "UNKNOWN",
    sourceFamily: item.sourceFamily,
    retrievalMethod: "EXACT_RETRIEVAL",
    fullTextAvailable: false,
    verificationState: "OFFICIALLY_VERIFIED",
  });
}

async function persistOfficialIdentity(input: {
  tenantId: string;
  item: DefinitiveSourceAuditItem;
  referenceDate: Date;
}): Promise<{ sourceFamilyId: string; temporalAssessmentId: string }> {
  const { item } = input;
  const sourceFamily = await prisma.legalSource.upsert({
    where: { sourceKey: `official-audit:${item.canonicalIdentifier}` },
    create: {
      sourceKey: `official-audit:${item.canonicalIdentifier}`,
      title: item.title,
      sourceType: item.sourceFamily === "EU_LEGISLATION" ? "REGOLAMENTO" : "ALTRO",
      resourceSemanticType: item.sourceFamily === "EU_LEGISLATION"
        ? "NORMATIVE_INSTRUMENT"
        : "JUDICIAL_DECISION",
      legalAuthorityKind: item.sourceFamily === "EU_LEGISLATION" ? "LEGISLATION" : "CASE_LAW",
      status: "IDENTITY_VERIFIED_PENDING_VALIDITY",
      role: item.sourceFamily === "EU_LEGISLATION" ? "NORMATIVE" : "CASE_SPECIFIC",
      confidence: "HIGH",
      issuingBody: item.issuingBody,
      sourceNumber: item.canonicalIdentifier,
      sourceDate: new Date(`${item.documentDate}T00:00:00.000Z`),
      sourceOrigin: item.sourceOrigin,
      publicationDate: new Date(`${item.documentDate}T00:00:00.000Z`),
      notes: `${item.classification}: ${item.limitation}`,
      tags: {
        auditVersion: DEFINITIVE_SOURCE_AUDIT_VERSION,
        originalCandidateId: item.originalCandidateId,
        relevantRule: item.relevantRule,
        applicabilityReason: item.applicabilityReason,
      },
      humanReviewRequired: true,
      isConformative: false,
      isExtractable: item.sourceFamily === "EU_LEGISLATION",
      identityNamespace: "OFFICIAL_LEGAL_SOURCE",
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: item.canonicalIdentifier,
    },
    update: {
      notes: `${item.classification}: ${item.limitation}`,
      tags: {
        auditVersion: DEFINITIVE_SOURCE_AUDIT_VERSION,
        originalCandidateId: item.originalCandidateId,
        relevantRule: item.relevantRule,
        applicabilityReason: item.applicabilityReason,
      },
      humanReviewRequired: true,
      isConformative: false,
    },
    select: { id: true },
  });
  await prisma.legalSourceIdentityAssertion.upsert({
    where: {
      sourceFamilyId_identifierScheme_normalizedValue: {
        sourceFamilyId: sourceFamily.id,
        identifierScheme: item.sourceFamily === "EU_LEGISLATION" ? "CELEX_ARTICLE" : "GIUSTIZIA_AMMINISTRATIVA",
        normalizedValue: item.canonicalIdentifier,
      },
    },
    create: {
      sourceFamilyId: sourceFamily.id,
      identifierScheme: item.sourceFamily === "EU_LEGISLATION" ? "CELEX_ARTICLE" : "GIUSTIZIA_AMMINISTRATIVA",
      rawValue: item.canonicalIdentifier,
      normalizedValue: item.canonicalIdentifier,
      issuingAuthority: item.issuingBody,
      jurisdiction: item.sourceFamily === "EU_LEGISLATION" ? "EU" : "IT",
      verificationStatus: "VERIFIED",
      provenanceReference: item.sourceUrl,
      verifiedAt: new Date(),
    },
    update: {
      verificationStatus: "VERIFIED",
      provenanceReference: item.sourceUrl,
      verifiedAt: new Date(),
    },
  });
  const expression = await prisma.legalExpressionVersion.upsert({
    where: {
      sourceFamilyId_expressionKey: {
        sourceFamilyId: sourceFamily.id,
        expressionKey: `${item.canonicalIdentifier}:IT`,
      },
    },
    create: {
      sourceFamilyId: sourceFamily.id,
      expressionKey: `${item.canonicalIdentifier}:IT`,
      publicationDate: new Date(`${item.documentDate}T00:00:00.000Z`),
      effectiveFrom: new Date(`${item.documentDate}T00:00:00.000Z`),
      expressionStatus: "IDENTITY_ONLY_OFFICIAL_METADATA",
    },
    update: {},
    select: { id: true },
  });
  const temporalInput = {
    sourceFamilyId: sourceFamily.id,
    legalExpressionVersionId: expression.id,
    assessmentVersion: DEFINITIVE_SOURCE_AUDIT_VERSION,
    referenceDate: input.referenceDate.toISOString().slice(0, 10),
    sourceDate: item.documentDate,
  };
  const temporalAssessment = await prisma.legalSourceTemporalAssessment.upsert({
    where: { inputFingerprint: hash(temporalInput) },
    create: {
      sourceFamilyId: sourceFamily.id,
      legalExpressionVersionId: expression.id,
      assessmentVersion: DEFINITIVE_SOURCE_AUDIT_VERSION,
      referenceDate: input.referenceDate,
      validityState: "IDENTITY_VERIFIED",
      temporalWindowState: "ON_OR_BEFORE_REFERENCE_DATE",
      applicabilityState: "APPLICABLE",
      reasonCodes: ["SOURCE_PREDATES_REFERENCE_DATE"],
      effectiveFromSnapshot: new Date(`${item.documentDate}T00:00:00.000Z`),
      humanReviewRequired: true,
      confidence: "HIGH",
      inputFingerprint: hash(temporalInput),
    },
    update: {},
    select: { id: true },
  });
  return {
    sourceFamilyId: sourceFamily.id,
    temporalAssessmentId: temporalAssessment.id,
  };
}

export interface PersistDefinitiveSourceAuditInput {
  tenantId: string;
  caseId: string;
  missionId: string;
  actorId: string;
}

export interface PersistDefinitiveSourceAuditResult {
  attemptId: string;
  bundleId: string;
  candidates: readonly AuthorityCandidate[];
  assessments: readonly PersistedSourceAssessment[];
}

export async function persistDefinitiveSourceAudit(
  input: PersistDefinitiveSourceAuditInput,
): Promise<PersistDefinitiveSourceAuditResult> {
  const mission = await prisma.researchMissionRecord.findFirst({
    where: {
      id: input.missionId,
      tenantId: input.tenantId,
      caseId: input.caseId,
      lifecycleStatus: "CURRENT",
      knowledgeRevisionId: { not: null },
      legalIssueSemanticKey: { not: null },
      researchQuestionSemanticKey: { not: null },
      missionFingerprint: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      caseId: true,
      referenceDate: true,
      referenceDateBasis: true,
      researchQuestionSemanticKey: true,
      missionFingerprint: true,
    },
  });
  if (!mission?.tenantId || !mission.researchQuestionSemanticKey || !mission.missionFingerprint) {
    throw new Error("CANONICAL_RESEARCH_MISSION_REQUIRED");
  }
  const researchQuestionSemanticKey = mission.researchQuestionSemanticKey;
  const missionFingerprint = mission.missionFingerprint;
  const attemptId = deterministicId("research-audit-attempt", {
    missionId: mission.id,
    version: DEFINITIVE_SOURCE_AUDIT_VERSION,
  });
  const bundleId = deterministicId("research-audit-bundle", {
    missionId: mission.id,
    version: DEFINITIVE_SOURCE_AUDIT_VERSION,
  });
  const candidates = DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) =>
    toAuditedAuthorityCandidate(item, attemptId));
  const completedAt = new Date();
  const payload = {
    kind: "RESEARCH_EVIDENCE_BUNDLE",
    version: RESEARCH_BRIDGE_VERSION,
    auditVersion: DEFINITIVE_SOURCE_AUDIT_VERSION,
    missionId: mission.id,
    executionId: attemptId,
    startedAt: completedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    researchToolExecutions: [],
    authorityCandidates: candidates,
    citationObservations: [],
    legalResearchSuggestions: [],
    evidenceGaps: DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) => ({
      gapId: deterministicId("audit-gap", item.key),
      kind: item.classification,
      description: item.limitation,
    })),
    conflicts: [],
    unresolvedQuestions: DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) => item.limitation),
    suggestedFollowUpMissions: [],
    humanDecisionEscalations: [],
    completionState: "PARTIAL",
  } satisfies Prisma.InputJsonObject;
  const bundleFingerprint = hash(payload);
  const claimToken = hash({ attemptId, actorId: input.actorId });
  await prisma.$transaction(async (tx) => {
    await tx.researchExecutionAttempt.upsert({
      where: { id: attemptId },
      create: {
        id: attemptId,
        missionId: mission.id,
        executorKind: "OFFICIAL_SOURCE_AUDIT",
        claimantId: input.actorId,
        claimToken,
        startedAt: completedAt,
        leaseExpiresAt: completedAt,
        completedAt,
        completionState: "PARTIAL",
        totalCalls: 0,
        moonlitCalls: 0,
        simpliciterCalls: 0,
        legalDataHunterCalls: 0,
        deferReason: "Official-source audit completed without provider calls; no source passed the usable-source gate.",
      },
      update: {},
    });
    await tx.researchEvidenceBundleRecord.upsert({
      where: { id: bundleId },
      create: {
        id: bundleId,
        missionId: mission.id,
        executionId: attemptId,
        contractVersion: DEFINITIVE_SOURCE_AUDIT_VERSION,
        fingerprint: bundleFingerprint,
        payload,
        completionState: "PARTIAL",
        totalCalls: 0,
        moonlitCalls: 0,
        simpliciterCalls: 0,
        legalDataHunterCalls: 0,
        submittedByActorId: input.actorId,
      },
      update: {},
    });
    await tx.researchExecutionAttempt.update({
      where: { id: attemptId },
      data: { finalBundleId: bundleId },
    });
  });
  const results = await persistResearchQuestionResults({
    missionId: mission.id,
    bundleId,
    candidates,
  });
  const assessments: PersistedSourceAssessment[] = [];
  for (const [index, result] of results.entries()) {
    const item = DEFINITIVE_SOURCE_AUDIT_ITEMS[index];
    const identity = await persistOfficialIdentity({
      tenantId: input.tenantId,
      item,
      referenceDate: mission.referenceDate,
    });
    await prisma.researchQuestionResultRecord.update({
      where: { id: result.id },
      data: {
        supportDirection: "INCONCLUSIVE",
        classificationSource: "AI_CLASSIFIER",
        classificationConfidence: 1,
        classificationRationale: `${item.classification}: ${item.applicabilityReason} Limite: ${item.limitation}`,
        classificationReviewStatus: "AI_PROPOSED",
        unresolvedAspectKeys: [item.classification],
      },
    });
    assessments.push(await persistSourceChainAssessment({
      resultId: result.id,
      tenantId: mission.tenantId,
      caseId: mission.caseId,
      missionId: mission.id,
      researchQuestionSemanticKey,
      missionFingerprint,
      referenceDate: mission.referenceDate.toISOString().slice(0, 10),
      referenceDateBasis: mission.referenceDateBasis as Readonly<Record<string, unknown>>,
      verificationVersion: SOURCE_CHAIN_VERIFICATION_VERSION,
      sourceIdentityKey: item.canonicalIdentifier,
      contentSha256: null,
      retrievalState: "RESOLVED",
      textState: "METADATA_ONLY",
      identityState: "VERIFIED",
      contentState: "INCOMPLETE",
      temporalState: "APPLICABLE",
      adverseState: "NOT_REQUIRED",
      officiality: "OFFICIAL",
      citationAnchors: [],
      manualReviewRequired: true,
      manualReviewReason: item.limitation,
      currentMission: true,
      sourceFamilyId: identity.sourceFamilyId,
      sourceVersionId: null,
      acquisitionId: null,
      temporalAssessmentId: identity.temporalAssessmentId,
    }));
  }
  return { attemptId, bundleId, candidates, assessments };
}
