import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger";

function getStateVariant(value: string): BadgeVariant {
  if (value === "SCADUTA") {
    return "danger";
  }
  if (value === "APERTA") {
    return "warning";
  }
  if (value === "GESTITA") {
    return "success";
  }
  return "default";
}

function getPeriodoVariant(value: string): BadgeVariant {
  if (value === "SCADUTE") {
    return "danger";
  }
  if (value === "ENTRO_30_GIORNI") {
    return "danger";
  }
  if (value === "ENTRO_60_GIORNI" || value === "ENTRO_90_GIORNI") {
    return "warning";
  }
  return "success";
}

export function ScadenzaStatoBadge({ value }: { value: string }) {
  return <Badge variant={getStateVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function ScadenzaPeriodoBadge({ value }: { value: string }) {
  return <Badge variant={getPeriodoVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function GiorniBadge({ giorniResidui, giorniRitardo }: { giorniResidui: number | null; giorniRitardo: number | null }) {
  if (giorniRitardo !== null) {
    return <Badge variant="danger">{giorniRitardo} gg ritardo</Badge>;
  }

  if (giorniResidui !== null && giorniResidui <= 30) {
    return <Badge variant="danger">{giorniResidui} gg residui</Badge>;
  }

  if (giorniResidui !== null && giorniResidui <= 90) {
    return <Badge variant="warning">{giorniResidui} gg residui</Badge>;
  }

  if (giorniResidui !== null) {
    return <Badge variant="success">{giorniResidui} gg residui</Badge>;
  }

  return <Badge>n/d</Badge>;
}
