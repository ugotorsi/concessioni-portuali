import Link from "next/link";
import { FileText, Paperclip } from "lucide-react";

import { FascicoloShell, type FascicoloOverviewModel } from "@/components/procedimenti/FascicoloShell";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { getConcessionVerticalLabel } from "@/lib/concession-vertical-labels";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { uploadFascicoloIntakeDocumentAction } from "@/server/actions/fascicolo-intake";
import { DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";
import type { getFascicoloIntakeDetail } from "@/server/queries/fascicolo-intake";

type FascicoloIntakeDetailData = NonNullable<Awaited<ReturnType<typeof getFascicoloIntakeDetail>>>;

interface FascicoloIntakeDetailProps {
  fascicolo: FascicoloIntakeDetailData;
  canUpload: boolean;
}

function Value({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-950">{value || "Non indicato"}</dd>
    </div>
  );
}

export function FascicoloIntakeDetail({ fascicolo, canUpload }: FascicoloIntakeDetailProps) {
  const title = fascicolo.denominazioneBreve || fascicolo.oggettoFascicolo;
  const overview: FascicoloOverviewModel = {
    title,
    status: "In preparazione",
    type: getConcessionVerticalLabel(fascicolo.tipologiaConcessione),
    concession: fascicolo.concessione?.numeroAtto ?? fascicolo.numeroConcessione,
    subject: fascicolo.soggettoAssistito ?? fascicolo.concessionario,
    priorityDeadline: fascicolo.scadenza ? formatDateIT(fascicolo.scadenza) : null,
    attention: [],
    documentCount: fascicolo.documenti.length,
    documents: fascicolo.documenti.slice(0, 3).map((documento) => ({
      id: documento.id,
      name: documento.nome,
      type: formatEnumLabel(documento.tipologia),
      date: formatDateIT(documento.createdAt),
      href: `/documenti/${documento.id}/download`,
    })),
    summary: [
      { label: "Oggetto", value: fascicolo.oggettoFascicolo },
      { label: "Contesto iniziale", value: fascicolo.contestoIniziale },
      { label: "Stato corrente", value: "In preparazione" },
      { label: "Concessione collegata", value: fascicolo.concessione?.numeroAtto ?? fascicolo.numeroConcessione },
      { label: "Soggetto assistito", value: fascicolo.soggettoAssistito },
      { label: "Concessionario / titolare", value: fascicolo.concessionario },
    ],
    timeline: [
      { id: `fascicolo-${fascicolo.id}`, label: "Fascicolo creato", date: formatDateIT(fascicolo.createdAt) },
    ],
  };

  return (
    <FascicoloShell
      model={overview}
      sectionTargets={{
        overview: "#panoramica",
        documents: "#documenti",
        timeline: "#cronologia",
        subjects: "#soggetti",
        concession: "#concessione",
      }}
    >
      <div className="space-y-6">
        <Card id="concessione" className="scroll-mt-16">
          <CardHeader>
            <CardTitle>Dati iniziali</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <span id="soggetti" className="block scroll-mt-16" />
            <dl className="grid gap-5 md:grid-cols-3">
              <Value label="Concessionario / titolare" value={fascicolo.concessionario} />
              <Value label="Ente concedente" value={fascicolo.enteConcedente} />
              <Value label="Autorità competente" value={fascicolo.autoritaCompetente} />
              <Value label="Numero concessione" value={fascicolo.numeroConcessione} />
              <Value label="Data rilascio" value={fascicolo.dataRilascio ? formatDateIT(fascicolo.dataRilascio) : null} />
              <Value label="Decorrenza" value={fascicolo.decorrenza ? formatDateIT(fascicolo.decorrenza) : null} />
              <Value label="Scadenza" value={fascicolo.scadenza ? formatDateIT(fascicolo.scadenza) : null} />
              <Value label="Località" value={fascicolo.localita} />
              <Value label="Soggetto assistito" value={fascicolo.soggettoAssistito} />
              <Value label="Controparte / amministrazione" value={fascicolo.controparteAmministrazione} />
              <Value label="Oggetto della concessione" value={fascicolo.oggettoConcessione} />
              <Value label="Bene / area / servizio" value={fascicolo.beneAreaServizio} />
            </dl>
            {fascicolo.contestoIniziale ? (
              <div className="border-t border-slate-200 pt-5">
                <p className="text-xs font-medium text-slate-500">Contesto iniziale</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{fascicolo.contestoIniziale}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card id="documenti">
          <CardHeader>
            <CardTitle>Documenti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {fascicolo.documenti.length > 0 ? (
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
                {fascicolo.documenti.map((documento) => (
                  <li key={documento.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-5 w-5 shrink-0 text-[#173d4f]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{documento.nome}</p>
                        <p className="text-xs text-slate-500">{formatEnumLabel(documento.tipologia)} · {formatDateIT(documento.createdAt)}</p>
                      </div>
                    </div>
                    <a href={`/documenti/${documento.id}/download`} className="text-sm font-semibold text-[#173d4f] underline underline-offset-4">Apri</a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-600">Nessun documento ancora caricato.</div>
            )}

            {canUpload ? (
              <details open={fascicolo.documenti.length === 0} className="rounded-md border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#173d4f]">Allega documento</summary>
                <form action={uploadFascicoloIntakeDocumentAction} className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2">
                  <input type="hidden" name="fascicoloIntakeId" value={fascicolo.id} />
                  <input type="hidden" name="source" value="UPLOAD_UTENTE" />
                  <input type="hidden" name="status" value="ATTIVO" />
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">
                    File
                    <Input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" required />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Nome documento
                    <Input name="nome" placeholder="Usa il nome del file se vuoto" />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Tipologia
                    <Select name="tipologia" defaultValue="NOTA" required>
                      {DOCUMENT_TIPOLOGIA_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}
                    </Select>
                  </label>
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">
                    Descrizione
                    <Textarea name="descrizione" rows={2} />
                  </label>
                  <div className="md:col-span-2">
                    <Button type="submit"><Paperclip className="h-4 w-4" aria-hidden="true" />Carica documento</Button>
                  </div>
                </form>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </FascicoloShell>
  );
}
