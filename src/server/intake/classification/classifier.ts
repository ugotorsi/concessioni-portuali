export const NEUTRAL_INTAKE_CLASSIFIER_VERSION = "neutral-intake-classifier/v1" as const;

export type NeutralIntakeClassificationOutcome =
  | "LEGAL_SOURCE_CANDIDATE"
  | "CASE_DOCUMENT"
  | "UNCERTAIN_REVIEW_REQUIRED";

export type NeutralIntakeClassificationConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type NeutralIntakeClassificationReasonCode =
  | "SELF_IDENTIFIES_REGULATION"
  | "GENERAL_NORMATIVE_STRUCTURE"
  | "JUDICIAL_DECISION_STRUCTURE"
  | "CASE_FILING_STRUCTURE"
  | "SPECIFIC_ADMINISTRATIVE_ACT"
  | "CONTRACTUAL_DOCUMENT_STRUCTURE"
  | "CORRESPONDENCE_STRUCTURE"
  | "MIXED_STRONG_SIGNALS"
  | "INSUFFICIENT_EVIDENCE"
  | "EXTRACTION_QUALITY_INSUFFICIENT";

export interface NeutralIntakeClassificationProjection {
  pageCount: number;
  normalizedCharacterCount: number;
  beginningText: string;
  endingText: string;
  headingLines: readonly string[];
  extractionQualityInsufficient: boolean;
}

export interface NeutralIntakeClassificationResult {
  outcome: NeutralIntakeClassificationOutcome;
  confidence: NeutralIntakeClassificationConfidence;
  reasonCodes: readonly NeutralIntakeClassificationReasonCode[];
  evidenceMarkers: readonly NeutralIntakeClassificationReasonCode[];
  reviewRequired: boolean;
}

function result(
  outcome: NeutralIntakeClassificationOutcome,
  confidence: NeutralIntakeClassificationConfidence,
  reasonCodes: readonly NeutralIntakeClassificationReasonCode[],
): NeutralIntakeClassificationResult {
  const canonicalReasonCodes = [...new Set(reasonCodes)];
  return {
    outcome,
    confidence,
    reasonCodes: canonicalReasonCodes,
    evidenceMarkers: canonicalReasonCodes,
    reviewRequired: outcome === "UNCERTAIN_REVIEW_REQUIRED",
  };
}

