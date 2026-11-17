export const PORT_ACTIVITY_LEGAL_TYPE_VALUES = [
  "OPERAZIONI_PORTUALI",
  "SERVIZI_PORTUALI",
  "PASSEGGERI",
  "ALTRO",
] as const;

export type PortActivityLegalTypeValue = (typeof PORT_ACTIVITY_LEGAL_TYPE_VALUES)[number];

const PORT_ACTIVITY_LEGAL_TYPE_LABELS: Record<PortActivityLegalTypeValue, string> = {
  OPERAZIONI_PORTUALI: "Operazioni portuali",
  SERVIZI_PORTUALI: "Servizi portuali",
  PASSEGGERI: "Attività relative ai passeggeri",
  ALTRO: "Altra natura",
};

export function getPortActivityLegalTypeLabel(value: PortActivityLegalTypeValue | null): string {
  return value === null ? "Non classificata" : PORT_ACTIVITY_LEGAL_TYPE_LABELS[value];
}