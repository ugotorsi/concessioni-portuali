"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DatasetScope } from "@/lib/dataset-visibility";
import { DATASET_WORKSPACE_STORAGE_KEY } from "@/lib/dataset-workspace-browser";
import { selectDatasetWorkspaceAction } from "@/server/actions/dataset-workspace";

export function DatasetWorkspaceSelector({
  datasetScope,
}: {
  datasetScope?: DatasetScope;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selectedScope = datasetScope === "SYNTHETIC" ? "SYNTHETIC" : "PROFESSIONAL";
  const nextScope = selectedScope === "SYNTHETIC" ? "PROFESSIONAL" : "SYNTHETIC";

  function selectWorkspace(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const selection = await selectDatasetWorkspaceAction(formData);
        globalThis.localStorage.setItem(
          DATASET_WORKSPACE_STORAGE_KEY,
          JSON.stringify(selection),
        );
        router.replace("/dashboard");
        router.refresh();
      } catch {
        setError("Cambio workspace non completato. Ricaricare la pagina e riprovare.");
      }
    });
  }

  return (
    <div>
      <form action={selectWorkspace}>
        <input type="hidden" name="scope" value={nextScope} />
        <input
          type="hidden"
          name="confirmation"
          value={`SELECT_DATASET_WORKSPACE_${nextScope}`}
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285] disabled:cursor-wait disabled:opacity-60"
          title={`Passa al workspace ${nextScope === "SYNTHETIC" ? "di collaudo sintetico" : "professionale"}`}
        >
          {isPending
            ? "Cambio workspace..."
            : selectedScope === "SYNTHETIC"
              ? "Collaudo sintetico"
              : "Dati professionali"}
        </button>
      </form>
      {error ? <p role="alert" className="mt-1 max-w-64 text-right text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
