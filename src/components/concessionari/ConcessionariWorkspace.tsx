"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, CreditCard, FolderOpen, Search } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatDateIT } from "@/lib/utils";
import type { ConcessionarioListItem } from "@/server/queries/concessionari";

interface ConcessionariWorkspaceProps {
  items: ConcessionarioListItem[];
}

export function ConcessionariWorkspace({ items }: ConcessionariWorkspaceProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase("it"));
  const filteredItems = deferredSearch
    ? items.filter((item) =>
        [item.denominazione, item.codiceFiscale, item.partitaIva, ...item.numeriConcessione]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase("it").includes(deferredSearch)),
      )
    : items;

  return (
    <section className="mt-5" aria-labelledby="elenco-concessionari">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="elenco-concessionari" className="text-base font-semibold text-slate-950">Elenco concessionari</h2>
          <p className="mt-1 text-sm text-slate-600">Una vista per soggetto, con concessioni e fascicoli collegati.</p>
        </div>
        <label className="block w-full sm:max-w-sm">
          <span className="text-sm font-medium text-slate-800">Cerca concessionario</span>
          <span className="mt-1 flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 focus-within:border-cyan-700 focus-within:ring-2 focus-within:ring-cyan-100">
            <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Denominazione, CF, P.IVA o concessione"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-slate-400"
            />
          </span>
        </label>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {filteredItems.map((item) => (
          <Card key={item.id} className="min-w-0">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-slate-500">
                  <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-xs font-medium uppercase">Concessionario</span>
                </div>
                <CardTitle className="mt-2 break-words text-base">{item.denominazione}</CardTitle>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="success">{item.concessioniAttiveCount} attive</Badge>
                {item.criticitaAperteCount > 0 ? <Badge variant="warning">{item.criticitaAperteCount} criticità</Badge> : null}
              </div>
            </CardHeader>
            <CardContent>
              {(item.codiceFiscale || item.partitaIva || item.contatto) ? (
                <dl className="grid gap-x-5 gap-y-2 border-b border-slate-100 pb-4 text-sm sm:grid-cols-2">
                  {item.codiceFiscale ? <div><dt className="text-xs text-slate-500">Codice fiscale</dt><dd className="break-all font-medium">{item.codiceFiscale}</dd></div> : null}
                  {item.partitaIva ? <div><dt className="text-xs text-slate-500">Partita IVA</dt><dd className="break-all font-medium">{item.partitaIva}</dd></div> : null}
                  {item.contatto ? <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Contatto</dt><dd className="break-all font-medium">{item.contatto}</dd></div> : null}
                </dl>
              ) : null}

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="flex items-center gap-1 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />Concessioni</dt><dd className="mt-1 font-semibold">{item.concessioniCount}</dd></div>
                <div><dt className="flex items-center gap-1 text-xs text-slate-500"><FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />Fascicoli</dt><dd className="mt-1 font-semibold">{item.fascicoliCount}</dd></div>
                <div><dt className="flex items-center gap-1 text-xs text-slate-500"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Criticità</dt><dd className="mt-1 font-semibold">{item.criticitaAperteCount}</dd></div>
                <div><dt className="flex items-center gap-1 text-xs text-slate-500"><CreditCard className="h-3.5 w-3.5" aria-hidden="true" />Pagamenti critici</dt><dd className="mt-1 font-semibold">{item.pagamentiCriticiCount}</dd></div>
              </dl>

              {item.prossimaScadenza ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-slate-700">
                  <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  Prossima scadenza concessoria: <strong>{formatDateIT(item.prossimaScadenza)}</strong>
                </p>
              ) : null}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <Link
                  href={`/concessionari/${item.id}`}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 sm:w-auto"
                >
                  Apri concessionario <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-600">
          {items.length === 0 ? "Nessun concessionario disponibile." : "Nessun concessionario corrisponde alla ricerca."}
        </div>
      ) : null}
    </section>
  );
}