import Link from "next/link";
import { notFound } from "next/navigation";

import { GravitaBadge, StatoBadge as CriticitaStatoBadge } from "@/components/criticita/CriticitaBadges";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { AppShell } from "@/components/layout/AppShell";
import { PrintButton } from "@/components/report/PrintButton";
import { ReportTipologiaBadge, ReportValidatoBadge } from "@/components/report/ReportBadges";
import { ScadenzaStatoBadge } from "@/components/scadenze/ScadenzeBadges";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { BACKOFFICE_ROLES, canDownloadReportPdf, canValidateReport, requireRole } from "@/lib/auth";
import { getConcessionVerticalLabel, getLegalFrameworkLabel } from "@/lib/concession-vertical-labels";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { toggleReportValidationAction } from "@/server/actions/report";
import { getNormeForReport } from "@/server/queries/normativa";
import { getReportDetail, getReportPreviewOperativo } from "@/server/queries/report";

interface ReportDetailPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({ params }: ReportDetailPageProps) {
  const role = await requireRole();
  const { id } = await params;
  const detail = await getReportDetail(id);

  if (!detail) {
    notFound();
  }

  const preview = getReportPreviewOperativo({
    tipologia: detail.report.tipologia,
    validato: detail.report.validato,
  });

  const canToggleValidation = canValidateReport(role);
  const canDownloadPdf = canDownloadReportPdf(role, detail.report.validato);
  const canUploadDocumenti = BACKOFFICE_ROLES.includes(role);
  const normeCollegate = await getNormeForReport(detail.report.id);

