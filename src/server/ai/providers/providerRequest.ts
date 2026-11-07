import type {
  AiAnalysisProviderRequestV1,
  AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import type { FascicoloDocumentProviderRequestV1 } from "@/server/ai/fascicoloDocumentAnalysis";
import {
  OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA,
  OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA,
} from "@/server/ai/providers/openai";

export interface SyntheticQualificationProviderRequestV1 {
  readonly systemPolicy: {
    readonly purpose: "SYNTHETIC_PROVIDER_QUALIFICATION_ONLY";
    readonly dataTrust: "UNTRUSTED_SYNTHETIC_DATA";
    readonly toolsAllowed: false;
    readonly externalResearchAllowed: false;
    readonly mutationsAllowed: false;
    readonly instructions: readonly string[];
  };
  readonly qualificationData: {
    readonly schemaVersion: "NOETRA_SYNTHETIC_QUALIFICATION_V1";
    readonly content: {
      readonly fascicoloId: "SYN-001";
      readonly location: "Porto Fantasia";
      readonly excerpts: readonly {
        readonly reference: "SYN.P1" | "SYN.P2";
        readonly text: string;
      }[];
    };
  };
  readonly requestedOutputContract: {
    readonly schemaVersion: "ai-fascicolo-analysis/v1";
    readonly outputMode: "STRUCTURED_PAYLOAD_ONLY";
    readonly allowedSections: readonly [
      "summary",
      "timeline",
      "recordedState",
      "signals",
      "investigativeQuestions",
      "suggestedActivities",
      "legalResearchQuestions",
    ];
    readonly signalTypes: readonly ["INFO", "VERIFY"];
    readonly basisRefsMeaning: "SYNTHETIC_EXCERPT_ID_ONLY";
  };
}

export interface SyntheticQualificationProvider {
  analyze(request: SyntheticQualificationProviderRequestV1): Promise<unknown>;
}

export type AiAnalysisProviderRequest =
  | AiAnalysisProviderRequestV1
  | AiOutboundAnalysisProviderRequestV1
  | FascicoloDocumentProviderRequestV1
  | SyntheticQualificationProviderRequestV1;

export function buildAiProviderInstructions(request: AiAnalysisProviderRequest): string {
  return JSON.stringify({
    systemPolicy: request.systemPolicy,
    requestedOutputContract: request.requestedOutputContract,
  });
}

function documentProviderData(request: FascicoloDocumentProviderRequestV1) {
  return {
    ...request.documentData,
    content: {
      ...request.documentData.content,
      evidenceSpans: request.documentData.content.evidenceSpans.map((span) => ({
        id: span.id,
        basisRef: span.basisRef,
        text: span.text,
      })),
    },
  };
}

export function buildAiProviderInput(request: AiAnalysisProviderRequest): string {
  if ("snapshotData" in request) {
    return [
      "BEGIN_UNTRUSTED_SNAPSHOT_DATA",
      JSON.stringify(request.snapshotData),
      "END_UNTRUSTED_SNAPSHOT_DATA",
    ].join("\n");
  }
  if ("outboundData" in request) {
    return [
      "BEGIN_UNTRUSTED_OUTBOUND_DATA",
      JSON.stringify(request.outboundData),
      "END_UNTRUSTED_OUTBOUND_DATA",
    ].join("\n");
  }
  if ("qualificationData" in request) {
    return [
      "BEGIN_UNTRUSTED_SYNTHETIC_QUALIFICATION_DATA",
      JSON.stringify(request.qualificationData),
      "END_UNTRUSTED_SYNTHETIC_QUALIFICATION_DATA",
    ].join("\n");
  }
  return [
    "BEGIN_UNTRUSTED_DOCUMENT_DATA",
    JSON.stringify(documentProviderData(request)),
    "END_UNTRUSTED_DOCUMENT_DATA",
  ].join("\n");
}

export function aiProviderOutputSchema(request: AiAnalysisProviderRequest): unknown {
  return "documentData" in request
    ? OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA
    : OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA;
}
