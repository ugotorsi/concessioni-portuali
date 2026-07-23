import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { AppShell } from "@/components/layout/AppShell";
import { PagamentoStatoBadge, RitardoBadge } from "@/components/pagamenti/PagamentiBadges";
import { GravitaBadge, StatoBadge as CriticitaStatoBadge } from "@/components/criticita/CriticitaBadges";
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
import { BACKOFFICE_ROLES, canManagePagamenti, requireRole } from "@/lib/auth";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getPagamentoDetail } from "@/server/queries/pagamenti";

interface PagamentoDetailPageProps {
  params: Promise<{ id: string }>;
}

function getAzioneConsigliata(args: {
  stato: string;
  giorniRitardo: number | null;
  residuo: number;
}): string[] {
  const messages: string[] = [];

  if (args.stato === "NON_PAGATO" || args.stato === "SCADUTO") {
    messages.push(
      "Verificare posizione contabile, attivare sollecito/diffida e valutare recupero canoni con riferimento anche all art. 47 lett. d cod. nav.",
    );
  }

  if (args.stato === "PARZIALE") {
    messages.push("Verificare residuo, causali del pagamento parziale ed eventuali integrazioni dovute.");
  }

  if (args.stato === "PAGATO") {
    messages.push("Posizione regolare: mantenere tracciamento storico e completezza documentale.");
  }

  if (args.giorniRitardo !== null && args.giorniRitardo >= 60) {
    messages.push("Ritardo elevato: attribuire priorità istruttoria alta per chiusura della posizione.");
  }

  if (args.residuo > 0 && messages.length === 0) {
    messages.push("Residuo economico presente: programmare verifica contabile e piano di rientro.");
  }

  if (messages.length === 0) {
    messages.push("Proseguire con monitoraggio periodico della posizione economica.");
  }

  return messages;
}

export const dynamic = "force-dynamic";

export default async function PagamentoDetailPage({ params }: PagamentoDetailPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const { id } = await params;
  const detail = await getPagamentoDetail(id);

  if (!detail) {
    notFound();
  }

  const azioniConsigliate = getAzioneConsigliata({
    stato: detail.pagamento.stato,
    giorniRitardo: detail.pagamento.giorniRitardo,
    residuo: detail.pagamento.residuo,
  });

  const canEdit = canManagePagamenti(role);

  return (
    <AppShell
      title={`Pagamento ${detail.pagamento.annoRiferimento}`}
      subtitle="Scheda read-only economico-istruttoria della posizione di pagamento"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dettaglio pagamento</h1>
            <p className="mt-1 text-sm text-slate-600">Analisi economica e contesto concessorio a supporto istruttorio.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Link
                href={`/pagamenti/${detail.pagamento.id}/modifica`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Aggiorna pagamento
              </Link>
            ) : null}
            <Link href="/pagamenti" className="text-sm font-medium text-slate-700 underline underline-offset-4">
              Torna ai pagamenti
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header pagamento</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato pagamento</p>
              <div className="mt-1">
                <PagamentoStatoBadge value={detail.pagamento.stato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessione</p>
              <p className="mt-1 font-semibold text-slate-900">{detail.concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessionario</p>
              <p className="mt-1 text-slate-900">{detail.concessionario.denominazione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Anno</p>
              <p className="mt-1 text-slate-900">{detail.pagamento.annoRiferimento}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Residuo</p>
              <p className="mt-1 font-semibold text-rose-700">{formatCurrencyEUR(detail.pagamento.residuo)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Scadenza</p>
              <p className="mt-1 text-slate-900">{formatDateIT(detail.pagamento.dataScadenza)}</p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Dati pagamento</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Importo dovuto</p>
                <p className="mt-1">{formatCurrencyEUR(detail.pagamento.importoDovuto)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Importo versato</p>
                <p className="mt-1">{formatCurrencyEUR(detail.pagamento.importoVersato)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Interessi mora</p>
                <p className="mt-1">
                  {detail.pagamento.interessiMora !== null
                    ? formatCurrencyEUR(detail.pagamento.interessiMora)
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Data versamento</p>
                <p className="mt-1">
                  {detail.pagamento.dataVersamento ? formatDateIT(detail.pagamento.dataVersamento) : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Ritardo</p>
                <div className="mt-1">
                  <RitardoBadge giorniRitardo={detail.pagamento.giorniRitardo} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Note</p>
                <p className="mt-1">{detail.pagamento.note ?? "-"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Contesto concessorio</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
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
                <p className="text-xs uppercase tracking-wide text-slate-500">Data scadenza concessione</p>
                <p className="mt-1">{formatDateIT(detail.concessione.dataScadenza)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia bene</p>
                <p className="mt-1">{formatEnumLabel(detail.concessione.tipologiaBene)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Attività</p>
                <p className="mt-1">{formatEnumLabel(detail.concessione.attivita)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
                <p className="mt-1">
                  {detail.concessione.canoneAnnuo !== null
                    ? formatCurrencyEUR(detail.concessione.canoneAnnuo)
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Categoria canone</p>
                <p className="mt-1">{detail.concessione.categoriaCanone ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
                <p className="mt-1">{detail.concessione.ubicazione ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Scheda concessione</p>
                <Link
                  href={`/concessioni/${detail.concessione.id}`}
                  className="mt-1 inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
                >
                  Apri concessione
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>3. Criticità economiche/morosità collegate alla concessione</CardTitle>
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
                  {detail.criticitaEconomicheMorosita.map((item) => (
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
                  {detail.criticitaEconomicheMorosita.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna criticità economica/morosità collegata.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Scadenze rilevanti</CardTitle>
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
                        Nessuna scadenza rilevante collegata.
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
              <CardTitle>5. Procedimenti collegati</CardTitle>
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
                  {detail.procedimentiCollegati.map((item) => (
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
                  {detail.procedimentiCollegati.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun procedimento collegato.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <EntityDocumentsPanel
            title="6. Documenti principali"
            entityType="pagamento"
            entityId={detail.pagamento.id}
            documents={detail.documentiPrincipali}
            canUpload={canEdit}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Azione consigliata</CardTitle>
            <CardDescription>Indicazioni automatiche orientate a presidio economico-istruttorio.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {azioniConsigliate.map((item, index) => (
                <li key={`${index}-${item}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
