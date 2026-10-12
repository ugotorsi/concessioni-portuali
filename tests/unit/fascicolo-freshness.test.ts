import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const buildSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/ai/fascicoloSnapshot", () => ({
  buildAiFascicoloSnapshotV1: buildSnapshotMock,
}));

import { buildP1C1ScreeningFingerprint } from "@/server/fascicolo-document-requirements/matcher";
import {
  PEC_RECEIPT_OBSERVATION_RULE_VERSION,
  type PecReceiptObservationDocument,
} from "@/server/fascicolo-observations/types";
import {
  evaluateCaseLawFreshness,
  evaluateFingerprintFreshness,
  evaluateHumanReviewFreshness,
  evaluateObservationFreshness,
  evaluateReportFreshness,
  evaluateRequirementEvidenceFreshness,
  evaluateRequirementProposalFreshness,
  evaluateTemporalAssessmentFreshness,
  evaluateTrustedReviewFreshness,
  FreshnessInputError,
} from "@/server/fascicolo-lifecycle/freshness";
import { loadTrustedReviewFreshness } from "@/server/fascicolo-lifecycle/trustedReviewFreshnessReadModel";
import { TEMPORAL_ASSESSMENT_VERSION, type TemporalAssessmentInput } from "@/server/legal-sources/temporal";
import { temporalAssessmentInputFingerprint } from "@/server/legal-sources/temporal/persistence";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const screeningInput = {
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  concessioneId: "concessione-1",
  normaRiferimento: "ART_18_L_84_1994" as const,
  portActivityLegalType: "OPERAZIONI_PORTUALI" as const,
};
const observationDocument: PecReceiptObservationDocument = {
  id: "document-1",
  procedimentoId: "procedimento-1",
  enteId: "ente-1",
  statoDocumento: "ATTIVO",
  canale: "PEC",
  pecRicevutaAccettazioneId: "acceptance-1",
  pecRicevutaConsegnaId: null,
  pecWarningMancataRicevuta: true,
};
const temporalInput: TemporalAssessmentInput = {
  sourceFamilyId: "source-1",
  legalAuthorityKind: "LEGISLATION",
  sourceStatus: "CURRENT",
  expression: {
    expressionId: "expression-1",
    publicationDate: "2024-01-01T00:00:00.000Z",
    effectiveFrom: "2024-02-01T00:00:00.000Z",
    effectiveTo: null,
    expressionStatus: "CURRENT",
    correctionMetadata: {},
    consolidationMetadata: {},
  },
  referenceDate: "2026-09-19T00:00:00.000Z",
};

