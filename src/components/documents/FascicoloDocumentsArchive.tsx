"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, FileText, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type { DocumentExtractionReadModel } from "@/server/queries/document-extractions";

export interface FascicoloDocumentArchiveItem {
  id: string;
  name: string;
  type: string;
  typeCode: string;
  state: string;
  isFileAvailable: boolean;
  documentDate?: string | null;
  acquiredAt: string;
  acquiredAtTimestamp: number;
  sender?: string | null;
  alert?: string | null;
  openHref: string;
  openInNewTab?: boolean;
  originalHref?: string | null;
  canArchive?: boolean;
  versionId?: string | null;
  extraction?: DocumentExtractionReadModel;
  details?: Array<{
    label: string;
    value: string;
  }>;
}

interface FascicoloDocumentsArchiveProps {
  documents: FascicoloDocumentArchiveItem[];
  uploadForm?: ReactNode;
  uploadInitiallyOpen?: boolean;
  archiveAction?: (formData: FormData) => void | Promise<void>;
}

type SortOrder = "recent" | "oldest" | "name";

function extractionStatusLabel(status: DocumentExtractionReadModel["status"]): string {
  switch (status) {
    case "AVAILABLE":
      return "Estrazione disponibile";
    case "PENDING":
      return "Estrazione in attesa";
    case "PROCESSING":
      return "Estrazione in elaborazione";
    case "OCR_REQUIRED":
      return "OCR necessario";
    case "FAILED":
      return "Estrazione non riuscita";
    case "NOT_RUN":
      return "Estrazione non ancora eseguita";
  }
}

