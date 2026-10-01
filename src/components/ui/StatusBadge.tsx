import { Badge, type BadgeVariant } from "@/components/ui/Badge";

const machineLabels: Record<string, string> = {
  TERMINAL_FAILED: "Elaborazione non completata",
  IDENTITY_VERIFICATION_REQUIRED: "Identità della fonte da verificare",
  CONTENT_VERIFICATION_REQUIRED: "Contenuto della fonte da verificare",
  MANUAL_REVIEW_REQUIRED: "Revisione professionale richiesta",
  RETRY_WAIT: "Nuovo tentativo programmato",
  CANCELLATION_REQUESTED: "Annullamento richiesto",
  QUEUED: "In coda",
  RUNNING: "In elaborazione",
  SUCCEEDED: "Completato",
  CANCELLED: "Annullato",
};

const machineVariants: Record<string, BadgeVariant> = {
  TERMINAL_FAILED: "danger",
  IDENTITY_VERIFICATION_REQUIRED: "warning",
  CONTENT_VERIFICATION_REQUIRED: "warning",
  MANUAL_REVIEW_REQUIRED: "warning",
  RETRY_WAIT: "info",
  CANCELLATION_REQUESTED: "warning",
  QUEUED: "muted",
  RUNNING: "info",
  SUCCEEDED: "success",
  CANCELLED: "muted",
};

export function StatusBadge({ code, label, variant }: {
  code: string;
  label?: string;
  variant?: BadgeVariant;
}) {
  return (
    <Badge variant={variant ?? machineVariants[code] ?? "default"} title={code}>
      {label ?? machineLabels[code] ?? code.replaceAll("_", " ").toLocaleLowerCase("it")}
    </Badge>
  );
}
