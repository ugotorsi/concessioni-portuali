export type ProductionReadinessGateInput = Readonly<{
  adminReady: number;
  knowledgeRevisionTableAvailable: boolean;
  structuredReportTableAvailable: boolean;
  currentKnowledgeRevisions: number;
  currentStructuredReports: number;
}>;

export type ProductionReadinessGateResult = Readonly<{
  blockingIssues: readonly string[];
  advisoryIssues: readonly string[];
}>;

export function evaluateProductionReadiness(
  input: ProductionReadinessGateInput,
): ProductionReadinessGateResult {
  const blockingIssues: string[] = [];
  const advisoryIssues: string[] = [];

  if (input.adminReady < 1) {
    blockingIssues.push("NO_READY_ADMIN");
  }
  if (!input.knowledgeRevisionTableAvailable) {
    blockingIssues.push("KNOWLEDGE_REVISION_TABLE_MISSING");
  }
  if (!input.structuredReportTableAvailable) {
    blockingIssues.push("STRUCTURED_REPORT_TABLE_MISSING");
  }
  if (input.currentKnowledgeRevisions < 1) {
    advisoryIssues.push("NO_CURRENT_KNOWLEDGE_REVISION");
  }
  if (input.currentStructuredReports < 1) {
    advisoryIssues.push("NO_CURRENT_STRUCTURED_REPORT");
  }

  return { blockingIssues, advisoryIssues };
}
