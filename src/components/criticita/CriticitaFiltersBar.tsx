import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { CriticitaFiltersData, GetCriticitaListParams } from "@/server/queries/criticita";

interface CriticitaFiltersBarProps {
  filtersData: CriticitaFiltersData;
  current: GetCriticitaListParams;
}

export function CriticitaFiltersBar({ filtersData, current }: CriticitaFiltersBarProps) {
  return (
    <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-6">
      <Input
        name="search"
        placeholder="Ricerca descrizione, norma, concessione"
        defaultValue={current.search ?? ""}
        className="xl:col-span-2"
      />

      <Select name="tipologia" defaultValue={current.tipologia ?? ""}>
        <option value="">Tipologia (tutte)</option>
        {filtersData.tipologie.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="gravita" defaultValue={current.gravita ?? ""}>
        <option value="">Gravita (tutte)</option>
        {filtersData.gravita.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="stato" defaultValue={current.stato ?? ""}>
        <option value="">Stato (tutti)</option>
        {filtersData.stati.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="fonte" defaultValue={current.fonte ?? ""}>
        <option value="">Fonte (tutte)</option>
        {filtersData.fonti.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="concessioneId" defaultValue={current.concessioneId ?? ""}>
        <option value="">Concessione (tutte)</option>
        {filtersData.concessioni.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-2 md:col-span-2 xl:col-span-6">
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Applica filtri
        </button>
        <a
          href="/criticita"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Reset
        </a>
      </div>
    </form>
  );
}
