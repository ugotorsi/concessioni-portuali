"use client";

import { CheckCircle2, Link2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { formatDateIT } from "@/lib/utils";
import { resolveLegalSourceCandidate } from "@/server/actions/legal-source-candidate-resolution";
import type { FascicoloLegalSourceCandidate } from "@/server/queries/fascicolo-legal-source-candidates";

interface LegalSourceCandidatesPanelProps {
  items: FascicoloLegalSourceCandidate[];
  procedimentoId?: string;
  canVerify?: boolean;
}

interface LegalSourceSearchItem {
  id: string;
  stableKey: string;
  title: string;
  documentType: string;
  issuingBody: string | null;
  sourceNumber: string | null;
}

function CandidateResolutionReceipt({ item }: { item: FascicoloLegalSourceCandidate }) {
  const resolution = item.resolution;
  if (!resolution) {
    return null;
  }

  const linkedSourceAvailable = resolution.outcome === "LINKED" && resolution.legalSource !== null;
  const linkedSourceUnavailable = resolution.outcome === "LINKED" && resolution.legalSource === null;

  return (
    <div className="space-y-2 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={linkedSourceUnavailable ? "warning" : "success"}>
          {linkedSourceAvailable
            ? "Fonte collegata"
            : linkedSourceUnavailable
              ? "Verifica richiesta"
              : "Nessuna corrispondenza"}
        </Badge>
        <span className="text-xs text-slate-500">Verificata il {formatDateIT(resolution.resolvedAt)}</span>
      </div>
      {resolution.legalSource ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="font-medium text-slate-900">{resolution.legalSource.title}</p>
          <p className="mt-1 text-xs text-slate-600">
            {[resolution.legalSource.issuingBody, resolution.legalSource.sourceNumber, resolution.legalSource.stableKey]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ) : linkedSourceUnavailable ? (
        <p>
          Collegamento non disponibile. La fonte associata non è disponibile nel contesto autorizzato corrente. È
          necessaria una verifica.
        </p>
      ) : (
        <p>Nessuna fonte esistente trovata nel catalogo consultabile.</p>
      )}
      <p className="text-xs text-slate-500">
        Verificata da {resolution.reviewedByEmail} ({resolution.reviewedByRole}).
      </p>
      {resolution.reviewNote ? (
        <p className="text-xs text-slate-600"><span className="font-medium">Nota:</span> {resolution.reviewNote}</p>
      ) : null}
    </div>
  );
}

function CandidateVerification({
  item,
  procedimentoId,
  onClose,
}: {
  item: FascicoloLegalSourceCandidate;
  procedimentoId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LegalSourceSearchItem[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function searchSources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = String(new FormData(event.currentTarget).get("search") ?? "").trim();
    if (!search) {
      setMessage({ kind: "error", text: "Inserire un termine di ricerca." });
      return;
    }

    setSearching(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/legal-sources?search=${encodeURIComponent(search)}&pageSize=10`);
      if (!response.ok) {
        throw new Error("search failed");
      }
      const payload = await response.json() as { items: LegalSourceSearchItem[] };
      setResults(payload.items);
      setSelectedSourceId(null);
      if (payload.items.length === 0) {
        setMessage({ kind: "success", text: "Nessuna fonte trovata con questi criteri." });
      }
    } catch {
      setMessage({ kind: "error", text: "Ricerca non disponibile. Riprovare." });
    } finally {
      setSearching(false);
    }
  }

  function submitResolution(outcome: "LINKED" | "NO_MATCH") {
    if (outcome === "LINKED" && !selectedSourceId) {
      setMessage({ kind: "error", text: "Selezionare una fonte da collegare." });
      return;
    }

    setMessage(null);
    startTransition(async () => {
      try {
        const result = await resolveLegalSourceCandidate({
          admissionId: item.id,
          procedimentoId,
          outcome,
          ...(outcome === "LINKED" && selectedSourceId ? { legalSourceId: selectedSourceId } : {}),
          ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
        });
        if (result.status === "CONFLICT") {
          setMessage({ kind: "error", text: result.message });
          return;
        }
        setMessage({
          kind: "success",
          text: result.status === "CREATED" ? "Verifica registrata." : "Verifica gia registrata.",
        });
        router.refresh();
      } catch {
        setMessage({ kind: "error", text: "Verifica non registrata. Controllare i dati e riprovare." });
      }
    });
  }

  return (
    <div className="space-y-3 border-t border-slate-200 pt-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-600">
          Confrontare l&apos;identità del documento con una fonte già presente. Il collegamento non valuta applicabilità,
          attualità o effetti giuridici.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onClose} aria-label="Chiudi verifica">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <form onSubmit={searchSources} className="flex flex-col gap-2 sm:flex-row">
        <Input name="search" placeholder="Titolo, chiave o riferimento" disabled={searching || isPending} />
        <Button type="submit" variant="outline" disabled={searching || isPending}>
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          {searching ? "Ricerca..." : "Cerca"}
        </Button>
      </form>

      {results.length > 0 ? (
        <div className="max-h-64 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200">
          {results.map((source) => {
            const selected = selectedSourceId === source.id;
            return (
              <button
                key={source.id}
                type="button"
                className={`w-full px-3 py-2 text-left text-sm ${selected ? "bg-slate-100" : "bg-white hover:bg-slate-50"}`}
                onClick={() => setSelectedSourceId(source.id)}
                aria-pressed={selected}
                disabled={isPending}
              >
                <span className="font-medium text-slate-900">{source.title}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {[source.issuingBody, source.sourceNumber, source.stableKey].filter(Boolean).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <label className="block text-xs text-slate-700">
        Nota di verifica (facoltativa)
        <Textarea
          value={reviewNote}
          onChange={(event) => setReviewNote(event.target.value)}
          maxLength={2000}
          rows={2}
          className="mt-1"
          disabled={isPending}
        />
      </label>

      {message ? (
        <p className={`text-sm ${message.kind === "error" ? "text-rose-700" : "text-emerald-700"}`} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => submitResolution("LINKED")} disabled={isPending || !selectedSourceId}>
          <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Collega fonte
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => submitResolution("NO_MATCH")} disabled={isPending}>
          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Nessuna fonte esistente trovata
        </Button>
      </div>
    </div>
  );
}

function InteractiveCandidatesPanel({ items, procedimentoId, canVerify }: Required<LegalSourceCandidatesPanelProps>) {
  const [activeAdmissionId, setActiveAdmissionId] = useState<string | null>(null);

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
            <div key={item.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.originalName ?? "Documento caricato"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.mimeType} · Ammesso il {formatDateIT(item.admittedAt)}
                  </p>
                </div>
                {item.resolution ? (
                  <CandidateResolutionReceipt item={item} />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">Possibile fonte giuridica</Badge>
                    {item.reviewRequired ? <Badge variant="warning">Da verificare</Badge> : null}
                    {canVerify ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveAdmissionId(activeAdmissionId === item.id ? null : item.id)}
                      >
                        <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                        Verifica fonte
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
              {!item.resolution && activeAdmissionId === item.id ? (
                <CandidateVerification
                  item={item}
                  procedimentoId={procedimentoId}
                  onClose={() => setActiveAdmissionId(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function LegalSourceCandidatesPanel({
  items,
  procedimentoId = "",
  canVerify = false,
}: LegalSourceCandidatesPanelProps) {
  if (items.length === 0) {
    return null;
  }

  return <InteractiveCandidatesPanel items={items} procedimentoId={procedimentoId} canVerify={canVerify} />;
}