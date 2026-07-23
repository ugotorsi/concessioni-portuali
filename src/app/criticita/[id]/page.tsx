import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { GravitaBadge, StatoBadge, TipologiaBadge } from "@/components/criticita/CriticitaBadges";
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
import {
  BACKOFFICE_ROLES,
  canManageCriticita,
  canManageProcedimenti,
  requireRole,
} from "@/lib/auth";
import {
  getArt47Description,
  getArt47RiskNoteWithRegolarizzazione,
  getArt47Label,
  getEsitoRegolarizzazioneDescription,
  getEsitoRegolarizzazioneLabel,
  getRegolarizzazioneBadgeVariant,
  getRischioDecadenzaBadgeVariant,
  getRischioDecadenzaLabel,
  hasRegolarizzazioneIstruttoriaRilevante,
} from "@/lib/art47";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getCriticitaDetail, getCriticitaIstruttoria } from "@/server/queries/criticita";
import { getNormeForCriticita } from "@/server/queries/normativa";

interface CriticitaDetailPageProps {
  params: Promise<{ id: string }>;
}

function yesNo(value: boolean): string {
  return value ? "Sì" : "No";
}

function buildPrioritaOperativa(args: {
  gravita: string;
  tipologia: string;
  stato: string;
}): string[] {
  const messages: string[] = [];

  if (args.gravita === "URGENTE") {
    messages.push("Criticità a trattazione prioritaria con presidio immediato dei passaggi istruttori.");
  } else if (args.gravita === "ALTA") {
    messages.push("Criticità ad alta priorità: pianificare verifica istruttoria in tempi brevi.");
  }

  if (args.tipologia === "MOROSITA") {
    messages.push("Valutare recupero canoni e possibile diffida in relazione allo stato dei pagamenti.");
  }

  if (args.tipologia === "RISCHIO_DECADENZA") {
    messages.push(
      "Verificare presupposti, gravità, contraddittorio e proporzionalità prima di eventuali proposte istruttorie.",
    );
  }

  if (args.tipologia === "RISCHIO_REVOCA") {
    messages.push("Verificare interesse pubblico sopravvenuto e impatto economico della misura.");
  }

  if (args.tipologia === "OCCUPAZIONE_DIFFORME") {
    messages.push("Verificare planimetrie, perimetro assentito e riscontro sopralluogo con documentazione fotografica.");
  }

  if (["RISOLTA", "ARCHIVIATA"].includes(args.stato)) {
    messages.push("Posizione in esito: mantenere tracciamento storico e completezza documentale.");
  }

  if (messages.length === 0) {
    messages.push("Monitorare la posizione con verifiche periodiche in base allo stato procedimentale.");
  }

  return messages;
}

export const dynamic = "force-dynamic";