describe("Fase 2B Patch D derived freshness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks a Trusted Review current only for the same snapshot content hash", () => {
    expect(evaluateTrustedReviewFreshness({
      currentSnapshotContentHash: hashA,
      sourceSnapshotContentHash: hashA,
    }).status).toBe("CURRENT");
    expect(evaluateTrustedReviewFreshness({
      currentSnapshotContentHash: hashB,
      sourceSnapshotContentHash: hashA,
    }).status).toBe("STALE");
  });

  it("rebuilds the current snapshot without invoking an AI provider", async () => {
    buildSnapshotMock.mockResolvedValue({ metadata: { contentHash: hashA } });

    await expect(loadTrustedReviewFreshness({
      procedimentoId: "procedimento-1",
      sourceSnapshotContentHash: hashA,
    })).resolves.toMatchObject({ status: "CURRENT" });
    expect(buildSnapshotMock).toHaveBeenCalledWith("procedimento-1");
    const source = readFileSync(resolve(
      "src/server/fascicolo-lifecycle/trustedReviewFreshnessReadModel.ts",
    ), "utf8");
    expect(source).not.toMatch(/provider|generate|completion|openai/i);
  });

  it("preserves historical Human Review but applies it to the current snapshot only when current", () => {
    const current = evaluateTrustedReviewFreshness({
      currentSnapshotContentHash: hashA,
      sourceSnapshotContentHash: hashA,
    });
    const stale = evaluateTrustedReviewFreshness({
      currentSnapshotContentHash: hashB,
      sourceSnapshotContentHash: hashA,
    });

    expect(evaluateHumanReviewFreshness(current)).toEqual({
      historicalReviewPreserved: true,
      appliesToCurrentSnapshot: true,
      trustedReviewFreshness: "CURRENT",
    });
    expect(evaluateHumanReviewFreshness(stale)).toEqual({
      historicalReviewPreserved: true,
      appliesToCurrentSnapshot: false,
      trustedReviewFreshness: "STALE",
    });
  });

  it("compares requirement proposals with the existing screening fingerprint builder", () => {
    const fingerprint = buildP1C1ScreeningFingerprint(screeningInput);
    expect(evaluateRequirementProposalFreshness({
      currentScreeningInput: screeningInput,
      screeningFingerprint: fingerprint,
    }).status).toBe("CURRENT");
    expect(evaluateRequirementProposalFreshness({
      currentScreeningInput: { ...screeningInput, portActivityLegalType: null },
      screeningFingerprint: fingerprint,
    }).status).toBe("STALE");
  });

  it("marks revoked or archived requirement evidence non-current", () => {
    const evidence = { documentoId: "document-1", revokedAt: null };
    const document = { id: "document-1", statoDocumento: "ATTIVO", currentFileVersionId: "version-2" };

    expect(evaluateRequirementEvidenceFreshness({
      evidence: { ...evidence, revokedAt: "2026-09-19T10:00:00.000Z" },
      document,
    })).toMatchObject({ status: "STALE", reasonCode: "EVIDENCE_REVOKED" });
    expect(evaluateRequirementEvidenceFreshness({
      evidence,
      document: { ...document, statoDocumento: "ARCHIVIATO" },
    })).toMatchObject({ status: "STALE", reasonCode: "EVIDENCE_DOCUMENT_ARCHIVED" });
  });

  it("does not invent a requirement evidence binding to the current file version", () => {
    expect(evaluateRequirementEvidenceFreshness({
      evidence: { documentoId: "document-1", revokedAt: null },
      document: { id: "document-1", statoDocumento: "ATTIVO", currentFileVersionId: "version-2" },
    })).toEqual({
      status: "INDETERMINATE",
      reasonCode: "EVIDENCE_DOCUMENT_VERSION_BINDING_NOT_AVAILABLE",
      currentFingerprint: null,
      outputFingerprint: null,
    });
  });

  it("requires both current PEC facts and the current observation rule version", () => {
    const storedFactsSnapshot = {
      canale: "PEC",
      pecRicevutaAccettazioneId: "acceptance-1",
      pecRicevutaConsegnaId: null,
      pecWarningMancataRicevuta: true,
    };
    expect(evaluateObservationFreshness({
      storedRuleVersion: PEC_RECEIPT_OBSERVATION_RULE_VERSION,
      storedFactsSnapshot,
      currentDocument: observationDocument,
    }).status).toBe("CURRENT");
    expect(evaluateObservationFreshness({
      storedRuleVersion: PEC_RECEIPT_OBSERVATION_RULE_VERSION,
      storedFactsSnapshot,
      currentDocument: { ...observationDocument, pecWarningMancataRicevuta: false },
    }).status).toBe("STALE");
    expect(evaluateObservationFreshness({
      storedRuleVersion: PEC_RECEIPT_OBSERVATION_RULE_VERSION + 1,
      storedFactsSnapshot,
      currentDocument: observationDocument,
    })).toMatchObject({ status: "STALE", reasonCode: "OBSERVATION_RULE_VERSION_CHANGED" });
  });

  it("uses the existing temporal fingerprint and changes only for legal temporal input", () => {
    const storedInputFingerprint = temporalAssessmentInputFingerprint(
      temporalInput,
      TEMPORAL_ASSESSMENT_VERSION,
    );
    expect(evaluateTemporalAssessmentFreshness({
      currentInput: temporalInput,
      storedInputFingerprint,
      storedAssessmentVersion: TEMPORAL_ASSESSMENT_VERSION,
    }).status).toBe("CURRENT");
    expect(evaluateTemporalAssessmentFreshness({
      currentInput: { ...temporalInput, referenceDate: "2027-01-01T00:00:00.000Z" },
      storedInputFingerprint,
      storedAssessmentVersion: TEMPORAL_ASSESSMENT_VERSION,
    }).status).toBe("STALE");
    expect(evaluateTemporalAssessmentFreshness({
      currentInput: temporalInput,
      storedInputFingerprint,
      storedAssessmentVersion: TEMPORAL_ASSESSMENT_VERSION,
      triggeredAt: "2099-01-01T00:00:00.000Z",
    } as never).status).toBe("CURRENT");
  });

  it("rejects a missing legal reference date instead of inventing one", () => {
    expect(() => evaluateTemporalAssessmentFreshness({
      currentInput: { ...temporalInput, referenceDate: "" },
      storedInputFingerprint: hashA,
      storedAssessmentVersion: TEMPORAL_ASSESSMENT_VERSION,
    })).toThrow(FreshnessInputError);
  });

  it("reports pending only for a qualified matching output and target fingerprint", () => {
    expect(evaluateFingerprintFreshness({
      outputKind: "TRUSTED_REVIEW",
      currentFingerprint: hashB,
      outputFingerprint: hashA,
      pendingRecalculation: { outputKind: "TRUSTED_REVIEW", targetFingerprint: hashB },
    }).status).toBe("RECALCULATION_PENDING");
    expect(evaluateFingerprintFreshness({
      outputKind: "TRUSTED_REVIEW",
      currentFingerprint: hashB,
      outputFingerprint: hashA,
      pendingRecalculation: { outputKind: "OBSERVATION", targetFingerprint: hashB },
    }).status).toBe("STALE");
    expect(evaluateFingerprintFreshness({
      outputKind: "TRUSTED_REVIEW",
      currentFingerprint: hashB,
      outputFingerprint: hashA,
    }).status).toBe("STALE");
  });

  it("fails closed for invalid fingerprints and does not mutate frozen inputs", () => {
    expect(() => evaluateFingerprintFreshness({
      outputKind: "TRUSTED_REVIEW",
      currentFingerprint: "invalid",
      outputFingerprint: hashA,
    })).toThrow(FreshnessInputError);
    const frozen = Object.freeze({
      currentScreeningInput: Object.freeze({ ...screeningInput }),
      screeningFingerprint: buildP1C1ScreeningFingerprint(screeningInput),
    });
    expect(() => evaluateRequirementProposalFreshness(frozen)).not.toThrow();
    expect(Object.isFrozen(frozen.currentScreeningInput)).toBe(true);
  });

  it("fails closed for unstructured case-law time and unprovable report freshness", () => {
    expect(evaluateTemporalAssessmentFreshness({
      currentInput: { ...temporalInput, legalAuthorityKind: "CASE_LAW" },
      storedInputFingerprint: hashA,
      storedAssessmentVersion: TEMPORAL_ASSESSMENT_VERSION,
    })).toMatchObject({ status: "INDETERMINATE", reasonCode: "CASE_LAW_TEMPORAL_CONTEXT_NOT_PROVABLE" });
    expect(evaluateCaseLawFreshness().status).toBe("INDETERMINATE");
    expect(evaluateReportFreshness()).toMatchObject({
      status: "INDETERMINATE",
      reasonCode: "REPORT_FRESHNESS_NOT_YET_PROVABLE",
    });
  });
});