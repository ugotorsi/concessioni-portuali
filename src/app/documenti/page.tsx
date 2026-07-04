import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { archiveDocumentoAction, createDocumentoUploadAction, updateDocumentoMetadataAction } from "@/server/actions/documenti";
import {
  DOCUMENT_STATO_VALUES,
  getDocumentiFiltersData,
  getDocumentiList,
  type DocumentoStatoFilter,
} from "@/server/queries/documenti";
import { DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

interface DocumentiPageProps {
  searchParams?: Promise<{
    search?: string;
    tipologia?: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number];
    stato?: DocumentoStatoFilter;
  }>;
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
    }),
  ]);

  return (
    <AppShell
      title="Fascicolo documentale"
      subtitle="Upload, consultazione e download documenti istruttori"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Fascicolo documentale</h1>
          <p className="mt-1 text-sm text-slate-600">
            Baseline locale demo: metadati in database e file su storage locale configurabile.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filtri documenti</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-4" method="GET">
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
                Collega il file ad almeno una entita tra concessione, criticita, procedimento, sopralluogo, pagamento o report.
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
                <label className="text-sm text-slate-700 md:col-span-3">
                  Descrizione
                  <Textarea name="descrizione" rows={2} />
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
                  Criticita
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
                    <TableCell>{item.dimensioneBytes !== null ? `${item.dimensioneBytes} bytes` : "-"}</TableCell>
                    <TableCell>{item.dataDocumento ? formatDateIT(item.dataDocumento) : formatDateIT(item.createdAt)}</TableCell>
                    <TableCell>
                      <a href={item.downloadUrl} className="text-sm underline underline-offset-4">
                        Scarica
                      </a>
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
                    <TableCell colSpan={canUpload ? 7 : 6} className="text-center text-slate-500">
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
