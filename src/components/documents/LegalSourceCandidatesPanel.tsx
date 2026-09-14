import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatDateIT } from "@/lib/utils";
import type { FascicoloLegalSourceCandidate } from "@/server/queries/fascicolo-legal-source-candidates";

interface LegalSourceCandidatesPanelProps {
  items: FascicoloLegalSourceCandidate[];
}

export function LegalSourceCandidatesPanel({ items }: LegalSourceCandidatesPanelProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fonti giuridiche candidate</CardTitle>
        <CardDescription>
          Documenti riconosciuti come possibili fonti giuridiche, da verificare prima del loro utilizzo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {items.map((item) => (
            <div key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {item.originalName ?? "Documento caricato"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.mimeType} · Ammesso il {formatDateIT(item.admittedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">Possibile fonte giuridica</Badge>
                {item.reviewRequired ? <Badge variant="warning">Da verificare</Badge> : null}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}