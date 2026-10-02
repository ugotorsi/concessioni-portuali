"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, FileText, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

export interface FascicoloDocumentArchiveItem {
  id: string;
  name: string;
  type: string;
  typeCode: string;
  state: string;
  documentDate?: string | null;
  acquiredAt: string;
  acquiredAtTimestamp: number;
  sender?: string | null;
  alert?: string | null;
  openHref: string;
  openInNewTab?: boolean;
  originalHref?: string | null;
  canArchive?: boolean;
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
                </div>
              </div>

              <div className="flex items-center gap-4 pl-8 md:pl-0">
                <a
                  href={item.openHref}
                  target={item.openInNewTab ? "_blank" : undefined}
                  rel={item.openInNewTab ? "noreferrer" : undefined}
                  className="text-sm font-semibold text-[#173d4f] underline decoration-slate-300 underline-offset-4 hover:decoration-[#173d4f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]"
                >
                  Apri documento
                </a>
                <details className="relative">
                  <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">Altro</summary>
                  <div className="mt-2 w-full min-w-60 space-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm md:absolute md:right-0 md:z-10 md:w-72">
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
