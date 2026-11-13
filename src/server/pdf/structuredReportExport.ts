import {
  buildProfessionalReportDocument,
  renderProfessionalReportPdf,
  renderProfessionalReportRtf,
} from "@/server/fascicolo-report/professional-export";

import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

interface StructuredReportExportInput {
  snapshotId: string;
  status: string;
  generatedAt: Date;
  payload: StructuredFascicoloReportPayload;
  documents?: ReadonlyArray<{ id: string; nome: string }>;
}

function professionalDocument(input: StructuredReportExportInput) {
  return buildProfessionalReportDocument({
    generatedAt: input.generatedAt,
    payload: input.payload,
  }, input.documents);
}

export async function renderStructuredReportPdf(input: StructuredReportExportInput): Promise<Buffer> {
  return renderProfessionalReportPdf(professionalDocument(input));
}

export function renderStructuredReportRtf(input: StructuredReportExportInput): Buffer {
  return renderProfessionalReportRtf(professionalDocument(input));
}
