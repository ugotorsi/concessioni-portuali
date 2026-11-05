import type {
  AiAnalysisProviderRequestV1,
  AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import type { FascicoloDocumentProviderRequestV1 } from "@/server/ai/fascicoloDocumentAnalysis";
import {
  OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA,
  OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA,
} from "@/server/ai/providers/openai";

export type AiAnalysisProviderRequest =
  | AiAnalysisProviderRequestV1
  | AiOutboundAnalysisProviderRequestV1
  | FascicoloDocumentProviderRequestV1;

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
