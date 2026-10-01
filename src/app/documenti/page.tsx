import { randomUUID } from "node:crypto";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { archiveDocumentoAction, createDocumentoUploadAction, updateDocumentoMetadataAction } from "@/server/actions/documenti";
import { DOCUMENT_CANALE_VALUES, DOCUMENT_DIREZIONE_VALUES } from "@/server/documents/protocollo";
import {
  DOCUMENT_STATO_VALUES,
  getDocumentiFiltersData,
  getDocumentiList,
  type DocumentoStatoFilter,
} from "@/server/queries/documenti";
import { DOCUMENT_SOURCE_VALUES, DOCUMENT_STATUS_VALUES, DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

interface DocumentiPageProps {
  searchParams?: Promise<{
    search?: string;
    tipologia?: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number];
    stato?: DocumentoStatoFilter;
    direzione?: (typeof DOCUMENT_DIREZIONE_VALUES)[number];
    canale?: (typeof DOCUMENT_CANALE_VALUES)[number];
    pecWarning?: "SI" | "NO";
  }>;
}

function toDateInputValue(value: Date | null): string {
  if (!value) {
    return "";
  }

  return value.toISOString().slice(0, 10);
}

export const dynamic = "force-dynamic";

export default async function DocumentiPage({ searchParams }: DocumentiPageProps) {
  const role = await requireRole();
  const canUpload = BACKOFFICE_ROLES.includes(role);
  const params = (await searchParams) ?? {};

  const [filters, items] = await Promise.all([
    getDocumentiFiltersData(),
    getDocumentiList({
      search: params.search,
      tipologia: params.tipologia,
      stato: params.stato,
      direzione: params.direzione,
      canale: params.canale,
      pecWarning: params.pecWarning,
    }),
  ]);

  return (
    <AppShell
      title="Fascicolo documentale"
      subtitle="Consulta e gestisci i documenti collegati alle attività istruttorie"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <form className="rounded-md border border-slate-200 bg-white p-4" method="GET">
          <div className="grid gap-3 md:grid-cols-3">
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">Cerca documento</span>
                <Input name="search" placeholder="Nome o descrizione" defaultValue={params.search ?? ""} />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">Tipologia</span>
                <Select name="tipologia" defaultValue={params.tipologia ?? ""}>
                <option value="">Tutte le tipologie</option>
                {filters.tipologie.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                </Select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">Stato</span>
                <Select name="stato" defaultValue={params.stato ?? "TUTTI"}>
                {DOCUMENT_STATO_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
                </Select>
              </label>
          </div>
          <details className="mt-4 border-t border-slate-200 pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-[#173d4f]">Filtri avanzati</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Select aria-label="Direzione documento" name="direzione" defaultValue={params.direzione ?? ""}>
                <option value="">Tutte le direzioni</option>
                {filters.direzioni.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Canale documento" name="canale" defaultValue={params.canale ?? ""}>
                <option value="">Tutti i canali</option>
                {filters.canali.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Verifica ricevuta PEC" name="pecWarning" defaultValue={params.pecWarning ?? ""}>
                <option value="">Ricevuta PEC: tutte</option>
                <option value="SI">Da verificare</option>
                <option value="NO">Verificata</option>
              </Select>
            </div>
          </details>
          <div className="mt-4 flex items-center gap-2">
            <Button type="submit">Applica filtri</Button>
            <a href="/documenti" className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Reset</a>
          </div>
        </form>

        {canUpload ? (
          <details className="rounded-md border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#173d4f]">Carica documento</summary>
            <div className="border-t border-slate-200 p-4">
              <form action={createDocumentoUploadAction} className="grid gap-3 md:grid-cols-3">
                <input type="hidden" name="intakeOperationId" value={randomUUID()} />
                <label className="text-sm text-slate-700 md:col-span-3">
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
                <label className="text-sm text-slate-700">
                  Data documento
                  <Input name="dataDocumento" type="date" />
                </label>
                <label className="text-sm text-slate-700">
                  Fonte
                  <Select name="source" defaultValue="UPLOAD_UTENTE" required>
                    {DOCUMENT_SOURCE_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {formatEnumLabel(value)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Stato
                  <Select name="status" defaultValue="ATTIVO" required>
                    {DOCUMENT_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {formatEnumLabel(value)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700 md:col-span-3">
                  Descrizione
                  <Textarea name="descrizione" rows={2} />
                </label>
                <label className="text-sm text-slate-700">
                  Direzione
                  <Select name="direzione" defaultValue="">
                    <option value="">Non indicata</option>
                    {filters.direzioni.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Canale
                  <Select name="canale" defaultValue="">
                    <option value="">Non indicato</option>
                    {filters.canali.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
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
                <label className="text-sm text-slate-700 md:col-span-3">
                  PEC Message-ID
                  <Input name="pecMessageId" placeholder="Message-ID PEC (se canale PEC)" />
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
                  Concessione
                  <Select name="concessioneId" defaultValue="">
                    <option value="">Nessuna</option>
                    {filters.concessioni.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Criticità
                  <Select name="criticitaId" defaultValue="">
                    <option value="">Nessuna</option>
                    {filters.criticita.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Procedimento
                  <Select name="procedimentoId" defaultValue="">
                    <option value="">Nessuno</option>
                    {filters.procedimenti.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Sopralluogo
                  <Select name="sopralluogoId" defaultValue="">
                    <option value="">Nessuno</option>
                    {filters.sopralluoghi.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Pagamento
                  <Select name="pagamentoId" defaultValue="">
                    <option value="">Nessuno</option>
                    {filters.pagamenti.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-slate-700">
                  Report
                  <Select name="reportId" defaultValue="">
                    <option value="">Nessuno</option>
                    {filters.report.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="md:col-span-3">
                  <Button type="submit">Conferma caricamento</Button>
                </div>
              </form>
            </div>
          </details>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Registro documenti</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Informazioni</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Documento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-80 truncate">{item.nome}</TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell>{formatEnumLabel(item.statoDocumento)}</TableCell>
                    <TableCell className="text-xs text-slate-600">
                      <div>{item.direzione ? formatEnumLabel(item.direzione) : "Direzione non indicata"}</div>
                      <div>{item.canale ? formatEnumLabel(item.canale) : "Canale non indicato"}</div>
                      <div>{item.numeroProtocollo ?? "Protocollo non indicato"}</div>
                      {item.dataProtocollo ? <div>{formatDateIT(item.dataProtocollo)}</div> : null}
                      {item.pecWarningMancataRicevuta ? <div className="font-semibold text-amber-700">Ricevuta PEC da verificare</div> : null}
                      <details className="mt-1">
                        <summary className="cursor-pointer font-medium text-slate-500">Dettagli tecnici</summary>
                        <div className="mt-1 space-y-0.5 break-all font-mono text-[11px]">
                          <div>Dimensione: {(item.sizeBytes ?? item.dimensioneBytes) !== null ? `${item.sizeBytes ?? item.dimensioneBytes} byte` : "-"}</div>
                          <div>Storage: {item.storageProvider ? formatEnumLabel(item.storageProvider) : "-"}</div>
                          <div>Fonte: {item.source ? formatEnumLabel(item.source) : "-"}</div>
                          <div>Stato: {item.status ? formatEnumLabel(item.status) : "-"}</div>
                          <div>Hash: {item.checksumSha256 ?? "-"}</div>
                        </div>
                      </details>
                    </TableCell>
                    <TableCell>{item.dataDocumento ? formatDateIT(item.dataDocumento) : formatDateIT(item.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex min-w-40 flex-col items-start gap-2">
                        <a
                          href={(item.mimeType?.startsWith("application/pdf") || item.mimeType?.startsWith("image/")) ? `${item.downloadUrl}?preview=1` : item.downloadUrl}
                          target={(item.mimeType?.startsWith("application/pdf") || item.mimeType?.startsWith("image/")) ? "_blank" : undefined}
                          rel={(item.mimeType?.startsWith("application/pdf") || item.mimeType?.startsWith("image/")) ? "noreferrer" : undefined}
                          className="text-sm font-semibold text-[#173d4f] underline decoration-slate-300 underline-offset-4 hover:decoration-[#173d4f]"
                        >
                          Apri documento
                        </a>
                        {(canUpload || item.mimeType?.startsWith("application/pdf") || item.mimeType?.startsWith("image/")) ? (
                          <details className="w-full">
                            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-900">Altro</summary>
                            <div className="mt-2 grid min-w-72 gap-3 border-l border-slate-200 pl-3">
                              {item.mimeType?.startsWith("application/pdf") || item.mimeType?.startsWith("image/") ? (
                                <a href={item.downloadUrl} className="text-xs text-slate-600 underline underline-offset-4">Scarica originale</a>
                              ) : null}
                          {canUpload ? (
                            <details>
                              <summary className="cursor-pointer text-xs font-medium text-slate-600">Modifica informazioni</summary>
                          <form action={updateDocumentoMetadataAction} className="flex flex-col gap-2">
                            <input type="hidden" name="id" value={item.id} />
                            <Input name="nome" defaultValue={item.nome} />
                            <Select name="tipologia" defaultValue={item.tipologia}>
                              {DOCUMENT_TIPOLOGIA_VALUES.map((value) => (
                                <option key={value} value={value}>
                                  {formatEnumLabel(value)}
                                </option>
                              ))}
                            </Select>
                            <Input name="descrizione" defaultValue={item.descrizione ?? ""} placeholder="Descrizione" />
                            <Select name="direzione" defaultValue={item.direzione ?? ""}>
                              <option value="">Direzione non indicata</option>
                              {filters.direzioni.map((value) => (
                                <option key={value.value} value={value.value}>
                                  {value.label}
                                </option>
                              ))}
                            </Select>
                            <Select name="canale" defaultValue={item.canale ?? ""}>
                              <option value="">Canale non indicato</option>
                              {filters.canali.map((value) => (
                                <option key={value.value} value={value.value}>
                                  {value.label}
                                </option>
                              ))}
                            </Select>
                            <Input name="numeroProtocollo" defaultValue={item.numeroProtocollo ?? ""} placeholder="Numero protocollo" />
                            <Input name="dataProtocollo" type="date" defaultValue={toDateInputValue(item.dataProtocollo)} />
                            <Input name="mittente" defaultValue={item.mittente ?? ""} placeholder="Mittente" />
                            <Input name="destinatario" defaultValue={item.destinatario ?? ""} placeholder="Destinatario" />
                            <Input name="pecMessageId" defaultValue={item.pecMessageId ?? ""} placeholder="Message-ID PEC" />
                            <Input name="pecRicevutaAccettazioneId" defaultValue={item.pecRicevutaAccettazioneId ?? ""} placeholder="ID ricevuta accettazione" />
                            <Input name="pecRicevutaConsegnaId" defaultValue={item.pecRicevutaConsegnaId ?? ""} placeholder="ID ricevuta consegna" />
                            <Button type="submit" variant="outline">
                              Salva modifiche
                            </Button>
                          </form>
                            </details>
                          ) : null}
                          {canUpload && item.statoDocumento !== "ARCHIVIATO" ? (
                            <form action={archiveDocumentoAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <Button type="submit" variant="danger">
                                Archivia
                              </Button>
                            </form>
                          ) : null}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      Nessun documento trovato.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
