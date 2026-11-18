import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { FascicoloGuidedActivities } from "@/components/procedimenti/FascicoloGuidedActivities";
import type { FascicoloProposal } from "@/components/procedimenti/FascicoloProposals";
import {
  ACTIVITY_SCHEMA,
  stableActivityKey,
  type ActivityRecord,
  type ActivitySpec,
  type ActivityVersion,
} from "@/server/fascicolo-operational-activities/model";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

const procedimentoId = "procedure-a";
const reportFingerprint = "b".repeat(64);
const activityKey = stableActivityKey(procedimentoId, "issue-a", "CHECK");
const activity: ActivitySpec = {
  activityKey, issueSemanticKey: "issue-a", issueText: "Problematica documentale",
  activityCode: "CHECK", title: "Verifica degli atti", action: "Esaminare gli atti.",
  office: "Ufficio competente", requiredDocuments: ["Istanza"], completionGate: "Riscontro verificato",
  necessity: "REQUIRED", legalSummary: "Conclusione preliminare.", legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
  alternatives: [], documents: [], fingerprint: "a".repeat(64),
};
const payload: StructuredFascicoloReportPayload = {
  contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1",
  tenantId: "tenant-a", procedimentoId, knowledgeRevisionId: "revision-a",
  knowledgeContractVersion: "FASCICOLO_KNOWLEDGE_V1", corpusFingerprint: "c".repeat(64),
  knowledgeStateFingerprint: "d".repeat(64), researchStateFingerprint: "e".repeat(64),
  sourceStateFingerprint: "f".repeat(64),
  documentedFramework: { partyRoles: [], facts: [], timeline: [], legalActs: [], measures: [], contradictions: [] },
  legalIssues: [], unassignedQuestions: [], gaps: [], deadlineCandidates: [], limitations: [],
  operationalPlans: [{
    issueSemanticKey: activity.issueSemanticKey, issueText: activity.issueText, sourceDocumentRefs: [],
    outstandingEvidence: [], legalSourceStatus: "LEGAL_RESEARCH_REQUIRED", professionalStatus: "PRELIMINARY_NOT_APPROVED",
    recommendedNextStep: activity.title, alternatives: [], deadlineReview: "Termini da verificare.",
    steps: [{
      activityCode: activity.activityCode, title: activity.title, action: activity.action, office: activity.office,
      requiredDocuments: activity.requiredDocuments, completionGate: activity.completionGate,
    }],
  }],
};

function proposal(status: FascicoloProposal["status"], fingerprint = reportFingerprint): FascicoloProposal {
  return {
    id: "proposal-a", procedimentoId, proposalType: "ACTIVITY", status, title: activity.title,
    description: activity.action, rationale: "Valutazione da confermare.", reviewVersion: 3,
    reviewNote: "La decisione precedente va considerata.", warningCodes: [], createdAt: new Date("2026-10-01"),
    originatingIssueSemanticKeys: [activity.issueSemanticKey], structuredReportFingerprint: fingerprint,
    proposedPayload: { activityCode: "CHECK", responsibleOffice: "Ufficio originario" },
    approvedPayload: { activityCode: "CHECK", responsibleOffice: "Ufficio modificato" },
  };
}

function render(proposals: readonly FascicoloProposal[], reportArchived = true) {
  return renderToStaticMarkup(createElement(FascicoloGuidedActivities, {
    procedimentoId, payload, reportFingerprint, corpusFingerprint: "c".repeat(64),
    specs: [activity], records: [], drafts: [], documents: [],
    proposals, canManage: true, reportArchived, analysisCurrent: true,
  }));
}

