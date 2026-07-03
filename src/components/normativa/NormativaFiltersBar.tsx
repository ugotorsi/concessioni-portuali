import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { GetNormativaListParams, NormativaFiltersData } from "@/server/queries/normativa";

interface NormativaFiltersBarProps {
  filtersData: NormativaFiltersData;
  current: GetNormativaListParams;
}

export function NormativaFiltersBar({ filtersData, current }: NormativaFiltersBarProps) {
  return (
    <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-5">
      <Input
        name="search"
        placeholder="Ricerca codice, titolo, ente"
        defaultValue={current.search ?? ""}
        className="xl:col-span-2"
      />

      <Select name="ambito" defaultValue={current.ambito ?? ""}>
        <option value="">Ambito (tutti)</option>
        {filtersData.ambiti.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="stato" defaultValue={current.stato ?? ""}>
        <option value="">Stato versione (tutti)</option>
        {filtersData.stati.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-2 xl:col-span-5">
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Applica filtri
        </button>
        <a
          href="/normativa"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Reset
        </a>
      </div>
    </form>
  );
}
