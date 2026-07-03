import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger";

function statoVariant(value: string): BadgeVariant {
  if (value === "DA_AVVIARE") {
    return "danger";
  }
  if (value === "IN_CORSO") {
    return "warning";
  }
  if (value === "CONCLUSO") {
    return "success";
  }
  return "default";
}

function tipologiaVariant(value: string): BadgeVariant {
  if (["AVVIO_DECADENZA", "AVVIO_REVOCA"].includes(value)) {
    return "danger";
  }
  if (["RECUPERO_CANONI", "ESCUSSIONE_GARANZIA", "ORDINE_RIPRISTINO"].includes(value)) {
    return "warning";
  }
  return "default";
}

export function ProcedimentoStatoBadge({ value }: { value: string }) {
  return <Badge variant={statoVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function ProcedimentoTipologiaBadge({ value }: { value: string }) {
  return <Badge variant={tipologiaVariant(value)}>{formatEnumLabel(value)}</Badge>;
}

export function ProcedimentoGiorniBadge(args: {
  giorniResiduiContraddittorio: number | null;
  giorniRitardoContraddittorio: number | null;
}) {
  if (args.giorniRitardoContraddittorio !== null) {
    return <Badge variant="danger">{args.giorniRitardoContraddittorio} gg ritardo</Badge>;
  }

  if (args.giorniResiduiContraddittorio !== null && args.giorniResiduiContraddittorio <= 30) {
    return <Badge variant="warning">{args.giorniResiduiContraddittorio} gg residui</Badge>;
  }

  if (args.giorniResiduiContraddittorio !== null) {
    return <Badge variant="success">{args.giorniResiduiContraddittorio} gg residui</Badge>;
  }

  return <Badge>N/D</Badge>;
}

export function ProcedimentoChecklistBadge({ complete }: { complete: boolean }) {
  return <Badge variant={complete ? "success" : "warning"}>{complete ? "Checklist completa" : "Checklist incompleta"}</Badge>;
}

export function ProcedimentoWarningBadge({ level }: { level: "default" | "warning" | "danger" }) {
  if (level === "danger") {
    return <Badge variant="danger">Attenzione alta</Badge>;
  }

  if (level === "warning") {
    return <Badge variant="warning">Attenzione media</Badge>;
  }

  return <Badge variant="default">Nessun alert</Badge>;
}
