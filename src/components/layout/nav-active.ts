export type NavMatchMode = "exact" | "section";

export function isNavItemActive(pathname: string, href: string, mode: NavMatchMode = "exact"): boolean {
  if (mode === "exact") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
