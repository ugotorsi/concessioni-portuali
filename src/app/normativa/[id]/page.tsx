import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { AmbitoNormaBadge, SeveritaImpattoBadge, StatoVersioneBadge } from "@/components/normativa/NormativaBadges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { canViewNormativa, requireRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getNormativaDetail } from "@/server/queries/normativa";

interface NormativaDetailPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function NormativaDetailPage({ params }: NormativaDetailPageProps) {
  const role = await requireRole();
  if (!canViewNormativa(role)) {
    return null;
  }

  const { id } = await params;
  const detail = await getNormativaDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <AppShell title={`Normativa ${detail.fonte.codice}`} subtitle="Dettaglio fonte, versioni e impatti cross-modulo">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{detail.fonte.titolo}</h1>
            <p className="mt-1 text-sm text-slate-600">{detail.fonte.codice}</p>
          </div>
          <Link href="/normativa" className="text-sm font-medium text-slate-700 underline underline-offset-4">
            Torna alla normativa
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Fonte normativa</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Codice</p>
              <p className="mt-1 font-semibold text-slate-900">{detail.fonte.codice}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ambito</p>
              <div className="mt-1">
                <AmbitoNormaBadge value={detail.fonte.ambito} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ente emittente</p>
              <p className="mt-1">{detail.fonte.enteEmittente ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Ultimo aggiornamento</p>
              <p className="mt-1">{formatDateIT(detail.fonte.updatedAt)}</p>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Descrizione</p>
              <p className="mt-1">{detail.fonte.descrizione ?? "-"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Versioni</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versione</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Entrata vigore</TableHead>
                  <TableHead>Fine vigore</TableHead>
                  <TableHead>Sintesi</TableHead>
                  <TableHead>Testo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.versioni.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold text-slate-900">{item.versione}</TableCell>
                    <TableCell>
                      <StatoVersioneBadge value={item.stato} />
                    </TableCell>
                    <TableCell>{formatDateIT(item.dataEntrataVigore)}</TableCell>
                    <TableCell>{item.dataFineVigore ? formatDateIT(item.dataFineVigore) : "-"}</TableCell>
                    <TableCell className="max-w-96 truncate">{item.sintesi}</TableCell>
                    <TableCell>
                      {item.urlTesto ? (
                        <a href={item.urlTesto} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                          Apri
                        </a>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {detail.versioni.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      Nessuna versione censita.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Impatti operativi</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modulo</TableHead>
                  <TableHead>Severita</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Azione richiesta</TableHead>
                  <TableHead>Link rapidi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.impatti.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatEnumLabel(item.modulo)}</TableCell>
                    <TableCell>
                      <SeveritaImpattoBadge value={item.severita} />
                    </TableCell>
                    <TableCell className="max-w-96 truncate">{item.descrizione}</TableCell>
                    <TableCell>{item.azioneRichiesta ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {item.concessione ? (
                          <Link href={`/concessioni/${item.concessione.id}`} className="text-xs underline underline-offset-4">
                            Concessione {item.concessione.numeroAtto}
                          </Link>
                        ) : null}
                        {item.criticita ? (
                          <Link href={`/criticita/${item.criticita.id}`} className="text-xs underline underline-offset-4">
                            Criticità {formatEnumLabel(item.criticita.tipologia)}
                          </Link>
                        ) : null}
                        {item.procedimento ? (
                          <Link href={`/procedimenti/${item.procedimento.id}`} className="text-xs underline underline-offset-4">
                            Procedimento {formatEnumLabel(item.procedimento.tipologia)}
                          </Link>
                        ) : null}
                        {item.report ? (
                          <Link href={`/report/${item.report.id}`} className="text-xs underline underline-offset-4">
                            Report
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {detail.impatti.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Nessun impatto mappato.
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
