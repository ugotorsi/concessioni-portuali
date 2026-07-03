import Link from "next/link";
import { notFound } from "next/navigation";

import { GravitaBadge, StatoBadge as CriticitaStatoBadge } from "@/components/criticita/CriticitaBadges";
import { AppShell } from "@/components/layout/AppShell";
import {
  ProcedimentoGiorniBadge,
  ProcedimentoStatoBadge,
  ProcedimentoTipologiaBadge,
} from "@/components/procedimenti/ProcedimentiBadges";
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
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getLetturaProcedimentale, getProcedimentoDetail } from "@/server/queries/procedimenti";
import { getNormeForProcedimento } from "@/server/queries/normativa";

interface ProcedimentoDetailPageProps {
  params: Promise<{ id: string }>;
}

function getChecklistItems(tipologia: string): string[] {
  if (tipologia === "AVVIO_DECADENZA") {
    return [
      "Individuazione obbligo violato",
      "Qualificazione fattispecie art. 47 cod. nav.",
      "Raccolta evidenze documentali",
      "Eventuale sopralluogo",
      "Comunicazione avvio procedimento",
      "Termine per controdeduzioni",
      "Valutazione memorie",
      "Verifica proporzionalita",
      "Eventuale parere Comitato Portuale ove necessario",
      "Proposta conclusiva agli uffici competenti",
    ];
  }

  if (tipologia === "AVVIO_REVOCA") {
    return [
      "Individuazione interesse pubblico",
      "Verifica durata concessione",
      "Verifica opere e possibile indennizzo",
      "Raccolta documentazione",
      "Comunicazione avvio procedimento",
      "Valutazione osservazioni",
      "Proposta conclusiva",
    ];
  }

  if (tipologia === "RECUPERO_CANONI") {
    return [
      "Verifica titolo",
      "Ricostruzione importi dovuti",
      "Verifica pagamenti ricevuti",
      "Calcolo residuo",
      "Sollecito/diffida",
      "Eventuale procedimento successivo",
    ];
  }

  if (tipologia === "ORDINE_RIPRISTINO") {
    return [
      "Verifica difformita",
      "Confronto planimetrie",
      "Sopralluogo/foto",
      "Riferimento art. 54 cod. nav.",
      "Termine per ripristino",
      "Verifica adempimento",
    ];
  }

  if (tipologia === "NUOVA_PROCEDURA") {
    return [
      "Verifica stato bene",
      "Storico criticità",
      "Valore economico",
      "Clausole tecniche",
      "Clausole manutentive",
      "Criteri di valutazione",
      "Schema avviso/bando",
    ];
  }

  return [
    "Raccolta documenti",
    "Verifica titolo",
    "Comunicazione o richiesta chiarimenti",
    "Termine riscontro",
    "Valutazione esiti",
    "Proposta conclusiva",
  ];
}

export const dynamic = "force-dynamic";

