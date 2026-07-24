import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ConcessioniFiltersData, GetConcessioniListParams } from "@/server/queries/concessioni";

interface ConcessioniFiltersBarProps {
  filtersData: ConcessioniFiltersData;
  current: GetConcessioniListParams;
}

export function ConcessioniFiltersBar({ filtersData, current }: ConcessioniFiltersBarProps) {
  return (
    <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-6">
      <Input
        name="search"
        placeholder="Ricerca atto, area, concessionario"
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

      <Select name="tipologiaBene" defaultValue={current.tipologiaBene ?? ""}>
        <option value="">Tipologia bene (tutte)</option>
        {filtersData.tipologieBene.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="attivita" defaultValue={current.attivita ?? ""}>
        <option value="">Attività (tutte)</option>
        {filtersData.attivita.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="concessionVertical" defaultValue={current.concessionVertical ?? ""}>
        <option value="">Verticale (tutte)</option>
        {filtersData.verticali.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="concessionarioId" defaultValue={current.concessionarioId ?? ""}>
        <option value="">Concessionario (tutti)</option>
        {filtersData.concessionari.map((option) => (
          <option key={option.id} value={option.id}>
            {option.denominazione}
          </option>
        ))}
      </Select>

      <Select name="scadenza" defaultValue={current.scadenza ?? ""}>
        <option value="">Scadenza (tutte)</option>
        {filtersData.scadenze.map((option) => (
          <option key={option.value} value={option.value}>
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
          href="/concessioni"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Reset
        </a>
      </div>
    </form>
  );
}