export default async function CriticitaDetailPage({ params }: CriticitaDetailPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const { id } = await params;

  const criticita = await getCriticitaDetail(id);
  if (!criticita) {
    notFound();
  }

  const istruttoria = getCriticitaIstruttoria({
    tipologia: criticita.tipologia,
    gravita: criticita.gravita,
    stato: criticita.stato,
    riferimentoNormativo: criticita.riferimentoNormativo,
    azioneConsigliata: criticita.azioneConsigliata,
  });

  const prioritaOperativa = buildPrioritaOperativa({
    gravita: criticita.gravita,
    tipologia: criticita.tipologia,
    stato: criticita.stato,
  });
  const normeCollegate = await getNormeForCriticita(criticita.id);
  const regolarizzazioneRilevante = hasRegolarizzazioneIstruttoriaRilevante(criticita);
  const notaArt47Regolarizzazione = getArt47RiskNoteWithRegolarizzazione(criticita);

  const canEdit = canManageCriticita(role);
  const canStartProcedimento = canManageProcedimenti(role);

  return (
    <AppShell
      title={`Criticità ${formatEnumLabel(criticita.tipologia)}`}
      subtitle="Scheda operativa read-only orientata a rischio, norma e azione istruttoria"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dettaglio criticità</h1>
            <p className="mt-1 text-sm text-slate-600">Analisi contestuale e supporto istruttorio operativo.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Link
                href={`/criticita/${criticita.id}/modifica`}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Modifica criticità
              </Link>
            ) : null}
            {canStartProcedimento ? (
              <Link
                href={`/procedimenti/nuovo?concessioneId=${criticita.concessione.id}&criticitaId=${criticita.id}`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Avvia procedimento
              </Link>
            ) : null}
            <Link href="/criticita" className="text-sm font-medium text-slate-700 underline underline-offset-4">
              Torna al registro criticità
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header criticità</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Gravità</p>
              <div className="mt-1">
                <GravitaBadge value={criticita.gravita} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia</p>
              <div className="mt-1">
                <TipologiaBadge value={criticita.tipologia} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
              <div className="mt-1">
                <StatoBadge value={criticita.stato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Fonte</p>
              <p className="mt-1 text-slate-900">{formatEnumLabel(criticita.fonte)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data rilevazione</p>
              <p className="mt-1 text-slate-900">{formatDateIT(criticita.dataRilevazione)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessione collegata</p>
              <p className="mt-1 font-semibold text-slate-900">{criticita.concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Concessionario</p>
              <p className="mt-1 text-slate-900">{criticita.concessione.concessionario.denominazione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Riferimento normativo</p>
              <p className="mt-1 text-slate-900">{criticita.riferimentoNormativo ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Localizzazione GIS</p>
              <p className="mt-1 text-slate-900">
                {criticita.latitudineGis !== null && criticita.longitudineGis !== null
                  ? `${criticita.latitudineGis.toFixed(4)}, ${criticita.longitudineGis.toFixed(4)}`
                  : criticita.concessione.latitudineGis !== null && criticita.concessione.longitudineGis !== null
                    ? `${criticita.concessione.latitudineGis.toFixed(4)}, ${criticita.concessione.longitudineGis.toFixed(4)}`
                    : criticita.concessione.coordinateGis ?? "-"}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {criticita.localizzazioneDescrizione ?? criticita.concessione.areaDescrizione ?? "Localizzazione descrittiva non disponibile."}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Zona: {criticita.concessione.zonaPortuale ?? "-"} | Rif. catastale: {criticita.concessione.riferimentoCatastale ?? "-"}
              </p>
              <Link href="/mappa" className="mt-1 inline-flex text-xs font-medium text-slate-700 underline underline-offset-4">
                Apri vista mappa
              </Link>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Descrizione e azione consigliata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione</p>
                <p className="mt-1">{criticita.descrizione}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Azione consigliata</p>
                <p className="mt-1">{criticita.azioneConsigliata ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Riferimento normativo</p>
                <p className="mt-1">{criticita.riferimentoNormativo ?? "-"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lettura istruttoria</CardTitle>
              <CardDescription>
                Supporto decisionale interno: la valutazione finale resta in capo all'Autorità competente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Qualificazione operativa</p>
                <p className="mt-1">{istruttoria.qualificazioneOperativa}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Livello attenzione</p>
                <p className="mt-1 font-semibold text-slate-900">{istruttoria.livelloAttenzione}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Riferimento normativo suggerito</p>
                <p className="mt-1">{istruttoria.riferimentoNormativoSuggerito}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Azione istruttoria consigliata</p>
                <p className="mt-1">{istruttoria.azioneIstruttoriaConsigliata}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {istruttoria.avvertenza}
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Mapping art. 47 Cod. Nav.</CardTitle>
            <CardDescription>
              Sezione di supporto istruttorio interno: non sostituisce la valutazione provvedimentale dell'Autorità.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Rilevanza art. 47</p>
              <div className="mt-1">
                <Badge variant={criticita.rilevanzaArt47 ? "danger" : "default"}>
                  {criticita.rilevanzaArt47 ? "Rilevante" : "Non rilevante"}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Lettera</p>
              <p className="mt-1 text-slate-900">{getArt47Label(criticita.letteraArt47)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Rischio decadenza</p>
              <div className="mt-1">
                <Badge variant={getRischioDecadenzaBadgeVariant(criticita.rischioDecadenza)}>
                  {getRischioDecadenzaLabel(criticita.rischioDecadenza)}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione fattispecie</p>
              <p className="mt-1 text-slate-900">{getArt47Description(criticita.letteraArt47)}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Motivazione istruttoria art. 47</p>
              <p className="mt-1 text-slate-900">{criticita.motivazioneArt47 ?? "-"}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Azione istruttoria art. 47</p>
              <p className="mt-1 text-slate-900">{criticita.azioneIstruttoriaArt47 ?? "-"}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Nota istruttoria su regolarizzazione</p>
              <p className="mt-1 text-slate-900">{notaArt47Regolarizzazione}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regolarizzazione / sanatoria</CardTitle>
            <CardDescription>
              La regolarizzazione incide sulla valutazione istruttoria ma non determina automaticamente l'esclusione di misure decadenziali.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato regolarizzazione</p>
              <div className="mt-1">
                <Badge variant={criticita.regolarizzata ? "success" : "default"}>
                  {criticita.regolarizzata ? "Regolarizzata" : "Non regolarizzata"}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Esito</p>
              <div className="mt-1">
                <Badge variant={getRegolarizzazioneBadgeVariant(criticita.esitoRegolarizzazione)}>
                  {getEsitoRegolarizzazioneLabel(criticita.esitoRegolarizzazione)}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data regolarizzazione</p>
              <p className="mt-1 text-slate-900">{criticita.dataRegolarizzazione ? formatDateIT(criticita.dataRegolarizzazione) : "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Verifica regolarizzazione</p>
              <div className="mt-1">
                <Badge variant={criticita.verificataRegolarizzazione ? "success" : "warning"}>
                  {criticita.verificataRegolarizzazione ? "Verificata" : "Da verificare"}
                </Badge>
              </div>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione regolarizzazione</p>
              <p className="mt-1 text-slate-900">{criticita.descrizioneRegolarizzazione ?? "-"}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione esito</p>
              <p className="mt-1 text-slate-900">{getEsitoRegolarizzazioneDescription(criticita.esitoRegolarizzazione)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data verifica</p>
              <p className="mt-1 text-slate-900">{criticita.dataVerificaRegolarizzazione ? formatDateIT(criticita.dataVerificaRegolarizzazione) : "-"}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Note verifica</p>
              <p className="mt-1 text-slate-900">{criticita.noteVerificaRegolarizzazione ?? "-"}</p>
            </div>
            {regolarizzazioneRilevante ? (
              <div className="md:col-span-2 xl:col-span-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Presenza di elementi di regolarizzazione utili al fascicolo istruttorio. Valutare proporzionalità e tenuta giuridica senza automatismi.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contesto concessorio</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Numero atto</p>
              <p className="mt-1 font-semibold text-slate-900">{criticita.concessione.numeroAtto}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Stato concessione</p>
              <div className="mt-1">
                <StatoBadge value={criticita.concessione.stato} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Scadenza</p>
              <p className="mt-1 text-slate-900">{formatDateIT(criticita.concessione.dataScadenza)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Bene/Area</p>
              <p className="mt-1 text-slate-900">{formatEnumLabel(criticita.concessione.tipologiaBene)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ubicazione</p>
              <p className="mt-1 text-slate-900">{criticita.concessione.ubicazione ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Canone annuo</p>
              <p className="mt-1 text-slate-900">
                {criticita.concessione.canoneAnnuo !== null
                  ? formatCurrencyEUR(criticita.concessione.canoneAnnuo)
                  : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Categoria canone</p>
              <p className="mt-1 text-slate-900">{criticita.concessione.categoriaCanone ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Scheda concessione</p>
              <Link
                href={`/concessioni/${criticita.concessione.id}`}
                className="mt-1 inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
              >
                Apri concessione
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Priorità operativa</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {prioritaOperativa.map((item, index) => (
                <li key={`${index}-${item}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
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
                      Nessun riferimento normativo collegato alla criticità.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Procedimenti collegati</CardTitle>
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
                  {criticita.procedimenti.map((item) => (
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
                  {criticita.procedimenti.length === 0 ? (
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

          <Card>
            <CardHeader>
              <CardTitle>Pagamenti critici della concessione</CardTitle>
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
                    <TableHead>Scadenza</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {criticita.pagamentiCritici.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.annoRiferimento}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoDovuto)}</TableCell>
                      <TableCell>{formatCurrencyEUR(item.importoVersato)}</TableCell>
                      <TableCell className="font-semibold text-rose-700">{formatCurrencyEUR(item.residuo)}</TableCell>
                      <TableCell>
                        <StatoBadge value={item.stato} />
                      </TableCell>
                      <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                    </TableRow>
                  ))}
                  {criticita.pagamentiCritici.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">
                        Nessun pagamento critico rilevato.
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
              <CardTitle>Scadenze aperte/scadute della concessione</CardTitle>
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
                  {criticita.scadenzeCritiche.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatDateIT(item.dataScadenza)}</TableCell>
                      <TableCell>{formatEnumLabel(item.tipologia)}</TableCell>
                      <TableCell className="max-w-80 truncate">{item.descrizione ?? "-"}</TableCell>
                      <TableCell>
                        <StatoBadge value={item.stato} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {criticita.scadenzeCritiche.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Nessuna scadenza critica collegata.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <EntityDocumentsPanel
            title="Documenti principali"
            entityType="criticita"
            entityId={criticita.id}
            documents={criticita.documenti}
            canUpload={canEdit}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Sopralluoghi recenti</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Esito</TableHead>
                  <TableHead>Operatori</TableHead>
                    <TableHead>Conformità planimetrica</TableHead>
                  <TableHead>Descrizione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {criticita.sopralluoghiRecenti.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDateIT(item.data)}</TableCell>
                    <TableCell>
                      <Badge variant={item.esito === "NEGATIVO" ? "danger" : item.esito === "CON_RILIEVI" ? "warning" : "success"}>
                        {formatEnumLabel(item.esito)}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.operatori}</TableCell>
                    <TableCell>{yesNo(item.conformitaPlanimetrica)}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione ?? "-"}</TableCell>
                  </TableRow>
                ))}
                {criticita.sopralluoghiRecenti.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Nessun sopralluogo recente disponibile.
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
