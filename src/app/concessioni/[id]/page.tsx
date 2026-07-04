import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { notFound } from "next/navigation";

import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { GravitaBadge, StatoBadge } from "@/components/concessioni/ConcessioniBadges";
import { AppShell } from "@/components/layout/AppShell";
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
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getConcessioneDetail } from "@/server/queries/concessioni";

interface ConcessioneDetailPageProps {
  params: Promise<{ id: string }>;
}

function yesNo(value: boolean): string {
  return value ? "Si" : "No";
}

export const dynamic = "force-dynamic";

export default async function ConcessioneDetailPage({ params }: ConcessioneDetailPageProps) {
  const role = await requireRole();
  const canUploadDocumenti = BACKOFFICE_ROLES.includes(role);
  const { id } = await params;
  const concessione = await getConcessioneDetail(id);

  if (!concessione) {
    notFound();
  }

  const today = startOfDay(new Date());
  const in90 = addDays(today, 90);

  const criticitaAperte = concessione.criticita.filter((item) =>
    ["APERTA", "IN_GESTIONE"].includes(item.stato),
  ).length;
  const criticitaUrgentiAlte = concessione.criticita.filter(
    (item) => ["URGENTE", "ALTA"].includes(item.gravita) && ["APERTA", "IN_GESTIONE"].includes(item.stato),
  ).length;
  const scadenzeAperteScadute = concessione.scadenze.filter((item) =>
    ["APERTA", "SCADUTA"].includes(item.stato),
  ).length;
  const pagamentiCritici = concessione.pagamenti.filter((item) =>
    ["NON_PAGATO", "PARZIALE", "SCADUTO"].includes(item.stato),
  ).length;
  const procedimentiInCorso = concessione.procedimenti.filter((item) =>
    ["DA_AVVIARE", "IN_CORSO"].includes(item.stato),
  ).length;
  const documentiCaricati = concessione.documenti.length;

  const hasScadenzeVicine = concessione.dataScadenza >= today && concessione.dataScadenza <= in90;
  const hasMorosita = concessione.pagamenti.some((item) => ["NON_PAGATO", "PARZIALE", "SCADUTO"].includes(item.stato));
  const hasRischioIstruttorio = concessione.criticita.some((item) =>
    ["RISCHIO_DECADENZA", "RISCHIO_REVOCA"].includes(item.tipologia),
  );

  const letturaOperativa: string[] = [];

  if (criticitaAperte > 0) {
    letturaOperativa.push(
        "La concessione richiede monitoraggio continuativo in quanto presenta criticità aperte o in gestione.",
    );
  }

  if (hasMorosita) {
    letturaOperativa.push(
        "Sono presenti morosità o pagamenti critici: valutare recupero canoni e, se necessario, azioni di diffida.",
    );
  }

  if (hasScadenzeVicine) {
    letturaOperativa.push(
        "La concessione risulta in scadenza entro 90 giorni: programmare attività per rinnovo o nuova procedura.",
    );
  }

  if (hasRischioIstruttorio) {
    letturaOperativa.push(
      "Sono emersi profili di rischio decadenza/revoca: opportuno supporto istruttorio dedicato con presidio giuridico-tecnico.",
    );
  }

  if (letturaOperativa.length === 0) {
    letturaOperativa.push(
      "Sulla base dei dati caricati la posizione appare regolare, fermo restando il monitoraggio periodico ordinario.",
    );
  }

  return (
    <AppShell
      title={`Concessione ${concessione.numeroAtto}`}
      subtitle="Scheda operativa read-only del rapporto concessorio"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Scheda concessione {concessione.numeroAtto}</h1>
            <p className="mt-1 text-sm text-slate-600">Dettaglio operativo read-only del rapporto concessorio.</p>
          </div>
          <Link href="/concessioni" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Torna all elenco concessioni
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header posizione</CardTitle>
            <CardDescription>Quadro identificativo principale della concessione.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Numero atto</p>
              <p className="mt-1 font-semibold text-slate-900">{concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessionario</p>
              <p className="mt-1 text-slate-900">{concessione.concessionario.denominazione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
              <div className="mt-1">
                <StatoBadge value={concessione.stato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Scadenza</p>
              <p className="mt-1 text-slate-900">{formatDateIT(concessione.dataScadenza)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Norma riferimento</p>
              <p className="mt-1 text-slate-900">{formatEnumLabel(concessione.normaRiferimento)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
              <p className="mt-1 text-slate-900">{concessione.ubicazione ?? "-"}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione bene</p>
              <p className="mt-1 text-slate-900">{concessione.descrizioneBene ?? "-"}</p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Quadro sintetico</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia bene</p>
                <p className="mt-1 text-slate-900">{formatEnumLabel(concessione.tipologiaBene)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Attivita</p>
                <p className="mt-1 text-slate-900">{formatEnumLabel(concessione.attivita)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Superficie</p>
                <p className="mt-1 text-slate-900">
                  {concessione.superficieMq !== null ? `${concessione.superficieMq.toLocaleString("it-IT")} mq` : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
                <p className="mt-1 text-slate-900">
                  {concessione.canoneAnnuo !== null ? formatCurrencyEUR(concessione.canoneAnnuo) : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Categoria canone</p>
                <p className="mt-1 text-slate-900">{concessione.categoriaCanone ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Data rilascio</p>
                <p className="mt-1 text-slate-900">{formatDateIT(concessione.dataRilascio)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Data scadenza</p>
                <p className="mt-1 text-slate-900">{formatDateIT(concessione.dataScadenza)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Coordinate GIS</p>
                <p className="mt-1 text-slate-900">
                  {concessione.latitudineGis !== null && concessione.longitudineGis !== null
                    ? `${concessione.latitudineGis.toFixed(4)}, ${concessione.longitudineGis.toFixed(4)}`
                    : concessione.coordinateGis ?? "-"}
                </p>
                <Link href="/mappa" className="mt-1 inline-flex text-xs font-medium text-slate-700 underline underline-offset-4">
                  Apri vista mappa
                </Link>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Area descrizione</p>
                <p className="mt-1 text-slate-900">{concessione.areaDescrizione ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Zona portuale</p>
                <p className="mt-1 text-slate-900">{concessione.zonaPortuale ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Riferimento catastale</p>
                <p className="mt-1 text-slate-900">{concessione.riferimentoCatastale ?? "-"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Indicatori</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Criticita aperte</p>
                <p className="text-2xl font-semibold text-rose-700">{criticitaAperte}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Criticita urgenti/alte</p>
                <p className="text-2xl font-semibold text-rose-700">{criticitaUrgentiAlte}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Scadenze aperte/scadute</p>
                <p className="text-2xl font-semibold text-amber-700">{scadenzeAperteScadute}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Pagamenti critici</p>
                <p className="text-2xl font-semibold text-rose-700">{pagamentiCritici}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Procedimenti in corso</p>
                <p className="text-2xl font-semibold text-amber-700">{procedimentiInCorso}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Documenti caricati</p>
                <p className="text-2xl font-semibold text-slate-900">{documentiCaricati}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Lettura operativa</CardTitle>
            <CardDescription>
              Indicazioni automatiche di presidio istruttorio basate sui dati correnti della concessione.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {letturaOperativa.map((item, index) => (
                <li key={`${index}-${item}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Obblighi concessori</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Frequenza</TableHead>
                  <TableHead>Prossima verifica</TableHead>
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {concessione.obblighi.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione}</TableCell>
                    <TableCell>{item.frequenza ? formatEnumLabel(item.frequenza) : "-"}</TableCell>
                    <TableCell>
                      {item.dataProssimaVerifica ? formatDateIT(item.dataProssimaVerifica) : "-"}
                    </TableCell>
                    <TableCell>
                      <StatoBadge value={item.stato} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scadenze</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Preavviso</TableHead>
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {concessione.scadenze.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione ?? "-"}</TableCell>
                    <TableCell>{item.preavvisoGiorni} gg</TableCell>
                    <TableCell>
                      <StatoBadge value={item.stato} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Criticita</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravita</TableHead>
                  <TableHead>Tipologia</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Rif. normativo</TableHead>
                  <TableHead>Data rilevazione</TableHead>
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {concessione.criticita.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <GravitaBadge value={item.gravita} />
                    </TableCell>
                    <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione}</TableCell>
                    <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                    <TableCell>{formatDateIT(item.dataRilevazione)}</TableCell>
                    <TableCell>
                      <StatoBadge value={item.stato} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pagamenti</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anno</TableHead>
                  <TableHead>Dovuto</TableHead>
                  <TableHead>Versato</TableHead>
                  <TableHead>Residuo</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Versamento</TableHead>
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {concessione.pagamenti.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.annoRiferimento}</TableCell>
                    <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                    <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                    <TableCell className="font-semibold text-rose-700">{formatCurrencyEUR(item.residuo)}</TableCell>
                    <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                    <TableCell>{item.dataVersamento ? formatDateIT(item.dataVersamento) : "-"}</TableCell>
                    <TableCell>
                      <StatoBadge value={item.stato} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <EntityDocumentsPanel
            title="Documenti"
            entityType="concessione"
            entityId={concessione.id}
            documents={concessione.documenti}
            canUpload={canUploadDocumenti}
          />

          <Card>
            <CardHeader>
              <CardTitle>Sopralluoghi</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Esito</TableHead>
                    <TableHead>Operatori</TableHead>
                    <TableHead>Conformita planimetrica</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concessione.sopralluoghi.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatDateIT(item.data)}</TableCell>
                      <TableCell>
                        <Badge variant={item.esito === "NEGATIVO" ? "danger" : item.esito === "CON_RILIEVI" ? "warning" : "success"}>
                          {formatEnumLabel(item.esito)}
                        </Badge>
                      </TableCell>
                      <TableCell>{item.operatori}</TableCell>
                      <TableCell>{yesNo(item.conformitaPlanimetrica)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Procedimenti</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Termine contraddittorio</TableHead>
                    <TableHead>Rif. normativo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concessione.procedimenti.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>
                        <StatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell>
                        {item.dataScadenzaContraddittorio ? formatDateIT(item.dataScadenzaContraddittorio) : "-"}
                      </TableCell>
                      <TableCell>{item.riferimentoNormativo ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Report</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titolo</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Validato</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concessione.report.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-72 truncate">{item.titolo}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>{item.formato}</TableCell>
                      <TableCell>
                        <Badge variant={item.validato ? "success" : "warning"}>{item.validato ? "Validato" : "Da validare"}</Badge>
                      </TableCell>
                      <TableCell>{formatDateIT(item.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
