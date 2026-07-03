import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger";

function getGravitaVariant(value: string): BadgeVariant {
  if (value === "URGENTE") {
    return "danger";
  }
  if (value === "ALTA") {
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

function getStatoVariant(value: string): BadgeVariant {
  if (value === "APERTA") {
    return "danger";
  }
  if (value === "IN_GESTIONE") {
    return "warning";
  }
  if (value === "RISOLTA") {
    return "success";
  }
  return "default";
}

function getTipologiaVariant(value: string): BadgeVariant {
  if (["RISCHIO_DECADENZA", "RISCHIO_REVOCA", "MOROSITA"].includes(value)) {
    return "danger";
  }
  if (["USO_NON_CONFORME", "OCCUPAZIONE_DIFFORME", "SICUREZZA"].includes(value)) {
    return "warning";
  }
  return "default";
}

export function GravitaBadge({ value }: { value: string }) {
  return <Badge variant={getGravitaVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function StatoBadge({ value }: { value: string }) {
  return <Badge variant={getStatoVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function TipologiaBadge({ value }: { value: string }) {
  return <Badge variant={getTipologiaVariant(value)}>{formatEnumLabel(value)}</Badge>;
}
