import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { GetProcedimentiListParams, ProcedimentiFiltersData } from "@/server/queries/procedimenti";

interface ProcedimentiFiltersBarProps {
  filtersData: ProcedimentiFiltersData;
  current: GetProcedimentiListParams;
}

export function ProcedimentiFiltersBar({ filtersData, current }: ProcedimentiFiltersBarProps) {
  return (
    <form method="get" className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(20rem,2fr)_repeat(3,minmax(10rem,1fr))]">
        <label className="md:col-span-2 xl:col-span-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Cerca fascicolo</span>
          <Input
            name="search"
            placeholder="Oggetto, concessione, soggetto o riferimento"
            defaultValue={current.search ?? ""}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Tipologia</span>
          <Select name="tipologia" defaultValue={current.tipologia ?? ""}>
        <option value="">Tipologia (tutte)</option>
        {filtersData.tipologie.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Stato</span>
          <Select name="stato" defaultValue={current.stato ?? ""}>
        <option value="">Stato (tutti)</option>
        {filtersData.stati.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Periodo</span>
          <Select name="periodo" defaultValue={current.periodo ?? "TUTTI"}>
        {filtersData.periodi.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
          </Select>
        </label>
      </div>

      <details className="mt-4 border-t border-slate-200 pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-[#173d4f]">Filtri avanzati</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <Select aria-label="Stato checklist" name="checklist" defaultValue={current.checklist ?? "TUTTE"}>
        {filtersData.checklist.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Stato memorie" name="memorie" defaultValue={current.memorie ?? "TUTTE"}>
        {filtersData.memorie.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Origine procedimento" name="origineProcedimento" defaultValue={current.origineProcedimento ?? ""}>
        <option value="">Origine (tutte)</option>
        {filtersData.originiProcedimento.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Procedimento d'ufficio" name="procedimentoUfficio" defaultValue={current.procedimentoUfficio ?? "TUTTI"}>
        {filtersData.procedimentoUfficio.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Applicabilità preavviso di rigetto" name="preavvisoRigettoApplicabile" defaultValue={current.preavvisoRigettoApplicabile ?? "TUTTI"}>
        {filtersData.preavvisoRigettoApplicabile.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Stato preavviso di rigetto" name="statoPreavvisoRigetto" defaultValue={current.statoPreavvisoRigetto ?? ""}>
        <option value="">Stato preavviso (tutti)</option>
        {filtersData.statiPreavvisoRigetto.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Concessione" name="concessioneId" defaultValue={current.concessioneId ?? ""}>
        <option value="">Concessione (tutte)</option>
        {filtersData.concessioni.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select aria-label="Criticità" name="criticitaId" defaultValue={current.criticitaId ?? ""}>
        <option value="">Criticita (tutte)</option>
        {filtersData.criticita.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit">Applica filtri</Button>
        <Link href="/procedimenti" className="inline-flex h-10 items-center justify-center rounded-md px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
          Reset
        </Link>
      </div>
    </form>
  );
}