  return (
    <AppShell
      title={`Report ${formatEnumLabel(detail.report.tipologia)}`}
      subtitle="Scheda reportistica read-only con contesto operativo e collegamenti ai moduli"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dettaglio report</h1>
            <p className="mt-1 text-sm text-slate-600">Output finale del servizio di monitoraggio a supporto delle istruttorie.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton />
            {canDownloadPdf ? (
              <Link
                href={`/report/${detail.report.id}/pdf`}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
              >
                Scarica PDF istituzionale
              </Link>
            ) : null}
            {canToggleValidation ? (
              <form action={toggleReportValidationAction}>
                <input type="hidden" name="id" value={detail.report.id} />
                <input type="hidden" name="validato" value={detail.report.validato ? "NO" : "SI"} />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  {detail.report.validato ? "Rimuovi validazione" : "Valida report"}
                </button>
              </form>
            ) : null}
            <Link
              href="/report"
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Torna ai report
            </Link>
            {detail.concessione ? (
              <Link
                href={`/concessioni/${detail.concessione.id}`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                Apri concessione
              </Link>
            ) : null}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header report</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
              <div className="mt-1">
                <ReportTipologiaBadge value={detail.report.tipologia} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Titolo</p>
              <p className="mt-1 text-slate-900">{detail.report.titolo}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Formato</p>
              <div className="mt-1">
                <Badge>{detail.report.formato}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Validato</p>
              <div className="mt-1">
                <ReportValidatoBadge value={detail.report.validato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data creazione</p>
              <p className="mt-1 text-slate-900">{formatDateIT(detail.report.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ultimo aggiornamento</p>
              <p className="mt-1 text-slate-900">{formatDateIT(detail.report.updatedAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessione collegata</p>
              <p className="mt-1 text-slate-900">{detail.concessione?.numeroAtto ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessionario</p>
              <p className="mt-1 text-slate-900">{detail.concessionario?.denominazione ?? "-"}</p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Contenuto report</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-slate-700">{detail.report.contenuto}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Preview operativa</CardTitle>
              <CardDescription>{preview.avvertenza}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Finalità</p>
                <p className="mt-1">{preview.finalita}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Destinatario operativo</p>
                <p className="mt-1">{preview.destinatarioOperativo}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Utilizzo consigliato</p>
                <p className="mt-1">{preview.utilizzoConsigliato}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Riferimenti normativi collegati</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Codice</TableHead>
                  <TableHead>Titolo</TableHead>
                  <TableHead>Ambito</TableHead>
                  <TableHead>Severita</TableHead>
                  <TableHead>Descrizione impatto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {normeCollegate.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold text-slate-900">{item.codice}</TableCell>
                    <TableCell className="max-w-80 truncate">{item.titolo}</TableCell>
                    <TableCell>{formatEnumLabel(item.ambito)}</TableCell>
                    <TableCell>{formatEnumLabel(item.severita)}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione}</TableCell>
                  </TableRow>
                ))}
                {normeCollegate.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Nessun riferimento normativo collegato al report.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {detail.concessione ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>3. Contesto concessorio</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Numero atto</p>
                  <p className="mt-1 font-semibold text-slate-900">{detail.concessione.numeroAtto}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato concessione</p>
                  <div className="mt-1">
                    <Badge>{formatEnumLabel(detail.concessione.stato)}</Badge>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Data rilascio</p>
                  <p className="mt-1">{formatDateIT(detail.concessione.dataRilascio)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Data scadenza</p>
                  <p className="mt-1">{formatDateIT(detail.concessione.dataScadenza)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia bene</p>
                  <p className="mt-1">{formatEnumLabel(detail.concessione.tipologiaBene)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Verticale concessione</p>
                  <div className="mt-1">
                    <Badge data-testid="report-concession-vertical">
                      {getConcessionVerticalLabel(detail.concessione.concessionVertical)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Attività</p>
                  <p className="mt-1">{formatEnumLabel(detail.concessione.attivita)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
                  <p className="mt-1">{detail.concessione.ubicazione ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
                  <p className="mt-1">
                    {detail.concessione.canoneAnnuo !== null
                      ? formatCurrencyEUR(detail.concessione.canoneAnnuo)
                      : "-"}
                  </p>
                </div>
                <div className="md:col-span-2 xl:col-span-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Framework normativi associati</p>
                  <div className="mt-1 flex flex-wrap gap-2" data-testid="report-concession-legal-frameworks">
                    {detail.concessione.legalFrameworks.length > 0 ? (
                      detail.concessione.legalFrameworks.map((item) => (
                        <Badge key={item}>{getLegalFrameworkLabel(item)}</Badge>
                      ))
                    ) : (
                      <span className="text-slate-500">Nessun framework normativo associato.</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>4. Criticità aperte</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gravità</TableHead>
                        <TableHead>Tipologia</TableHead>
                        <TableHead>Descrizione</TableHead>
                        <TableHead>Stato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.criticitaAperte.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <GravitaBadge value={item.gravita} />
                          </TableCell>
                          <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                          <TableCell className="max-w-80 truncate">{item.descrizione}</TableCell>
                          <TableCell>
                            <CriticitaStatoBadge value={item.stato} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {detail.criticitaAperte.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">
                            Nessuna criticità aperta collegata.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>5. Scadenze rilevanti</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Tipologia</TableHead>
                        <TableHead>Descrizione</TableHead>
                        <TableHead>Stato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.scadenzeRilevanti.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                          <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                          <TableCell className="max-w-80 truncate">{item.descrizione ?? "-"}</TableCell>
                          <TableCell>
                            <ScadenzaStatoBadge value={item.stato} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {detail.scadenzeRilevanti.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">
                            Nessuna scadenza aperta/scaduta collegata.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>6. Pagamenti critici</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Anno</TableHead>
                        <TableHead>Dovuto</TableHead>
                        <TableHead>Versato</TableHead>
                        <TableHead>Residuo</TableHead>
                        <TableHead>Stato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.pagamentiCritici.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.annoRiferimento}</TableCell>
                          <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                          <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                          <TableCell className="font-semibold text-rose-700">{formatCurrencyEUR(item.residuo)}</TableCell>
                          <TableCell>
                            <Badge>{formatEnumLabel(item.stato)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {detail.pagamentiCritici.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-slate-500">
                            Nessun pagamento critico collegato.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>7. Procedimenti in corso</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipologia</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>Avvio</TableHead>
                        <TableHead>Termine contraddittorio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.procedimentiInCorso.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                          <TableCell>
                            <Badge>{formatEnumLabel(item.stato)}</Badge>
                          </TableCell>
                          <TableCell>{item.dataAvvio ? formatDateIT(item.dataAvvio) : "-"}</TableCell>
                          <TableCell>
                            {item.dataScadenzaContraddittorio ? formatDateIT(item.dataScadenzaContraddittorio) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {detail.procedimentiInCorso.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">
                            Nessun procedimento in corso collegato.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>8. Sopralluoghi recenti</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Esito</TableHead>
                        <TableHead>Operatori</TableHead>
                        <TableHead>Conformità</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.sopralluoghiRecenti.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{formatDateIT(item.data)}</TableCell>
                          <TableCell>
                            <Badge>{formatEnumLabel(item.esito)}</Badge>
                          </TableCell>
                          <TableCell>{item.operatori}</TableCell>
                          <TableCell>
                            <Badge variant={item.conformitaPlanimetrica ? "success" : "danger"}>
                              {item.conformitaPlanimetrica ? "Conforme" : "Non conforme"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {detail.sopralluoghiRecenti.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">
                            Nessun sopralluogo recente disponibile.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <EntityDocumentsPanel
                title="9. Documenti principali"
                entityType="report"
                entityId={detail.report.id}
                documents={detail.documentiPrincipali}
                canUpload={canUploadDocumenti}
              />
            </section>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Contesto concessorio</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500">Report non collegato a una specifica concessione.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