export default async function ProcedimentoDetailPage({ params }: ProcedimentoDetailPageProps) {
  const { id } = await params;
  const detail = await getProcedimentoDetail(id);

  if (!detail) {
    notFound();
  }

  const checklist = getChecklistItems(detail.procedimento.tipologia);

  const lettura = getLetturaProcedimentale({
    tipologia: detail.procedimento.tipologia,
    stato: detail.procedimento.stato,
    riferimentoNormativo: detail.procedimento.riferimentoNormativo,
    giorniRitardoContraddittorio: detail.procedimento.giorniRitardoContraddittorio,
  });
  const normeCollegate = await getNormeForProcedimento(detail.procedimento.id);

  return (
    <AppShell
      title={`Procedimento ${formatEnumLabel(detail.procedimento.tipologia)}`}
      subtitle="Scheda procedimentale read-only orientata a checklist e lettura istruttoria"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dettaglio procedimento</h1>
            <p className="mt-1 text-sm text-slate-600">Quadro istruttorio con collegamenti a criticità, pagamenti, sopralluoghi e scadenze.</p>
          </div>
          <Link href="/procedimenti" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Torna ai procedimenti
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header procedimento</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
              <div className="mt-1">
                <ProcedimentoTipologiaBadge value={detail.procedimento.tipologia} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
              <div className="mt-1">
                <ProcedimentoStatoBadge value={detail.procedimento.stato} />
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
              <p className="text-xs uppercase tracking-wide text-slate-500">Riferimento normativo</p>
              <p className="mt-1 text-slate-900">{detail.procedimento.riferimentoNormativo ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data avvio</p>
              <p className="mt-1 text-slate-900">
                {detail.procedimento.dataAvvio ? formatDateIT(detail.procedimento.dataAvvio) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Termine contraddittorio</p>
              <p className="mt-1 text-slate-900">
                {detail.procedimento.dataScadenzaContraddittorio
                  ? formatDateIT(detail.procedimento.dataScadenzaContraddittorio)
                  : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data provvedimento finale</p>
              <p className="mt-1 text-slate-900">
                {detail.procedimento.dataProvvedimentoFinale
                  ? formatDateIT(detail.procedimento.dataProvvedimentoFinale)
                  : "-"}
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Dati procedimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
                <p className="mt-1">{formatEnumLabel(detail.procedimento.tipologia)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
                <div className="mt-1">
                  <ProcedimentoStatoBadge value={detail.procedimento.stato} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Giorni contraddittorio</p>
                <div className="mt-1">
                  <ProcedimentoGiorniBadge
                    giorniResiduiContraddittorio={detail.procedimento.giorniResiduiContraddittorio}
                    giorniRitardoContraddittorio={detail.procedimento.giorniRitardoContraddittorio}
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Note istruttorie</p>
                <p className="mt-1">{detail.procedimento.noteIstruttorie ?? "-"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Checklist istruttoria</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-slate-700">
                {checklist.map((item, index) => (
                  <li key={`${index}-${item}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>3. Lettura procedimentale e azione consigliata</CardTitle>
            <CardDescription>{lettura.avvertenza}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Qualificazione procedimentale</p>
              <p className="mt-1">{lettura.qualificazioneProcedimentale}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Livello attenzione</p>
              <p className="mt-1 font-semibold text-slate-900">{lettura.livelloAttenzione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Passaggi istruttori consigliati</p>
              <p className="mt-1">{lettura.passaggiIstruttoriConsigliati}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Riferimenti normativi suggeriti</p>
              <p className="mt-1">{lettura.riferimentiNormativiSuggeriti}</p>
            </div>
          </CardContent>
        </Card>

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
                  <TableHead>Impatto</TableHead>
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
                      Nessun riferimento normativo collegato al procedimento.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Contesto concessorio</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
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
              <p className="text-xs uppercase tracking-wide text-slate-500">Bene/Area</p>
              <p className="mt-1">{formatEnumLabel(detail.concessione.tipologiaBene)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Attivita</p>
              <p className="mt-1">{formatEnumLabel(detail.concessione.attivita)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
              <p className="mt-1">{detail.concessione.ubicazione ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
              <p className="mt-1">
                {detail.concessione.canoneAnnuo !== null ? formatCurrencyEUR(detail.concessione.canoneAnnuo) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Categoria canone</p>
              <p className="mt-1">{detail.concessione.categoriaCanone ?? "-"}</p>
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

        <Card>
          <CardHeader>
            <CardTitle>5. Criticità collegata</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.criticitaCollegata ? (
              <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
                  <p className="mt-1">{formatEnumLabel(detail.criticitaCollegata.tipologia)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Gravita</p>
                  <div className="mt-1">
                    <GravitaBadge value={detail.criticitaCollegata.gravita} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
                  <div className="mt-1">
                    <CriticitaStatoBadge value={detail.criticitaCollegata.stato} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Data rilevazione</p>
                  <p className="mt-1">{formatDateIT(detail.criticitaCollegata.dataRilevazione)}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione</p>
                  <p className="mt-1">{detail.criticitaCollegata.descrizione}</p>
                </div>
                <div className="md:col-span-2">
                  <Link
                    href={`/criticita/${detail.criticitaCollegata.id}`}
                    className="inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
                  >
                    Apri criticità collegata
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nessuna criticita collegata al procedimento.</p>
            )}
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>6. Altre criticità aperte della concessione</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gravita</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.altreCriticitaAperte.map((item) => (
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
                  {detail.altreCriticitaAperte.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna ulteriore criticita aperta.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>7. Pagamenti critici</CardTitle>
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
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>8. Scadenze rilevanti</CardTitle>
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
                        Nessuna scadenza rilevante.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>9. Sopralluoghi recenti</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Esito</TableHead>
                    <TableHead>Operatori</TableHead>
                    <TableHead>Conformita</TableHead>
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
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>10. Documenti principali</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.documentiPrincipali.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-80 truncate">{item.nome}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>{item.dataDocumento ? formatDateIT(item.dataDocumento) : formatDateIT(item.createdAt)}</TableCell>
                      <TableCell>
                        <a href={item.url} className="text-sm underline underline-offset-4" target="_blank" rel="noreferrer">
                          Apri
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.documentiPrincipali.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun documento principale disponibile.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>11. Report collegati</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titolo</TableHead>
                    <TableHead>Tipologia</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Validato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.reportCollegati.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-80 truncate">{item.titolo}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell>{item.formato}</TableCell>
                      <TableCell>
                        <Badge variant={item.validato ? "success" : "warning"}>
                          {item.validato ? "Validato" : "Da validare"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.reportCollegati.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessun report collegato disponibile.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
