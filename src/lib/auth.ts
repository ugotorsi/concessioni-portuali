import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const DEMO_ROLES = [
  "ADMIN",
  "OPERATORE_SOCIETA",
  "GIURIDICO",
  "TECNICO",
  "ECONOMICO",
  "VIEWER_ADSP",
] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];

export const BACKOFFICE_ROLES: DemoRole[] = [
  "ADMIN",
  "OPERATORE_SOCIETA",
  "GIURIDICO",
  "TECNICO",
  "ECONOMICO",
];

export const DEMO_ROLE_COOKIE = "cp_demo_role";

function isDemoRole(value: string | undefined): value is DemoRole {
  if (!value) {
    return false;
  }

  return DEMO_ROLES.includes(value as DemoRole);
}

export async function getCurrentRole(): Promise<DemoRole | null> {
  const cookieStore = await cookies();
  const role = cookieStore.get(DEMO_ROLE_COOKIE)?.value;

  return isDemoRole(role) ? role : null;
}

export async function requireRole(allowedRoles?: DemoRole[]): Promise<DemoRole> {
  const role = await getCurrentRole();

  if (!role) {
    redirect("/login");
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    redirect(role === "VIEWER_ADSP" ? "/adsp" : "/dashboard");
  }

  return role;
}

export function isAdspViewer(role: DemoRole): boolean {
  return role === "VIEWER_ADSP";
}

export function isBackofficeRole(role: DemoRole): boolean {
  return BACKOFFICE_ROLES.includes(role);
}

export function getRoleLabel(role: DemoRole): string {
  switch (role) {
    case "ADMIN":
      return "Amministratore";
    case "OPERATORE_SOCIETA":
      return "Operatore Società";
    case "GIURIDICO":
      return "Profilo Giuridico";
    case "TECNICO":
      return "Profilo Tecnico";
    case "ECONOMICO":
      return "Profilo Economico";
    case "VIEWER_ADSP":
      return "Viewer AdSP";
    default:
      return role;
  }
}

export function getRoleDescription(role: DemoRole): string {
  switch (role) {
    case "ADMIN":
      return "Accesso completo alla vista Back-office società in modalità dimostrativa.";
    case "OPERATORE_SOCIETA":
      return "Profilo operativo Back-office società per monitoraggio e coordinamento.";
    case "GIURIDICO":
      return "Profilo Back-office orientato ai passaggi istruttori e normativi.";
    case "TECNICO":
      return "Profilo Back-office orientato a verifiche tecniche e sopralluoghi.";
    case "ECONOMICO":
      return "Profilo Back-office orientato a canoni, morosità e analisi economica.";
    case "VIEWER_ADSP":
      return "Vista consultiva AdSP con focus su report validati e quadro sintetico.";
    default:
      return "Profilo demo";
  }
}

export function canManageCriticita(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO", "TECNICO", "ECONOMICO"].includes(role);
}

export function canManagePagamenti(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "ECONOMICO"].includes(role);
}

export function canManageSopralluoghi(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "TECNICO"].includes(role);
}

export function canManageProcedimenti(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"].includes(role);
}

export function canValidateReport(role: DemoRole): boolean {
  return ["ADMIN", "GIURIDICO"].includes(role);
}

export function canViewNormativa(_role: DemoRole): boolean {
  return true;
}

export function canManageNormativaUpdate(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"].includes(role);
}

export function canUseAI(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO", "TECNICO", "ECONOMICO"].includes(role);
}

export function canExportOperationalData(role: DemoRole): boolean {
  return ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO", "TECNICO", "ECONOMICO"].includes(role);
}

export function canDownloadReportPdf(role: DemoRole, isValidatedReport: boolean): boolean {
  if (role === "VIEWER_ADSP") {
    return isValidatedReport;
  }

  return true;
}
