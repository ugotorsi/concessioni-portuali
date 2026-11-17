import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";
import {
  GAP_KEY,
  MATCHER_ALGORITHM_VERSION,
  RELEVANT_PROVISIONS,
  RULE_CODE,
  RULE_CONTRACT_VERSION,
  SOURCE_KEY,
  type P1C1CanonicalFacts,
  type P1C1FingerprintInput,
  type P1C1MatchResult,
} from "@/server/fascicolo-document-requirements/types";

export function evaluateP1C1DocumentRequirement(input: P1C1CanonicalFacts): P1C1MatchResult {
  const matchedCriteria = [
    {
      field: "Concessione.normaRiferimento" as const,
      operator: "EQ" as const,
      actual: input.normaRiferimento,
      expected: "ART_18_L_84_1994" as const,
      matched: input.normaRiferimento === "ART_18_L_84_1994",
    },
    {
      field: "Concessione.portActivityLegalType" as const,
      operator: "EQ" as const,
      actual: input.portActivityLegalType,
      expected: "OPERAZIONI_PORTUALI" as const,
      matched: input.portActivityLegalType === "OPERAZIONI_PORTUALI",
    },
  ];

  return {
    eligible: matchedCriteria.every((criterion) => criterion.matched),
    matchedCriteria,
  };
}

export function buildP1C1ScreeningFingerprint(input: P1C1FingerprintInput): string {
  const payload = {
    algorithmVersion: MATCHER_ALGORITHM_VERSION,
    enteId: input.enteId,
    procedimentoId: input.procedimentoId,
    concessioneId: input.concessioneId,
    facts: {
      normaRiferimento: input.normaRiferimento,
      portActivityLegalType: input.portActivityLegalType,
    },
    source: {
      stableKey: SOURCE_KEY,
      relevantProvisions: RELEVANT_PROVISIONS,
    },
    rule: {
      ruleCode: RULE_CODE,
      ruleContractVersion: input.ruleContractVersion ?? RULE_CONTRACT_VERSION,
    },
    gap: {
      gapKey: GAP_KEY,
    },
    result: true,
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}