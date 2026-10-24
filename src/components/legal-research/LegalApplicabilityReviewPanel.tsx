"use client";

import { useEffect, useState } from "react";

import type { ReviewerVerification } from "@/components/legal-research/reviewer-view-model";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import type { LegalApplicabilityReview } from "@/server/legal-research/assisted-verification";

export function LegalApplicabilityReviewPanel({
  verification,
  onUpdated,
}: Readonly<{
  verification: ReviewerVerification;
  onUpdated: (verification: ReviewerVerification) => void;
}>) {
  const proposals = (verification.snapshot.legalApplicabilityReviews ?? []).filter(
    (review) => review.reviewStatus === "AI_PROPOSED",
  );
  const [selectedId, setSelectedId] = useState(proposals[0]?.reviewId ?? "");
  const selected = proposals.find((review) => review.reviewId === selectedId) ?? null;
  const [draft, setDraft] = useState(selected ? JSON.stringify(selected, null, 2) : "");
  const [rationale, setRationale] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selected ? JSON.stringify(selected, null, 2) : "");
    setRationale("");
    setError(null);
  }, [selected]);

  if (proposals.length === 0) return null;

  async function confirm(): Promise<void> {
    if (!selected || rationale.trim().length < 20) return;
    let review: LegalApplicabilityReview;
    try {
      review = JSON.parse(draft) as LegalApplicabilityReview;
    } catch {
      setError("La correzione non contiene un JSON valido.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/legal-research/assisted-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "CONFIRM_LEGAL_APPLICABILITY",
          missionId: verification.snapshot.missionId,
          recordId: verification.recordId,
          review,
          correctionRationale: rationale,
        }),
      });
      const payload = await response.json() as {
        verification?: ReviewerVerification;
        error?: string;
      };
      if (!response.ok || !payload.verification) {
        setError(payload.error === "ASSISTED_VERIFICATION_CONFLICT"
          ? "La proposta e cambiata: ricaricare prima di confermare."
          : "La proposta corretta non supera i controlli di integrita.");
        return;
      }
      onUpdated(payload.verification);
    } catch {
      setError("La verifica professionale non e disponibile.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Applicabilita giuridica preliminare</CardTitle>
        <CardDescription>
          Le proposte AI non sono conclusioni professionali. Verificare fatti, date, fonte, citazioni,
          disciplina transitoria e risultato dell&apos;orchestratore prima della conferma.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="text-sm font-medium text-slate-700">
          Proposta
          <select
            className="mt-1 h-10 w-full border border-slate-300 bg-white px-3 text-sm"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {proposals.map((review) => (
              <option key={review.reviewId} value={review.reviewId}>
                {review.candidateProvisionReference} - {review.reviewStatus}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <div className="grid gap-2 text-sm text-slate-700">
            <p><strong>Fonte/versione:</strong> {selected.candidateEvidenceSourceId} / {selected.candidateSourceVersionId}</p>
            <p><strong>Fatti decisivi:</strong> {selected.factualApplicability.decisiveKnowledgeItemIds.join(", ")}</p>
            <p><strong>Disciplina transitoria:</strong> {selected.transitionalDiscipline.status}</p>
          </div>
        ) : null}
        <label className="text-sm font-medium text-slate-700">
          Proposta completa e correzioni
          <Textarea className="mt-1 min-h-80 font-mono text-xs" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Motivazione professionale della correzione o conferma
          <Textarea className="mt-1" minLength={20} value={rationale} onChange={(event) => setRationale(event.target.value)} />
        </label>
        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        <Button type="button" disabled={pending || !selected || rationale.trim().length < 20} onClick={() => void confirm()}>
          {pending ? "Registrazione..." : "Conferma valutazione professionale"}
        </Button>
      </CardContent>
    </Card>
  );
}
