import { archiveDocumentoAction, createDocumentoUploadAction } from "@/server/actions/documenti";
import { FascicoloDocumentsArchive, type FascicoloDocumentArchiveItem } from "@/components/documents/FascicoloDocumentsArchive";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { DOCUMENT_CANALE_VALUES, DOCUMENT_DIREZIONE_VALUES } from "@/server/documents/protocollo";
import { DOCUMENT_SOURCE_VALUES, DOCUMENT_STATUS_VALUES, DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";
import type { DocumentExtractionReadModel } from "@/server/queries/document-extractions";

interface EntityDocumentItem {
  id: string;
  nome: string;
  tipologia: string;
  statoDocumento?: string;
  isFileAvailable?: boolean;
  dataDocumento: Date | null;
  createdAt: Date;
  direzione?: string | null;
  canale?: string | null;
  source?: string | null;
  status?: string | null;
  storageProvider?: string | null;
  checksumSha256?: string | null;
  sizeBytes?: number | null;
  numeroProtocollo?: string | null;
  dataProtocollo?: Date | null;
  pecWarningMancataRicevuta?: boolean;
  descrizione?: string | null;
  mittente?: string | null;
  url?: string | null;
  currentFileVersionId?: string | null;
  extraction?: DocumentExtractionReadModel;
}

interface EntityDocumentsPanelProps {
  title: string;
  entityType: "concessione" | "criticita" | "procedimento" | "sopralluogo" | "pagamento" | "report";
  entityId: string;
  documents: EntityDocumentItem[];
  canUpload: boolean;
  archiveMode?: boolean;
}

function getHiddenFieldName(entityType: EntityDocumentsPanelProps["entityType"]): string {
  switch (entityType) {
    case "concessione":
      return "concessioneId";
    case "criticita":
      return "criticitaId";
    case "procedimento":
      return "procedimentoId";
    case "sopralluogo":
      return "sopralluogoId";
    case "pagamento":
      return "pagamentoId";
    case "report":
      return "reportId";
  }
}

function EntityDocumentUploadForm({ hiddenFieldName, entityId }: { hiddenFieldName: string; entityId: string }) {
  return (
    <form action={createDocumentoUploadAction} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name={hiddenFieldName} value={entityId} />
      <label className="text-sm text-slate-700 md:col-span-2">
        File
        <Input name="file" type="file" required />
      </label>
      <label className="text-sm text-slate-700">
        Nome documento <span className="font-normal text-slate-500">(opzionale)</span>
        <Input name="nome" placeholder="Usa il nome del file se vuoto" />
      </label>
      <label className="text-sm text-slate-700">
        Tipologia
        <Select name="tipologia" required defaultValue="NOTA">
          {DOCUMENT_TIPOLOGIA_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}
        </Select>
      </label>
      <label className="text-sm text-slate-700 md:col-span-2">
        Descrizione <span className="font-normal text-slate-500">(opzionale)</span>
        <Textarea name="descrizione" rows={2} placeholder="Descrizione documento" />
      </label>
      <label className="text-sm text-slate-700">
        Data documento
        <Input name="dataDocumento" type="date" />
      </label>
      <label className="text-sm text-slate-700">
        Provenienza
        <Input name="mittente" placeholder="Soggetto mittente" />
      </label>
      <details className="md:col-span-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-600">Altri metadati</summary>
        <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-2">
          <label className="text-sm text-slate-700">Direzione<Select name="direzione" defaultValue=""><option value="">Non indicata</option>{DOCUMENT_DIREZIONE_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}</Select></label>
          <label className="text-sm text-slate-700">Canale<Select name="canale" defaultValue=""><option value="">Non indicato</option>{DOCUMENT_CANALE_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}</Select></label>
          <label className="text-sm text-slate-700">Numero protocollo<Input name="numeroProtocollo" placeholder="Es. PG/2026/000123" /></label>
          <label className="text-sm text-slate-700">Data protocollo<Input name="dataProtocollo" type="date" /></label>
          <label className="text-sm text-slate-700">Destinatario<Input name="destinatario" placeholder="Destinatario" /></label>
          <label className="text-sm text-slate-700">PEC Message-ID<Input name="pecMessageId" placeholder="Message-ID PEC" /></label>
          <label className="text-sm text-slate-700">Ricevuta accettazione PEC<Input name="pecRicevutaAccettazioneId" placeholder="ID ricevuta" /></label>
          <label className="text-sm text-slate-700">Ricevuta consegna PEC<Input name="pecRicevutaConsegnaId" placeholder="ID ricevuta" /></label>
          <label className="text-sm text-slate-700">Fonte<Select name="source" required defaultValue="UPLOAD_UTENTE">{DOCUMENT_SOURCE_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}</Select></label>
          <label className="text-sm text-slate-700">Stato<Select name="status" required defaultValue="ATTIVO">{DOCUMENT_STATUS_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}</Select></label>
        </div>
      </details>
      <div className="md:col-span-2"><Button type="submit">Conferma allegato</Button></div>
    </form>
  );
}

function toArchiveItem(item: EntityDocumentItem, canUpload: boolean): FascicoloDocumentArchiveItem {
  const usesStoredFile = item.url?.includes("/download") ?? false;
  const details = [
    item.numeroProtocollo ? { label: "Protocollo", value: item.numeroProtocollo } : null,
    item.dataProtocollo ? { label: "Data protocollo", value: formatDateIT(item.dataProtocollo) } : null,
    item.direzione ? { label: "Direzione", value: formatEnumLabel(item.direzione) } : null,
    item.canale ? { label: "Canale", value: formatEnumLabel(item.canale) } : null,
    item.descrizione ? { label: "Descrizione", value: item.descrizione } : null,
    item.source ? { label: "Fonte", value: formatEnumLabel(item.source) } : null,
    item.sizeBytes !== null && item.sizeBytes !== undefined ? { label: "Dimensione", value: `${item.sizeBytes} byte` } : null,
  ].filter((detail): detail is { label: string; value: string } => detail !== null);

  return {
    id: item.id,
    name: item.nome,
    type: formatEnumLabel(item.tipologia),
    typeCode: item.tipologia,
    state: item.statoDocumento === "ARCHIVIATO" ? "Archiviato" : "Caricato",
    isFileAvailable: item.isFileAvailable === true,
    documentDate: item.dataDocumento ? formatDateIT(item.dataDocumento) : null,
    acquiredAt: formatDateIT(item.createdAt),
    acquiredAtTimestamp: item.createdAt.getTime(),
    sender: item.mittente,
    alert: item.pecWarningMancataRicevuta ? "Ricevuta PEC da verificare" : null,
    openHref: `/documenti/${item.id}/download${usesStoredFile ? "?preview=1" : ""}`,
    openInNewTab: item.isFileAvailable === true && usesStoredFile,
    originalHref: item.isFileAvailable === true && usesStoredFile ? `/documenti/${item.id}/download` : null,
    canArchive: canUpload && item.statoDocumento !== "ARCHIVIATO",
    details,
    versionId: item.currentFileVersionId ?? null,
    extraction: item.extraction,
  };
}

export function EntityDocumentsPanel({
  title,
  entityType,
  entityId,
  documents,
  canUpload,
  archiveMode = false,
}: EntityDocumentsPanelProps) {
  const hiddenFieldName = getHiddenFieldName(entityType);
  const isProcedimento = entityType === "procedimento";
  const uploadForm = canUpload ? <EntityDocumentUploadForm hiddenFieldName={hiddenFieldName} entityId={entityId} /> : undefined;

  if (archiveMode) {
    return (
      <FascicoloDocumentsArchive
        documents={documents.map((item) => toArchiveItem(item, canUpload))}
        uploadForm={uploadForm}
        archiveAction={archiveDocumentoAction}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Documenti del fascicolo collegati all'entità istruttoria.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipologia</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Informazioni</TableHead>
              <TableHead>Documento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-80 truncate">{item.nome}</TableCell>
                <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                <TableCell>{formatEnumLabel(item.statoDocumento ?? "ATTIVO")}</TableCell>
                <TableCell>
                  {item.dataDocumento ? formatDateIT(item.dataDocumento) : formatDateIT(item.createdAt)}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  <div>{item.direzione ? formatEnumLabel(item.direzione) : "Direzione non indicata"}</div>
                  <div>{item.canale ? formatEnumLabel(item.canale) : "Canale non indicato"}</div>
                  <div>{item.numeroProtocollo ?? "Protocollo non indicato"}</div>
                  {item.dataProtocollo ? <div>{formatDateIT(item.dataProtocollo)}</div> : null}
                  {item.pecWarningMancataRicevuta ? <div className="font-semibold text-amber-700">Ricevuta PEC da verificare</div> : null}
                  <details className="mt-1">
                    <summary className="cursor-pointer font-medium text-slate-500">Dettagli tecnici</summary>
                    <div className="mt-1 space-y-0.5 break-all font-mono text-[11px] text-slate-500">
                      <div>Storage: {item.storageProvider ? formatEnumLabel(item.storageProvider) : "-"}</div>
                      <div>Fonte: {item.source ? formatEnumLabel(item.source) : "-"}</div>
                      <div>Stato: {item.status ? formatEnumLabel(item.status) : "-"}</div>
                      <div>Hash: {item.checksumSha256 ?? "-"}</div>
                      <div>Dimensione: {item.sizeBytes !== null && item.sizeBytes !== undefined ? `${item.sizeBytes} byte` : "-"}</div>
                    </div>
                  </details>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-36 flex-col items-start gap-2">
                    <a
                      href={`/documenti/${item.id}/download${item.url?.includes("/download") ? "?preview=1" : ""}`}
                      target={item.url?.includes("/download") ? "_blank" : undefined}
                      rel={item.url?.includes("/download") ? "noreferrer" : undefined}
                      className="text-sm font-semibold text-[#173d4f] underline decoration-slate-300 underline-offset-4 hover:decoration-[#173d4f]"
                    >
                      Apri documento
                    </a>
                    {(item.url?.includes("/download") || (canUpload && item.statoDocumento !== "ARCHIVIATO")) ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-900">Altro</summary>
                        <div className="mt-2 flex flex-col items-start gap-2 border-l border-slate-200 pl-2">
                          {item.url?.includes("/download") ? (
                            <a href={`/documenti/${item.id}/download`} className="text-xs text-slate-600 underline underline-offset-4">
                              Scarica originale
                            </a>
                          ) : null}
                          {canUpload && item.statoDocumento !== "ARCHIVIATO" ? (
                            <form action={archiveDocumentoAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <button type="submit" className="text-xs font-medium text-red-700 underline underline-offset-4">
                                Archivia
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {documents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  {isProcedimento ? "Nessun documento presente nel fascicolo." : "Nessun documento collegato."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {uploadForm ? (
          <details className="rounded-md border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#173d4f]">Allega documento</summary>
            <div className="border-t border-slate-200 p-4">{uploadForm}</div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
