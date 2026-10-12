import type {
  NeutralIntakeClassificationOutcome,
  NeutralIntakeStatus,
} from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatDateIT } from "@/lib/utils";
import type { FascicoloProcessingItem } from "@/server/queries/neutral-intake-processing";

type BadgeVariant = "default" | "success" | "warning" | "danger";

export function getProcessingStatusPresentation(
  status: NeutralIntakeStatus,
  hasClassification: boolean,
): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "RECEIVED":
      return { label: "Caricato - lettura in corso", variant: "default" };
    case "EVIDENCE_READY":
      return hasClassification
        ? { label: "Classificazione completata - acquisizione in corso", variant: "default" }
        : { label: "Documento letto - classificazione in corso", variant: "default" };
    case "REVIEW_REQUIRED":
      return { label: "Da verificare", variant: "warning" };
    case "FAILED_EXTRACTION":
    case "FAILED_CLASSIFICATION":
    case "FAILED_HANDOFF":
      return { label: "Elaborazione non completata", variant: "danger" };
    case "ROUTED":
      return { label: "Documento acquisito", variant: "success" };
  }
}

export function getClassificationNatureLabel(
  outcome: NeutralIntakeClassificationOutcome,
  reviewRequired: boolean,
): string {
  if (reviewRequired) {
    return "Da verificare";
  }

  switch (outcome) {
    case "CASE_DOCUMENT":
      return "Documento del fascicolo";
    case "LEGAL_SOURCE_CANDIDATE":
      return "Possibile fonte giuridica";
    case "UNCERTAIN_REVIEW_REQUIRED":
      return "Da verificare";
  }
}

interface NeutralIntakeProcessingPanelProps {
  items: FascicoloProcessingItem[];
}

export function NeutralIntakeProcessingPanel({ items }: NeutralIntakeProcessingPanelProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>In elaborazione</CardTitle>
        <CardDescription>Stato dei documenti caricati che non sono ancora presenti nel catalogo del fascicolo.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {items.map((item) => {
            const status = getProcessingStatusPresentation(item.status, item.classification !== null);
            const nature = item.classification
              ? getClassificationNatureLabel(item.classification.outcome, item.classification.reviewRequired)
              : null;

            return (
              <div key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.originalName ?? "Documento caricato"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.mimeType} · {item.sizeBytes} bytes · {formatDateIT(item.receivedAt)}
                  </p>
                  {nature ? <p className="mt-1 text-sm text-slate-700">Natura: {nature}</p> : null}
                </div>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}