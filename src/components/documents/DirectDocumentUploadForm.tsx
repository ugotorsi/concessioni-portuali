"use client";

import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { createDocumentoUploadAction } from "@/server/actions/documenti";
import { uploadFascicoloDocumentRequirementEvidence } from "@/server/actions/fascicolo-document-requirement-upload";
import { DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

const DIRECT_UPLOAD_THRESHOLD_BYTES = 512 * 1024;

interface DirectDocumentUploadFormProps {
  children: ReactNode;
  className: string;
  submitLabel: string;
  purpose?: "DOCUMENT" | "REQUIREMENT_EVIDENCE";
}

interface InitiatedUpload {
  objectKey: string;
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
}

type UploadTransferOutcome = "CONFIRMED" | "RESPONSE_UNAVAILABLE";

function metadataFrom(formData: FormData): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key !== "file" && typeof value === "string") metadata[key] = value;
  }
  return metadata;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Richiesta di upload non riuscita.");
  return payload;
}

function putWithProgress(input: {
  file: File;
  upload: InitiatedUpload;
  onProgress: (percent: number) => void;
}): Promise<UploadTransferOutcome> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", input.upload.uploadUrl);
    for (const [name, value] of Object.entries(input.upload.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => resolve("RESPONSE_UNAVAILABLE");
    request.onabort = () => reject(new Error("Caricamento interrotto. È possibile riprovare."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve("CONFIRMED");
        return;
      }
      if (request.status === 412) {
        resolve("RESPONSE_UNAVAILABLE");
        return;
      }
      const errorCode = request.responseText.match(/<Code>([^<]+)<\/Code>/)?.[1];
      const detail = errorCode ? `, ${errorCode}` : "";
      reject(new Error(`R2 ha rifiutato il caricamento (HTTP ${request.status}${detail}).`));
    };
    request.send(input.file);
  });
}

export function DirectDocumentUploadForm({
  children,
  className,
  submitLabel,
  purpose = "DOCUMENT",
}: DirectDocumentUploadFormProps) {
  const router = useRouter();
  const operationIdRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Selezionare un file non vuoto.");
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const operationId = operationIdRef.current ?? crypto.randomUUID();
      operationIdRef.current = operationId;
      if (file.size <= DIRECT_UPLOAD_THRESHOLD_BYTES) {
        if (purpose === "DOCUMENT") {
          await createDocumentoUploadAction(formData);
        } else {
          const tipologia = String(formData.get("tipologia") ?? "");
          if (!DOCUMENT_TIPOLOGIA_VALUES.includes(tipologia as (typeof DOCUMENT_TIPOLOGIA_VALUES)[number])) {
            throw new Error("Tipologia documento non valida.");
          }
          await uploadFascicoloDocumentRequirementEvidence({
            proposalId: String(formData.get("proposalId") ?? ""),
            operationId,
            file,
            tipologia: tipologia as (typeof DOCUMENT_TIPOLOGIA_VALUES)[number],
            nome: String(formData.get("nome") ?? "").trim() || undefined,
            descrizione: String(formData.get("descrizione") ?? "").trim() || undefined,
            dataDocumento: String(formData.get("dataDocumento") ?? "").trim() || undefined,
          });
          form.reset();
          router.refresh();
        }
        return;
      }
      const request = {
        purpose,
        operationId,
        file: { name: file.name, size: file.size, type: file.type },
        metadata: metadataFrom(formData),
      };
      setProgress(0);
      setMessage("Preparazione del caricamento sicuro...");
      const initiated = await jsonResponse<InitiatedUpload>(await fetch("/api/document-uploads/direct/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
      }));
      setMessage("Trasferimento diretto allo storage...");
      const transferOutcome = await putWithProgress({ file, upload: initiated, onProgress: setProgress });
      setMessage(transferOutcome === "CONFIRMED"
        ? "Verifica integrità e registrazione..."
        : "Risposta storage non disponibile: verifica sicura dell'oggetto...");
      const completed = await jsonResponse<{ procedimentoId: string | null }>(await fetch(
        "/api/document-uploads/direct/complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...request, objectKey: initiated.objectKey }),
        },
      ));
      operationIdRef.current = null;
      form.reset();
      setProgress(100);
      setMessage("Documento caricato, verificato e registrato.");
      if (completed.procedimentoId) router.push(`/procedimenti/${completed.procedimentoId}`);
      else router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Caricamento non completato. Riprovare.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onChange={(event) => {
        if (!pending && event.target instanceof HTMLInputElement && event.target.name === "file") {
          operationIdRef.current = null;
          setProgress(null);
          setMessage(null);
          setError(null);
        }
      }}
      className={className}
    >
      {children}
      <div className="md:col-span-full">
        <Button type="submit" disabled={pending}>
          {pending ? "Caricamento in corso..." : submitLabel}
        </Button>
        {progress !== null ? (
          <div className="mt-2" aria-live="polite">
            <div className="h-2 overflow-hidden rounded bg-slate-200">
              <div className="h-full bg-[#173d4f] transition-[width]" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-600">{progress}% · {message}</p>
          </div>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p> : null}
      </div>
    </form>
  );
}
