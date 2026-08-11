import type { NormaRiferimento, PortActivityLegalType, Prisma } from "@/generated/prisma/client";

export const SOURCE_KEY = "L-84-1994";
export const RULE_CODE = "P1C_ART18_ART16_AUTH_REQUIREMENT";
export const GAP_KEY = "REQ-AUTORIZZAZIONE-ART16";
export const REQUIREMENT_CODE = "VERIFICA_TITOLO_AUTORIZZATORIO_ART16";
export const MATCHER_ALGORITHM_VERSION = "P1C1_SCREENING_FINGERPRINT_V1";
export const RULE_CONTRACT_VERSION = 1;
export const RELEVANT_PROVISIONS = ["art. 18", "art. 16 comma 3"] as const;

export const P1C1_RULE_DEFINITION = {
  requirementCode: REQUIREMENT_CODE,
  predicate: {
    normaRiferimento: {
      operator: "EQ",
      expected: "ART_18_L_84_1994",
    },
    portActivityLegalType: {
      operator: "EQ",
      expected: "OPERAZIONI_PORTUALI",
    },
  },
  meaning: "requirement_to_verify",
  humanReviewRequired: true,
  validatoMeans: "requirement_applicability_confirmed_only",
  doesNotAssert: [
    "authorization_present",
    "authorization_missing",
    "authorization_valid",
    "authorization_effective",
    "authorization_sufficient",
    "application_admissible",
    "proceeding_regular",
    "concession_grantable",
  ],
} as const satisfies Prisma.InputJsonObject;

export interface P1C1CanonicalFacts {
  normaRiferimento: NormaRiferimento;
  portActivityLegalType: PortActivityLegalType | null;
}

export interface P1C1MatchedCriterion {
  field: "Concessione.normaRiferimento" | "Concessione.portActivityLegalType";
  operator: "EQ";
  actual: NormaRiferimento | PortActivityLegalType | null;
  expected: "ART_18_L_84_1994" | "OPERAZIONI_PORTUALI";
  matched: boolean;
}

export interface P1C1MatchResult {
  eligible: boolean;
  matchedCriteria: P1C1MatchedCriterion[];
}

export interface P1C1FingerprintInput extends P1C1CanonicalFacts {
  enteId: string;
  procedimentoId: string;
  concessioneId: string;
  ruleContractVersion?: number;
}