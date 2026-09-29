import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWithSyntheticDocuments as verifyResearchEvidence } from "./assisted-document-fixtures";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const getLatestAssistedVerificationMock = vi.hoisted(() => vi.fn());
const persistAssistedVerificationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tenant-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-auth")>(),
  getCurrentTenantContext: getCurrentTenantContextMock,
}));

vi.mock("@/server/legal-research/persistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/legal-research/persistence")>(),
  getLatestAssistedVerification: getLatestAssistedVerificationMock,
  persistAssistedVerification: persistAssistedVerificationMock,
}));

import { GET, PATCH, POST, PUT } from "@/app/api/legal-research/assisted-verification/route";
import {
  buildInitialVerificationCommand,
  canSubmitLegalReview,
  type ReviewerVerification,
} from "@/components/legal-research/reviewer-view-model";
import {
  assistedVerificationPreClaimStatus,
  createAssistedVerificationSnapshot,
  type AssistedVerificationSnapshot,
} from "@/server/legal-research/assisted-verification";
import { RESEARCH_BRIDGE_VERSION, createResearchMission } from "@/server/legal-research/bridge";
import { ResearchPersistenceError } from "@/server/legal-research/persistence";

const missionId = `research-mission:${"a".repeat(64)}`;
const context = {
  userId: "legal-user-a",
  role: "GIURIDICO" as const,
  isAdmin: false,
  tenantMemberships: [],
  defaultTenantId: "tenant-a",
  accessibleTenantIds: ["tenant-a"],
};
const snapshot = createAssistedVerificationSnapshot({ missionId, sources: [] });
const reviewCommand = {
  missionId,
  recordId: `research-verification:${"b".repeat(64)}`,
  legalPropositionId: "proposition-a",
  rationale: "Reasoned adverse treatment for the identified proposition.",
  evidenceSourceId: "source-a",
  decision: "ADVERSE" as const,
};
const verificationMission = {
  ...createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-a" },
    legalIssueIds: ["issue-a"],
    legalPropositionIds: ["proposition-a"],
    referenceDate: "2026-09-26T00:00:00.000Z",
    mode: "ADVERSE_SEARCH",
    researchQuestion: "Verify documented adverse authority.",
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["CJEU"],
    missingSourceFamilies: [],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: false,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: true,
    },
    budget: {
      maxTotalResearchCalls: 0,
      maxMoonlitCalls: 0,
      maxSimpliciterCalls: 0,
      maxLegalDataHunterCalls: 0,
    },
    status: "PENDING",
    executionPlan: { requiredCapabilities: ["ADVERSE_AUTHORITY_DISCOVERY"] },
  }),
  missionId,
};
const sourceDraft = {
  evidenceSourceId: "source-a",
  authorityId: "authority-a",
  legalSourceId: "legal-source-a",
  legalExpressionVersionId: "expression-a",
  officialIdentifier: "ECLI:EU:C:2024:1",
  sourceUrl: "https://official.example.test/authority-a",
  sourceFamily: "CJEU" as const,
  courtOrBody: "Court of Justice of the European Union",
  documentType: "Judgment",
  contentSha256: "c".repeat(64),
  documentId: "document-a",
  fileVersionId: "file-a",
  termsOfUseBasis: "Official public-access terms checked.",
  verificationRationale: "Identity and full text matched the official publication.",
};
const initialCommand = buildInitialVerificationCommand({
  missionId,
  source: sourceDraft,
  includeCitationRelation: true,
  targetSource: {
    ...sourceDraft,
    evidenceSourceId: "source-b",
    authorityId: "authority-b",
    legalSourceId: "legal-source-b",
    legalExpressionVersionId: "expression-b",
    officialIdentifier: "ECLI:EU:C:2020:2",
    sourceUrl: "https://official.example.test/authority-b",
  },
  citationParagraph: "42",
});
const incompleteVerification = {
  recordId: `research-verification:${"b".repeat(64)}`,
  snapshot,
  result: {
    authorityCandidates: [],
    verifiedFullTexts: [],
    citationObservations: [],
    adverseAssessments: [],
    legalResearchSuggestions: [],
    evidenceGaps: [{ gapId: "gap-full-text", kind: "FULL_TEXT_NOT_VERIFIED" }],
    adverseAuthorityVerified: false,
  },
  preClaimStatus: {
    satisfied: false,
    unmetRequirements: ["FULL_TEXT_UNVERIFIED", "EVIDENCE_GAPS_REMAIN"],
  },
  fingerprint: "b".repeat(64),
  recordedByActorId: context.userId,
  createdAt: new Date("2026-09-26T10:00:00.000Z"),
} as const;

