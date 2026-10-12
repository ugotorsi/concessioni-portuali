import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const moduloLinks = [
  { href: "/concessioni", label: "Concessioni e contratti" },
  { href: "/concessionari", label: "Soggetti" },
  { href: "/pagamenti", label: "Canoni e pagamenti" },
  { href: "/scadenze", label: "Scadenze e obblighi" },
  { href: "/sopralluoghi", label: "Sopralluoghi e manutenzioni" },
  { href: "/criticita", label: "Criticita" },
  { href: "/procedimenti", label: "Procedimenti" },
  { href: "/documenti", label: "Documenti" },
  { href: "/normativa", label: "Normativa" },
  { href: "/audit", label: "Audit" },
  { href: "/report", label: "Report" },
];

const prioritaIniziali = [
  "Anagrafica bene pubblico e fascicolo unico del bene",
  "Collegamento bene-rapporto concessorio o contrattuale",
  "Collegamento soggetti-canoni-pagamenti-scadenze",
  "Tracciabilita documenti e fonti normative apribili",
  "Presidio criticita, procedimenti e audit sul fascicolo",
];

export default async function PatrimonioImmobiliarePubblicoPage() {
  return (
    <AppShell
      title="Verticale patrimonio immobiliare pubblico"
      subtitle="Workspace strategico per la gestione unificata del patrimonio immobiliare degli enti pubblici."
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4" data-testid="verticale-patrimonio-page">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Stato verticale</CardTitle>
                <CardDescription>
                  Verticale attivata come perimetro definitivo di sviluppo prodotto, senza ambiente demo dedicato.
                </CardDescription>
              </div>
              <Badge variant="warning">Implementazione in corso</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {prioritaIniziali.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-600" data-testid="verticale-patrimonio-note">
              Incremento non distruttivo: la verticalizzazione patrimoniale utilizza i moduli esistenti e prepara il fascicolo unico del bene.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Navigazione moduli collegati</CardTitle>
            <CardDescription>
              Accesso ai moduli gia disponibili per costruire la vista trasversale bene-rapporto-soggetto-pagamenti-documenti.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {moduloLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