export function classifyNeutralIntakeEvidenceV1(
  projection: NeutralIntakeClassificationProjection,
): NeutralIntakeClassificationResult {
  const beginning = projection.beginningText.toLocaleUpperCase("it-IT");
  const ending = projection.endingText.toLocaleUpperCase("it-IT");
  const headings = projection.headingLines.join("\n").toLocaleUpperCase("it-IT");
  const fullProjection = `${beginning}\n${ending}`;
  const headerRegion = beginning.split(/\r?\n/).slice(0, 12).join("\n");
  const primaryHeading = projection.headingLines[0]?.trim().toLocaleUpperCase("it-IT") ?? "";

  if (projection.normalizedCharacterCount < 120) {
    return result("UNCERTAIN_REVIEW_REQUIRED", "INSUFFICIENT", ["INSUFFICIENT_EVIDENCE"]);
  }
  if (projection.extractionQualityInsufficient) {
    return result("UNCERTAIN_REVIEW_REQUIRED", "INSUFFICIENT", ["EXTRACTION_QUALITY_INSUFFICIENT"]);
  }

  const regulation = /^(?:REGOLAMENTO|ORDINANZA\s+(?:N\.?|NUMERO)|LEGGE\s+(?:N\.?|NUMERO)|DECRETO\s+LEGISLATIVO)/m.test(headings);
  const normativeStructure = (fullProjection.match(/\bART(?:ICOLO|\.)\s*\d+/g) ?? []).length >= 3
    && /\b(?:DISPOSIZIONI GENERALI|ENTRATA IN VIGORE|SI APPLICA A|NORME FINALI)\b/.test(fullProjection);
  const primaryCaseFiling = /^(?:RICORSO|MEMORIA|ISTANZA|ATTO\s+DI\s+CITAZIONE|DIFFIDA)\b/.test(primaryHeading);
  const caseFiling = /^(?:RICORSO|MEMORIA|ISTANZA|ATTO\s+DI\s+CITAZIONE|DIFFIDA)\b/m.test(headings);
  const courtIdentity = /\b(?:TRIBUNALE(?:\s+AMMINISTRATIVO\s+REGIONALE)?|CORTE\s+(?:DI\s+CASSAZIONE|SUPREMA\s+DI\s+CASSAZIONE|COSTITUZIONALE|DEI\s+CONTI)|CONSIGLIO\s+DI\s+STATO|TAR\b)/.test(headerRegion);
  const judicialDecisionType = /\bSENTENZA(?:\s+N\.?)?\b/.test(headerRegion)
    || (/\bCORTE\s+(?:DI\s+CASSAZIONE|SUPREMA\s+DI\s+CASSAZIONE)\b/.test(headerRegion)
      && /\bORDINANZA\b/.test(headerRegion));
  const institutionalForm = /\b(?:REPUBBLICA\s+ITALIANA|IN\s+NOME\s+DEL\s+POPOLO\s+ITALIANO)\b/.test(headerRegion);
  const finalDisposition = /\bP\.?\s*Q\.?\s*M\.?\b|\bPER\s+QUESTI\s+MOTIVI\b/.test(ending);
  const judgment = !primaryCaseFiling && courtIdentity && judicialDecisionType && institutionalForm && finalDisposition;
  const specificAdministrativeAct = /^(?:DETERMINAZIONE|DETERMINA|AUTORIZZAZIONE|CONCESSIONE|ORDINANZA)\b/m.test(headings)
    && /\b(?:AL\s+SIG\.?|ALLA\s+SOCIET[ÀA]|CONCESSIONARIO|PROCEDIMENTO|AUTORIZZA\s+(?:IL|LA)|SANZIONE|PAGAMENTO)\b/.test(fullProjection);
  const contract = /^(?:CONTRATTO|SCRITTURA\s+PRIVATA|ACCORDO)\b/m.test(headings)
    && /\bTRA\b[\s\S]{0,500}\b(?:PARTI|CONTRAENTI|STIPULANO|CONVENGONO)\b/.test(beginning);
  const correspondence = /^(?:PEC|POSTA\s+ELETTRONICA\s+CERTIFICATA|COMUNICAZIONE)\b/m.test(headings)
    || /\b(?:MITTENTE|DESTINATARIO|MESSAGGIO\s+PEC)\s*:/.test(beginning);
  const sourceSignal = regulation || normativeStructure || judgment;
  const caseSignal = caseFiling || specificAdministrativeAct || contract || correspondence;

  if (sourceSignal && caseSignal) {
    return result("UNCERTAIN_REVIEW_REQUIRED", "LOW", ["MIXED_STRONG_SIGNALS"]);
  }
  if (judgment) return result("LEGAL_SOURCE_CANDIDATE", "HIGH", ["JUDICIAL_DECISION_STRUCTURE"]);
  if (regulation || normativeStructure) {
    const reasons: NeutralIntakeClassificationReasonCode[] = [];
    if (regulation) reasons.push("SELF_IDENTIFIES_REGULATION");
    if (normativeStructure) reasons.push("GENERAL_NORMATIVE_STRUCTURE");
    return result("LEGAL_SOURCE_CANDIDATE", regulation && normativeStructure ? "HIGH" : "MEDIUM", reasons);
  }
  if (caseFiling) return result("CASE_DOCUMENT", "HIGH", ["CASE_FILING_STRUCTURE"]);
  if (specificAdministrativeAct) return result("CASE_DOCUMENT", "HIGH", ["SPECIFIC_ADMINISTRATIVE_ACT"]);
  if (contract) return result("CASE_DOCUMENT", "HIGH", ["CONTRACTUAL_DOCUMENT_STRUCTURE"]);
  if (correspondence) return result("CASE_DOCUMENT", "HIGH", ["CORRESPONDENCE_STRUCTURE"]);
  return result("UNCERTAIN_REVIEW_REQUIRED", "LOW", ["INSUFFICIENT_EVIDENCE"]);
}