function post(body: unknown): Request {
  return new Request("https://app.example.test/api/legal-research/assisted-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(body: unknown): Request {
  return new Request("https://app.example.test/api/legal-research/assisted-verification", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("https://app.example.test/api/legal-research/assisted-verification", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type RouteVerification = ReviewerVerification & Readonly<{ recordId: string }>;

function storedVerification(snapshot: AssistedVerificationSnapshot, sequence: number): RouteVerification {
  const result = verifyResearchEvidence({ mission: verificationMission, ...snapshot });
  return {
    recordId: `research-verification:${String(sequence).padStart(64, "0")}`,
    snapshot,
    result,
    preClaimStatus: assistedVerificationPreClaimStatus(verificationMission, result),
    fingerprint: String(sequence).padStart(64, "0"),
    recordedByActorId: context.userId,
    createdAt: "2026-09-26T10:00:00.000Z",
  };
}

describe("assisted verification application route", () => {
  it.each(["reviewedByActorId", "reviewedAt", "basisFingerprint", "callerVerified"])("rejects caller-supplied search attestation %s", async field => {
    const response = await POST(post({ action: "REVIEW_ADVERSE_SEARCH", missionId, recordId: reviewCommand.recordId, [field]: "forged" }));
    expect(response.status).toBe(400);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("requests a server-assigned search review without inventing a citation", async () => {
    const response = await POST(post({ action: "REVIEW_ADVERSE_SEARCH", missionId, recordId: reviewCommand.recordId }));
    expect(response.status).toBe(201);
    expect(persistAssistedVerificationMock).toHaveBeenCalledWith({ snapshot, actor: { actorId: context.userId, tenantId: context.defaultTenantId }, expectedPreviousRecordId: reviewCommand.recordId, approveAdverseSearch: true });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue(context);
    persistAssistedVerificationMock.mockResolvedValue({
      outcome: "CREATED",
      verification: incompleteVerification,
    });
    getLatestAssistedVerificationMock.mockResolvedValue(incompleteVerification);
  });

  it("rejects unauthenticated access before persistence", async () => {
    getCurrentTenantContextMock.mockResolvedValue(null);

    const response = await POST(post(reviewCommand));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "AUTH_REQUIRED" });
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects stale reviewed versions before writing", async () => {
    const response = await POST(post({ ...reviewCommand, recordId: "stale-record" }));
    expect(response.status).toBe(409);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated role that cannot perform legal review", async () => {
    getCurrentTenantContextMock.mockResolvedValue({ ...context, role: "TECNICO" });

    const response = await POST(post(reviewCommand));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects a mission from another tenant without accepting client identity", async () => {
    getLatestAssistedVerificationMock.mockRejectedValue(
      new ResearchPersistenceError("AUTHORIZATION_REQUIRED"),
    );

    const response = await POST(post(reviewCommand));

    expect(response.status).toBe(403);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects review submission while documented evidence is incomplete", async () => {
    const response = await POST(post(reviewCommand));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "VERIFICATION_EVIDENCE_INCOMPLETE" });
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("completes the UI path from no snapshot through documented review and reread", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00.000Z"));
    let stored: RouteVerification | null = null;
    let sequence = 0;
    getLatestAssistedVerificationMock.mockImplementation(async () => stored);
    persistAssistedVerificationMock.mockImplementation(async ({ snapshot, expectedPreviousRecordId }) => {
      expect(expectedPreviousRecordId).toBe(stored?.recordId ?? null);
      sequence += 1;
      stored = storedVerification(snapshot, sequence);
      return { outcome: "CREATED", verification: stored };
    });

    const emptyRead = await GET(new Request(
      `https://app.example.test/api/legal-research/assisted-verification?missionId=${missionId}`,
    ));
    expect(emptyRead.status).toBe(404);

    const created = await PUT(put(initialCommand));
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as { verification: RouteVerification };
    expect(createdPayload.verification.snapshot.sources).toHaveLength(2);
    expect(createdPayload.verification.snapshot.sources[0]).toMatchObject({
      accessStatus: "CONSULTABLE",
      identityVerificationStatus: "VERIFIED",
      reviewerAttestation: {
        reviewedByActorId: "legal-user-a",
        reviewedAt: "2026-09-26T10:00:00.000Z",
        rationale: sourceDraft.verificationRationale,
      },
      termsOfUse: {
        status: "PERMITTED",
        checkedAt: "2026-09-26T10:00:00.000Z",
      },
    });
    expect(createdPayload.verification.snapshot.citationRelation)
      .toMatchObject({ documented: true });

    const initialRead = await GET(new Request(
      `https://app.example.test/api/legal-research/assisted-verification?missionId=${missionId}`,
    ));
    expect(initialRead.status).toBe(200);
    const initialPayload = await initialRead.json() as { verification: RouteVerification };
    expect(initialPayload.verification.result.citationObservations).toHaveLength(1);
    expect(initialPayload.verification.result.adverseAuthorityVerified).toBe(false);
    expect(initialPayload.verification.result.evidenceGaps)
      .toContainEqual(expect.objectContaining({ kind: "NO_ADVERSE_AUTHORITY_CHECK" }));
    expect(canSubmitLegalReview(initialPayload.verification, reviewCommand)).toBe(true);

    const adverseGap = initialPayload.verification.result.evidenceGaps.find((item) => (
      item.kind === "NO_ADVERSE_AUTHORITY_CHECK"
    ))!;
    const suggested = await PATCH(patch({
      missionId,
      recordId: initialPayload.verification.recordId,
      kind: "POSSIBLE_COUNTERARGUMENT",
      description: "Research the documented authority treatment before resolving the proposition.",
      rationale: "The verified citation leaves a legal-treatment gap requiring explicit reviewer research.",
      originatingGapId: adverseGap.gapId,
      evidenceSourceId: "source-a",
    }));
    expect(suggested.status).toBe(201);
    const suggestedPayload = await suggested.json() as { verification: RouteVerification };
    expect(suggestedPayload.verification.snapshot.researchSuggestions).toEqual([
      expect.objectContaining({
        reviewedByActorId: "legal-user-a",
        reviewedAt: "2026-09-26T10:00:00.000Z",
        originatingGapId: adverseGap.gapId,
      }),
    ]);
    expect(suggestedPayload.verification.result.legalResearchSuggestions).toHaveLength(1);

    const reviewed = await POST(post({ ...reviewCommand, recordId: suggestedPayload.verification.recordId }));
    expect(reviewed.status).toBe(201);
    const finalRead = await GET(new Request(
      `https://app.example.test/api/legal-research/assisted-verification?missionId=${missionId}`,
    ));
    const finalPayload = await finalRead.json() as { verification: RouteVerification };
    expect(finalPayload.verification.snapshot.adverseReview).toMatchObject({
      reviewedByActorId: "legal-user-a",
      reviewedAt: "2026-09-26T10:00:00.000Z",
      rationale: reviewCommand.rationale,
    });
    expect(finalPayload.verification.result.adverseAuthorityVerified).toBe(true);
    expect(finalPayload.verification.result.legalResearchSuggestions).toHaveLength(1);
    expect(finalPayload.verification.result.evidenceGaps).toEqual([]);
    const { documented: _documented, ...approvedRelation } = finalPayload.verification.snapshot.citationRelation!;
    const unchanged = await PUT(put({
      missionId, recordId: finalPayload.verification.recordId, sources: [],
      citationRelation: approvedRelation,
    }));
    const unchangedPayload = await unchanged.json() as { verification: RouteVerification };
    expect(unchangedPayload.verification.result.adverseAuthorityVerified).toBe(true);
    const changed = await PUT(put({
      missionId, recordId: unchangedPayload.verification.recordId, sources: [],
      citationRelation: { ...approvedRelation, locator: { paragraph: "99" } },
    }));
    expect(changed.status).toBe(201);
    const changedPayload = await changed.json() as { verification: RouteVerification };
    expect(changedPayload.verification.snapshot.adverseReview).toBeUndefined();
    expect(changedPayload.verification.result.adverseAuthorityVerified).toBe(false);
    expect(changedPayload.verification.snapshot.citationRelation?.locator).toEqual({ paragraph: "99" });
    expect(finalPayload.verification.snapshot.adverseReview).toBeDefined();
    const reattested = await POST(post({ ...reviewCommand, recordId: changedPayload.verification.recordId }));
    expect(reattested.status).toBe(201);
    expect((await reattested.json()).verification.result.adverseAuthorityVerified).toBe(true);
    vi.useRealTimers();
  });

  it("keeps a source-only initial snapshot blocked on the undocumented relation", async () => {
    getLatestAssistedVerificationMock.mockResolvedValue(null);
    const sourceOnlyCommand = buildInitialVerificationCommand({
      missionId,
      source: sourceDraft,
      includeCitationRelation: false,
      targetSource: sourceDraft,
      citationParagraph: "",
    });
    persistAssistedVerificationMock.mockImplementation(async ({ snapshot }) => ({
      outcome: "CREATED",
      verification: storedVerification(snapshot, 1),
    }));

    const response = await PUT(put(sourceOnlyCommand));
    const payload = await response.json() as { verification: RouteVerification };

    expect(response.status).toBe(201);
    expect(payload.verification.snapshot.citationRelation).toBeUndefined();
    expect(payload.verification.result.citationObservations).toEqual([]);
    expect(payload.verification.result.evidenceGaps)
      .toContainEqual(expect.objectContaining({ kind: "UNRESOLVED_AUTHORITY_TREATMENT" }));
    expect(payload.verification.preClaimStatus.satisfied).toBe(false);
  });

  it("rejects unauthenticated initial snapshot creation", async () => {
    getCurrentTenantContextMock.mockResolvedValue(null);

    const response = await PUT(put(initialCommand));

    expect(response.status).toBe(401);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects initial snapshot creation for a role without legal-review permission", async () => {
    getCurrentTenantContextMock.mockResolvedValue({ ...context, role: "TECNICO" });

    const response = await PUT(put(initialCommand));

    expect(response.status).toBe(403);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects initial snapshot creation for another tenant", async () => {
    getLatestAssistedVerificationMock.mockRejectedValue(
      new ResearchPersistenceError("AUTHORIZATION_REQUIRED"),
    );

    const response = await PUT(put(initialCommand));

    expect(response.status).toBe(403);
  });

  it("rejects an incomplete official source without persisting verification flags", async () => {
    const response = await PUT(put({
      missionId,
      sources: [{ ...sourceDraft, contentSha256: "" }],
    }));

    expect(response.status).toBe(400);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects client-controlled verification, actor, tenant, or date fields", async () => {
    const command = initialCommand as Record<string, unknown>;
    const sources = command.sources as readonly Record<string, unknown>[];
    const response = await PUT(put({
      ...command,
      actorId: "attacker",
      tenantId: "tenant-b",
      reviewedAt: "2020-01-01T00:00:00.000Z",
      sources: [{ ...sources[0], identityVerificationStatus: "VERIFIED" }, ...sources.slice(1)],
    }));

    expect(response.status).toBe(400);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("allows an authorized jurist to persist and read a valid verification", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00.000Z"));
    const loadedSnapshot = createAssistedVerificationSnapshot({
      missionId,
      sources: [{
        evidenceSourceId: "source-a",
        authorityId: "authority-a",
        legalSourceId: "legal-source-a",
        legalExpressionVersionId: "expression-a",
        officialIdentifier: "ECLI:EU:C:2024:1",
        sourceUrl: "https://official.example.test/authority-a",
        providerId: "OFFICIAL_SOURCE",
        accessStatus: "CONSULTABLE",
        identityVerificationStatus: "VERIFIED",
        reviewerAttestation: {
          reviewedByActorId: "legal-user-a",
          reviewedAt: "2026-09-26T09:00:00.000Z",
          rationale: "Official identity and source content checked by the legal reviewer.",
        },
        termsOfUse: {
          status: "PERMITTED",
          basis: "Official public-access terms checked",
          checkedAt: "2026-09-26T09:00:00.000Z",
        },
        fullText: { available: true, contentSha256: "c".repeat(64) },
      }, {
        evidenceSourceId: "source-b",
        authorityId: "authority-b",
        legalSourceId: "legal-source-b",
        legalExpressionVersionId: "expression-b",
        officialIdentifier: "ECLI:EU:C:2020:2",
        sourceUrl: "https://official.example.test/authority-b",
        providerId: "OFFICIAL_SOURCE",
        accessStatus: "CONSULTABLE",
        identityVerificationStatus: "VERIFIED",
        reviewerAttestation: {
          reviewedByActorId: "legal-user-a",
          reviewedAt: "2026-09-26T09:00:00.000Z",
          rationale: "Official identity and source content checked by the legal reviewer.",
        },
        termsOfUse: {
          status: "PERMITTED",
          basis: "Official public-access terms checked",
          checkedAt: "2026-09-26T09:00:00.000Z",
        },
        fullText: { available: false },
      }],
      citationRelation: {
        sourceAuthorityId: "authority-a",
        targetAuthorityId: "authority-b",
        evidenceSourceId: "source-a",
        documented: true,
        locator: { paragraph: "42" },
      },
    });
    const validSnapshot = createAssistedVerificationSnapshot({
      missionId,
      sources: loadedSnapshot.sources,
      citationRelation: loadedSnapshot.citationRelation,
      adverseReview: {
        observationSourceAuthorityId: "authority-a",
        observationTargetAuthorityId: "authority-b",
        legalPropositionId: "proposition-a",
        reviewedByActorId: "legal-user-a",
        reviewedAt: "2026-09-26T10:00:00.000Z",
        evidenceSourceId: "source-a",
        rationale: "Reasoned adverse treatment for the identified proposition.",
        decision: "ADVERSE",
      },
    });
    const valid = {
      ...incompleteVerification,
      snapshot: validSnapshot,
      result: {
        ...incompleteVerification.result,
        verifiedFullTexts: [{ evidenceSourceId: "source-a" }],
        citationObservations: [{ id: "citation-a" }],
        adverseAssessments: [{ id: "assessment-a" }],
        legalResearchSuggestions: [{ suggestionId: "suggestion-a" }],
        evidenceGaps: [],
        adverseAuthorityVerified: true,
      },
    };
    getLatestAssistedVerificationMock.mockResolvedValue({
      ...incompleteVerification,
      snapshot: loadedSnapshot,
      result: valid.result,
    });
    persistAssistedVerificationMock.mockResolvedValue({ outcome: "CREATED", verification: valid });

    expect((await POST(post(reviewCommand))).status).toBe(201);
    expect(persistAssistedVerificationMock).toHaveBeenCalledWith({
      snapshot: validSnapshot,
      actor: { actorId: "legal-user-a", tenantId: "tenant-a" },
      expectedPreviousRecordId: incompleteVerification.recordId,
    });
    getLatestAssistedVerificationMock.mockResolvedValue(valid);
    const response = await GET(new Request(
      `https://app.example.test/api/legal-research/assisted-verification?missionId=${missionId}`,
    ));

    expect(response.status).toBe(200);
    expect(getLatestAssistedVerificationMock).toHaveBeenCalledWith(
      missionId,
      { actorId: "legal-user-a", tenantId: "tenant-a" },
    );
    await expect(response.json()).resolves.toMatchObject({
      verification: { result: { adverseAuthorityVerified: true, evidenceGaps: [] } },
    });
    vi.useRealTimers();
  });

  it("rejects caller-controlled actor or tenant fields", async () => {
    const response = await POST(post({
      ...reviewCommand,
      actorId: "attacker",
      tenantId: "tenant-b",
    }));

    expect(response.status).toBe(400);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });

  it("rejects a suggestion without a verified source and active gap", async () => {
    const response = await PATCH(patch({
      missionId,
      recordId: incompleteVerification.recordId,
      kind: "MISSING_FACTUAL_EVIDENCE",
      description: "Acquire additional factual material from an official source.",
      rationale: "The proposed action cannot be attributed without verified evidence and an active gap.",
      originatingGapId: "gap-not-recorded",
      evidenceSourceId: "source-not-verified",
    }));

    expect(response.status).toBe(422);
    expect(persistAssistedVerificationMock).not.toHaveBeenCalled();
  });
});