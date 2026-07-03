import { Badge } from "@/components/ui/Badge";
import { formatEnumLabel } from "@/lib/utils";

interface ReportTipologiaBadgeProps {
  value: string;
}

interface ReportValidatoBadgeProps {
  value: boolean;
}

export function ReportTipologiaBadge({ value }: ReportTipologiaBadgeProps) {
  if (value === "DOSSIER_ISTRUTTORIO") {
    return <Badge variant="warning">{formatEnumLabel(value)}</Badge>;
  }

  if (value === "REPORT_MOROSITA" || value === "PROPOSTA_BANDO" || value === "REPORT_CRITICITA") {
    return <Badge variant="danger">{formatEnumLabel(value)}</Badge>;
  }

  return <Badge>{formatEnumLabel(value)}</Badge>;
}

export function ReportValidatoBadge({ value }: ReportValidatoBadgeProps) {
  return <Badge variant={value ? "success" : "warning"}>{value ? "Validato" : "Non validato"}</Badge>;
}
