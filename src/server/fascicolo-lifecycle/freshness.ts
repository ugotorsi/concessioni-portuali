import { z } from "zod";

import { stableStringify } from "@/server/audit/hash";
import { buildP1C1ScreeningFingerprint } from "@/server/fascicolo-document-requirements/matcher";
import type { P1C1FingerprintInput } from "@/server/fascicolo-document-requirements/types";
import { buildPecReceiptFactsSnapshot } from "@/server/fascicolo-observations/pecReceiptDetector";
import {
  PEC_RECEIPT_OBSERVATION_RULE_VERSION,
  type PecReceiptFactsSnapshot,
  type PecReceiptObservationDocument,
} from "@/server/fascicolo-observations/types";
import {
  temporalAssessmentInputFingerprint,
} from "@/server/legal-sources/temporal/persistence";
import {
  TEMPORAL_ASSESSMENT_VERSION,
  type TemporalAssessmentInput,
} from "@/server/legal-sources/temporal";

export const FRESHNESS_STATES = [
  "CURRENT",
  "STALE",
  "RECALCULATION_PENDING",
  "INDETERMINATE",
] as const;

export type FreshnessState = (typeof FRESHNESS_STATES)[number];
export type FreshnessOutputKind =
  | "TRUSTED_REVIEW"
  | "REQUIREMENT_PROPOSAL"
  | "OBSERVATION"
  | "TEMPORAL_ASSESSMENT";

export interface QualifiedPendingRecalculation {
  readonly outputKind: FreshnessOutputKind;
  readonly targetFingerprint: string;
}

export interface FreshnessAssessment {
  readonly status: FreshnessState;
  readonly reasonCode: string;
  readonly currentFingerprint: string | null;
  readonly outputFingerprint: string | null;
}

export class FreshnessInputError extends Error {
  readonly code = "INVALID_FRESHNESS_INPUT" as const;

  constructor() {
    super("INVALID_FRESHNESS_INPUT");
    this.name = "FreshnessInputError";
  }
}

const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const instantSchema = z.string().datetime({ offset: true });
const outputKindSchema = z.enum([
  "TRUSTED_REVIEW",
  "REQUIREMENT_PROPOSAL",
  "OBSERVATION",
  "TEMPORAL_ASSESSMENT",
]);
const factsSchema = z.object({
  canale: z.string().nullable(),
  pecRicevutaAccettazioneId: z.string().nullable(),
  pecRicevutaConsegnaId: z.string().nullable(),
  pecWarningMancataRicevuta: z.boolean(),
}).strict();

function freezeAssessment(
  status: FreshnessState,
  reasonCode: string,
  currentFingerprint: string | null,
  outputFingerprint: string | null,
): FreshnessAssessment {
  return Object.freeze({ status, reasonCode, currentFingerprint, outputFingerprint });
}

/** Freshness expresses input equivalence, not legal correctness or validity. */
export function evaluateFingerprintFreshness(input: {
  outputKind: FreshnessOutputKind;
  currentFingerprint: string;
  outputFingerprint: string;
  pendingRecalculation?: QualifiedPendingRecalculation | null;
}): FreshnessAssessment {
  const parsed = z.object({
    outputKind: outputKindSchema,
    currentFingerprint: fingerprintSchema,
    outputFingerprint: fingerprintSchema,
    pendingRecalculation: z.object({
      outputKind: outputKindSchema,
      targetFingerprint: fingerprintSchema,
    }).strict().nullable().optional(),
  }).strict().safeParse(input);
  if (!parsed.success) throw new FreshnessInputError();
  if (parsed.data.currentFingerprint === parsed.data.outputFingerprint) {
    return freezeAssessment(
      "CURRENT",
      "INPUT_FINGERPRINT_MATCH",
      parsed.data.currentFingerprint,
      parsed.data.outputFingerprint,
    );
  }
  if (
    parsed.data.pendingRecalculation?.outputKind === parsed.data.outputKind
    && parsed.data.pendingRecalculation.targetFingerprint === parsed.data.currentFingerprint
  ) {
    return freezeAssessment(
      "RECALCULATION_PENDING",
      "MATCHING_RECALCULATION_PROVEN",
      parsed.data.currentFingerprint,
      parsed.data.outputFingerprint,
    );
  }
  return freezeAssessment(
    "STALE",
    "INPUT_FINGERPRINT_CHANGED",
    parsed.data.currentFingerprint,
    parsed.data.outputFingerprint,
  );
}

export function evaluateTrustedReviewFreshness(input: {
  currentSnapshotContentHash: string;
  sourceSnapshotContentHash: string;
  pendingRecalculation?: QualifiedPendingRecalculation | null;
}): FreshnessAssessment {
  return evaluateFingerprintFreshness({
    outputKind: "TRUSTED_REVIEW",
    currentFingerprint: input.currentSnapshotContentHash,
    outputFingerprint: input.sourceSnapshotContentHash,
    pendingRecalculation: input.pendingRecalculation,
  });
}

