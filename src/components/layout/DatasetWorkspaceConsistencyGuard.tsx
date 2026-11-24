"use client";

import { useEffect } from "react";

import type { DatasetScope } from "@/lib/dataset-visibility";
import {
  DATASET_WORKSPACE_STORAGE_KEY,
  parseDatasetWorkspaceSelectionNotice,
} from "@/lib/dataset-workspace-browser";

export function DatasetWorkspaceConsistencyGuard({
  datasetScope,
}: {
  datasetScope: DatasetScope;
}) {
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== DATASET_WORKSPACE_STORAGE_KEY) {
        return;
      }
      const selection = parseDatasetWorkspaceSelectionNotice(event.newValue);
      if (selection && selection.scope !== datasetScope) {
        globalThis.location.reload();
      }
    }

    globalThis.addEventListener("storage", handleStorage);
    return () => globalThis.removeEventListener("storage", handleStorage);
  }, [datasetScope]);

  return null;
}
