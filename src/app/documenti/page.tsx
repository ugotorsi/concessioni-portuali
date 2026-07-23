import { AppShell } from "@/components/layout/AppShell";
import { ResumeDemoBanner } from "@/components/demo-guidata/ResumeDemoBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
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
      subtitle="Upload, consultazione e download documenti istruttori"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <ResumeDemoBanner />

        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Fascicolo documentale</h1>
          <p className="mt-1 text-sm text-slate-600">
            Baseline locale demo: metadati in database e file su storage locale configurabile.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Metadato registrato a fini istruttori: non sostituisce protocollazione o conservazione a norma.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filtri documenti</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-6" method="GET">
              <Input name="search" placeholder="Ricerca per nome o descrizione" defaultValue={params.search ?? ""} />
              <Select name="tipologia" defaultValue={params.tipologia ?? ""}>
                <option value="">Tutte le tipologie</option>
                {filters.tipologie.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Select name="stato" defaultValue={params.stato ?? "TUTTI"}>
                {DOCUMENT_STATO_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnumLabel(value)}
                  </option>
                ))}
              </Select>
              <Select name="direzione" defaultValue={params.direzione ?? ""}>
                <option value="">Tutte le direzioni</option>
                {filters.direzioni.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Select name="canale" defaultValue={params.canale ?? ""}>
                <option value="">Tutti i canali</option>
                {filters.canali.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Select name="pecWarning" defaultValue={params.pecWarning ?? ""}>
                <option value="">Warning PEC: tutti</option>
                <option value="SI">Con warning PEC</option>
                <option value="NO">Senza warning PEC</option>
              </Select>
              <div className="flex items-center gap-2">
                <Button type="submit">Applica</Button>
                <a href="/documenti" className="text-sm underline underline-offset-4">
                  Reset
                </a>
              </div>
            </form>
          </CardContent>
        </Card>

        {canUpload ? (
          <Card>
            <CardHeader>
              <CardTitle>Carica documento</CardTitle>
              <CardDescription>
                Collega il file ad almeno un'entità tra concessione, criticità, procedimento, sopralluogo, pagamento o report.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createDocumentoUploadAction} className="grid gap-3 md:grid-cols-3">
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
                  <Button type="submit">Carica documento</Button>
                </div>
              </form>
            </CardContent>
          </Card>
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
                  <TableHead>Dimensione</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Protocollo/PEC</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Download</TableHead>
                  {canUpload ? <TableHead>Aggiorna</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-80 truncate">{item.nome}</TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell>{formatEnumLabel(item.statoDocumento)}</TableCell>
                    <TableCell>{(item.sizeBytes ?? item.dimensioneBytes) !== null ? `${item.sizeBytes ?? item.dimensioneBytes} bytes` : "-"}</TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{item.storageProvider ? formatEnumLabel(item.storageProvider) : "-"}</div>
                      <div>{item.source ? `Fonte: ${formatEnumLabel(item.source)}` : "Fonte: -"}</div>
                      <div>{item.status ? `Status: ${formatEnumLabel(item.status)}` : "Status: -"}</div>
                      <div>{item.checksumSha256 ? `Hash: ${item.checksumSha256.slice(0, 12)}...` : "Hash: -"}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{item.direzione ? formatEnumLabel(item.direzione) : "-"} / {item.canale ? formatEnumLabel(item.canale) : "-"}</div>
                      <div>{item.numeroProtocollo ?? "Nessun protocollo"}</div>
                      {item.dataProtocollo ? <div>{formatDateIT(item.dataProtocollo)}</div> : null}
                      {item.pecWarningMancataRicevuta ? <div className="font-semibold text-amber-700">Warning PEC</div> : null}
                    </TableCell>
                    <TableCell>{item.dataDocumento ? formatDateIT(item.dataDocumento) : formatDateIT(item.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <a href={item.downloadUrl} className="text-sm underline underline-offset-4">
                          Scarica
                        </a>
                        {item.mimeType?.startsWith("application/pdf") || item.mimeType?.startsWith("image/") ? (
                          <a
                            href={`${item.downloadUrl}?preview=1`}
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
                        <div className="flex flex-col gap-2">
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
                            <Input name="descrizione" placeholder="Descrizione" />
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
                              Salva metadati
                            </Button>
                          </form>
                          {item.statoDocumento !== "ARCHIVIATO" ? (
                            <form action={archiveDocumentoAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <Button type="submit" variant="outline">
                                Archivia
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canUpload ? 9 : 8} className="text-center text-slate-500">
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
