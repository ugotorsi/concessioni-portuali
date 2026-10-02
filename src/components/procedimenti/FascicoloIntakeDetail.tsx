import { Paperclip } from "lucide-react";

import { FascicoloDocumentsArchive, type FascicoloDocumentArchiveItem } from "@/components/documents/FascicoloDocumentsArchive";
import { FascicoloAnalysis } from "@/components/procedimenti/FascicoloAnalysis";
import { FascicoloConcession } from "@/components/procedimenti/FascicoloConcession";
import { FascicoloDeadlines } from "@/components/procedimenti/FascicoloDeadlines";
import { FascicoloIssues } from "@/components/procedimenti/FascicoloIssues";
import { FascicoloProposals } from "@/components/procedimenti/FascicoloProposals";
import { FascicoloReport } from "@/components/procedimenti/FascicoloReport";
import { FascicoloResearch } from "@/components/procedimenti/FascicoloResearch";
import { FascicoloShell, type FascicoloOverviewModel, type FascicoloSection } from "@/components/procedimenti/FascicoloShell";
import { FascicoloSubjects, type FascicoloSubject } from "@/components/procedimenti/FascicoloSubjects";
import { FascicoloTimeline, type FascicoloTimelineEvent } from "@/components/procedimenti/FascicoloTimeline";
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
  activeSection: FascicoloSection;
}

function Value({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-950">{value || "Non indicato"}</dd>
    </div>
  );
}

function toArchiveItem(documento: FascicoloIntakeDetailData["documenti"][number]): FascicoloDocumentArchiveItem {
  const usesStoredFile = documento.url?.includes("/download") ?? false;
  const details = [
    documento.numeroProtocollo ? { label: "Protocollo", value: documento.numeroProtocollo } : null,
    documento.dataProtocollo ? { label: "Data protocollo", value: formatDateIT(documento.dataProtocollo) } : null,
    documento.direzione ? { label: "Direzione", value: formatEnumLabel(documento.direzione) } : null,
    documento.canale ? { label: "Canale", value: formatEnumLabel(documento.canale) } : null,
    documento.descrizione ? { label: "Descrizione", value: documento.descrizione } : null,
    documento.source ? { label: "Fonte", value: formatEnumLabel(documento.source) } : null,
    documento.sizeBytes !== null ? { label: "Dimensione", value: `${documento.sizeBytes} byte` } : null,
  ].filter((detail): detail is { label: string; value: string } => detail !== null);

  return {
    id: documento.id,
    name: documento.nome,
    type: formatEnumLabel(documento.tipologia),
    typeCode: documento.tipologia,
    state: documento.statoDocumento === "ARCHIVIATO" ? "Archiviato" : "Caricato",
    documentDate: documento.dataDocumento ? formatDateIT(documento.dataDocumento) : null,
    acquiredAt: formatDateIT(documento.createdAt),
    acquiredAtTimestamp: documento.createdAt.getTime(),
    sender: documento.mittente,
    alert: documento.pecWarningMancataRicevuta ? "Ricevuta PEC da verificare" : null,
    openHref: `/documenti/${documento.id}/download${usesStoredFile ? "?preview=1" : ""}`,
    openInNewTab: usesStoredFile,
    originalHref: usesStoredFile ? `/documenti/${documento.id}/download` : null,
    details,
  };
}

