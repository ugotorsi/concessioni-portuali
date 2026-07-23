import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { GravitaBadge, StatoBadge as CriticitaStatoBadge } from "@/components/criticita/CriticitaBadges";
import { AppShell } from "@/components/layout/AppShell";
import { ScadenzaStatoBadge } from "@/components/scadenze/ScadenzeBadges";
import { ConformitaBadge, EsitoSopralluogoBadge, ProblemaTecnicoBadge } from "@/components/sopralluoghi/SopralluoghiBadges";
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
import { BACKOFFICE_ROLES, canManageCriticita, requireRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getLetturaTecnicaSopralluogo, getSopralluogoDetail } from "@/server/queries/sopralluoghi";

interface SopralluogoDetailPageProps {
  params: Promise<{ id: string }>;
}

function hasIssueText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();
  if (lower.includes("ok") || lower.includes("regolare") || lower.includes("nessuna")) {
    return false;
  }

  return [
    "critic",
    "risch",
    "elevat",
    "non conform",
    "difform",
    "manc",
    "inadegu",
    "violaz",
    "interferenz",
    "ostru",
    "sicurez",
    "occupaz",
  ].some((token) => lower.includes(token));
}

export const dynamic = "force-dynamic";

export default async function SopralluogoDetailPage({ params }: SopralluogoDetailPageProps) {
  const role = await requireRole(BACKOFFICE_ROLES);
  const { id } = await params;
  const detail = await getSopralluogoDetail(id);

  if (!detail) {
    notFound();
  }

  const letturaTecnica = getLetturaTecnicaSopralluogo({
    esito: detail.sopralluogo.esito,
    conformitaPlanimetrica: detail.sopralluogo.conformitaPlanimetrica,
    sicurezza: detail.sopralluogo.sicurezza,
    occupazione: detail.sopralluogo.occupazione,
    interferenze: detail.sopralluogo.interferenze,
  });

  const canOpenCriticita =
    canManageCriticita(role) &&
    (detail.sopralluogo.esito === "NEGATIVO" || detail.sopralluogo.esito === "CON_RILIEVI");

  return (
    <AppShell
      title={`Sopralluogo ${formatDateIT(detail.sopralluogo.data)}`}
      subtitle="Scheda tecnica read-only per analisi esito e supporto istruttorio"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dettaglio sopralluogo</h1>
            <p className="mt-1 text-sm text-slate-600">Analisi tecnica dello stato dei luoghi e delle prescrizioni collegate.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canOpenCriticita ? (
              <Link
                href={`/criticita/nuova?concessioneId=${detail.concessione.id}&fonte=SOPRALLUOGO&tipologia=TECNICA`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Apri criticità da sopralluogo
              </Link>
            ) : null}
            <Link href="/sopralluoghi" className="text-sm font-medium text-slate-700 underline underline-offset-4">
              Torna ai sopralluoghi
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header sopralluogo</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Esito</p>
              <div className="mt-1">
                <EsitoSopralluogoBadge value={detail.sopralluogo.esito} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Data</p>
              <p className="mt-1 text-slate-900">{formatDateIT(detail.sopralluogo.data)}</p>
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
              <p className="text-xs uppercase tracking-wide text-slate-500">Operatori</p>
              <p className="mt-1 text-slate-900">{detail.sopralluogo.operatori}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Area/Bene</p>
              <p className="mt-1 text-slate-900">
                {formatEnumLabel(detail.concessione.tipologiaBene)} - {detail.concessione.ubicazione ?? "-"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Localizzazione GIS</p>
              <p className="mt-1 text-slate-900">
                {detail.sopralluogo.latitudineGis !== null && detail.sopralluogo.longitudineGis !== null
                  ? `${detail.sopralluogo.latitudineGis.toFixed(4)}, ${detail.sopralluogo.longitudineGis.toFixed(4)}`
                  : detail.concessione.latitudineGis !== null && detail.concessione.longitudineGis !== null
                    ? `${detail.concessione.latitudineGis.toFixed(4)}, ${detail.concessione.longitudineGis.toFixed(4)}`
                    : detail.concessione.coordinateGis ?? "-"}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {detail.sopralluogo.localizzazioneDescrizione ?? detail.concessione.areaDescrizione ?? "Localizzazione descrittiva non disponibile."}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Zona: {detail.concessione.zonaPortuale ?? "-"} | Rif. catastale: {detail.concessione.riferimentoCatastale ?? "-"}
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
              <CardTitle>1. Dati sopralluogo</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Conformità planimetrica</p>
                <div className="mt-1">
                  <ConformitaBadge value={detail.sopralluogo.conformitaPlanimetrica} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Stato manutentivo</p>
                <p className="mt-1">{detail.sopralluogo.statoManutentivo ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Sicurezza</p>
                <div className="mt-1 flex items-center gap-2">
                  <ProblemaTecnicoBadge hasIssue={hasIssueText(detail.sopralluogo.sicurezza)} />
                  <span>{detail.sopralluogo.sicurezza ?? "-"}</span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Occupazione</p>
                <div className="mt-1 flex items-center gap-2">
                  <ProblemaTecnicoBadge hasIssue={hasIssueText(detail.sopralluogo.occupazione)} />
                  <span>{detail.sopralluogo.occupazione ?? "-"}</span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Interferenze</p>
                <div className="mt-1 flex items-center gap-2">
                  <ProblemaTecnicoBadge hasIssue={hasIssueText(detail.sopralluogo.interferenze)} />
                  <span>{detail.sopralluogo.interferenze ?? "-"}</span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione</p>
                <p className="mt-1">{detail.sopralluogo.descrizione ?? "-"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Esito tecnico</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Esito</p>
                <div className="mt-1">
                  <EsitoSopralluogoBadge value={detail.sopralluogo.esito} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Conformità planimetrica</p>
                <div className="mt-1">
                  <ConformitaBadge value={detail.sopralluogo.conformitaPlanimetrica} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Data aggiornamento</p>
                <p className="mt-1">{formatDateIT(detail.sopralluogo.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>3. Contesto concessorio</CardTitle>
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
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipologia bene</p>
              <p className="mt-1">{formatEnumLabel(detail.concessione.tipologiaBene)}</p>
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

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>4. Criticità aperte della concessione</CardTitle>
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
          <EntityDocumentsPanel
            title="6. Documenti principali"
            entityType="sopralluogo"
            entityId={detail.sopralluogo.id}
            documents={detail.documentiPrincipali}
            canUpload={true}
          />

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

        <Card>
          <CardHeader>
            <CardTitle>Lettura tecnica e azione consigliata</CardTitle>
            <CardDescription>
              La piattaforma supporta la verifica istruttoria e non sostituisce le determinazioni dell'Autorità.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Qualificazione tecnica</p>
              <p className="mt-1">{letturaTecnica.qualificazioneTecnica}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Livello attenzione</p>
              <p className="mt-1 font-semibold text-slate-900">{letturaTecnica.livelloAttenzione}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Azione consigliata</p>
              <p className="mt-1">{letturaTecnica.azioneConsigliata}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Collegamento a criticità</p>
              <p className="mt-1">{letturaTecnica.collegamentoCriticita}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
