"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Lightbulb, Loader2, Save, Search, XCircle } from "lucide-react";

import {
  canSubmitLegalReview,
  reviewerRequirements,
  type ReviewerVerification,
} from "@/components/legal-research/reviewer-view-model";
import { InitialVerificationForm } from "@/components/legal-research/InitialVerificationForm";
import { AdverseSearchForm } from "@/components/legal-research/AdverseSearchForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";

type ReviewDecision = "ADVERSE" | "NOT_ADVERSE" | "INCONCLUSIVE";
type SuggestionKind = ReviewerVerification["result"]["legalResearchSuggestions"][number]["kind"];
type ResultDirection = "SUPPORTS" | "OPPOSES" | "NEUTRAL";
type QuestionResultReviewItem = Readonly<{
  resultId: string;
  missionId: string;
  title: string;
  sourceUrl: string | null;
  supportDirection: ResultDirection | "INCONCLUSIVE" | "UNASSESSED";
  classificationReviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
  classificationRationale: string | null;
  sourceUsable: boolean;
}>;

function locatorLabel(locator: NonNullable<ReviewerVerification["snapshot"]["citationRelation"]>["locator"]): string {
  if (!locator) return "Nessun localizzatore";
  if (locator.page) return `Pagina ${locator.page}`;
  if (locator.section) return `Sezione ${locator.section}`;
  if (locator.paragraph) return `Paragrafo ${locator.paragraph}`;
  if (locator.span) return `Intervallo ${locator.span.start}-${locator.span.end}`;
  return "Nessun localizzatore";
}

function apiErrorMessage(code: string | undefined): string {
  if (code === "ASSISTED_VERIFICATION_CONFLICT") return "La verifica e' cambiata. Ricarica ed esamina la versione corrente prima di salvare.";
  if (code === "NOT_FOUND") return "Nessuna verifica assistita registrata per questa missione.";
  if (code === "VERIFICATION_EVIDENCE_INCOMPLETE") {
    return "La relazione citazionale o la fonte documentale non è sufficiente per registrare la revisione.";
  }
  if (code === "FORBIDDEN") return "Il profilo corrente non può accedere a questa missione.";
  if (code === "INVALID_REQUEST") return "I dati della revisione non sono validi.";
  if (code === "QUESTION_RESULT_REVIEW_UNAVAILABLE") return "La classificazione delle fonti non è disponibile.";
  return "Il registro delle verifiche assistite non è disponibile.";
}

