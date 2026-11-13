const adminRuntimeDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Rome",
});

export function formatAdminRuntimeDateTime(value: Date): string {
  return adminRuntimeDateTimeFormatter.format(value);
}
