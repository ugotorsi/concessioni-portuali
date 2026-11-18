"use client";

import { type FormEvent, useState } from "react";
import { FilePlus2, Loader2 } from "lucide-react";

import {
  buildInitialVerificationCommand,
  type InitialSourceDraft,
  type ReviewerVerification,
} from "@/components/legal-research/reviewer-view-model";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

const emptySource: InitialSourceDraft = {
  evidenceSourceId: "",
  authorityId: "",
  legalSourceId: "",
  legalExpressionVersionId: "",
  officialIdentifier: "",
  sourceUrl: "",
  sourceFamily: "",
  courtOrBody: "",
  documentType: "",
  contentSha256: "",
  documentId: "",
  fileVersionId: "",
  termsOfUseBasis: "",
  verificationRationale: "",
};

function SourceFields({
  legend,
  source,
  onChange,
}: Readonly<{
  legend: string;
  source: InitialSourceDraft;
  onChange: (source: InitialSourceDraft) => void;
}>) {
  const field = (name: keyof InitialSourceDraft) => ({
    value: source[name] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      onChange({ ...source, [name]: event.target.value });
    },
  });
  return (
    <fieldset className="grid gap-4 border-t border-slate-200 pt-4">
      <legend className="pr-3 text-sm font-semibold text-slate-900">{legend}</legend>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">ID fonte probatoria<Input className="mt-1" {...field("evidenceSourceId")} required /></label>
        <label className="text-sm font-medium text-slate-700">ID autorità<Input className="mt-1" {...field("authorityId")} required /></label>
        <label className="text-sm font-medium text-slate-700">Identificatore ufficiale<Input className="mt-1" {...field("officialIdentifier")} required /></label>
        <label className="text-sm font-medium text-slate-700">ID fonte legale<Input className="mt-1" {...field("legalSourceId")} required /></label>
        <label className="text-sm font-medium text-slate-700">ID versione espressione<Input className="mt-1" {...field("legalExpressionVersionId")} required /></label>
        <label className="text-sm font-medium text-slate-700">URL ufficiale HTTPS<Input className="mt-1" type="url" pattern="https://.*" {...field("sourceUrl")} required /></label>
        <label className="text-sm font-medium text-slate-700">
          Famiglia della fonte
          <select className="mt-1 h-10 w-full border border-slate-300 bg-white px-3 text-sm" {...field("sourceFamily")} required>
            <option value="">Seleziona</option>
            <option value="ITALIAN_LEGISLATION">Legislazione italiana</option>
            <option value="EU_LEGISLATION">Legislazione UE</option>
            <option value="CASSAZIONE">Cassazione</option>
            <option value="CORTE_COSTITUZIONALE">Corte costituzionale</option>
            <option value="GIURISPRUDENZA_DI_MERITO">Giurisprudenza di merito</option>
            <option value="GIUSTIZIA_AMMINISTRATIVA">Giustizia amministrativa</option>
            <option value="CJEU">Corte di giustizia UE</option>
            <option value="CNF">Consiglio nazionale forense</option>
            <option value="ECHR">Corte europea dei diritti dell’uomo</option>
            <option value="OTHER">Altra fonte</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">Organo o autorità<Input className="mt-1" {...field("courtOrBody")} required /></label>
        <label className="text-sm font-medium text-slate-700">Tipo di documento<Input className="mt-1" {...field("documentType")} required /></label>
      </div>
      <label className="text-sm font-medium text-slate-700">SHA-256 del testo integrale<Input className="mt-1 font-mono" minLength={64} maxLength={64} pattern="[A-Fa-f0-9]{64}" {...field("contentSha256")} required /></label>
      <label className="text-sm font-medium text-slate-700">ID documento disponibile<Input className="mt-1" {...field("documentId")} /></label>
      <label className="text-sm font-medium text-slate-700">ID versione del file<Input className="mt-1" {...field("fileVersionId")} /></label>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Base dei diritti d’uso<Textarea className="mt-1" minLength={20} maxLength={8000} {...field("termsOfUseBasis")} required /></label>
        <label className="text-sm font-medium text-slate-700">Attestazione motivata del revisore<Textarea className="mt-1" minLength={20} maxLength={8000} {...field("verificationRationale")} required /></label>
      </div>
    </fieldset>
  );
}

export function InitialVerificationForm({
  missionId,
  recordId = null,
  onCreated,
}: Readonly<{
  missionId: string;
  recordId?: string | null;
  onCreated: (verification: ReviewerVerification) => void;
}>) {
  const [source, setSource] = useState<InitialSourceDraft>(emptySource);
  const [targetSource, setTargetSource] = useState<InitialSourceDraft>(emptySource);
  const [includeCitationRelation, setIncludeCitationRelation] = useState(false);
  const [citationParagraph, setCitationParagraph] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = buildInitialVerificationCommand({
    missionId,
    recordId,
    source,
    includeCitationRelation,
    targetSource,
    citationParagraph,
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!command) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/legal-research/assisted-verification", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(command),
      });
      const payload = await response.json() as { verification?: ReviewerVerification; error?: string };
      if (!response.ok || !payload.verification) {
        setError(payload.error === "ASSISTED_VERIFICATION_CONFLICT"
          ? "La missione dispone già di una verifica: ricaricala prima di continuare."
          : "La fonte o la relazione documentata non supera i controlli richiesti.");
        return;
      }
      onCreated(payload.verification);
    } catch {
      setError("Il registro delle verifiche assistite non è disponibile.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{recordId ? "Aggiunta o correzione documentale" : "Prima registrazione documentale"}</CardTitle>
        <CardDescription>Registra una fonte ufficiale; aggiungi la relazione solo quando è documentata da un locator verificabile.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <SourceFields legend="Fonte che documenta il testo" source={source} onChange={setSource} />
          <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={includeCitationRelation}
              onChange={(event) => setIncludeCitationRelation(event.target.checked)}
            />
            La fonte documenta una relazione citazionale tra due autorità
          </label>
          {includeCitationRelation ? (
            <>
              <SourceFields legend="Fonte ufficiale dell’autorità citata" source={targetSource} onChange={setTargetSource} />
              <label className="text-sm font-medium text-slate-700">
                Paragrafo che documenta la relazione
                <Input className="mt-1" value={citationParagraph} onChange={(event) => setCitationParagraph(event.target.value)} required />
              </label>
            </>
          ) : null}
          {error ? <p className="text-sm text-rose-800" role="alert">{error}</p> : null}
          <div className="flex justify-end">
            <Button className="gap-2" type="submit" disabled={pending || !command}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
              Registra nuova versione
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
