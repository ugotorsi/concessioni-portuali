import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger";

function esitoVariant(value: string): BadgeVariant {
  if (value === "NEGATIVO") {
    return "danger";
  }
  if (value === "CON_RILIEVI") {
    return "warning";
  }
  if (value === "POSITIVO") {
    return "success";
  }
  return "default";
}

export function EsitoSopralluogoBadge({ value }: { value: string }) {
  return <Badge variant={esitoVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function ConformitaBadge({ value }: { value: boolean }) {
  return <Badge variant={value ? "success" : "danger"}>{value ? "Conforme" : "Non conforme"}</Badge>;
}

export function ProblemaTecnicoBadge({ hasIssue }: { hasIssue: boolean }) {
  if (hasIssue) {
    return <Badge variant="warning">Rilievi</Badge>;
  }

  return <Badge variant="success">Regolare</Badge>;
}
