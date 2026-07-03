import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

interface StringValueProps {
  value: string;
}

export function AmbitoNormaBadge({ value }: StringValueProps) {
  return <Badge>{formatEnumLabel(value)}</Badge>;
}

export function StatoVersioneBadge({ value }: StringValueProps) {
  const variant = value === "VIGENTE" ? "success" : value === "IN_CONSULTAZIONE" ? "warning" : "default";
  return <Badge variant={variant}>{formatEnumLabel(value)}</Badge>;
}

export function SeveritaImpattoBadge({ value }: StringValueProps) {
  const variant = value === "URGENTE" || value === "ALTA" ? "danger" : value === "MEDIA" ? "warning" : "default";
  return <Badge variant={variant}>{formatEnumLabel(value)}</Badge>;
}
