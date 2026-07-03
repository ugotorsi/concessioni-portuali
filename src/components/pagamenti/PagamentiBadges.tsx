import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger";

function statoVariant(value: string): BadgeVariant {
  if (value === "NON_PAGATO" || value === "SCADUTO") {
    return "danger";
  }
  if (value === "PARZIALE") {
    return "warning";
  }
  if (value === "PAGATO") {
    return "success";
  }
  return "default";
}

export function PagamentoStatoBadge({ value }: { value: string }) {
  return <Badge variant={statoVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function RitardoBadge({ giorniRitardo }: { giorniRitardo: number | null }) {
  if (giorniRitardo === null) {
    return <Badge variant="success">Regolare</Badge>;
  }

  if (giorniRitardo >= 60) {
    return <Badge variant="danger">{giorniRitardo} gg ritardo</Badge>;
  }

  return <Badge variant="warning">{giorniRitardo} gg ritardo</Badge>;
}

export function ResiduoBadge({ residuo }: { residuo: number }) {
  if (residuo <= 0) {
    return <Badge variant="success">Saldo</Badge>;
  }

  return <Badge variant="danger">Residuo</Badge>;
}
