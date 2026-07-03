import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { GetSopralluoghiListParams, SopralluoghiFiltersData } from "@/server/queries/sopralluoghi";

interface SopralluoghiFiltersBarProps {
  filtersData: SopralluoghiFiltersData;
  current: GetSopralluoghiListParams;
}

export function SopralluoghiFiltersBar({ filtersData, current }: SopralluoghiFiltersBarProps) {
  return (
    <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-5">
      <Input
        name="search"
        placeholder="Ricerca verbale, concessionario, area"
        defaultValue={current.search ?? ""}
        className="xl:col-span-2"
      />

      <Select name="esito" defaultValue={current.esito ?? ""}>
        <option value="">Esito (tutti)</option>
        {filtersData.esiti.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="periodo" defaultValue={current.periodo ?? "TUTTI"}>
        {filtersData.periodi.map((option) => (
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

      <div className="flex items-center gap-2 md:col-span-2 xl:col-span-3">
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Applica filtri
        </button>
        <a
          href="/sopralluoghi"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Reset
        </a>
      </div>
    </form>
  );
}