export function LegalReviewerClient({ initialMissionId = "" }: Readonly<{ initialMissionId?: string }>) {
  const [missionId, setMissionId] = useState(initialMissionId);
  const [verification, setVerification] = useState<ReviewerVerification | null>(null);
  const [legalPropositionId, setLegalPropositionId] = useState("");
  const [evidenceSourceId, setEvidenceSourceId] = useState("");
  const [rationale, setRationale] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("INCONCLUSIVE");
  const [suggestionKind, setSuggestionKind] = useState<SuggestionKind>("MISSING_LEGAL_PROPOSITION");
  const [suggestionGapId, setSuggestionGapId] = useState("");
  const [suggestionEvidenceSourceId, setSuggestionEvidenceSourceId] = useState("");
  const [suggestionDescription, setSuggestionDescription] = useState("");
  const [suggestionRationale, setSuggestionRationale] = useState("");
  const [resolutionGapId, setResolutionGapId] = useState("");
  const [resolutionEvidenceId, setResolutionEvidenceId] = useState("");
  const [resolutionTargetId, setResolutionTargetId] = useState("");
  const [questionResults, setQuestionResults] = useState<readonly QuestionResultReviewItem[]>([]);
  const [resultId, setResultId] = useState("");
  const [resultDirection, setResultDirection] = useState<ResultDirection | "">("");
  const [resultRationale, setResultRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function loadQuestionResults(requestedMissionId: string): Promise<void> {
    const response = await fetch(
      `/api/legal-research/question-results/review?missionId=${encodeURIComponent(requestedMissionId)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    const payload = await response.json() as { results?: readonly QuestionResultReviewItem[]; error?: string };
    if (!response.ok || !payload.results) throw new Error(payload.error ?? "QUESTION_RESULT_REVIEW_UNAVAILABLE");
    setQuestionResults(payload.results);
    setResultId((current) => payload.results!.some((result) => result.resultId === current) ? current : "");
  }

  async function loadVerification(requestedMissionId = missionId): Promise<void> {
    const normalizedMissionId = requestedMissionId.trim();
    if (!normalizedMissionId) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/legal-research/assisted-verification?missionId=${encodeURIComponent(normalizedMissionId)}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );
      const payload = await response.json() as { verification?: ReviewerVerification; error?: string };
      if (!response.ok || !payload.verification) {
        setVerification(null);
        setError(apiErrorMessage(payload.error));
        return;
      }
      setVerification(payload.verification);
      setMissionId(normalizedMissionId);
      await loadQuestionResults(normalizedMissionId);
      setEvidenceSourceId(payload.verification.snapshot.citationRelation?.evidenceSourceId ?? "");
      setLegalPropositionId(payload.verification.snapshot.adverseReview?.legalPropositionId ?? "");
      setRationale(payload.verification.snapshot.adverseReview?.rationale ?? "");
      setDecision(payload.verification.snapshot.adverseReview?.decision ?? "INCONCLUSIVE");
    } catch {
      setVerification(null);
      setQuestionResults([]);
      setError(apiErrorMessage(undefined));
    } finally {
      setPending(false);
    }
  }

  async function submitResultReview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!verification || !resultId || !resultDirection || resultRationale.trim().length < 20) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/legal-research/question-results/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          missionId: verification.snapshot.missionId,
          resultId,
          direction: resultDirection,
          rationale: resultRationale,
        }),
      });
      const payload = await response.json() as { result?: QuestionResultReviewItem; error?: string };
      if (!response.ok || !payload.result) {
        setError(apiErrorMessage(payload.error));
        return;
      }
      setQuestionResults((current) => current.map((result) => (
        result.resultId === payload.result!.resultId ? payload.result! : result
      )));
      setResultRationale("");
      setNotice("Classificazione e revisione umana registrate.");
    } catch {
      setError(apiErrorMessage("QUESTION_RESULT_REVIEW_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (initialMissionId) void loadVerification(initialMissionId);
    // The initial route identifier is intentionally loaded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMissionId]);

  async function submitReview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!verification || !canSubmitLegalReview(verification, {
      legalPropositionId,
      evidenceSourceId,
      rationale,
    })) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/legal-research/assisted-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          missionId: verification.snapshot.missionId,
          recordId: verification.recordId,
          legalPropositionId,
          evidenceSourceId,
          rationale,
          decision,
        }),
      });
      const payload = await response.json() as {
        outcome?: "CREATED" | "REUSED";
        verification?: ReviewerVerification;
        error?: string;
      };
      if (!response.ok || !payload.verification) {
        setError(apiErrorMessage(payload.error));
        return;
      }
      setVerification(payload.verification);
      setNotice(payload.outcome === "REUSED"
        ? "Revisione già presente nel registro immutabile."
        : "Revisione registrata nel registro immutabile.");
    } catch {
      setError(apiErrorMessage(undefined));
    } finally {
      setPending(false);
    }
  }

  async function submitSuggestion(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!verification || !suggestionGapId || !suggestionEvidenceSourceId
      || !suggestionDescription.trim() || !suggestionRationale.trim()) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/legal-research/assisted-verification", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          missionId: verification.snapshot.missionId,
          recordId: verification.recordId,
          kind: suggestionKind,
          description: suggestionDescription,
          rationale: suggestionRationale,
          originatingGapId: suggestionGapId,
          evidenceSourceId: suggestionEvidenceSourceId,
        }),
      });
      const payload = await response.json() as { verification?: ReviewerVerification; error?: string };
      if (!response.ok || !payload.verification) {
        setError(apiErrorMessage(payload.error));
        return;
      }
      setVerification(payload.verification);
      setSuggestionDescription("");
      setSuggestionRationale("");
      setNotice("Suggerimento motivato registrato nel registro immutabile.");
    } catch {
      setError(apiErrorMessage(undefined));
    } finally {
      setPending(false);
    }
  }

  async function submitGapResolution(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!verification || !resolutionGapId || !resolutionEvidenceId || !resolutionTargetId.trim()) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/legal-research/assisted-verification", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          missionId: verification.snapshot.missionId,
          recordId: verification.recordId,
          sources: [],
          gapResolutions: [{ gapId: resolutionGapId, evidenceSourceId: resolutionEvidenceId, targetId: resolutionTargetId.trim() }],
        }),
      });
      const payload = await response.json() as { verification?: ReviewerVerification; error?: string };
      if (!response.ok || !payload.verification) {
        setError(apiErrorMessage(payload.error));
        return;
      }
      setVerification(payload.verification);
      setResolutionGapId("");
      setResolutionEvidenceId("");
      setResolutionTargetId("");
      setNotice("Risoluzione documentale registrata.");
    } catch {
      setError(apiErrorMessage(undefined));
    } finally {
      setPending(false);
    }
  }

  const requirements = verification ? reviewerRequirements(verification) : [];
  const canSubmit = verification ? canSubmitLegalReview(verification, {
    legalPropositionId,
    evidenceSourceId,
    rationale,
  }) : false;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Missione di ricerca</CardTitle>
          <CardDescription>Carica il record tenant-scoped dal registro delle verifiche assistite.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => {
            event.preventDefault();
            void loadVerification();
          }}>
            <label className="flex-1 text-sm font-medium text-slate-700">
              Identificativo missione
              <Input
                className="mt-1 font-mono"
                value={missionId}
                onChange={(event) => {
                  setMissionId(event.target.value);
                  setVerification(null);
                  setQuestionResults([]);
                }}
                placeholder="research-mission:..."
                maxLength={96}
                required
              />
            </label>
            <Button className="gap-2 self-end" type="submit" disabled={pending || !missionId.trim()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Carica
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      {missionId.trim() ? (
        <InitialVerificationForm
          key={verification?.recordId ?? missionId}
          missionId={missionId}
          recordId={verification?.recordId ?? null}
          onCreated={(created) => {
            setVerification(created);
            setMissionId(created.snapshot.missionId);
            setEvidenceSourceId(created.snapshot.citationRelation?.evidenceSourceId ?? "");
            setError(null);
            setNotice("Nuova versione registrata nel registro immutabile.");
            void loadQuestionResults(created.snapshot.missionId).catch(() => {
              setError(apiErrorMessage("QUESTION_RESULT_REVIEW_UNAVAILABLE"));
            });
          }}
        />
      ) : null}

      {verification ? (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Stato dei requisiti</CardTitle>
                <CardDescription className="break-all">{verification.snapshot.missionId}</CardDescription>
              </div>
              <Badge variant={verification.preClaimStatus.satisfied ? "success" : "danger"}>
                {verification.preClaimStatus.satisfied ? "Gate soddisfatto" : "Gate non soddisfatto"}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 md:grid-cols-2 xl:grid-cols-3">
              {requirements.map((requirement) => (
                <div key={requirement.id} className="flex min-h-24 gap-3 bg-white p-4">
                  {requirement.satisfied
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{requirement.label}</p>
                    <p className="mt-1 text-xs text-slate-600">{requirement.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {!verification.preClaimStatus.satisfied ? (
            <section className="rounded-md border border-amber-300 bg-amber-50 px-4 py-4" aria-labelledby="unmet-title">
              <h2 id="unmet-title" className="text-sm font-semibold text-amber-950">Requisiti ancora non soddisfatti</h2>
              <ul className="mt-2 grid gap-1 text-sm text-amber-900 sm:grid-cols-2">
                {verification.preClaimStatus.unmetRequirements.map((requirement) => (
                  <li key={requirement} className="font-mono text-xs">{requirement}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <AdverseSearchForm key={verification.recordId} verification={verification} onSaved={setVerification} />

          {verification.result.evidenceGaps.length > 0 ? (
            <section aria-labelledby="resolve-gap-title" className="border-y border-slate-200 py-4">
              <h2 id="resolve-gap-title" className="text-sm font-semibold">Risoluzione documentale del gap</h2>
              <form onSubmit={(event) => { void submitGapResolution(event); }} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Gap
                  <Select value={resolutionGapId} required onChange={(event) => {
                    setResolutionGapId(event.target.value);
                    setResolutionTargetId(verification.result.evidenceGaps.find((gap) => gap.gapId === event.target.value)?.targetId ?? "");
                  }}>
                    <option value="">Seleziona gap</option>
                    {verification.result.evidenceGaps.map((gap) => <option key={gap.gapId} value={gap.gapId}>{gap.gapId} - {gap.kind}</option>)}
                  </Select>
                </label>
                <label className="text-sm">Prova documentale
                  <Select value={resolutionEvidenceId} required onChange={(event) => setResolutionEvidenceId(event.target.value)}>
                    <option value="">Seleziona fonte verificata</option>
                    {verification.result.verifiedFullTexts.map((source) => <option key={source.evidenceSourceId} value={source.evidenceSourceId}>{source.officialIdentifier}</option>)}
                  </Select>
                </label>
                <label className="text-sm">Identificativo oggetto
                  <Input value={resolutionTargetId} required onChange={(event) => setResolutionTargetId(event.target.value)} />
                </label>
                <Button type="submit" className="gap-2 self-end" disabled={pending || !resolutionGapId || !resolutionEvidenceId || !resolutionTargetId.trim()}>
                  <Save className="h-4 w-4" />Registra risoluzione
                </Button>
              </form>
            </section>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Fonti e identificatori ufficiali</CardTitle>
              <CardDescription>Provenienza, identità, diritti di consultazione e impronta del testo.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Autorità</TableHead>
                    <TableHead>Identificatore ufficiale</TableHead>
                    <TableHead>Versione fonte</TableHead>
                    <TableHead>Verifica</TableHead>
                    <TableHead>Fonte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {verification.snapshot.sources.map((source) => (
                    <TableRow key={source.evidenceSourceId}>
                      <TableCell className="font-mono text-xs">{source.authorityId}</TableCell>
                      <TableCell className="font-medium text-slate-900">{source.officialIdentifier}</TableCell>
                      <TableCell className="text-xs">
                        <span className="block">{source.legalSourceId}</span>
                        <span className="block text-slate-500">{source.legalExpressionVersionId}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={source.identityVerificationStatus === "VERIFIED" ? "success" : "warning"}>
                            {source.identityVerificationStatus}
                          </Badge>
                          <Badge variant={source.termsOfUse.status === "PERMITTED" ? "success" : "warning"}>
                            {source.termsOfUse.status}
                          </Badge>
                        </div>
                        <p className="mt-2 max-w-72 break-all font-mono text-[11px] text-slate-500">
                          {source.fullText.contentSha256 ?? "SHA-256 non disponibile"}
                        </p>
                        <p className="mt-1 max-w-72 text-xs text-slate-600">
                          {source.reviewerAttestation.rationale}
                        </p>
                      </TableCell>
                      <TableCell>
                        <a className="inline-flex items-center gap-1 text-sm font-medium text-slate-900 underline underline-offset-4" href={source.sourceUrl} target="_blank" rel="noreferrer">
                          Apri <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                  {verification.snapshot.sources.length === 0 ? (
                    <TableRow><TableCell colSpan={5}>Nessuna fonte documentale registrata.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Classificazione della fonte</CardTitle>
              <CardDescription>
                La revisione qualifica il contributo della fonte al quesito. Non modifica i gate documentali,
                temporali o di usabilità della SourceChain.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Risultato</TableHead>
                    <TableHead>Direzione</TableHead>
                    <TableHead>Revisione</TableHead>
                    <TableHead>SourceChain</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {questionResults.map((result) => (
                    <TableRow key={result.resultId}>
                      <TableCell>
                        <span className="block font-medium text-slate-900">{result.title}</span>
                        <span className="block break-all font-mono text-[11px] text-slate-500">{result.resultId}</span>
                        {result.sourceUrl ? (
                          <a className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-4" href={result.sourceUrl} target="_blank" rel="noreferrer">
                            Apri fonte <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </TableCell>
                      <TableCell><Badge>{result.supportDirection}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={result.classificationReviewStatus === "HUMAN_CONFIRMED" ? "success" : "warning"}>
                          {result.classificationReviewStatus}
                        </Badge>
                        {result.classificationRationale ? <p className="mt-2 max-w-96 text-xs text-slate-600">{result.classificationRationale}</p> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={result.sourceUsable ? "success" : "warning"}>
                          {result.sourceUsable ? "USABLE" : "NON USABLE"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {questionResults.length === 0 ? (
                    <TableRow><TableCell colSpan={4}>Nessun risultato di ricerca associato alla missione.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>

              <form className="grid gap-3 rounded-md border border-slate-200 p-4 md:grid-cols-2" onSubmit={(event) => { void submitResultReview(event); }}>
                <label className="text-sm font-medium text-slate-700">
                  Risultato
                  <Select className="mt-1" value={resultId} required onChange={(event) => setResultId(event.target.value)}>
                    <option value="">Seleziona risultato</option>
                    {questionResults.map((result) => <option key={result.resultId} value={result.resultId}>{result.title}</option>)}
                  </Select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Qualificazione
                  <Select className="mt-1" value={resultDirection} required onChange={(event) => setResultDirection(event.target.value as ResultDirection | "")}>
                    <option value="">Seleziona qualificazione</option>
                    <option value="SUPPORTS">SUPPORTS</option>
                    <option value="OPPOSES">OPPOSES</option>
                    <option value="NEUTRAL">NEUTRAL</option>
                  </Select>
                </label>
                <label className="text-sm font-medium text-slate-700 md:col-span-2">
                  Motivazione
                  <Textarea
                    className="mt-1"
                    value={resultRationale}
                    onChange={(event) => setResultRationale(event.target.value)}
                    minLength={20}
                    maxLength={2000}
                    required
                  />
                </label>
                <div className="flex justify-end md:col-span-2">
                  <Button type="submit" className="gap-2" disabled={pending || !resultId || !resultDirection || resultRationale.trim().length < 20}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Registra classificazione
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Relazione citazionale</CardTitle>
                <CardDescription>Osservazione documentale; non equivale a valutazione giuridica.</CardDescription>
              </CardHeader>
              <CardContent>
                {verification.snapshot.citationRelation ? (
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs uppercase text-slate-500">Autorità sorgente</dt><dd className="mt-1 break-all font-mono text-xs">{verification.snapshot.citationRelation.sourceAuthorityId}</dd></div>
                    <div><dt className="text-xs uppercase text-slate-500">Autorità citata</dt><dd className="mt-1 break-all font-mono text-xs">{verification.snapshot.citationRelation.targetAuthorityId}</dd></div>
                    <div><dt className="text-xs uppercase text-slate-500">Fonte probatoria</dt><dd className="mt-1 break-all font-mono text-xs">{verification.snapshot.citationRelation.evidenceSourceId}</dd></div>
                    <div><dt className="text-xs uppercase text-slate-500">Localizzatore</dt><dd className="mt-1">{locatorLabel(verification.snapshot.citationRelation.locator)}</dd></div>
                  </dl>
                ) : <p className="text-sm text-amber-800">Relazione citazionale non documentata.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Gap e azioni di ricerca</CardTitle>
                <CardDescription>Le azioni proposte non costituiscono conclusioni legali.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Gap residui</p>
                  <ul className="mt-2 grid gap-2">
                    {verification.result.evidenceGaps.map((gap) => (
                      <li key={gap.gapId} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        <span className="font-medium">{gap.kind}</span>{gap.targetId ? ` · ${gap.targetId}` : ""}
                      </li>
                    ))}
                    {verification.result.evidenceGaps.length === 0 ? <li className="text-sm text-slate-600">Nessun gap registrato.</li> : null}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Azioni suggerite</p>
                  <ul className="mt-2 grid gap-2">
                    {verification.result.legalResearchSuggestions.map((suggestion) => (
                      <li key={suggestion.suggestionId} className="border-l-2 border-slate-300 pl-3 text-sm text-slate-700">
                        <span className="block font-medium text-slate-900">{suggestion.kind}</span>
                        <span className="block">{suggestion.description}</span>
                        <span className="mt-1 block text-xs text-slate-500">{suggestion.rationale}</span>
                        <span className="mt-1 block font-mono text-[11px] text-slate-500">{suggestion.reviewedByActorId} · {suggestion.reviewedAt}</span>
                      </li>
                    ))}
                    {verification.result.legalResearchSuggestions.length === 0 ? <li className="text-sm text-slate-600">Nessuna azione documentata.</li> : null}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Registra azione di ricerca</CardTitle>
              <CardDescription>Il suggerimento deve essere motivato dal revisore e collegato a un gap e a una fonte già verificata.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={(event) => void submitSuggestion(event)}>
                <div className="grid gap-4 lg:grid-cols-3">
                  <label className="text-sm font-medium text-slate-700">
                    Tipo
                    <Select className="mt-1" value={suggestionKind} onChange={(event) => setSuggestionKind(event.target.value as SuggestionKind)}>
                      <option value="MISSING_LEGAL_PROPOSITION">Proposizione giuridica mancante</option>
                      <option value="MISSING_FACTUAL_EVIDENCE">Prova fattuale mancante</option>
                      <option value="MISSING_ADMINISTRATIVE_DOCUMENT">Documento amministrativo mancante</option>
                      <option value="MISSING_SOURCE_FAMILY">Famiglia di fonti mancante</option>
                      <option value="ALTERNATIVE_LEGAL_QUALIFICATION">Qualificazione alternativa</option>
                      <option value="POSSIBLE_COUNTERARGUMENT">Possibile controargomentazione</option>
                      <option value="HUMAN_LEGAL_JUDGMENT_QUESTION">Questione per valutazione umana</option>
                    </Select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Gap originario
                    <Select className="mt-1" value={suggestionGapId} onChange={(event) => setSuggestionGapId(event.target.value)} required>
                      <option value="">Seleziona un gap</option>
                      {verification.result.evidenceGaps.map((gap) => (
                        <option key={gap.gapId} value={gap.gapId}>{gap.kind}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Fonte verificata
                    <Select className="mt-1" value={suggestionEvidenceSourceId} onChange={(event) => setSuggestionEvidenceSourceId(event.target.value)} required>
                      <option value="">Seleziona una fonte</option>
                      {verification.result.verifiedFullTexts.map((source) => (
                        <option key={source.evidenceSourceId} value={source.evidenceSourceId}>{source.officialIdentifier}</option>
                      ))}
                    </Select>
                  </label>
                </div>
                <label className="text-sm font-medium text-slate-700">Azione proposta<Textarea className="mt-1" value={suggestionDescription} onChange={(event) => setSuggestionDescription(event.target.value)} maxLength={8000} required /></label>
                <label className="text-sm font-medium text-slate-700">Motivazione<Textarea className="mt-1" value={suggestionRationale} onChange={(event) => setSuggestionRationale(event.target.value)} maxLength={8000} required /></label>
                <div className="flex justify-end">
                  <Button className="gap-2" type="submit" disabled={pending || !suggestionGapId || !suggestionEvidenceSourceId || !suggestionDescription.trim() || !suggestionRationale.trim()}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                    Registra suggerimento
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Valutazioni giuridiche</CardTitle>
              <CardDescription>Le valutazioni avverse confermate richiedono attribuzione, fonte e motivazione umana.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Proposizione</TableHead><TableHead>Trattamento</TableHead><TableHead>Stato</TableHead><TableHead>Motivazione</TableHead></TableRow></TableHeader>
                <TableBody>
                  {verification.result.adverseAssessments.map((assessment) => (
                    <TableRow key={assessment.id}>
                      <TableCell className="font-mono text-xs">{assessment.scope?.id ?? "-"}</TableCell>
                      <TableCell><Badge variant="danger">{assessment.treatment}</Badge></TableCell>
                      <TableCell>{assessment.reviewState}</TableCell>
                      <TableCell className="max-w-xl">{assessment.rationale ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                  {verification.result.adverseAssessments.length === 0 ? (
                    <TableRow><TableCell colSpan={4}>Nessuna valutazione avversa confermata. La verifica resta richiesta.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registra revisione giuridica</CardTitle>
              <CardDescription>Il revisore e il tenant sono derivati dalla sessione autenticata e non sono modificabili.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={(event) => void submitReview(event)}>
                <div className="grid gap-4 lg:grid-cols-3">
                  <label className="text-sm font-medium text-slate-700">
                    Proposizione giuridica
                    <Input className="mt-1" value={legalPropositionId} onChange={(event) => setLegalPropositionId(event.target.value)} required />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Decisione
                    <Select className="mt-1" value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}>
                      <option value="INCONCLUSIVE">Inconclusiva</option>
                      <option value="NOT_ADVERSE">Non avversa</option>
                      <option value="ADVERSE">Avversa</option>
                    </Select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Fonte probatoria
                    <Select className="mt-1" value={evidenceSourceId} onChange={(event) => setEvidenceSourceId(event.target.value)} required>
                      <option value="">Seleziona la fonte documentata</option>
                      {verification.snapshot.sources.map((source) => (
                        <option key={source.evidenceSourceId} value={source.evidenceSourceId}>{source.officialIdentifier}</option>
                      ))}
                    </Select>
                  </label>
                </div>
                <label className="text-sm font-medium text-slate-700">
                  Motivazione
                  <Textarea className="mt-1" value={rationale} onChange={(event) => setRationale(event.target.value)} maxLength={8000} required />
                </label>
                {!canSubmit ? (
                  <p className="text-sm text-amber-800">Per salvare servono proposizione, motivazione e una relazione documentata con fonte e localizzatore coerenti.</p>
                ) : null}
                <div className="flex justify-end">
                  <Button className="gap-2" type="submit" disabled={pending || !canSubmit}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salva revisione
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}