export function evaluateHumanReviewFreshness(
  trustedReviewFreshness: FreshnessAssessment,
): Readonly<{
  historicalReviewPreserved: true;
  appliesToCurrentSnapshot: boolean;
  trustedReviewFreshness: FreshnessState;
}> {
  if (!FRESHNESS_STATES.includes(trustedReviewFreshness.status)) throw new FreshnessInputError();
  return Object.freeze({
    historicalReviewPreserved: true,
    appliesToCurrentSnapshot: trustedReviewFreshness.status === "CURRENT",
    trustedReviewFreshness: trustedReviewFreshness.status,
  });
}

export function evaluateRequirementProposalFreshness(input: {
  currentScreeningInput: P1C1FingerprintInput;
  screeningFingerprint: string;
  pendingRecalculation?: QualifiedPendingRecalculation | null;
}): FreshnessAssessment {
  return evaluateFingerprintFreshness({
    outputKind: "REQUIREMENT_PROPOSAL",
    currentFingerprint: buildP1C1ScreeningFingerprint(input.currentScreeningInput),
    outputFingerprint: input.screeningFingerprint,
    pendingRecalculation: input.pendingRecalculation,
  });
}

export function evaluateRequirementEvidenceFreshness(input: {
  evidence: { documentoId: string; revokedAt: Date | string | null };
  document: { id: string; statoDocumento: string; currentFileVersionId: string | null } | null;
}): FreshnessAssessment {
  if (
    !input.evidence.documentoId.trim()
    || (input.evidence.revokedAt !== null && Number.isNaN(new Date(input.evidence.revokedAt).getTime()))
  ) {
    throw new FreshnessInputError();
  }
  if (input.evidence.revokedAt !== null) {
    return freezeAssessment("STALE", "EVIDENCE_REVOKED", null, null);
  }
  if (input.document === null || input.document.id !== input.evidence.documentoId) {
    return freezeAssessment("STALE", "EVIDENCE_DOCUMENT_NOT_CURRENT", null, null);
  }
  if (input.document.statoDocumento !== "ATTIVO") {
    return freezeAssessment("STALE", "EVIDENCE_DOCUMENT_ARCHIVED", null, null);
  }
  return freezeAssessment(
    "INDETERMINATE",
    "EVIDENCE_DOCUMENT_VERSION_BINDING_NOT_AVAILABLE",
    null,
    null,
  );
}

export function evaluateObservationFreshness(input: {
  storedRuleVersion: number;
  storedFactsSnapshot: PecReceiptFactsSnapshot;
  currentDocument: PecReceiptObservationDocument;
}): FreshnessAssessment {
  const storedFacts = factsSchema.safeParse(input.storedFactsSnapshot);
  if (!storedFacts.success || !Number.isInteger(input.storedRuleVersion) || input.storedRuleVersion < 1) {
    throw new FreshnessInputError();
  }
  if (input.storedRuleVersion !== PEC_RECEIPT_OBSERVATION_RULE_VERSION) {
    return freezeAssessment("STALE", "OBSERVATION_RULE_VERSION_CHANGED", null, null);
  }
  const currentFacts = buildPecReceiptFactsSnapshot(input.currentDocument);
  if (stableStringify(storedFacts.data) !== stableStringify(currentFacts)) {
    return freezeAssessment("STALE", "OBSERVATION_FACTS_CHANGED", null, null);
  }
  return freezeAssessment("CURRENT", "OBSERVATION_INPUT_MATCH", null, null);
}

export function evaluateTemporalAssessmentFreshness(input: {
  currentInput: TemporalAssessmentInput;
  storedInputFingerprint: string;
  storedAssessmentVersion: string;
  pendingRecalculation?: QualifiedPendingRecalculation | null;
}): FreshnessAssessment {
  if (!instantSchema.safeParse(input.currentInput.referenceDate).success) {
    throw new FreshnessInputError();
  }
  if (input.currentInput.legalAuthorityKind === "CASE_LAW") {
    return freezeAssessment(
      "INDETERMINATE",
      "CASE_LAW_TEMPORAL_CONTEXT_NOT_PROVABLE",
      null,
      input.storedInputFingerprint,
    );
  }
  const currentFingerprint = temporalAssessmentInputFingerprint(
    input.currentInput,
    TEMPORAL_ASSESSMENT_VERSION,
  );
  if (input.storedAssessmentVersion !== TEMPORAL_ASSESSMENT_VERSION) {
    fingerprintSchema.parse(input.storedInputFingerprint);
    return freezeAssessment(
      "STALE",
      "TEMPORAL_ASSESSMENT_VERSION_CHANGED",
      currentFingerprint,
      input.storedInputFingerprint,
    );
  }
  return evaluateFingerprintFreshness({
    outputKind: "TEMPORAL_ASSESSMENT",
    currentFingerprint,
    outputFingerprint: input.storedInputFingerprint,
    pendingRecalculation: input.pendingRecalculation,
  });
}

export function evaluateReportFreshness(): FreshnessAssessment {
  return freezeAssessment("INDETERMINATE", "REPORT_FRESHNESS_NOT_YET_PROVABLE", null, null);
}

export function evaluateCaseLawFreshness(): FreshnessAssessment {
  return freezeAssessment("INDETERMINATE", "CASE_LAW_TEMPORAL_CONTEXT_NOT_PROVABLE", null, null);
}