import { describe, expect, it } from "vitest";

import { evaluateProductionReadiness } from "../../scripts/runtime/production-readiness-policy";

describe("production readiness policy", () => {
  it("allows publication before the first structured report is generated", () => {
    expect(evaluateProductionReadiness({
      adminReady: 1,
      knowledgeRevisionTableAvailable: true,
      structuredReportTableAvailable: true,
      currentKnowledgeRevisions: 0,
      currentStructuredReports: 0,
    })).toEqual({
      blockingIssues: [],
      advisoryIssues: [
        "NO_CURRENT_KNOWLEDGE_REVISION",
        "NO_CURRENT_STRUCTURED_REPORT",
      ],
    });
  });

  it("blocks publication when schema or administrative access is not ready", () => {
    expect(evaluateProductionReadiness({
      adminReady: 0,
      knowledgeRevisionTableAvailable: false,
      structuredReportTableAvailable: false,
      currentKnowledgeRevisions: 0,
      currentStructuredReports: 0,
    }).blockingIssues).toEqual([
      "NO_READY_ADMIN",
      "KNOWLEDGE_REVISION_TABLE_MISSING",
      "STRUCTURED_REPORT_TABLE_MISSING",
    ]);
  });
});
