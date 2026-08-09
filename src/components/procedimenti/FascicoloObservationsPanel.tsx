import { refreshFascicoloObservationsAction, reviewFascicoloObservationAction } from "@/server/actions/fascicolo-observations";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatDateIT } from "@/lib/utils";

interface FascicoloObservationsPanelProps {
  procedimentoId: string;
  canReview: boolean;
  hasCanonicalTenant: boolean;
  observations: Awaited<ReturnType<typeof import("@/server/queries/fascicolo-observations").getFascicoloObservations>>;
}

function statusVariant(status: "PROPOSTO" | "VALIDATO" | "RIFIUTATO" | "SUPERATO") {
  if (status === "VALIDATO") {
    return "success" as const;
  }
  if (status === "RIFIUTATO") {
    return "danger" as const;
  }
  return "default" as const;
}

export function FascicoloObservationsPanel({ procedimentoId, canReview, hasCanonicalTenant, observations }: FascicoloObservationsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Osservazioni del fascicolo</CardTitle>
        <CardDescription>Supporto tecnico non vincolante, sottoposto a verifica umana.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canReview && hasCanonicalTenant ? (
          <form action={refreshFascicoloObservationsAction}>
            <input type="hidden" name="procedimentoId" value={procedimentoId} />
            <Button type="submit" variant="outline">Aggiorna osservazioni</Button>
          </form>
        ) : null}
        {!hasCanonicalTenant ? (
          <p className="text-sm text-slate-600">
            Le osservazioni del fascicolo non sono disponibili finché il procedimento non è associato a un ente competente.
          </p>
        ) : null}

        {observations.map((observation) => (
          <article key={observation.id} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">{observation.text}</p>
              <Badge variant={statusVariant(observation.status)}>{observation.status}</Badge>
            </div>
            <p>
              Documento sorgente: <a href={`/documenti/${observation.documento.id}/download`} className="underline underline-offset-4">{observation.documento.nome}</a>
            </p>
            <p>
              Condizione tecnica attuale: {observation.currentConditionDetected ? "rilevata" : "non più rilevata"}
            </p>
            <p className="text-xs text-slate-600">
              Canale: {observation.factsSnapshot.canale ?? "-"}; ricevuta accettazione: {observation.factsSnapshot.pecRicevutaAccettazioneId ?? "non registrata"}; ricevuta consegna: {observation.factsSnapshot.pecRicevutaConsegnaId ?? "non registrata"}
            </p>
            <p className="text-xs text-slate-600">{observation.ruleCode} v{observation.ruleVersion} - rilevata il {formatDateIT(observation.detectedAt)}</p>
            <p className="text-xs text-slate-600">{observation.disclaimer}</p>
            {observation.reviewedAt ? <p className="text-xs text-slate-600">Verificata il {formatDateIT(observation.reviewedAt)}{observation.reviewNote ? `: ${observation.reviewNote}` : ""}</p> : null}

            {canReview && observation.status === "PROPOSTO" ? (
              <div className="grid gap-2 md:grid-cols-3">
                <form action={reviewFascicoloObservationAction} className="flex gap-2">
                  <input type="hidden" name="observationId" value={observation.id} />
                  <input type="hidden" name="status" value="VALIDATO" />
                  <Input name="reviewNote" placeholder="Nota opzionale" />
                  <Button type="submit" size="sm">Valida</Button>
                </form>
                <form action={reviewFascicoloObservationAction} className="flex gap-2">
                  <input type="hidden" name="observationId" value={observation.id} />
                  <input type="hidden" name="status" value="RIFIUTATO" />
                  <Input name="reviewNote" required placeholder="Nota obbligatoria" />
                  <Button type="submit" size="sm" variant="outline">Rifiuta</Button>
                </form>
                <form action={reviewFascicoloObservationAction} className="flex gap-2">
                  <input type="hidden" name="observationId" value={observation.id} />
                  <input type="hidden" name="status" value="SUPERATO" />
                  <Input name="reviewNote" required placeholder="Nota obbligatoria" />
                  <Button type="submit" size="sm" variant="outline">Segna come superata</Button>
                </form>
              </div>
            ) : null}
          </article>
        ))}

        {observations.length === 0 ? <p className="text-sm text-slate-500">Nessuna osservazione del fascicolo rilevata.</p> : null}
      </CardContent>
    </Card>
  );
}