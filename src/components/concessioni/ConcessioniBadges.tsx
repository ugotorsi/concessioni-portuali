import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger";

function getStateVariant(value: string): BadgeVariant {
  if (["SCADUTA", "SCADUTO", "NON_PAGATO", "INADEMPIUTO", "APERTA"].includes(value)) {
    return "danger";
  }

  if (["PARZIALE", "IN_GESTIONE", "DA_AVVIARE", "IN_CORSO", "IN_PROROGA", "SOSPESA"].includes(value)) {
    return "warning";
  }

  if (["ATTIVA", "PAGATO", "ADEMPIUTO", "CONCLUSO", "RISOLTA", "GESTITA"].includes(value)) {
    return "success";
  }

  return "default";
}

function getGravitaVariant(value: string): BadgeVariant {
  if (value === "URGENTE" || value === "ALTA") {
    return "danger";
  }
  if (value === "MEDIA") {
    return "warning";
  }
  if (value === "BASSA") {
    return "success";
  }
  return "default";
}

export function StatoBadge({ value }: { value: string }) {
  return <Badge variant={getStateVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function GravitaBadge({ value }: { value: string }) {
  return <Badge variant={getGravitaVariant(value)}>{formatEnumLabel(value)}</Badge>;
}
