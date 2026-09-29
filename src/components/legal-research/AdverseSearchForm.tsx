"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import type { AdverseSearch } from "@/server/legal-research/adverse-search";
import type { ReviewerVerification } from "./reviewer-view-model";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

export function AdverseSearchForm({ verification, onSaved }: Readonly<{
  verification: ReviewerVerification;
  onSaved: (verification: ReviewerVerification) => void;
}>) {
  const [search, setSearch] = useState<AdverseSearch>(() => verification.snapshot.adverseSearch ?? {
    missionId: verification.snapshot.missionId, legalPropositionId: "",
    temporalScope: { from: "", through: "", referenceDate: "" }, jurisdictions: [],
    examinedDocuments: [], researchSteps: [], candidates: [], limitations: "", unresolvedGaps: [],
    sufficiencyRationale: "", outcome: "INCONCLUSIVE",
  });
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = verification.snapshot.sources.filter(source => source.fullText.documentId && source.fullText.fileVersionId
    && verification.result.verifiedFullTexts.some(verified => verified.evidenceSourceId === source.evidenceSourceId));
  const jurisdictions = [...new Set(verification.snapshot.sources.flatMap(source => source.sourceFamily ? [source.sourceFamily] : []))];
  const approval = verification.snapshot.adverseSearchReview;

  function update(patch: Partial<AdverseSearch>) {
    setSearch(current => ({ ...current, ...patch }));
    setDirty(true);
    setError(null);
  }

  async function send(action: "SAVE_ADVERSE_SEARCH" | "REVIEW_ADVERSE_SEARCH") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/legal-research/assisted-verification", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action, missionId: verification.snapshot.missionId, recordId: verification.recordId,
          ...(action === "SAVE_ADVERSE_SEARCH" ? { search } : {}) }),
      });
      const body = await response.json() as { verification?: ReviewerVerification; error?: string };
      if (!response.ok || !body.verification) {
        setError(body.error === "ASSISTED_VERIFICATION_CONFLICT" ? "La revisione e' cambiata. Ricaricare la missione."
          : body.error === "FORBIDDEN" || body.error === "AUTHORIZATION_REQUIRED" ? "Accesso non autorizzato."
            : "Ricerca non approvabile: verificare perimetro, documenti, attivita', candidati e lacune.");
        return;
      }
      setDirty(false);
      onSaved(body.verification);
    } catch {
      setError("Registro non disponibile. Esito del salvataggio non confermato: ricaricare prima di riprovare.");
    } finally {
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send("SAVE_ADVERSE_SEARCH");
  }

  return <section className="min-w-0 border-y border-slate-200 py-5" aria-labelledby="adverse-search-title">
    <h2 id="adverse-search-title" className="text-base font-semibold">Ricerca di autorita' contrarie</h2>
    {approval ? <dl className="mt-2 grid gap-1 break-words text-sm sm:grid-cols-2">
      <div><dt className="font-medium">Revisore registrato</dt><dd>{approval.reviewedByActorId}</dd></div>
      <div><dt className="font-medium">Data assegnata dal server</dt><dd>{approval.reviewedAt}</dd></div>
    </dl> : null}
    {error ? <p className="mt-3 text-sm text-rose-800" role="alert">{error}</p> : null}
    <form onSubmit={save} className="mt-4 grid min-w-0 gap-4">
      <fieldset disabled={pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Perimetro revisionato</legend>
        <label className="text-sm">Proposizione giuridica<Input required value={search.legalPropositionId} onChange={event => update({ legalPropositionId: event.target.value })} /></label>
        {([['from', 'Dal (UTC)'], ['through', 'Fino al (UTC)'], ['referenceDate', 'Data di riferimento della missione (UTC)']] as const).map(([field, label]) =>
          <label key={field} className="min-w-0 text-sm">{label}<Input required type="datetime-local" step="1" value={search.temporalScope[field].slice(0, 19)}
            onChange={event => update({ temporalScope: { ...search.temporalScope, [field]: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : "" } })} /></label>)}
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium">Ambiti giurisdizionali e normativi</p><div className="flex flex-wrap gap-4">
          {jurisdictions.map(jurisdiction => <label key={jurisdiction} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={search.jurisdictions.includes(jurisdiction)} onChange={event => update({ jurisdictions: event.target.checked ? [...search.jurisdictions, jurisdiction] : search.jurisdictions.filter(value => value !== jurisdiction) })} />{jurisdiction}
          </label>)}
        </div></div>
      </fieldset>
      <fieldset disabled={pending} className="grid min-w-0 gap-3">
        <legend className="mb-2 text-sm font-semibold">Documenti e versioni esaminati</legend>
        {sources.map(source => <label key={source.evidenceSourceId} className="flex min-w-0 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 shrink-0" checked={search.examinedDocuments.some(document => document.evidenceSourceId === source.evidenceSourceId && document.fileVersionId === source.fullText.fileVersionId && document.legalExpressionVersionId === source.legalExpressionVersionId && document.contentSha256 === source.fullText.contentSha256)} onChange={event => {
            if (event.target.checked) update({
              examinedDocuments: [...search.examinedDocuments.filter(document => document.evidenceSourceId !== source.evidenceSourceId), { evidenceSourceId: source.evidenceSourceId, documentId: source.fullText.documentId!, fileVersionId: source.fullText.fileVersionId!, contentSha256: source.fullText.contentSha256!, legalSourceId: source.legalSourceId, legalExpressionVersionId: source.legalExpressionVersionId }],
              candidates: [...search.candidates.filter(candidate => candidate.evidenceSourceId !== source.evidenceSourceId), { authorityId: source.authorityId, evidenceSourceId: source.evidenceSourceId, outcome: "INCONCLUSIVE", rationale: "" }],
              researchSteps: search.researchSteps.map(step => ({ ...step, evidence: step.evidence.filter(evidence => evidence.evidenceSourceId !== source.evidenceSourceId) })).filter(step => step.evidence.length),
            });
            else update({ examinedDocuments: search.examinedDocuments.filter(document => document.evidenceSourceId !== source.evidenceSourceId),
              candidates: search.candidates.filter(candidate => candidate.evidenceSourceId !== source.evidenceSourceId),
              researchSteps: search.researchSteps.map(step => ({ ...step, evidence: step.evidence.filter(evidence => evidence.evidenceSourceId !== source.evidenceSourceId) })).filter(step => step.evidence.length),
            });
          }} />
          <span className="min-w-0 break-all"><strong>{source.officialIdentifier}</strong><span className="block font-mono text-xs text-slate-600">{source.legalExpressionVersionId} / {source.fullText.fileVersionId}</span><span className="block font-mono text-xs text-slate-600">SHA256: {source.fullText.contentSha256}</span></span>
        </label>)}
      </fieldset>
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <legend className="mb-2 text-sm font-semibold">Attivita' e ricerche eseguite</legend>
        {search.researchSteps.map((step, index) => <div key={index} className="grid min-w-0 gap-3 border-b border-slate-200 pb-4 sm:grid-cols-2">
          <label className="text-sm">Metodo<Select value={step.method} onChange={event => update({ researchSteps: search.researchSteps.map((value, position) => position === index ? { ...value, method: event.target.value as typeof step.method } : value) })}>
            <option value="DOCUMENT_READING">Lettura documentale</option><option value="OFFICIAL_SEARCH">Ricerca su fonte ufficiale</option><option value="CITATION_FOLLOW_UP">Verifica dei rinvii citazionali</option>
          </Select></label>
          <label className="min-w-0 text-sm">Data dell'attivita' (UTC)<Input required type="datetime-local" step="1" value={step.performedAt.slice(0, 19)} onChange={event => update({ researchSteps: search.researchSteps.map((value, position) => position === index ? { ...value, performedAt: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : "" } : value) })} /></label>
          <label className="text-sm sm:col-span-2">Query o attivita' effettivamente svolta<Textarea required minLength={20} maxLength={8000} value={step.queryOrActivity} onChange={event => update({ researchSteps: search.researchSteps.map((value, position) => position === index ? { ...value, queryOrActivity: event.target.value } : value) })} /></label>
          {step.evidence.map((evidence, evidenceIndex) => <div key={evidenceIndex} className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-2">
            <label className="text-sm">Documento probatorio<Select required value={evidence.evidenceSourceId} onChange={event => update({ researchSteps: search.researchSteps.map((value, position) => position === index ? { ...value, evidence: value.evidence.map((reference, referenceIndex) => referenceIndex === evidenceIndex ? { ...reference, evidenceSourceId: event.target.value } : reference) } : value) })}>
              <option value="">Seleziona documento</option>{search.examinedDocuments.map(document => <option key={document.evidenceSourceId} value={document.evidenceSourceId}>{document.evidenceSourceId}</option>)}
            </Select></label>
            <label className="text-sm">Pagina, paragrafo o passaggio<Input required value={evidence.locator} onChange={event => update({ researchSteps: search.researchSteps.map((value, position) => position === index ? { ...value, evidence: value.evidence.map((reference, referenceIndex) => referenceIndex === evidenceIndex ? { ...reference, locator: event.target.value } : reference) } : value) })} /></label>
          </div>)}
          <Button type="button" title="Rimuovi attivita'" aria-label="Rimuovi attivita'" className="h-9 w-9" onClick={() => update({ researchSteps: search.researchSteps.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button type="button" className="justify-self-start gap-2" disabled={!search.examinedDocuments.length || search.researchSteps.length >= 100} onClick={() => update({ researchSteps: [...search.researchSteps, { method: "DOCUMENT_READING", performedAt: "", queryOrActivity: "", evidence: [{ evidenceSourceId: search.examinedDocuments[0].evidenceSourceId, locator: "" }] }] })}><Plus className="h-4 w-4" />Aggiungi attivita'</Button>
      </fieldset>
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <legend className="mb-2 text-sm font-semibold">Candidati valutati</legend>
        {search.candidates.map((candidate, index) => <div key={`${candidate.evidenceSourceId}-${index}`} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <p className="break-all text-sm font-medium sm:col-span-2">{candidate.authorityId} / {candidate.evidenceSourceId}</p>
          <label className="text-sm">Esito<Select value={candidate.outcome} onChange={event => update({ candidates: search.candidates.map((value, position) => position === index ? { ...value, outcome: event.target.value as typeof candidate.outcome } : value) })}>
            <option value="INCONCLUSIVE">Inconcludente</option><option value="NOT_ADVERSE">Non contrario alla proposizione</option><option value="EXCLUDED">Escluso con motivazione</option>
          </Select></label>
          <label className="text-sm">Motivazione della valutazione o esclusione<Textarea required minLength={20} maxLength={8000} value={candidate.rationale} onChange={event => update({ candidates: search.candidates.map((value, position) => position === index ? { ...value, rationale: event.target.value } : value) })} /></label>
        </div>)}
      </fieldset>
      <fieldset disabled={pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Conclusioni sul perimetro</legend>
        <label className="text-sm">Limiti della ricerca<Textarea required minLength={20} maxLength={8000} value={search.limitations} onChange={event => update({ limitations: event.target.value })} /></label>
        <label className="text-sm">Lacune ancora aperte<Textarea value={search.unresolvedGaps.join("\n")} onChange={event => update({ unresolvedGaps: event.target.value.split("\n") })} onBlur={() => update({ unresolvedGaps: search.unresolvedGaps.map(value => value.trim()).filter(Boolean) })} /></label>
        <label className="text-sm sm:col-span-2">Motivazione della sufficienza del perimetro<Textarea required minLength={20} maxLength={8000} value={search.sufficiencyRationale} onChange={event => update({ sufficiencyRationale: event.target.value })} /></label>
        <label className="text-sm sm:col-span-2">Esito della ricerca<Select value={search.outcome} onChange={event => update({ outcome: event.target.value as AdverseSearch["outcome"] })}>
          <option value="INCONCLUSIVE">Ricerca inconcludente</option><option value="NO_ADVERSE_FOUND_IN_REVIEWED_SCOPE">Nessuna autorita' contraria trovata nel perimetro esaminato</option>
        </Select></label>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || !search.examinedDocuments.length} className="gap-2"><Save className="h-4 w-4" />Salva resoconto</Button>
        <Button type="button" disabled={pending || dirty || !verification.snapshot.adverseSearch || verification.snapshot.adverseSearch.outcome === "INCONCLUSIVE" || Boolean(verification.result.adverseSearchCompleted)} className="gap-2" onClick={() => void send("REVIEW_ADVERSE_SEARCH")}><CheckCircle2 className="h-4 w-4" />Approva ricerca nel perimetro</Button>
      </div>
    </form>
  </section>;
}