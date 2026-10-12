import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { discoverItalianLegalReferences } from "@/server/intake/legal-reference-discovery/parser";
import {
  NORMATTIVA_PROVIDER,
  createNormattivaOfficialProvider,
} from "@/server/intake/official-source-lookup/normattiva";
import {
  assessLegalSourceTemporalApplicability,
} from "@/server/legal-sources/temporal";
import { persistTemporalAssessment } from "@/server/legal-sources/temporal/persistence";

import type { AuthorityCandidate } from "./bridge";
import {
  SOURCE_CHAIN_VERIFICATION_VERSION,
  evaluateContentVerification,
  evaluateExactRetrieval,
  evaluateIdentityVerification,
  temporalStateFromAssessment,
} from "./source-chain";
import { persistSourceChainAssessment } from "./source-chain-persistence";

const MAX_OFFICIAL_DOCUMENT_BYTES = 2 * 1024 * 1024;
const NORMATTIVA_AKN_ENDPOINT = "https://www.normattiva.it/do/atto/caricaAKN";

type CandidateRow = Readonly<{
  id: string;
  candidateSnapshot: unknown;
}>;

type MissionRow = Readonly<{
  id: string;
  tenantId: string;
  caseId: string;
  researchQuestion: string;
  researchQuestionSemanticKey: string;
  missionFingerprint: string;
  referenceDate: Date;
  referenceDateBasis: unknown;
  lifecycleStatus: string;
}>;

type AknEvidence = Readonly<{
  bytes: Uint8Array;
  contentSha256: string;
  expressionDate: string;
  expressionKey: string;
  citationAnchor: Readonly<{ section: string; anchor: string }>;
  sourceUrl: string;
}>;

export type OfficialSourceVerificationResult = Readonly<{
  checked: number;
  verified: number;
  usable: number;
  providersUsed: readonly string[];
}>;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("it-IT");
}

function xmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function citationAnchor(xml: string, researchQuestion: string) {
  const terms = normalized(researchQuestion)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 6)
    .map((term) => term.slice(0, 7));
  const articles = [...xml.matchAll(/<article\b[^>]*\beId="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)]
    .map((match) => {
      const text = normalized(xmlText(match[2]));
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
        + (text.includes("concession") ? 2 : 0)
        + (/(efficacia|scadenza|termine)/.test(text) ? 1 : 0);
      return { anchor: match[1], text, score };
    })
    .filter((article) => article.text.includes("concession"));
  const selected = articles.sort((left, right) => right.score - left.score)[0];
  if (!selected || selected.score < 3) return null;
  const articleNumber = /^art_(.+)$/.exec(selected.anchor)?.[1]?.replace(/_/g, "-");
  return {
    section: articleNumber ? `Art. ${articleNumber}` : selected.anchor,
    anchor: selected.anchor,
  };
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error(`OFFICIAL_SOURCE_HTTP_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OFFICIAL_DOCUMENT_BYTES) {
    throw new Error("OFFICIAL_SOURCE_RESPONSE_TOO_LARGE");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_OFFICIAL_DOCUMENT_BYTES) {
        await reader.cancel();
        throw new Error("OFFICIAL_SOURCE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("OFFICIAL_SOURCE_SESSION_COOKIE_MISSING");
  return setCookie
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((item) => item.split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function acquireNormattivaAkn(input: {
  candidateUrl: string;
  providerRecordId: string;
  publicationDate: Date | null;
  referenceDate: Date;
  researchQuestion: string;
}): Promise<AknEvidence> {
  if (!input.publicationDate) throw new Error("NORMATTIVA_PUBLICATION_DATE_MISSING");
  const detailUrl = new URL(input.candidateUrl);
  if (detailUrl.protocol !== "https:" || detailUrl.hostname !== "www.normattiva.it") {
    throw new Error("NORMATTIVA_SOURCE_URL_INVALID");
  }
  detailUrl.searchParams.set("atto.dataVigenza", input.referenceDate.toISOString().slice(0, 10));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const session = await fetch(detailUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml",
        "User-Agent": "concessioni-portuali-official-research/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!session.ok) throw new Error(`NORMATTIVA_SESSION_HTTP_${session.status}`);
    const cookies = cookieHeader(session);
    await session.body?.cancel();
    const dataGu = input.publicationDate.toISOString().slice(0, 10).replace(/-/g, "");
    const dataVigenza = input.referenceDate.toISOString().slice(0, 10).replace(/-/g, "");
    const aknUrl = new URL(NORMATTIVA_AKN_ENDPOINT);
    aknUrl.searchParams.set("dataGU", dataGu);
    aknUrl.searchParams.set("codiceRedaz", input.providerRecordId);
    aknUrl.searchParams.set("dataVigenza", dataVigenza);
    const response = await fetch(aknUrl, {
      headers: {
        Accept: "application/xml,text/xml",
        Cookie: cookies,
        Referer: detailUrl.toString(),
        "User-Agent": "concessioni-portuali-official-research/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = await readBoundedBytes(response);
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!/<akomaNtoso\b/.test(xml) || !xml.includes(input.providerRecordId)) {
      throw new Error("NORMATTIVA_AKN_IDENTITY_MISMATCH");
    }
    const expression = /<FRBRExpression>[\s\S]*?<FRBRuri\s+value="([^"]+)"[\s\S]*?<FRBRdate\s+date="(\d{4}-\d{2}-\d{2})"/.exec(xml);
    if (!expression) throw new Error("NORMATTIVA_AKN_EXPRESSION_MISSING");
    const anchor = citationAnchor(xml, input.researchQuestion);
    if (!anchor) throw new Error("NORMATTIVA_RELEVANT_CITATION_ANCHOR_MISSING");
    return {
      bytes,
      contentSha256: sha256(bytes),
      expressionDate: expression[2],
      expressionKey: expression[1],
      citationAnchor: anchor,
      sourceUrl: aknUrl.toString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function candidate(value: unknown): AuthorityCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<AuthorityCandidate>;
  return typeof item.candidateId === "string"
    && typeof item.toolId === "string"
    && typeof item.sourceUrl === "string"
    && typeof item.officialIdentifier === "string"
    ? item as AuthorityCandidate
    : null;
}

function normattivaReference(item: AuthorityCandidate) {
  const references = discoverItalianLegalReferences([
    item.officialIdentifier,
    item.title,
  ].filter((value): value is string => Boolean(value)).join(" "));
  return references.find((reference) => reference.kind === "LEGISLATION") ?? null;
}

async function persistVerifiedNormattivaSource(input: {
  mission: MissionRow;
  resultId: string;
  candidate: AuthorityCandidate;
  actorId: string;
  providerHit: {
    providerRecordId: string;
    sourceType: string | null;
    actNumber: string | null;
    actYear: number | null;
    issuedAt: Date | null;
    title: string | null;
    publishedAt: Date | null;
  };
  evidence: AknEvidence;
}): Promise<boolean> {
  const sourceKey = `official:normattiva:${input.providerHit.providerRecordId}`;
  const title = input.providerHit.title ?? input.candidate.title ?? sourceKey;
  const source = await prisma.legalSource.upsert({
    where: { sourceKey },
    update: {
      title,
      status: "CURRENT",
      confidence: "HIGH",
      humanReviewRequired: false,
      publicationDate: input.providerHit.publishedAt,
      sourceOrigin: NORMATTIVA_PROVIDER,
    },
    create: {
      sourceKey,
      title,
      sourceType: "LEGGE",
      resourceSemanticType: "NORMATIVE_INSTRUMENT",
      legalAuthorityKind: "LEGISLATION",
      sourceCharacter: "PUBLIC_OFFICIAL",
      status: "CURRENT",
      role: "NORMATIVE",
      legalRank: "NATIONAL_LAW",
      territorialScope: "NATIONAL",
      confidence: "HIGH",
      issuingBody: "Repubblica Italiana",
      sourceNumber: input.providerHit.actNumber,
      sourceDate: input.providerHit.issuedAt,
      sourceOrigin: NORMATTIVA_PROVIDER,
      publicationDate: input.providerHit.publishedAt,
      effectiveFrom: new Date(`${input.evidence.expressionDate}T00:00:00.000Z`),
      humanReviewRequired: false,
      isConformative: true,
      isExtractable: true,
      identityNamespace: "NORMATTIVA_CODICE_REDAZIONALE",
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: input.providerHit.providerRecordId,
    },
  });
  const expression = await prisma.legalExpressionVersion.upsert({
    where: {
      sourceFamilyId_expressionKey: {
        sourceFamilyId: source.id,
        expressionKey: input.evidence.expressionKey,
      },
    },
    update: {},
    create: {
      sourceFamilyId: source.id,
      expressionKey: input.evidence.expressionKey,
      publicationDate: input.providerHit.publishedAt,
      effectiveFrom: new Date(`${input.evidence.expressionDate}T00:00:00.000Z`),
      expressionStatus: "CURRENT",
    },
  });
  const version = await prisma.legalSourceVersion.upsert({
    where: {
      sourceFamilyId_observedSha256: {
        sourceFamilyId: source.id,
        observedSha256: input.evidence.contentSha256,
      },
    },
    update: {},
    create: {
      sourceFamilyId: source.id,
      legalExpressionVersionId: expression.id,
      observedSha256: input.evidence.contentSha256,
      observedSizeBytes: input.evidence.bytes.byteLength,
      observedMimeType: "application/xml",
      versionLabel: input.evidence.expressionKey,
      publicationDate: input.providerHit.publishedAt,
      effectiveFrom: new Date(`${input.evidence.expressionDate}T00:00:00.000Z`),
      legalLifecycleStatus: "CURRENT",
    },
  });
  const acquisitionKey = sha256([
    source.id,
    version.id,
    input.evidence.sourceUrl,
    input.evidence.contentSha256,
  ].join("\0"));
  const acquisition = await prisma.legalSourceAcquisition.upsert({
    where: { idempotencyKey: acquisitionKey },
    update: {},
    create: {
      sourceFamilyId: source.id,
      sourceVersionId: version.id,
      idempotencyKey: acquisitionKey,
      outcome: "ACQUIRED",
      originClass: "PUBLIC_OFFICIAL_API",
      providerOrChannel: NORMATTIVA_PROVIDER,
      originalUrl: input.evidence.sourceUrl,
      externalSourceId: input.providerHit.providerRecordId,
      artifactLocator: input.evidence.sourceUrl,
      acquiredAt: new Date(),
      observedSha256: input.evidence.contentSha256,
      observedSizeBytes: input.evidence.bytes.byteLength,
      observedMimeType: "application/xml",
      acquiredByActorId: input.actorId,
      acquiredByProcess: "LEGAL_RESEARCH_OFFICIAL_SOURCE_VERIFICATION_V1",
    },
  });
  const assertion = await prisma.legalSourceIdentityAssertion.findFirst({
    where: {
      sourceFamilyId: source.id,
      identifierScheme: "NORMATTIVA_CODICE_REDAZIONALE",
      normalizedValue: input.providerHit.providerRecordId,
    },
  });
  if (assertion) {
    await prisma.legalSourceIdentityAssertion.update({
      where: { id: assertion.id },
      data: {
        verificationStatus: "VERIFIED",
        provenanceReference: input.evidence.sourceUrl,
        verifiedAt: new Date(),
      },
    });
  } else {
    await prisma.legalSourceIdentityAssertion.create({
      data: {
        sourceFamilyId: source.id,
        identifierScheme: "NORMATTIVA_CODICE_REDAZIONALE",
        rawValue: input.candidate.officialIdentifier,
        normalizedValue: input.providerHit.providerRecordId,
        issuingAuthority: "Normattiva",
        jurisdiction: "IT",
        verificationStatus: "VERIFIED",
        provenanceReference: input.evidence.sourceUrl,
        verifiedAt: new Date(),
      },
    });
  }
  const temporalInput = {
    sourceFamilyId: source.id,
    legalAuthorityKind: "LEGISLATION" as const,
    sourceStatus: "CURRENT" as const,
    expression: {
      expressionId: expression.id,
      publicationDate: input.providerHit.publishedAt?.toISOString() ?? null,
      effectiveFrom: expression.effectiveFrom?.toISOString() ?? null,
      effectiveTo: null,
      expressionStatus: expression.expressionStatus,
      correctionMetadata: null,
      consolidationMetadata: null,
    },
    referenceDate: input.mission.referenceDate.toISOString(),
    temporalEvidence: { authoritativeAsOfDate: true },
  };
  const temporalResult = assessLegalSourceTemporalApplicability(temporalInput);
  const temporal = await persistTemporalAssessment(temporalInput, temporalResult);
  const exact = evaluateExactRetrieval({
    sourceType: input.providerHit.sourceType ?? undefined,
    canonicalIdentifier: input.candidate.officialIdentifier,
    title: input.candidate.title,
    sourceUrl: input.candidate.sourceUrl,
    officiality: "OFFICIAL",
  }, {
    sourceType: input.providerHit.sourceType ?? undefined,
    canonicalIdentifier: input.providerHit.providerRecordId,
    title: input.candidate.title,
    sourceUrl: input.evidence.sourceUrl,
    officiality: "OFFICIAL",
  });
  const identity = evaluateIdentityVerification({
    retrievalState: exact.state,
    assertionStates: ["VERIFIED"],
  });
  const content = evaluateContentVerification({
    textState: "FULL_TEXT",
    acquiredContentSha256: input.evidence.contentSha256,
    expectedContentSha256: input.evidence.contentSha256,
    acquiredText: null,
    citedText: null,
    citationAnchors: [input.evidence.citationAnchor],
  });
  const temporalState = temporalStateFromAssessment({
    questionReferenceDate: input.mission.referenceDate.toISOString(),
    assessmentReferenceDate: temporal.assessment.referenceDate.toISOString(),
    applicabilityState: temporal.assessment.applicabilityState === "APPLICABLE_ON_DATE"
      ? "APPLICABLE"
      : temporal.assessment.applicabilityState === "NOT_APPLICABLE_ON_DATE"
        ? "NOT_APPLICABLE"
        : temporal.assessment.applicabilityState,
  });
  const assessment = await persistSourceChainAssessment({
    resultId: input.resultId,
    tenantId: input.mission.tenantId,
    caseId: input.mission.caseId,
    missionId: input.mission.id,
    researchQuestionSemanticKey: input.mission.researchQuestionSemanticKey,
    missionFingerprint: input.mission.missionFingerprint,
    referenceDate: input.mission.referenceDate.toISOString().slice(0, 10),
    referenceDateBasis: input.mission.referenceDateBasis as Record<string, unknown>,
    verificationVersion: SOURCE_CHAIN_VERIFICATION_VERSION,
    sourceFamilyId: source.id,
    sourceVersionId: version.id,
    acquisitionId: acquisition.id,
    temporalAssessmentId: temporal.assessment.id,
    sourceIdentityKey: input.providerHit.providerRecordId,
    contentSha256: input.evidence.contentSha256,
    retrievalState: exact.state,
    textState: "FULL_TEXT",
    identityState: identity.state,
    contentState: content.state,
    temporalState,
    adverseState: "NOT_REQUIRED",
    officiality: "OFFICIAL",
    citationAnchors: [input.evidence.citationAnchor],
    manualReviewRequired: exact.manualReviewRequired
      || identity.manualReviewRequired
      || temporal.assessment.humanReviewRequired,
    manualReviewReason: exact.manualReviewRequired
      ? "SOURCE_RETRIEVAL_REVIEW_REQUIRED"
      : identity.reason,
    currentMission: input.mission.lifecycleStatus === "CURRENT",
  });
  return assessment.usable;
}

export async function verifyOfficialResearchSources(input: {
  missionId: string;
  tenantId: string;
  caseId: string;
  actorId: string;
}): Promise<OfficialSourceVerificationResult> {
  const missionRecord = await prisma.researchMissionRecord.findUnique({
    where: { id: input.missionId },
    select: {
      id: true,
      tenantId: true,
      caseId: true,
      payload: true,
      researchQuestionSemanticKey: true,
      missionFingerprint: true,
      referenceDate: true,
      referenceDateBasis: true,
      lifecycleStatus: true,
    },
  });
  if (!missionRecord
    || missionRecord.tenantId !== input.tenantId
    || missionRecord.caseId !== input.caseId
    || !missionRecord.researchQuestionSemanticKey
    || !missionRecord.missionFingerprint) {
    throw new Error("OFFICIAL_SOURCE_VERIFICATION_SCOPE_MISMATCH");
  }
  const payload = missionRecord.payload as { researchQuestion?: unknown };
  if (typeof payload.researchQuestion !== "string" || !payload.researchQuestion.trim()) {
    throw new Error("OFFICIAL_SOURCE_VERIFICATION_QUESTION_MISSING");
  }
  const mission: MissionRow = {
    id: missionRecord.id,
    tenantId: missionRecord.tenantId,
    caseId: missionRecord.caseId,
    researchQuestion: payload.researchQuestion,
    researchQuestionSemanticKey: missionRecord.researchQuestionSemanticKey,
    missionFingerprint: missionRecord.missionFingerprint,
    referenceDate: missionRecord.referenceDate,
    referenceDateBasis: missionRecord.referenceDateBasis,
    lifecycleStatus: missionRecord.lifecycleStatus,
  };
  const resultRows: CandidateRow[] = await prisma.researchQuestionResultRecord.findMany({
    where: { missionId: input.missionId, tenantId: input.tenantId, caseId: input.caseId },
    select: { id: true, candidateSnapshot: true },
    orderBy: { createdAt: "asc" },
  });
  const normattivaCandidates = resultRows.flatMap((row) => {
    const item = candidate(row.candidateSnapshot);
    if (!item || new URL(item.sourceUrl!).hostname !== "www.normattiva.it") return [];
    const reference = normattivaReference(item);
    return reference ? [{ row, item, reference }] : [];
  });
  const uniqueCandidates = [...new Map(normattivaCandidates.map((entry) => (
    [entry.item.officialIdentifier, entry] as const
  ))).values()];
  const provider = createNormattivaOfficialProvider();
  let verified = 0;
  let usable = 0;
  for (const entry of uniqueCandidates) {
    if (!provider.supports(entry.reference)) continue;
    const lookup = await provider.lookup(entry.reference);
    if (lookup.status !== "FOUND_UNIQUE") continue;
    const hit = lookup.hits[0];
    if (hit.documentKind !== "LEGISLATION"
      || hit.providerRecordId !== entry.item.officialIdentifier) continue;
    const evidence = await acquireNormattivaAkn({
      candidateUrl: entry.item.sourceUrl!,
      providerRecordId: hit.providerRecordId,
      publicationDate: hit.publishedAt,
      referenceDate: mission.referenceDate,
      researchQuestion: mission.researchQuestion,
    });
    verified += 1;
    if (await persistVerifiedNormattivaSource({
      mission,
      resultId: entry.row.id,
      candidate: entry.item,
      actorId: input.actorId,
      providerHit: hit,
      evidence,
    })) usable += 1;
  }
  return {
    checked: uniqueCandidates.length,
    verified,
    usable,
    providersUsed: verified > 0 ? [NORMATTIVA_PROVIDER] : [],
  };
}
