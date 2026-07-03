import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { GetPagamentiListParams, PagamentiFiltersData } from "@/server/queries/pagamenti";

interface PagamentiFiltersBarProps {
  filtersData: PagamentiFiltersData;
  current: GetPagamentiListParams;
}

export function PagamentiFiltersBar({ filtersData, current }: PagamentiFiltersBarProps) {
  return (
    <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-6">
      <Input
        name="search"
        placeholder="Ricerca concessione, area, concessionario"
        defaultValue={current.search ?? ""}
        className="xl:col-span-2"
      />

      <Select name="stato" defaultValue={current.stato ?? ""}>
        <option value="">Stato (tutti)</option>
        {filtersData.stati.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="anno" defaultValue={typeof current.anno === "number" ? String(current.anno) : ""}>
        <option value="">Anno (tutti)</option>
        {filtersData.anni.map((anno) => (
          <option key={anno} value={anno}>
            {anno}
          </option>
        ))}
      </Select>

      <Select name="criticita" defaultValue={current.criticita ?? ""}>
        <option value="">Criticita (tutte)</option>
        {filtersData.criticita.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="concessioneId" defaultValue={current.concessioneId ?? ""} className="xl:col-span-2">
        <option value="">Concessione (tutte)</option>
        {filtersData.concessioni.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="concessionarioId" defaultValue={current.concessionarioId ?? ""} className="xl:col-span-2">
        <option value="">Concessionario (tutti)</option>
        {filtersData.concessionari.map((option) => (
          <option key={option.id} value={option.id}>
            {option.denominazione}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-2 md:col-span-2 xl:col-span-2">
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Applica filtri
        </button>
        <a
          href="/pagamenti"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Reset
        </a>
      </div>
    </form>
  );
}
