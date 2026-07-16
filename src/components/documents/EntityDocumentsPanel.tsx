import { archiveDocumentoAction, createDocumentoUploadAction } from "@/server/actions/documenti";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { DOCUMENT_CANALE_VALUES, DOCUMENT_DIREZIONE_VALUES } from "@/server/documents/protocollo";
import { DOCUMENT_SOURCE_VALUES, DOCUMENT_STATUS_VALUES, DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

interface EntityDocumentItem {
  id: string;
  nome: string;
  tipologia: string;
  statoDocumento?: string;
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
  url?: string | null;
}

interface EntityDocumentsPanelProps {
  title: string;
  entityType: "concessione" | "criticita" | "procedimento" | "sopralluogo" | "pagamento" | "report";
  entityId: string;
  documents: EntityDocumentItem[];
  canUpload: boolean;
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

export function EntityDocumentsPanel({
  title,
  entityType,
  entityId,
  documents,
  canUpload,
}: EntityDocumentsPanelProps) {
  const hiddenFieldName = getHiddenFieldName(entityType);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Documenti del fascicolo collegati all entita istruttoria.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipologia</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Metadata</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Download</TableHead>
              {canUpload ? <TableHead>Azioni</TableHead> : null}
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
                <TableCell className="text-xs text-slate-700">
                  <div>{item.direzione ? formatEnumLabel(item.direzione) : "-"} / {item.canale ? formatEnumLabel(item.canale) : "-"}</div>
                  <div>{item.numeroProtocollo ?? "Nessun protocollo"}</div>
                  {item.dataProtocollo ? <div>{formatDateIT(item.dataProtocollo)}</div> : null}
                  {item.pecWarningMancataRicevuta ? <div className="font-semibold text-amber-700">Warning PEC</div> : null}
                </TableCell>
                <TableCell className="text-xs text-slate-700">
                  <div>{item.storageProvider ? formatEnumLabel(item.storageProvider) : "-"}</div>
                  <div>{item.source ? `Fonte: ${formatEnumLabel(item.source)}` : "Fonte: -"}</div>
                  <div>{item.status ? `Status: ${formatEnumLabel(item.status)}` : "Status: -"}</div>
                  <div>{item.checksumSha256 ? `Hash: ${item.checksumSha256.slice(0, 10)}...` : "Hash: -"}</div>
                  <div>{item.sizeBytes !== null && item.sizeBytes !== undefined ? `${item.sizeBytes} bytes` : "-"}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <a href={`/documenti/${item.id}/download`} className="text-sm underline underline-offset-4">
                      Scarica
                    </a>
                    {item.url?.includes("/download") ? (
                      <a
                        href={`/documenti/${item.id}/download?preview=1`}
                        className="text-xs underline underline-offset-4"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Preview
                      </a>
                    ) : null}
                  </div>
                </TableCell>
                {canUpload ? (
                  <TableCell>
                    {item.statoDocumento !== "ARCHIVIATO" ? (
                      <form action={archiveDocumentoAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button type="submit" className="text-sm underline underline-offset-4">
                          Archivia
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-slate-500">Archiviato</span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {documents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canUpload ? 8 : 7} className="text-center text-slate-500">
                  Nessun documento collegato.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {canUpload ? (
          <form action={createDocumentoUploadAction} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
            <input type="hidden" name={hiddenFieldName} value={entityId} />
            <label className="text-sm text-slate-700 md:col-span-2">
              File
              <Input name="file" type="file" required />
            </label>
            <label className="text-sm text-slate-700">
              Nome documento
              <Input name="nome" placeholder="Nome visualizzato" />
            </label>
            <label className="text-sm text-slate-700">
              Tipologia
              <Select name="tipologia" required defaultValue="NOTA">
                {DOCUMENT_TIPOLOGIA_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm text-slate-700 md:col-span-2">
              Descrizione
              <Textarea name="descrizione" rows={2} placeholder="Descrizione documento" />
            </label>
            <label className="text-sm text-slate-700">
              Direzione
              <Select name="direzione" defaultValue="">
                <option value="">Non indicata</option>
                {DOCUMENT_DIREZIONE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm text-slate-700">
              Canale
              <Select name="canale" defaultValue="">
                <option value="">Non indicato</option>
                {DOCUMENT_CANALE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm text-slate-700">
              Numero protocollo
              <Input name="numeroProtocollo" placeholder="Es. PG/2026/000123" />
            </label>
            <label className="text-sm text-slate-700">
              Data protocollo
              <Input name="dataProtocollo" type="date" />
            </label>
            <label className="text-sm text-slate-700">
              Mittente
              <Input name="mittente" placeholder="Mittente" />
            </label>
            <label className="text-sm text-slate-700">
              Destinatario
              <Input name="destinatario" placeholder="Destinatario" />
            </label>
            <label className="text-sm text-slate-700 md:col-span-2">
              PEC Message-ID
              <Input name="pecMessageId" placeholder="Message-ID PEC" />
            </label>
            <label className="text-sm text-slate-700">
              Ricevuta accettazione PEC
              <Input name="pecRicevutaAccettazioneId" placeholder="ID ricevuta" />
            </label>
            <label className="text-sm text-slate-700">
              Ricevuta consegna PEC
              <Input name="pecRicevutaConsegnaId" placeholder="ID ricevuta" />
            </label>
            <label className="text-sm text-slate-700">
              Data documento
              <Input name="dataDocumento" type="date" />
            </label>
            <label className="text-sm text-slate-700">
              Fonte
              <Select name="source" required defaultValue="UPLOAD_UTENTE">
                {DOCUMENT_SOURCE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm text-slate-700">
              Stato
              <Select name="status" required defaultValue="ATTIVO">
                {DOCUMENT_STATUS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex items-end">
              <Button type="submit">Carica documento</Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
