"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatEnumLabel } from "@/lib/utils";
import { uploadFascicoloDocumentRequirementEvidence } from "@/server/actions/fascicolo-document-requirement-upload";
import { DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

interface FascicoloDocumentRequirementUploadFormProps {
  proposalId: string;
}

export function FascicoloDocumentRequirementUploadForm({
  proposalId,
}: FascicoloDocumentRequirementUploadFormProps) {
  const router = useRouter();
  const operationIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function startNewFileAttempt() {
    if (!submittingRef.current) {
      operationIdRef.current = null;
      setSuccessMessage(null);
      setErrorMessage(null);
    }
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    const tipologia = String(formData.get("tipologia") ?? "");
    if (!(file instanceof File) || file.size === 0 || !DOCUMENT_TIPOLOGIA_VALUES.includes(
      tipologia as (typeof DOCUMENT_TIPOLOGIA_VALUES)[number],
    )) {
      setSuccessMessage(null);
      setErrorMessage("Selezionare un file e una tipologia validi.");
      operationIdRef.current = null;
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    const operationId = operationIdRef.current ?? crypto.randomUUID();
    operationIdRef.current = operationId;

    try {
      await uploadFascicoloDocumentRequirementEvidence({
        proposalId,
        operationId,
        file,
        tipologia: tipologia as (typeof DOCUMENT_TIPOLOGIA_VALUES)[number],
        nome: String(formData.get("nome") ?? "").trim() || undefined,
        descrizione: String(formData.get("descrizione") ?? "").trim() || undefined,
        dataDocumento: String(formData.get("dataDocumento") ?? "").trim() || undefined,
      });
      form.reset();
      operationIdRef.current = null;
      setSuccessMessage("Documento caricato e associato.");
      router.refresh();
    } catch {
      setErrorMessage("Caricamento non completato. Verificare i dati e riprovare.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <h5 className="text-sm font-medium text-slate-900">Carica e associa documento</h5>
      <form onSubmit={submitUpload} className="grid gap-2 md:grid-cols-2">
        <label className="text-xs text-slate-700 md:col-span-2">
          File
          <Input
            name="file"
            type="file"
            required
            disabled={isSubmitting}
            className="mt-1"
            onChange={startNewFileAttempt}
          />
        </label>
        <label className="text-xs text-slate-700">
          Tipologia
          <Select name="tipologia" required defaultValue="NOTA" disabled={isSubmitting} className="mt-1">
            {DOCUMENT_TIPOLOGIA_VALUES.map((value) => (
              <option key={value} value={value}>{formatEnumLabel(value)}</option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-slate-700">
          Nome documento (facoltativo)
          <Input name="nome" maxLength={180} disabled={isSubmitting} className="mt-1" />
        </label>
        <label className="text-xs text-slate-700 md:col-span-2">
          Descrizione (facoltativa)
          <Textarea name="descrizione" maxLength={1000} rows={2} disabled={isSubmitting} className="mt-1" />
        </label>
        <label className="text-xs text-slate-700">
          Data documento (facoltativa)
          <Input name="dataDocumento" type="date" disabled={isSubmitting} className="mt-1" />
        </label>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Caricamento..." : "Carica e associa documento"}
          </Button>
        </div>
      </form>
      {successMessage ? <p role="status" className="text-xs text-emerald-700">{successMessage}</p> : null}
      {errorMessage ? <p role="alert" className="text-xs text-rose-700">{errorMessage}</p> : null}
    </div>
  );
}