describe("guided activity workspace", () => {
  it("links an authorized reviewer to the originating adverse mission only", () => {
    const withSources: StructuredFascicoloReportPayload = {
      ...payload,
      legalIssues: [{
        knowledgeItemId: "issue-a", semanticKey: "issue-a", text: "Problematica documentale",
        reviewStatus: "HUMAN_CONFIRMED", originatingItemIds: [],
        questions: [{
          knowledgeItemId: "question-a", semanticKey: "question-a", text: "Qual è il limite?",
          reviewStatus: "HUMAN_CONFIRMED", missionId: "mission-primary", missionStatus: "COMPLETED",
          coverageStatus: "PARTIAL", favorableAuthorities: [], contraryAuthorities: [],
          nonUsableResults: [{
            resultId: "adverse-source", missionId: "mission-adverse", title: "Fonte contraria",
            direction: "OPPOSES", reasons: ["CLASSIFICATION_NOT_HUMAN_CONFIRMED"],
          }],
          gaps: [], limitations: [],
        }],
      }],
    };
    const props = {
      procedimentoId, payload: withSources, reportFingerprint, corpusFingerprint: "c".repeat(64),
      specs: [activity], records: [], drafts: [], documents: [], proposals: [],
      canManage: true, reportArchived: true, analysisCurrent: true,
    };
    const authorized = renderToStaticMarkup(createElement(FascicoloGuidedActivities, { ...props, canReviewLegalSources: true }));
    expect(authorized).toContain("Verifica le fonti:");
    expect(authorized).toContain("/legal-research/assisted-verification/mission-adverse");
    expect(authorized).not.toContain("/legal-research/assisted-verification/mission-primary");
    const unauthorized = renderToStaticMarkup(createElement(FascicoloGuidedActivities, props));
    expect(unauthorized).toContain("La classificazione spetta a un professionista autorizzato");
    expect(unauthorized).not.toContain("/legal-research/assisted-verification");
  });
  it("requests explicit archival and prevents decisions against an unarchived report", () => {
    const html = render([], false);
    expect(html).toContain("Archivia il quadro corrente");
    expect(html).toContain("senza modificare le proposte esistenti");
    expect(html).not.toContain('value="APPROVE"');
  });

  it("reopens the relevant problem after an activity operation", () => {
    const html = renderToStaticMarkup(createElement(FascicoloGuidedActivities, {
      procedimentoId, payload, reportFingerprint, corpusFingerprint: "c".repeat(64),
      specs: [activity], records: [], drafts: [], documents: [], proposals: [],
      canManage: true, reportArchived: true, analysisCurrent: true, focusActivityKey: activityKey,
    }));
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(render([])).not.toMatch(/<details[^>]*open=""/);
  });

  it("binds a draft request to the current activity, report and corpus", () => {
    const withDocument: ActivitySpec = {
      ...activity,
      documents: [{ templateKey: "PLAN:CURRENT", title: "Atto", legacyTemplateKeys: [] }],
    };
    const current: ActivityVersion = {
      schema: ACTIVITY_SCHEMA, procedimentoId, activityKey, issueSemanticKey: activity.issueSemanticKey,
      issueText: activity.issueText, activityCode: activity.activityCode, title: activity.title,
      specFingerprint: activity.fingerprint, version: 2, requestId: "00000000-0000-4000-8000-000000000002",
      requestFingerprint: "a".repeat(64), event: "TAKE_CHARGE", eventNote: "Presa in carico.",
      approvalProposalId: null, status: "IN_PROGRESS", assignee: null, dueDate: null, dueDateReason: null,
      dueDateDocumentIds: [], dependencyKeys: [], sharedActivities: [], attachedDocumentIds: [], drafts: [],
      execution: null, outcome: null, completionNote: null, exclusionNote: null, blockedReason: null,
      savedAt: new Date("2026-11-01T10:00:00Z"), savedBy: "operator@example.test", auditHash: "a".repeat(64),
    };
    const html = renderToStaticMarkup(createElement(FascicoloGuidedActivities, {
      procedimentoId, payload, reportFingerprint, corpusFingerprint: "c".repeat(64),
      specs: [withDocument], records: [{ activityKey, current, history: [current] }], drafts: [], documents: [],
      proposals: [], canManage: true, reportArchived: true, analysisCurrent: true,
    }));
    expect(html).toContain("Apri o crea bozza");
    expect(html).toContain(`name="activityKey" value="${activityKey}"`);
    expect(html).toContain('name="expectedActivityVersion" value="2"');
    expect(html).toContain(`name="expectedSpecFingerprint" value="${activity.fingerprint}"`);
    expect(html).toContain(`name="expectedReportFingerprint" value="${reportFingerprint}"`);
    expect(html).toContain(`name="expectedCorpusFingerprint" value="${"c".repeat(64)}"`);
  });

  it("requires a fresh assessment and shows the previous amendment instead of silently adopting it", () => {
    const html = render([proposal("AMENDED_AND_APPROVED")]);
    expect(html).toContain("Rivaluta la proposta approvata con modifiche");
    expect(html).toContain("Ufficio originario");
    expect(html).toContain("Ufficio modificato");
    expect(html).toContain("non vengono trasferite automaticamente");
    expect(html).toContain('value="REEVALUATE_PROPOSAL"');
    expect(html).not.toContain('value="ADOPT_APPROVAL"');
  });

  it("requires reconsideration for rejected or previously approved proposals", () => {
    expect(render([proposal("REJECTED")])).toContain("Rivaluta la proposta rifiutata");
    expect(render([proposal("APPROVED", "9".repeat(64))])).toContain("quadro precedente");
    expect(render([proposal("APPROVED")])).toContain('value="ADOPT_APPROVAL"');
  });

  it("keeps all historical evidence visible when there is no current report", () => {
    const first: ActivityVersion = {
      schema: ACTIVITY_SCHEMA, procedimentoId, activityKey, issueSemanticKey: activity.issueSemanticKey,
      issueText: activity.issueText, activityCode: activity.activityCode, title: activity.title,
      specFingerprint: activity.fingerprint, version: 1, requestId: "00000000-0000-4000-8000-000000000001",
      requestFingerprint: "a".repeat(64), event: "APPROVE", eventNote: "Approvazione motivata.",
      approvalProposalId: null, status: "APPROVED", assignee: null, dueDate: null, dueDateReason: null,
      dueDateDocumentIds: [], dependencyKeys: [], sharedActivities: [], attachedDocumentIds: [], drafts: [],
      execution: null, outcome: null, completionNote: null, exclusionNote: null, blockedReason: null,
      savedAt: new Date("2026-11-01T10:00:00Z"), savedBy: "operator@example.test", auditHash: "a".repeat(64),
    };
    const second: ActivityVersion = {
      ...first, version: 2, requestId: "00000000-0000-4000-8000-000000000002",
      event: "RECORD_OUTCOME", eventNote: "Riscontro acquisito.", status: "OUTCOME_RECORDED",
      assignee: "Ufficio legale", attachedDocumentIds: ["missing"],
      execution: { date: "2026-11-01", description: "Comunicazione inviata", documentIds: ["document-a"] },
      outcome: { date: "2026-11-02", description: "Risposta ricevuta", documentIds: ["document-a"], alternativeTitle: null },
    };
    const record: ActivityRecord = { activityKey, current: second, history: [second, first] };
    const html = renderToStaticMarkup(createElement(FascicoloGuidedActivities, {
      procedimentoId, payload: null, reportFingerprint: null, corpusFingerprint: null,
      specs: [], records: [record], drafts: [],
      documents: [{ id: "document-a", nome: "Riscontro protocollato" }], proposals: [],
      canManage: true, reportArchived: false, analysisCurrent: false,
    }));
    expect(html).toContain("Cronologie non presenti nel percorso corrente");
    expect(html).toContain("Cronologia completa (2)");
    expect(html).toContain("Problematica documentale");
    expect(html).toContain("Ufficio legale");
    expect(html).toContain("Comunicazione inviata");
    expect(html).toContain("Risposta ricevuta");
    expect(html).toContain("Riscontro protocollato");
    expect(html).toContain("Documento non più disponibile");
    expect(html).toContain("Approvazione motivata");
  });
});
