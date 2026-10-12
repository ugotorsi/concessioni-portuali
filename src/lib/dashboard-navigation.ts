export type DashboardFascicoloSection = "deadlines" | "issues";

export function buildDashboardFascicoloHref(
  fascicoloId: string,
  section?: DashboardFascicoloSection,
): string {
  const basePath = `/procedimenti/${fascicoloId}`;
  return section ? `${basePath}?section=${section}` : basePath;
}
