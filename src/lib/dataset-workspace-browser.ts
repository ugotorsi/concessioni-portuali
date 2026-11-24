import type { DatasetScope } from "@/lib/dataset-visibility";

export const DATASET_WORKSPACE_STORAGE_KEY = "noetra.dataset-workspace-selection";

export type DatasetWorkspaceSelectionNotice = Readonly<{
  scope: Extract<DatasetScope, "PROFESSIONAL" | "SYNTHETIC">;
  expiresAt: number;
}>;

export function parseDatasetWorkspaceSelectionNotice(
  value: string | null,
  now = Date.now(),
): DatasetWorkspaceSelectionNotice | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<DatasetWorkspaceSelectionNotice>;
    if (
      (parsed.scope !== "PROFESSIONAL" && parsed.scope !== "SYNTHETIC")
      || typeof parsed.expiresAt !== "number"
      || !Number.isFinite(parsed.expiresAt)
      || parsed.expiresAt <= now
    ) {
      return null;
    }
    return {
      scope: parsed.scope,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}