export function FascicoloIntakeDetail({ fascicolo, canUpload, activeSection }: FascicoloIntakeDetailProps) {
  const title = fascicolo.denominazioneBreve || fascicolo.oggettoFascicolo;
  const subjects: FascicoloSubject[] = [];
  if (fascicolo.soggettoAssistito) subjects.push({ name: fascicolo.soggettoAssistito, roles: ["Assistito"], category: "principal" });
  if (fascicolo.concessionario) subjects.push({ name: fascicolo.concessionario, roles: ["Concessionario"], category: "principal", note: fascicolo.numeroConcessione ? `Concessione ${fascicolo.numeroConcessione}` : null });
  if (fascicolo.enteConcedente) subjects.push({ name: fascicolo.enteConcedente, roles: ["Ente concedente"], category: "principal", type: "Amministrazione pubblica" });
  if (fascicolo.autoritaCompetente) subjects.push({ name: fascicolo.autoritaCompetente, roles: ["Autorità competente"], category: "principal", type: "Amministrazione pubblica" });
  if (fascicolo.controparteAmministrazione) subjects.push({ name: fascicolo.controparteAmministrazione, roles: ["Controparte"], category: "other" });
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
  const timelineEvents: FascicoloTimelineEvent[] = [
    {
      id: `fascicolo-${fascicolo.id}`,
      date: formatDateIT(fascicolo.createdAt),
      dateTime: fascicolo.createdAt.toISOString(),
      timestamp: fascicolo.createdAt.getTime(),
      title: "Fascicolo creato",
      type: "Fascicolo",
      description: `Apertura del fascicolo ${title}.`,
      subjects: fascicolo.soggettoAssistito ?? fascicolo.concessionario,
    },
    ...(fascicolo.dataRilascio ? [{
      id: `rilascio-${fascicolo.id}`,
      date: formatDateIT(fascicolo.dataRilascio),
      dateTime: fascicolo.dataRilascio.toISOString(),
      timestamp: fascicolo.dataRilascio.getTime(),
      title: "Concessione rilasciata",
      type: "Concessione" as const,
      description: fascicolo.numeroConcessione
        ? `Rilascio della concessione ${fascicolo.numeroConcessione}.`
        : "Rilascio della concessione registrato nel fascicolo.",
      subjects: fascicolo.concessionario,
      href: `/procedimenti/${fascicolo.id}?section=concession`,
      actionLabel: "Vai alla concessione",
    }] : []),
    ...(fascicolo.decorrenza ? [{
      id: `decorrenza-${fascicolo.id}`,
      date: formatDateIT(fascicolo.decorrenza),
      dateTime: fascicolo.decorrenza.toISOString(),
      timestamp: fascicolo.decorrenza.getTime(),
      title: "Decorrenza della concessione",
      type: "Concessione" as const,
      description: "Inizio della decorrenza indicata per la concessione.",
      subjects: fascicolo.concessionario,
      href: `/procedimenti/${fascicolo.id}?section=concession`,
      actionLabel: "Vai alla concessione",
    }] : []),
    ...(fascicolo.scadenza ? [{
      id: `scadenza-${fascicolo.id}`,
      date: formatDateIT(fascicolo.scadenza),
      dateTime: fascicolo.scadenza.toISOString(),
      timestamp: fascicolo.scadenza.getTime(),
      title: "Scadenza della concessione",
      type: "Scadenza" as const,
      description: "Termine di scadenza indicato per la concessione.",
      subjects: fascicolo.concessionario,
      alert: fascicolo.scadenza < new Date() ? "Scaduto" as const : null,
      href: `/procedimenti/${fascicolo.id}?section=concession`,
      actionLabel: "Vai alla concessione",
    }] : []),
    ...fascicolo.documenti.map((documento) => {
      const eventDate = documento.dataDocumento ?? documento.createdAt;
      return {
        id: `documento-${documento.id}`,
        dedupeKey: `documento-${documento.id}`,
        date: formatDateIT(eventDate),
        dateTime: eventDate.toISOString(),
        timestamp: eventDate.getTime(),
        title: documento.nome,
        type: "Documento" as const,
        description: `Documento ${formatEnumLabel(documento.tipologia)} acquisito nel fascicolo.`,
        subjects: documento.mittente,
        source: documento.nome,
        alert: documento.pecWarningMancataRicevuta ? "Da verificare" as const : null,
        href: `/documenti/${documento.id}/download${documento.url?.includes("/download") ? "?preview=1" : ""}`,
        actionLabel: "Apri documento",
      };
    }),
  ];
  const nextDeadline = fascicolo.scadenza && fascicolo.scadenza >= new Date()
    ? formatDateIT(fascicolo.scadenza)
    : null;

  return (
    <FascicoloShell
      model={overview}
      basePath={`/procedimenti/${fascicolo.id}`}
      activeSection={activeSection}
    >
      <div className="space-y-6">
        {activeSection === "timeline" ? <FascicoloTimeline events={timelineEvents} nextDeadline={nextDeadline} /> : null}

        {activeSection === "subjects" ? <FascicoloSubjects subjects={subjects} /> : null}

        {activeSection === "concession" ? (
          <FascicoloConcession
            model={{
              number: fascicolo.concessione?.numeroAtto ?? fascicolo.numeroConcessione,
              concessionaire: fascicolo.concessionario,
              grantingAuthority: fascicolo.enteConcedente,
              competentAuthority: fascicolo.autoritaCompetente,
              releaseDate: fascicolo.dataRilascio ? formatDateIT(fascicolo.dataRilascio) : null,
              expiryDate: fascicolo.scadenza ? formatDateIT(fascicolo.scadenza) : null,
              openHref: fascicolo.concessione ? `/concessioni/${fascicolo.concessione.id}` : null,
              title: [
                { label: "Numero atto", value: fascicolo.concessione?.numeroAtto ?? fascicolo.numeroConcessione },
                { label: "Oggetto della concessione", value: fascicolo.oggettoConcessione },
                { label: "Data rilascio", value: fascicolo.dataRilascio ? formatDateIT(fascicolo.dataRilascio) : null },
                { label: "Decorrenza", value: fascicolo.decorrenza ? formatDateIT(fascicolo.decorrenza) : null },
                { label: "Data scadenza", value: fascicolo.scadenza ? formatDateIT(fascicolo.scadenza) : null },
              ],
              property: [
                { label: "Località", value: fascicolo.localita },
                { label: "Bene / area / servizio", value: fascicolo.beneAreaServizio },
              ],
              activity: [
                { label: "Verticale", value: getConcessionVerticalLabel(fascicolo.tipologiaConcessione) },
              ],
              fee: [],
              indicators: { documents: fascicolo.documenti.length },
            }}
          />
        ) : null}

        {activeSection === "analysis" ? (
          <FascicoloAnalysis
            model={{
              questions: [],
              evidence: [],
              contradictions: [],
              gaps: [],
              relevantItems: [],
            }}
          />
        ) : null}

        {activeSection === "research" ? <FascicoloResearch model={{ questions: [], sources: [] }} /> : null}

        {activeSection === "deadlines" ? <FascicoloDeadlines model={{ deadlines: [], candidates: [] }} /> : null}

        {activeSection === "issues" ? <FascicoloIssues model={{ issues: [] }} /> : null}

        {activeSection === "reports" ? <FascicoloReport snapshots={[]} /> : null}

        {activeSection === "proposals" ? <FascicoloProposals proposals={[]} canManage={false} /> : null}

        {activeSection === "documents" ? (
          <FascicoloDocumentsArchive
            documents={fascicolo.documenti.map(toArchiveItem)}
            uploadForm={canUpload ? (
              <form action={uploadFascicoloIntakeDocumentAction} className="grid gap-4 md:grid-cols-2">
                  <input type="hidden" name="fascicoloIntakeId" value={fascicolo.id} />
                  <input type="hidden" name="source" value="UPLOAD_UTENTE" />
                  <input type="hidden" name="status" value="ATTIVO" />
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">
                    File
                    <Input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" required />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Nome documento <span className="font-normal text-slate-500">(opzionale)</span>
                    <Input name="nome" placeholder="Usa il nome del file se vuoto" />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Tipologia
                    <Select name="tipologia" defaultValue="NOTA" required>
                      {DOCUMENT_TIPOLOGIA_VALUES.map((value) => <option key={value} value={value}>{formatEnumLabel(value)}</option>)}
                    </Select>
                  </label>
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">
                    Descrizione <span className="font-normal text-slate-500">(opzionale)</span>
                    <Textarea name="descrizione" rows={2} />
                  </label>
                  <div className="md:col-span-2">
                    <Button type="submit"><Paperclip className="h-4 w-4" aria-hidden="true" />Carica documento</Button>
                  </div>
              </form>
            ) : undefined}
          />
        ) : null}

        {!["documents", "timeline", "subjects", "concession", "analysis", "research", "deadlines", "issues", "reports", "proposals"].includes(activeSection) ? (
          <p className="rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-600">Nessun dato ancora disponibile.</p>
        ) : null}
      </div>
    </FascicoloShell>
  );
}