export function FascicoloDocumentsArchive({
  documents,
  uploadForm,
  uploadInitiallyOpen = false,
  archiveAction,
}: FascicoloDocumentsArchiveProps) {
  const [selectedType, setSelectedType] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [uploadOpen, setUploadOpen] = useState(uploadInitiallyOpen);
  const availableTypes = Array.from(new Map(documents.map((item) => [item.typeCode, item.type])).entries());
  const problemCount = documents.filter((item) => item.alert).length;
  const visibleDocuments = documents
    .filter((item) => selectedType === "all" || item.typeCode === selectedType)
    .sort((left, right) => {
      if (sortOrder === "name") {
        return left.name.localeCompare(right.name, "it");
      }

      const difference = left.acquiredAtTimestamp - right.acquiredAtTimestamp;
      return sortOrder === "oldest" ? difference : -difference;
    });

  return (
    <section className="space-y-4" aria-labelledby="fascicolo-documents-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 id="fascicolo-documents-heading" className="text-lg font-semibold text-slate-950">Documenti</h2>
          <p className="mt-1 text-sm text-slate-600">Atti e documenti acquisiti nel fascicolo.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
            <span className="rounded-md bg-slate-100 px-2.5 py-1">{documents.length} {documents.length === 1 ? "documento" : "documenti"}</span>
            {problemCount > 0 ? (
              <span className="rounded-md bg-amber-50 px-2.5 py-1 text-amber-800">
                {problemCount} {problemCount === 1 ? "documento da verificare" : "documenti da verificare"}
              </span>
            ) : null}
          </div>
        </div>
        {uploadForm ? (
          <Button
            type="button"
            onClick={() => setUploadOpen((current) => !current)}
            aria-expanded={uploadOpen}
            aria-controls="fascicolo-document-upload"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            Allega documento
          </Button>
        ) : null}
      </div>

      {uploadForm && uploadOpen ? (
        <div id="fascicolo-document-upload" className="rounded-md border border-slate-200 bg-slate-50 p-4">
          {uploadForm}
        </div>
      ) : null}

      {documents.length > 1 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {availableTypes.length > 1 ? (
            <label className="text-sm font-medium text-slate-700 sm:w-64">
              Tipologia
              <Select value={selectedType} onChange={(event) => setSelectedType(event.target.value)} className="mt-1">
                <option value="all">Tutte le tipologie</option>
                {availableTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
          ) : null}
          <label className="text-sm font-medium text-slate-700 sm:w-52">
            Ordina
            <Select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)} className="mt-1">
              <option value="recent">Più recenti</option>
              <option value="oldest">Più vecchi</option>
              <option value="name">Nome</option>
            </Select>
          </label>
        </div>
      ) : null}

      {visibleDocuments.length > 0 ? (
        <ul className="divide-y divide-slate-200 border-y border-slate-200">
          {visibleDocuments.map((item) => (
            <li key={item.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[#173d4f]" aria-hidden="true" />
                <div className="min-w-0 space-y-1.5">
                  <p className="break-words text-sm font-semibold text-slate-950">{item.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{item.type}</span>
                    <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">{item.state}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {item.documentDate ? <span>Data documento: {item.documentDate}</span> : null}
                    <span>Acquisito: {item.acquiredAt}</span>
                    {item.sender ? <span>Provenienza: {item.sender}</span> : null}
                  </div>
                  {item.alert ? (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      {item.alert}
                    </p>
                  ) : null}
                  <p className="text-xs text-slate-600">
                    Versione: <span className="font-mono">{item.versionId ?? "non disponibile"}</span>
                    {" · "}
                    {extractionStatusLabel(item.extraction?.status ?? "NOT_RUN")}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8 md:flex-nowrap md:pl-0">
                {item.isFileAvailable ? (
                  <a
                    href={item.openHref}
                    target={item.openInNewTab ? "_blank" : undefined}
                    rel={item.openInNewTab ? "noreferrer" : undefined}
                    className="text-sm font-semibold text-[#173d4f] underline decoration-slate-300 underline-offset-4 hover:decoration-[#173d4f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]"
                  >
                    Apri documento
                  </a>
                ) : (
                  <span className="text-sm text-slate-500">Documento non ancora verificato</span>
                )}
                <details className="relative">
                  <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">Azioni e dettagli</summary>
                  <div className="absolute left-0 z-10 mt-2 w-[min(15rem,calc(100vw-2rem))] space-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm md:left-auto md:right-0 md:w-72">
                    <dl className="space-y-1.5">
                      <div><dt className="inline font-medium text-slate-800">Data acquisizione: </dt><dd className="inline">{item.acquiredAt}</dd></div>
                      {item.details?.map((detail) => (
                        <div key={`${item.id}-${detail.label}`} className="break-words">
                          <dt className="inline font-medium text-slate-800">{detail.label}: </dt><dd className="inline">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {item.originalHref ? <a href={item.originalHref} className="block font-medium underline underline-offset-4">Scarica originale</a> : null}
                    {archiveAction && item.canArchive ? (
                      <form action={archiveAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button type="submit" className="font-medium text-red-700 underline underline-offset-4">Archivia</button>
                      </form>
                    ) : null}
                  </div>
                </details>
              </div>
              <details className="md:col-span-2 md:ml-8">
                <summary className="cursor-pointer text-sm font-semibold text-[#173d4f] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">
                  Consulta testo estratto
                </summary>
                <div className="mt-3 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <p className="font-semibold text-slate-950">{item.name}</p>
                    <p>Versione: <span className="font-mono text-xs">{item.versionId ?? "non disponibile"}</span></p>
                  </div>
                  <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div><dt className="font-medium text-slate-900">Stato</dt><dd>{extractionStatusLabel(item.extraction?.status ?? "NOT_RUN")}</dd></div>
                    <div><dt className="font-medium text-slate-900">Metodo</dt><dd>{item.extraction?.methods.length ? item.extraction.methods.join(", ") : "Non disponibile"}</dd></div>
                    <div><dt className="font-medium text-slate-900">Pagine</dt><dd>{item.extraction?.pageCount ?? 0}</dd></div>
                    <div><dt className="font-medium text-slate-900">Caratteri</dt><dd>{item.extraction?.characterCount ?? 0}</dd></div>
                    <div><dt className="font-medium text-slate-900">Policy</dt><dd>{item.extraction?.policyVersion ?? "Non disponibile"}</dd></div>
                    <div><dt className="font-medium text-slate-900">Provenienza risultato</dt><dd>{item.extraction?.provenance.length ? item.extraction.provenance.join(", ") : "Non disponibile"}</dd></div>
                  </dl>
                  {item.extraction?.status === "OCR_REQUIRED" ? (
                    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900">
                      OCR_REQUIRED: il documento richiede riconoscimento ottico del testo.
                    </p>
                  ) : null}
                  {item.extraction?.status === "FAILED" ? (
                    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
                      {item.extraction.failureCode ?? "EXTRACTION_FAILED"}
                      {item.extraction.failureMessage ? `: ${item.extraction.failureMessage}` : ""}
                    </p>
                  ) : null}
                  {(item.extraction?.status ?? "NOT_RUN") === "NOT_RUN" ? (
                    <p className="rounded-md border border-slate-200 bg-white p-3">Nessun risultato di estrazione disponibile per questa versione.</p>
                  ) : null}
                  {item.extraction?.status === "PENDING" ? (
                    <p role="status" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sky-900">
                      Estrazione ammessa e in attesa dell'esecutore.
                    </p>
                  ) : null}
                  {item.extraction?.status === "PROCESSING" ? (
                    <p role="status" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
                      Estrazione in elaborazione.
                    </p>
                  ) : null}
                  {item.extraction?.status === "AVAILABLE" ? (
                    <ol className="space-y-4">
                      {item.extraction.pages.map((page) => (
                        <li key={`${item.id}-page-${page.pageNumber}`} className="rounded-md border border-slate-200 bg-white p-4">
                          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                            <span className="font-semibold text-slate-900">Pagina {page.pageNumber}</span>
                            <span>Metodo: {page.method}</span>
                            <span>{page.characterCount} caratteri</span>
                            {page.ocrConfidence !== null ? <span>Confidenza OCR: {Math.round(page.ocrConfidence * 100)}%</span> : null}
                          </div>
                          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-900">{page.text}</pre>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : documents.length === 0 ? (
        <div className="py-4 text-sm text-slate-600">
          <p>Nessun documento ancora acquisito.</p>
          {uploadForm ? (
            <button type="button" onClick={() => setUploadOpen(true)} className="mt-1 font-semibold text-[#173d4f] underline underline-offset-4">
              Allega il primo documento
            </button>
          ) : null}
        </div>
      ) : (
        <p className="py-4 text-sm text-slate-600">Nessun documento corrisponde al filtro selezionato.</p>
      )}
    </section>
  );
}
