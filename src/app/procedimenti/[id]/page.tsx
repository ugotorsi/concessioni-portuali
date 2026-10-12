import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SubmitButtonPending } from "@/components/forms/SubmitButtonPending";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { NeutralIntakeProcessingPanel } from "@/components/documents/NeutralIntakeProcessingPanel";
import {
  AiFascicoloTrustedReviewPanel,
  resolveAiFascicoloTrustedReviewSelection,
} from "@/components/procedimenti/AiFascicoloTrustedReviewPanel";
import { AiFascicoloTrustedReviewGenerationControl } from "@/components/procedimenti/AiFascicoloTrustedReviewGenerationControl";
import { ChecklistItemEvidence } from "@/components/procedimenti/ChecklistItemEvidence";
import { FascicoloDocumentRequirementScreeningTrigger } from "@/components/procedimenti/FascicoloDocumentRequirementScreeningTrigger";
import { FascicoloObservationsPanel } from "@/components/procedimenti/FascicoloObservationsPanel";
import { FascicoloAutomaticWorkflowPanel } from "@/components/procedimenti/FascicoloAutomaticWorkflowPanel";
import {
  FascicoloAnalysis,
  type FascicoloAnalysisCorpus,
} from "@/components/procedimenti/FascicoloAnalysis";
import { FascicoloDeadlines, type FascicoloDeadlineStatus } from "@/components/procedimenti/FascicoloDeadlines";
import { FascicoloIssues, type FascicoloIssueSeverity, type FascicoloIssueStatus } from "@/components/procedimenti/FascicoloIssues";
import { FascicoloProposals } from "@/components/procedimenti/FascicoloProposals";
import { FascicoloReport } from "@/components/procedimenti/FascicoloReport";
import { FascicoloResearch } from "@/components/procedimenti/FascicoloResearch";
import { FascicoloIntakeDetail } from "@/components/procedimenti/FascicoloIntakeDetail";
import { FascicoloConcession } from "@/components/procedimenti/FascicoloConcession";
import { FascicoloShell, resolveFascicoloSection, type FascicoloOverviewModel } from "@/components/procedimenti/FascicoloShell";
import { FascicoloSubjects } from "@/components/procedimenti/FascicoloSubjects";
import { FascicoloTimeline, type FascicoloTimelineEvent } from "@/components/procedimenti/FascicoloTimeline";
import {
  ProcedimentoGiorniBadge,
  ProcedimentoChecklistBadge,
  ProcedimentoOrigineBadge,
  ProcedimentoPreavvisoBadge,
  ProcedimentoStatoBadge,
  ProcedimentoTipologiaBadge,
  ProcedimentoWarningBadge,
} from "@/components/procedimenti/ProcedimentiBadges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { canManageProcedimenti, canRegisterProcedimentoDecision, requireRole } from "@/lib/auth";
import {
  getChecklistContraddittorioItems,
  getOrigineProcedimentoLabel,
  getProcedimentoChecklistGuidance,
  getStatoPreavvisoRigettoDescription,
  getStatoPreavvisoRigettoLabel,
} from "@/lib/procedimento-checklist";
import { formatCurrencyEUR, formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  finalizeProcedimentoDecisionAction,
  reassignProcedimentoResponsabileAction,
  updateProcedimentoChecklistAction,
} from "@/server/actions/procedimenti";
import { getDecisionRulePreviewForTipologia } from "@/server/procedimenti/decisioni";
import { getLetturaProcedimentale, getProcedimentoDetail } from "@/server/queries/procedimenti";
import { getChecklistEvidenceData } from "@/server/queries/checklist-evidence";
import { getFascicoloDocumentRequirementProposals } from "@/server/queries/fascicolo-document-requirements";
import { getFascicoloLegalSourceCandidates } from "@/server/queries/fascicolo-legal-source-candidates";
import { getFascicoloObservations } from "@/server/queries/fascicolo-observations";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";
import {
  getFascicoloDocumentCorpus,
  type FascicoloDocumentCorpus,
} from "@/server/queries/fascicolo-document-corpus";
import { getNormeForProcedimento } from "@/server/queries/normativa";
import { getFascicoloProcessingItems } from "@/server/queries/neutral-intake-processing";
import { getAiFascicoloHumanReviewReadModel } from "@/server/queries/ai-fascicolo-human-review";
import { getAiFascicoloTrustedReviewMaterialsReadModel } from "@/server/queries/ai-fascicolo-trusted-review-materials";
import { getFascicoloIntakeDetail } from "@/server/queries/fascicolo-intake";
import { listStructuredFascicoloReportSnapshots } from "@/server/fascicolo-report";

import { PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES } from "@/server/queries/procedimenti";

interface ProcedimentoDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    screening?: string | string[];
    documentUpload?: string | string[];
    materialId?: string | string[];
    statementPath?: string | string[];
    section?: string | string[];
  }>;
}

export const dynamic = "force-dynamic";

async function loadAiFascicoloTrustedReviewPanelData(input: {
  readonly procedimentoId: string;
  readonly materialId?: string | string[];
  readonly statementPath?: string | string[];
}) {
  let trustedReviewMaterials = null;
  let readError = false;
  try {
    trustedReviewMaterials = await getAiFascicoloTrustedReviewMaterialsReadModel({
      procedimentoId: input.procedimentoId,
    });
  } catch {
    readError = true;
  }
  const selection = resolveAiFascicoloTrustedReviewSelection(
    trustedReviewMaterials?.materials ?? [],
    input.materialId,
    input.statementPath,
  );
  let humanReview = null;
  if (selection.kind === "COMPLETE") {
    try {
      humanReview = await getAiFascicoloHumanReviewReadModel({
        materialId: selection.material.materialId,
        statementPath: selection.statementPath,
      });
    } catch {
      readError = true;
    }
  }
  return {
    materials: trustedReviewMaterials?.materials ?? [],
    selection,
    humanReview,
    readError,
  };
}

function getStatoEffettoLabel(value: "NON_PREVISTO" | "PENDENTE" | "PRONTO" | "APPLICATO" | "BLOCCATO" | "ERRORE") {
  switch (value) {
    case "NON_PREVISTO":
      return "Effetto non previsto";
    case "PENDENTE":
      return "Effetto pendente";
    case "PRONTO":
      return "Effetto pronto";
    case "APPLICATO":
      return "Effetto applicato";
    case "BLOCCATO":
      return "Effetto bloccato";
    case "ERRORE":
      return "Errore applicazione";
    default:
      return value;
  }
}

function analysisCorpusModel(corpus: FascicoloDocumentCorpus | null): FascicoloAnalysisCorpus | null {
  if (!corpus) return null;
  return {
    availability: corpus.availability,
    documentCount: corpus.documentCount,
    availableDocumentCount: corpus.availableDocumentCount,
    textPageCount: corpus.textPageCount,
    documentsToVerify: corpus.documents.flatMap((document) => document.status === "AVAILABLE"
      ? []
      : [{
          id: document.documentoId,
          name: document.name,
          status: document.status,
        }]),
  };
}

export default async function ProcedimentoDetailPage({ params, searchParams }: ProcedimentoDetailPageProps) {
  const role = await requireRole();
  const canReview = canManageProcedimenti(role);
  const canWriteChecklist = canReview;
  const canRegisterDecision = canRegisterProcedimentoDecision(role);
  const { id } = await params;
  const { screening, documentUpload, materialId, statementPath, section } = await searchParams;
  const activeSection = resolveFascicoloSection(section);
  const screeningDone = screening === "done";
  const duplicateDocumentUpload = documentUpload === "duplicate";
  const detail = await getProcedimentoDetail(id);
  const fascicoloIntake = detail ? null : await getFascicoloIntakeDetail(id);

  if (fascicoloIntake?.procedimento) {
    redirect(`/procedimenti/${fascicoloIntake.procedimento.id}`);
  }

  if (fascicoloIntake) {
    return <FascicoloIntakeDetail fascicolo={fascicoloIntake} canUpload={canReview} activeSection={activeSection} />;
  }

  if (!detail) {
    notFound();
  }

  const processingItems = await getFascicoloProcessingItems(detail.procedimento.id);
  const documentCorpus = detail.canonicalEnteId
    ? await getFascicoloDocumentCorpus({
        tenantId: detail.canonicalEnteId,
        procedimentoId: detail.procedimento.id,
      })
    : null;
  const analysisCorpus = analysisCorpusModel(documentCorpus);
  const automaticWorkflow = await getFascicoloAutomaticWorkflowReadModel(detail.procedimento.id);
  const legalSourceCandidates = await getFascicoloLegalSourceCandidates(detail.procedimento.id);
  const fascicoloObservations = await getFascicoloObservations(detail.procedimento.id);
  const fascicoloDocumentRequirements = await getFascicoloDocumentRequirementProposals(detail.procedimento.id);
  const checklistEvidenceData = await getChecklistEvidenceData(detail.procedimento.id);
  const hasCanonicalTenant = Boolean(detail.canonicalEnteId);
  const structuredReportSnapshots = activeSection === "reports" && detail.canonicalEnteId
    ? await listStructuredFascicoloReportSnapshots({
        tenantId: detail.canonicalEnteId,
        procedimentoId: detail.procedimento.id,
      })
    : [];
  const trustedReviewPanelData = await loadAiFascicoloTrustedReviewPanelData({
    procedimentoId: detail.procedimento.id,
    materialId,
    statementPath,
  });

  if (!detail.concessione || !detail.concessionario) {
    const overview: FascicoloOverviewModel = {
      title: "Fascicolo operativo",
      status: formatEnumLabel(detail.procedimento.stato),
      type: formatEnumLabel(detail.procedimento.tipologia),
      reference: "Titolo concessorio non accertato",
      lastUpdated: formatDateIT(detail.procedimento.updatedAt),
      documentCount: detail.documentiPrincipali.length,
      openIssueCount: detail.altreCriticitaAperte.length,
      criticalPaymentCount: 0,
      concession: {
        number: null,
        authority: null,
        object: null,
        startDate: null,
        expiryDate: null,
        location: null,
        incomplete: true,
      },
      subjects: [],
      documents: detail.documentiPrincipali.slice(0, 3).map((documento) => ({
        id: documento.id,
        name: documento.nome,
        type: formatEnumLabel(documento.tipologia),
        date: formatDateIT(documento.dataDocumento ?? documento.createdAt),
        isFileAvailable: documento.isFileAvailable,
        href: documento.url,
      })),
      deadlines: [],
      attention: [{
        label: "Titolo concessorio non ancora accertato",
        section: "concession",
      }],
    };
    return (
      <FascicoloShell
        model={overview}
        basePath={`/procedimenti/${detail.procedimento.id}`}
        activeSection={activeSection}
        notice={duplicateDocumentUpload ? (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Documento già presente nel fascicolo.
          </div>
        ) : null}
      >
        <div className="space-y-4">
          {activeSection === "documents" ? (
            <section className="space-y-4" aria-label="Documenti del fascicolo">
              <EntityDocumentsPanel
                title="Documenti del Fascicolo"
                entityType="procedimento"
                entityId={detail.procedimento.id}
                documents={detail.documentiPrincipali}
                canUpload={canWriteChecklist}
                archiveMode
              />
              <NeutralIntakeProcessingPanel items={processingItems} />
            </section>
          ) : null}
          {activeSection === "istruttoria" ? <FascicoloAutomaticWorkflowPanel model={automaticWorkflow} /> : null}
          {activeSection === "analysis" ? (
            <FascicoloAnalysis
              model={{
                questions: [],
                evidence: detail.documentiPrincipali.map((documento) => ({
                  id: documento.id,
                  title: documento.nome,
                  detail: formatEnumLabel(documento.tipologia),
                  href: documento.isFileAvailable ? documento.url : null,
                })),
                contradictions: [],
                gaps: detail.documentiPrincipali.length === 0 ? [{
                  id: "documenti-mancanti",
                  title: "Documentazione da acquisire",
                  requestedItem: "Carica gli atti disponibili per avviare estrazione e analisi.",
                }] : [],
                relevantItems: [],
                corpus: analysisCorpus,
              }}
            />
          ) : null}
          {activeSection === "research" ? <FascicoloResearch model={{ questions: [], sources: [] }} /> : null}
          {activeSection === "reports" ? <FascicoloReport snapshots={structuredReportSnapshots} /> : null}
          {activeSection === "concession" ? (
            <Card>
              <CardHeader><CardTitle>Titolo concessorio non accertato</CardTitle></CardHeader>
              <CardContent className="text-sm text-slate-600">
                Il fascicolo è operativo senza rappresentare l&apos;esistenza di una concessione. Il collegamento potrà essere aggiunto solo quando un titolo reale sarà disponibile.
              </CardContent>
            </Card>
          ) : null}
          {activeSection === "subjects" ? (
            <FascicoloSubjects
              subjects={[]}
              responsible={detail.procedimento.responsabileProcedimentoNome ? {
                name: detail.procedimento.responsabileProcedimentoNome,
                email: detail.procedimento.responsabileProcedimentoEmail,
                organization: detail.procedimento.unitaOrganizzativaResponsabile,
                assignedAt: detail.procedimento.responsabileAssegnatoAt
                  ? formatDateIT(detail.procedimento.responsabileAssegnatoAt)
                  : null,
              } : null}
              responsibilityHistory={[]}
            />
          ) : null}
          {["timeline", "deadlines", "issues", "proposals", "decisione"].includes(activeSection) ? (
            <p className="rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-600">
              Nessun dato disponibile per questa sezione.
            </p>
          ) : null}
        </div>
      </FascicoloShell>
    );
  }

  const concessione = detail.concessione;
  const concessionario = detail.concessionario;
  const checklist = getChecklistContraddittorioItems(detail.procedimento);
  const checklistGuidance = getProcedimentoChecklistGuidance(detail.procedimento);
  const preavvisoWarningApplicabileNonInviato =
    detail.procedimento.preavvisoRigettoApplicabile &&
    ["APPLICABILE_DA_INVIARE", "NON_VALUTATO"].includes(detail.procedimento.statoPreavvisoRigetto);
  const preavvisoWarningOsservazioniNonValutate =
    detail.procedimento.osservazioniPreavvisoRicevute &&
    detail.procedimento.statoPreavvisoRigetto !== "OSSERVAZIONI_VALUTATE" &&
    !(detail.procedimento.valutazioneOsservazioniPreavviso && detail.procedimento.valutazioneOsservazioniPreavviso.trim() !== "");

  const lettura = getLetturaProcedimentale({
    tipologia: detail.procedimento.tipologia,
    stato: detail.procedimento.stato,
    riferimentoNormativo: detail.procedimento.riferimentoNormativo,
    giorniRitardoContraddittorio: detail.procedimento.giorniRitardoContraddittorio,
  });
  const normeCollegate = await getNormeForProcedimento(detail.procedimento.id);
  const decisionRules = getDecisionRulePreviewForTipologia(detail.procedimento.tipologia);
  const hasDecision = detail.procedimento.decisioneConclusiva !== null;
  const decisioneConclusiva = detail.procedimento.decisioneConclusiva;
  const canRenderFinalizeForm =
    canRegisterDecision &&
    !hasDecision &&
    ["DA_AVVIARE", "IN_CORSO"].includes(detail.procedimento.stato);
  const linkedIssueIsOpen = detail.criticitaCollegata?.stato !== "RISOLTA" && detail.criticitaCollegata !== null;
  const openIssueCount = detail.altreCriticitaAperte.length + (linkedIssueIsOpen ? 1 : 0);
  const nextDeadline = [...detail.scadenzeRilevanti]
    .filter((item) => item.dataScadenza >= new Date())
    .sort((left, right) => left.dataScadenza.getTime() - right.dataScadenza.getTime())[0];
  const concessionIncomplete = !detail.concessione.numeroAtto
    || !detail.concessione.descrizioneBene
    || !detail.concessione.ubicazione;
  const primaryIssue = linkedIssueIsOpen && detail.criticitaCollegata
    ? detail.criticitaCollegata
    : detail.altreCriticitaAperte[0];
  const nextChecklistItem = detail.procedimento.checklistMissingItems[0];
  const overview: FascicoloOverviewModel = {
    title: `Fascicolo ${formatEnumLabel(detail.procedimento.tipologia)}`,
    status: formatEnumLabel(detail.procedimento.stato),
    type: formatEnumLabel(detail.procedimento.tipologia),
    reference: detail.concessione.numeroAtto,
    administration: detail.concessione.ente?.nome,
    subject: detail.concessionario.denominazione,
    lastUpdated: formatDateIT(detail.procedimento.updatedAt),
    phase: lettura.qualificazioneProcedimentale,
    checklist: {
      completed: detail.procedimento.checklistCompletedItems,
      total: detail.procedimento.checklistTotalItems,
    },
    documentCount: detail.documentiPrincipali.length,
    openIssueCount,
    criticalPaymentCount: detail.pagamentiCritici.length,
    documents: detail.documentiPrincipali.slice(0, 3).map((documento) => ({
      id: documento.id,
      name: documento.nome,
      type: formatEnumLabel(documento.tipologia),
      date: formatDateIT(documento.dataDocumento ?? documento.createdAt),
      isFileAvailable: documento.isFileAvailable,
      href: documento.url,
    })),
    attention: [
      ...(detail.procedimento.giorniRitardoContraddittorio !== null
        ? [{ label: `Termine del contraddittorio scaduto da ${detail.procedimento.giorniRitardoContraddittorio} giorni`, section: "deadlines" as const }]
        : []),
      ...(nextChecklistItem
        ? [{ label: nextChecklistItem, section: "analysis" as const }]
        : []),
      ...(primaryIssue
        ? [{ label: `${formatEnumLabel(primaryIssue.tipologia)}: ${primaryIssue.descrizione}`, section: "issues" as const }]
        : []),
      ...(detail.pagamentiCritici.length > 0
        ? [{ label: `${detail.pagamentiCritici.length} ${detail.pagamentiCritici.length === 1 ? "pagamento richiede" : "pagamenti richiedono"} verifica`, section: "concession" as const }]
        : []),
      ...(detail.documentiPrincipali.length === 0
        ? [{ label: "Nessun documento disponibile", section: "documents" as const }]
        : []),
    ],
    deadlines: detail.scadenzeRilevanti.slice(0, 5).map((item) => ({
      id: item.id,
      date: formatDateIT(item.dataScadenza),
      label: item.descrizione || formatEnumLabel(item.tipologia),
      status: formatEnumLabel(item.stato),
    })),
    concession: {
      number: detail.concessione.numeroAtto,
      authority: detail.concessione.ente?.nome,
      object: detail.concessione.descrizioneBene,
      startDate: formatDateIT(detail.concessione.dataRilascio),
      expiryDate: formatDateIT(detail.concessione.dataScadenza),
      location: detail.concessione.ubicazione,
      incomplete: concessionIncomplete,
    },
    subjects: [
      {
        name: detail.concessionario.denominazione,
        role: "Concessionario",
      },
      ...(detail.concessione.ente?.nome ? [{
        name: detail.concessione.ente.nome,
        role: "Ente concedente",
      }] : []),
    ],
    nextStep: nextChecklistItem
      ? { label: nextChecklistItem, section: "analysis" as const }
      : primaryIssue
        ? {
            label: `Verificare la criticità ${formatEnumLabel(primaryIssue.tipologia)}`,
            section: "issues" as const,
          }
        : nextDeadline
          ? {
              label: `Controllare la scadenza del ${formatDateIT(nextDeadline.dataScadenza)}`,
              section: "deadlines" as const,
            }
          : undefined,
  };
  const timelineEvents: FascicoloTimelineEvent[] = [
    {
      id: `fascicolo-${detail.procedimento.id}`,
      date: formatDateIT(detail.procedimento.createdAt),
      dateTime: detail.procedimento.createdAt.toISOString(),
      timestamp: detail.procedimento.createdAt.getTime(),
      title: "Fascicolo creato",
      type: "Fascicolo",
      description: `Apertura del fascicolo ${formatEnumLabel(detail.procedimento.tipologia)}.`,
      subjects: concessionario.denominazione,
    },
    ...(detail.procedimento.dataAvvio ? [{
      id: `avvio-${detail.procedimento.id}`,
      date: formatDateIT(detail.procedimento.dataAvvio),
      dateTime: detail.procedimento.dataAvvio.toISOString(),
      timestamp: detail.procedimento.dataAvvio.getTime(),
      title: "Procedimento avviato",
      type: "Fascicolo" as const,
      description: `Avvio del procedimento ${formatEnumLabel(detail.procedimento.tipologia)}.`,
      subjects: concessionario.denominazione,
    }] : []),
    {
      id: `concessione-${detail.concessione.id}`,
      date: formatDateIT(detail.concessione.dataRilascio),
      dateTime: detail.concessione.dataRilascio.toISOString(),
      timestamp: detail.concessione.dataRilascio.getTime(),
      title: "Concessione rilasciata",
      type: "Concessione",
      description: `Rilascio della concessione ${detail.concessione.numeroAtto}.`,
      subjects: concessionario.denominazione,
      href: `/procedimenti/${detail.procedimento.id}?section=concession`,
      actionLabel: "Vai alla concessione",
    },
    ...(detail.procedimento.comunicazioneAvvioInviata && detail.procedimento.dataComunicazioneAvvio ? [{
      id: `comunicazione-avvio-${detail.procedimento.id}`,
      date: formatDateIT(detail.procedimento.dataComunicazioneAvvio),
      dateTime: detail.procedimento.dataComunicazioneAvvio.toISOString(),
      timestamp: detail.procedimento.dataComunicazioneAvvio.getTime(),
      title: "Comunicazione di avvio inviata",
      type: "Comunicazione" as const,
      description: "Comunicazione di avvio del procedimento registrata nel fascicolo.",
      subjects: concessionario.denominazione,
    }] : []),
    ...(detail.procedimento.contestazioneFormaleInviata && detail.procedimento.dataContestazioneFormale ? [{
      id: `contestazione-${detail.procedimento.id}`,
      date: formatDateIT(detail.procedimento.dataContestazioneFormale),
      dateTime: detail.procedimento.dataContestazioneFormale.toISOString(),
      timestamp: detail.procedimento.dataContestazioneFormale.getTime(),
      title: "Contestazione formale inviata",
      type: "Comunicazione" as const,
      description: "Invio della contestazione formale registrato nel fascicolo.",
      subjects: concessionario.denominazione,
    }] : []),
    ...(detail.procedimento.memorieRicevute && detail.procedimento.dataRicezioneMemorie ? [{
      id: `memorie-${detail.procedimento.id}`,
      date: formatDateIT(detail.procedimento.dataRicezioneMemorie),
      dateTime: detail.procedimento.dataRicezioneMemorie.toISOString(),
      timestamp: detail.procedimento.dataRicezioneMemorie.getTime(),
      title: "Memorie ricevute",
      type: "Comunicazione" as const,
      description: "Ricezione delle memorie registrata nel fascicolo.",
      subjects: concessionario.denominazione,
    }] : []),
    ...detail.documentiPrincipali
      .filter((documento) => documento.id !== decisioneConclusiva?.documentoId)
      .map((documento) => {
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
          source: documento.nome,
          href: documento.isFileAvailable ? documento.url : null,
          actionLabel: documento.isFileAvailable ? "Apri documento" : null,
        };
      }),
    ...detail.sopralluoghiRecenti.map((item) => ({
      id: `sopralluogo-${item.id}`,
      date: formatDateIT(item.data),
      dateTime: item.data.toISOString(),
      timestamp: item.data.getTime(),
      title: `Sopralluogo ${formatEnumLabel(item.esito)}`,
      type: "Sopralluogo" as const,
      description: item.descrizione ?? `Esito: ${formatEnumLabel(item.esito)}.`,
      subjects: item.operatori,
      alert: item.conformitaPlanimetrica ? null : "Non conforme" as const,
      href: `/sopralluoghi/${item.id}`,
      actionLabel: "Apri sopralluogo",
    })),
    ...(detail.criticitaCollegata ? [{
      id: `criticita-${detail.criticitaCollegata.id}`,
      date: formatDateIT(detail.criticitaCollegata.dataRilevazione),
      dateTime: detail.criticitaCollegata.dataRilevazione.toISOString(),
      timestamp: detail.criticitaCollegata.dataRilevazione.getTime(),
      title: formatEnumLabel(detail.criticitaCollegata.tipologia),
      type: "Criticità" as const,
      description: detail.criticitaCollegata.descrizione,
      href: `/criticita/${detail.criticitaCollegata.id}`,
      actionLabel: "Apri criticità",
    }] : []),
    ...detail.altreCriticitaAperte.map((item) => ({
      id: `criticita-${item.id}`,
      date: formatDateIT(item.dataRilevazione),
      dateTime: item.dataRilevazione.toISOString(),
      timestamp: item.dataRilevazione.getTime(),
      title: formatEnumLabel(item.tipologia),
      type: "Criticità" as const,
      description: item.descrizione,
      href: `/procedimenti/${detail.procedimento.id}?section=issues`,
      actionLabel: "Vai alle criticità",
    })),
    ...detail.scadenzeRilevanti.map((item) => ({
      id: `scadenza-${item.id}`,
      date: formatDateIT(item.dataScadenza),
      dateTime: item.dataScadenza.toISOString(),
      timestamp: item.dataScadenza.getTime(),
      title: `Scadenza ${formatEnumLabel(item.tipologia)}`,
      type: "Scadenza" as const,
      description: item.descrizione ?? `Scadenza ${formatEnumLabel(item.tipologia)} registrata nel fascicolo.`,
      subjects: concessionario.denominazione,
      alert: ["SCADUTA", "SCADUTO"].includes(item.stato) ? "Scaduto" as const : null,
      href: `/procedimenti/${detail.procedimento.id}?section=deadlines`,
      actionLabel: "Vai alle scadenze",
    })),
    ...detail.pagamentiCritici.map((item) => ({
      id: `pagamento-${item.id}`,
      date: formatDateIT(item.dataScadenza),
      dateTime: item.dataScadenza.toISOString(),
      timestamp: item.dataScadenza.getTime(),
      title: `Pagamento ${item.annoRiferimento}`,
      type: "Pagamento" as const,
      description: `Residuo da verificare: ${formatCurrencyEUR(item.residuo)}.`,
      subjects: concessionario.denominazione,
      alert: "Da verificare" as const,
      href: `/procedimenti/${detail.procedimento.id}?section=concession`,
      actionLabel: "Vai alla concessione",
    })),
    ...(decisioneConclusiva ? [{
      id: `provvedimento-${decisioneConclusiva.id}`,
      date: formatDateIT(decisioneConclusiva.dataAtto),
      dateTime: decisioneConclusiva.dataAtto.toISOString(),
      timestamp: decisioneConclusiva.dataAtto.getTime(),
      title: `Provvedimento finale ${decisioneConclusiva.numeroAtto}`,
      type: "Provvedimento" as const,
      description: decisioneConclusiva.motivazioneSintetica,
      subjects: [decisioneConclusiva.organoCompetente, decisioneConclusiva.adottanteNome].filter(Boolean).join(" · "),
      source: decisioneConclusiva.documentoNome,
      href: `/procedimenti/${detail.procedimento.id}?section=decisione`,
      actionLabel: "Vai alla decisione",
    }] : detail.procedimento.dataProvvedimentoFinale ? [{
      id: `provvedimento-${detail.procedimento.id}`,
      date: formatDateIT(detail.procedimento.dataProvvedimentoFinale),
      dateTime: detail.procedimento.dataProvvedimentoFinale.toISOString(),
      timestamp: detail.procedimento.dataProvvedimentoFinale.getTime(),
      title: "Provvedimento finale registrato",
      type: "Provvedimento" as const,
      description: "Data del provvedimento finale registrata nel fascicolo.",
      href: `/procedimenti/${detail.procedimento.id}?section=decisione`,
      actionLabel: "Vai alla decisione",
    }] : []),
  ];

  return (
    <FascicoloShell
      model={overview}
      basePath={`/procedimenti/${detail.procedimento.id}`}
      activeSection={activeSection}
      notice={duplicateDocumentUpload ? (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Documento già presente nel fascicolo.
        </div>
      ) : null}
    >
      <div className="space-y-4">
        {activeSection === "istruttoria" ? (
          <section aria-labelledby="istruttoria-title" className="border-b border-slate-200 pb-4">
            <h2 id="istruttoria-title" className="text-lg font-semibold text-slate-950">Istruttoria</h2>
            <p className="mt-1 text-sm text-slate-600">Verifiche, osservazioni e valutazioni a supporto del procedimento.</p>
          </section>
        ) : null}

        {activeSection === "decisione" ? (
          <section aria-labelledby="decisione-title" className="border-b border-slate-200 pb-4">
            <h2 id="decisione-title" className="text-lg font-semibold text-slate-950">Decisione</h2>
            <p className="mt-1 text-sm text-slate-600">Provvedimento finale e relativo stato di registrazione.</p>
          </section>
        ) : null}

        {activeSection === "documents" ? <section className="space-y-4" aria-label="Documenti del fascicolo">
          <EntityDocumentsPanel
            title="Documenti del Fascicolo"
            entityType="procedimento"
            entityId={detail.procedimento.id}
            documents={detail.documentiPrincipali}
            canUpload={canWriteChecklist}
            archiveMode
          />
          <NeutralIntakeProcessingPanel items={processingItems} />
        </section> : null}

        {activeSection === "istruttoria" ? <section className="space-y-4" aria-label="Istruttoria del fascicolo">
          <div>
            <FascicoloAutomaticWorkflowPanel model={automaticWorkflow} />
          </div>
        </section> : null}

        {activeSection === "research" ? (
          <FascicoloResearch
            model={{
              questions: [],
              sources: [
                ...normeCollegate.map((item) => ({
                  id: `norma-${item.id}`,
                  title: item.titolo,
                  identifier: item.codice,
                  sourceType: formatEnumLabel(item.ambito),
                  origin: "Normativa collegata al fascicolo",
                  note: `${formatEnumLabel(item.severita)} · ${item.descrizione}`,
                })),
                ...legalSourceCandidates.map((item) => ({
                  id: `candidato-${item.id}`,
                  title: item.resolution?.legalSource?.title ?? item.originalName ?? "Fonte acquisita",
                  identifier: item.resolution?.legalSource?.sourceNumber
                    ?? item.resolution?.legalSource?.stableKey
                    ?? item.originalName,
                  authority: item.resolution?.legalSource?.issuingBody,
                  sourceType: item.mimeType,
                  date: formatDateIT(item.admittedAt),
                  origin: "Documento acquisito al fascicolo",
                  verificationStatus: item.resolution?.outcome === "LINKED"
                    ? "Identità della fonte collegata; contenuto e applicabilità temporale da verificare."
                    : item.resolution?.outcome === "NO_MATCH"
                      ? "Nessuna fonte ufficiale corrispondente individuata."
                      : "Verifica della fonte in attesa.",
                  note: item.resolution?.reviewNote,
                  usability: item.resolution?.outcome === "NO_MATCH" ? "NOT_USABLE" as const : "TO_VERIFY" as const,
                })),
              ],
            }}
          />
        ) : null}

        {activeSection === "subjects" ? (
          <FascicoloSubjects
            subjects={[{
              name: detail.concessionario.denominazione,
              roles: ["Concessionario"],
              category: "principal",
              contact: detail.concessionario.email ?? detail.concessionario.pec,
              organization: detail.concessionario.sedeLegale,
              note: `Titolare della concessione ${detail.concessione.numeroAtto}`,
              href: `/procedimenti/${detail.procedimento.id}?section=concession`,
            }]}
            responsible={detail.procedimento.responsabileProcedimentoNome ? {
              name: detail.procedimento.responsabileProcedimentoNome,
              email: detail.procedimento.responsabileProcedimentoEmail,
              organization: detail.procedimento.unitaOrganizzativaResponsabile,
              assignedAt: detail.procedimento.responsabileAssegnatoAt
                ? formatDateIT(detail.procedimento.responsabileAssegnatoAt)
                : null,
            } : null}
            responsibilityHistory={detail.procedimento.responsabileAssignments.map((assignment) => ({
              id: assignment.id,
              name: assignment.responsabileNome,
              email: assignment.responsabileEmail,
              organization: assignment.unitaOrganizzativa,
              assignedAt: formatDateIT(assignment.decorrenza),
              endedAt: assignment.cessazione ? formatDateIT(assignment.cessazione) : null,
              note: assignment.motivoAssegnazione,
            }))}
            reassignAction={canWriteChecklist ? (
              <details className="max-w-2xl rounded-md border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7285]">Riassegna responsabile</summary>
                <form action={reassignProcedimentoResponsabileAction} className="mt-3 space-y-3">
                  <input type="hidden" name="procedimentoId" value={detail.procedimento.id} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-slate-700">Responsabile<Input name="responsabileNome" required /></label>
                    <label className="text-sm text-slate-700">Email responsabile (opzionale)<Input name="responsabileEmail" type="email" /></label>
                    <label className="text-sm text-slate-700">Unità organizzativa<Input name="unitaOrganizzativa" required /></label>
                    <label className="text-sm text-slate-700">Decorrenza<Input name="decorrenza" type="date" required /></label>
                    <label className="text-sm text-slate-700 md:col-span-2">Motivo assegnazione (opzionale)<Textarea name="motivoAssegnazione" rows={2} /></label>
                  </div>
                  <Button type="submit">Conferma riassegnazione</Button>
                </form>
              </details>
            ) : null}
          />
        ) : null}

        {activeSection === "analysis" ? (
          <FascicoloAnalysis
            model={{
              questions: [
                ...(detail.criticitaCollegata && linkedIssueIsOpen ? [{
                  id: detail.criticitaCollegata.id,
                  title: formatEnumLabel(detail.criticitaCollegata.tipologia),
                  description: detail.criticitaCollegata.descrizione,
                  status: formatEnumLabel(detail.criticitaCollegata.stato),
                  area: detail.criticitaCollegata.riferimentoNormativo,
                  relevance: formatEnumLabel(detail.criticitaCollegata.gravita),
                  href: `/criticita/${detail.criticitaCollegata.id}`,
                }] : []),
                ...detail.altreCriticitaAperte.map((item) => ({
                  id: item.id,
                  title: formatEnumLabel(item.tipologia),
                  description: item.descrizione,
                  status: formatEnumLabel(item.stato),
                  relevance: formatEnumLabel(item.gravita),
                  href: `/criticita/${item.id}`,
                })),
              ],
              evidence: [
                {
                  id: `concessione-${detail.concessione.id}`,
                  title: `Titolo concessorio ${detail.concessione.numeroAtto}`,
                  detail: formatEnumLabel(detail.concessione.stato),
                  href: `/procedimenti/${detail.procedimento.id}?section=concession`,
                },
                ...detail.documentiPrincipali.slice(0, 4).map((documento) => ({
                  id: documento.id,
                  title: documento.nome,
                  detail: formatEnumLabel(documento.tipologia),
                  href: documento.isFileAvailable ? documento.url : null,
                })),
              ],
              contradictions: [],
              gaps: fascicoloDocumentRequirements.proposals
                .filter((proposal) => proposal.status !== "RIFIUTATO")
                .map((proposal) => ({
                  id: proposal.id,
                  title: proposal.gapLabelSnapshot,
                  relevance: proposal.gapDescriptionSnapshot,
                  status: proposal.status === "VALIDATO" ? "Confermata" : "Da verificare",
                })),
              relevantItems: [
                ...fascicoloObservations
                  .filter((observation) => observation.status !== "RIFIUTATO")
                  .map((observation) => ({
                    id: observation.id,
                    title: observation.text,
                    description: `Documento collegato: ${observation.documento.nome}`,
                    detail: observation.status === "VALIDATO" ? "Verificata" : observation.status === "SUPERATO" ? "Superata" : "Da verificare",
                    href: `/documenti/${observation.documento.id}/download`,
                  })),
              ],
              corpus: analysisCorpus,
            }}
          />
        ) : null}

        {activeSection === "istruttoria" ? <section className="grid gap-4 xl:grid-cols-2">
          <FascicoloObservationsPanel
            procedimentoId={detail.procedimento.id}
            canReview={canWriteChecklist}
            hasCanonicalTenant={hasCanonicalTenant}
            observations={fascicoloObservations}
          />

          <AiFascicoloTrustedReviewGenerationControl procedimentoId={detail.procedimento.id} />

          <AiFascicoloTrustedReviewPanel
            procedimentoId={detail.procedimento.id}
            materials={trustedReviewPanelData.materials}
            selection={trustedReviewPanelData.selection}
            humanReview={trustedReviewPanelData.humanReview}
            readError={trustedReviewPanelData.readError}
          />

          <FascicoloDocumentRequirementScreeningTrigger
            procedimentoId={detail.procedimento.id}
            canRun={canReview}
            hasCanonicalTenant={hasCanonicalTenant}
            screeningDone={screeningDone}
          />

        </section> : null}

        {activeSection === "proposals" ? (
          <FascicoloProposals
            proposals={automaticWorkflow?.operationalProposals ?? []}
            canManage={canReview && hasCanonicalTenant}
          />
        ) : null}

        {activeSection === "istruttoria" ? <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Checklist istruttoria</CardTitle>
              <CardDescription>
                Supporto istruttorio non vincolante: non sostituisce la valutazione del responsabile del procedimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato checklist</p>
                  <div className="mt-1">
                    <ProcedimentoChecklistBadge complete={detail.procedimento.checklistContraddittorioCompleta} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Avvertenze</p>
                  <div className="mt-1">
                    <ProcedimentoWarningBadge level={detail.procedimento.checklistWarningLevel} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Completamento</p>
                  <p className="mt-1 text-slate-900">
                    {detail.procedimento.checklistCompletedItems}/{detail.procedimento.checklistTotalItems} ({detail.procedimento.checklistPercentage}%)
                  </p>
                </div>
                {detail.procedimento.termineMemorieScadenza ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Termine memorie</p>
                    <p className="mt-1 text-slate-900">{formatDateIT(detail.procedimento.termineMemorieScadenza)}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Origine procedimento</p>
                  <div className="mt-1">
                    <ProcedimentoOrigineBadge value={detail.procedimento.origineProcedimento} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Procedimento d ufficio</p>
                  <p className="mt-1 text-slate-900">{detail.procedimento.procedimentoUfficio ? "Si" : "No"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato preavviso rigetto</p>
                  <div className="mt-1">
                    <ProcedimentoPreavvisoBadge
                      applicabile={detail.procedimento.preavvisoRigettoApplicabile}
                      stato={detail.procedimento.statoPreavvisoRigetto}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{getStatoPreavvisoRigettoLabel(detail.procedimento.statoPreavvisoRigetto)}</p>
                </div>
                {detail.procedimento.termineOsservazioniPreavviso ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Termine osservazioni preavviso</p>
                    <p className="mt-1 text-slate-900">{formatDateIT(detail.procedimento.termineOsservazioniPreavviso)}</p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {getStatoPreavvisoRigettoDescription(detail.procedimento.statoPreavvisoRigetto)}
              </div>

              {preavvisoWarningApplicabileNonInviato ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Preavviso di rigetto indicato come applicabile secondo valutazione istruttoria ma non ancora inviato.
                </div>
              ) : null}

              {preavvisoWarningOsservazioniNonValutate ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Osservazioni sul preavviso ricevute ma non ancora valutate in motivazione istruttoria.
                </div>
              ) : null}

              {detail.criticitaCollegata?.rilevanzaArt47 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Per profili decadenziali ex art. 47, la checklist aiuta a verificare il rispetto del contraddittorio prima di ogni valutazione finale.
                </p>
              ) : null}

              <div className="space-y-2">
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Collegamento istruttorio al fascicolo. L&apos;associazione del documento non certifica la completezza, la regolarità, la validità o la sufficienza giuridica della documentazione e non modifica automaticamente lo stato della checklist o l&apos;esito del procedimento.
                </p>
                {!checklistEvidenceData.hasCanonicalTenant ? (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Le evidenze istruttorie non sono associabili finché il procedimento non dispone di un tenant canonico.
                  </p>
                ) : null}
                {checklist.map((item) => (
                  <div key={item.code} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-slate-900">{item.label}</p>
                        <p className="text-xs text-slate-500">{item.required ? "Passaggio essenziale" : "Passaggio consigliato"}</p>
                      </div>
                      <Badge variant={item.completed ? "success" : item.required ? "danger" : "default"}>
                        {item.completed ? "Presente" : item.required ? "Mancante" : "Non compilato"}
                      </Badge>
                    </div>
                    <ChecklistItemEvidence
                      procedimentoId={detail.procedimento.id}
                      itemCode={item.code}
                      canManage={canWriteChecklist}
                      data={checklistEvidenceData}
                    />
                  </div>
                ))}
              </div>

              {detail.procedimento.checklistMissingItems.length > 0 ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <p className="font-medium">Passaggi essenziali mancanti</p>
                  <ul className="mt-2 list-disc pl-5">
                    {detail.procedimento.checklistMissingItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {detail.procedimento.motivazioneValutazione
                || detail.procedimento.propostaEsitoIstruttorio
                || detail.procedimento.noteChecklistContraddittorio
                || detail.procedimento.dataPreavvisoRigetto
                || detail.procedimento.dataOsservazioniPreavviso
                || detail.procedimento.valutazioneOsservazioniPreavviso
                || detail.procedimento.motivazioneMancatoPreavviso ? (
                <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                  {detail.procedimento.motivazioneValutazione ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Motivazione valutazione</p>
                      <p className="mt-1">{detail.procedimento.motivazioneValutazione}</p>
                    </div>
                  ) : null}
                  {detail.procedimento.propostaEsitoIstruttorio ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Proposta esito istruttorio</p>
                      <p className="mt-1">{formatEnumLabel(detail.procedimento.propostaEsitoIstruttorio)}</p>
                    </div>
                  ) : null}
                  {detail.procedimento.noteChecklistContraddittorio ? (
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Nota checklist contraddittorio</p>
                      <p className="mt-1">{detail.procedimento.noteChecklistContraddittorio}</p>
                    </div>
                  ) : null}
                  {detail.procedimento.dataPreavvisoRigetto ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Data preavviso rigetto</p>
                      <p className="mt-1">{formatDateIT(detail.procedimento.dataPreavvisoRigetto)}</p>
                    </div>
                  ) : null}
                  {detail.procedimento.dataOsservazioniPreavviso ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Data osservazioni preavviso</p>
                      <p className="mt-1">{formatDateIT(detail.procedimento.dataOsservazioniPreavviso)}</p>
                    </div>
                  ) : null}
                  {detail.procedimento.valutazioneOsservazioniPreavviso ? (
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Valutazione osservazioni preavviso</p>
                      <p className="mt-1">{detail.procedimento.valutazioneOsservazioniPreavviso}</p>
                    </div>
                  ) : null}
                  {detail.procedimento.motivazioneMancatoPreavviso ? (
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Motivazione mancato preavviso</p>
                      <p className="mt-1">{detail.procedimento.motivazioneMancatoPreavviso}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {checklistGuidance}
              </div>

              {canWriteChecklist ? (
                <form action={updateProcedimentoChecklistAction} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                  <input type="hidden" name="procedimentoId" value={detail.procedimento.id} />
                  <p className="text-sm font-medium text-slate-900">Aggiorna checklist</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Select name="origineProcedimento" defaultValue={detail.procedimento.origineProcedimento}>
                      <option value="UFFICIO">{getOrigineProcedimentoLabel("UFFICIO")}</option>
                      <option value="ISTANZA_PARTE">{getOrigineProcedimentoLabel("ISTANZA_PARTE")}</option>
                      <option value="ALTRO">{getOrigineProcedimentoLabel("ALTRO")}</option>
                    </Select>
                    <Select name="procedimentoUfficio" defaultValue={detail.procedimento.procedimentoUfficio ? "true" : "false"}>
                      <option value="true">Procedimento d ufficio: Si</option>
                      <option value="false">Procedimento d ufficio: No</option>
                    </Select>
                    <Select name="preavvisoRigettoApplicabile" defaultValue={detail.procedimento.preavvisoRigettoApplicabile ? "true" : "false"}>
                      <option value="false">Preavviso applicabile: No / da verificare</option>
                      <option value="true">Preavviso applicabile: Si</option>
                    </Select>
                    <Select name="statoPreavvisoRigetto" defaultValue={detail.procedimento.statoPreavvisoRigetto}>
                      <option value="NON_VALUTATO">{getStatoPreavvisoRigettoLabel("NON_VALUTATO")}</option>
                      <option value="NON_APPLICABILE">{getStatoPreavvisoRigettoLabel("NON_APPLICABILE")}</option>
                      <option value="APPLICABILE_DA_INVIARE">{getStatoPreavvisoRigettoLabel("APPLICABILE_DA_INVIARE")}</option>
                      <option value="INVIATO">{getStatoPreavvisoRigettoLabel("INVIATO")}</option>
                      <option value="OSSERVAZIONI_RICEVUTE">{getStatoPreavvisoRigettoLabel("OSSERVAZIONI_RICEVUTE")}</option>
                      <option value="OSSERVAZIONI_VALUTATE">{getStatoPreavvisoRigettoLabel("OSSERVAZIONI_VALUTATE")}</option>
                    </Select>
                    <Input name="dataPreavvisoRigetto" type="date" defaultValue={detail.procedimento.dataPreavvisoRigetto ? detail.procedimento.dataPreavvisoRigetto.toISOString().slice(0, 10) : ""} />
                    <Input name="termineOsservazioniPreavviso" type="date" defaultValue={detail.procedimento.termineOsservazioniPreavviso ? detail.procedimento.termineOsservazioniPreavviso.toISOString().slice(0, 10) : ""} />
                    <Select name="osservazioniPreavvisoRicevute" defaultValue={detail.procedimento.osservazioniPreavvisoRicevute ? "true" : "false"}>
                      <option value="false">Osservazioni preavviso: No</option>
                      <option value="true">Osservazioni preavviso: Si</option>
                    </Select>
                    <Input name="dataOsservazioniPreavviso" type="date" defaultValue={detail.procedimento.dataOsservazioniPreavviso ? detail.procedimento.dataOsservazioniPreavviso.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="comunicazioneAvvioInviata" defaultChecked={detail.procedimento.comunicazioneAvvioInviata} className="h-4 w-4" />
                      Comunicazione avvio inviata
                    </label>
                    <Input name="dataComunicazioneAvvio" type="date" defaultValue={detail.procedimento.dataComunicazioneAvvio ? detail.procedimento.dataComunicazioneAvvio.toISOString().slice(0, 10) : ""} />
                    <Input name="termineMemorieGiorni" type="number" min={1} defaultValue={detail.procedimento.termineMemorieGiorni ?? ""} />
                    <Input name="termineMemorieScadenza" type="date" defaultValue={detail.procedimento.termineMemorieScadenza ? detail.procedimento.termineMemorieScadenza.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="contestazioneFormaleInviata" defaultChecked={detail.procedimento.contestazioneFormaleInviata} className="h-4 w-4" />
                      Contestazione formale inviata
                    </label>
                    <Input name="dataContestazioneFormale" type="date" defaultValue={detail.procedimento.dataContestazioneFormale ? detail.procedimento.dataContestazioneFormale.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="memorieRicevute" defaultChecked={detail.procedimento.memorieRicevute} className="h-4 w-4" />
                      Memorie ricevute
                    </label>
                    <Input name="dataRicezioneMemorie" type="date" defaultValue={detail.procedimento.dataRicezioneMemorie ? detail.procedimento.dataRicezioneMemorie.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="audizioneRichiesta" defaultChecked={detail.procedimento.audizioneRichiesta} className="h-4 w-4" />
                      Audizione richiesta
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="audizioneSvolta" defaultChecked={detail.procedimento.audizioneSvolta} className="h-4 w-4" />
                      Audizione svolta
                    </label>
                    <Input name="dataAudizione" type="date" defaultValue={detail.procedimento.dataAudizione ? detail.procedimento.dataAudizione.toISOString().slice(0, 10) : ""} />
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="sopralluogoIstruttorioSvolto" defaultChecked={detail.procedimento.sopralluogoIstruttorioSvolto} className="h-4 w-4" />
                      Sopralluogo istruttorio svolto
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="controdeduzioniValutate" defaultChecked={detail.procedimento.controdeduzioniValutate} className="h-4 w-4" />
                      Controdeduzioni valutate
                    </label>
                    <Select name="propostaEsitoIstruttorio" defaultValue={detail.procedimento.propostaEsitoIstruttorio ?? ""}>
                      <option value="">Nessuna proposta</option>
                      {PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES.map((item) => (
                        <option key={item} value={item}>{formatEnumLabel(item)}</option>
                      ))}
                    </Select>
                    <Textarea name="motivazioneValutazione" defaultValue={detail.procedimento.motivazioneValutazione ?? ""} className="md:col-span-2" />
                    <Textarea name="valutazioneOsservazioniPreavviso" defaultValue={detail.procedimento.valutazioneOsservazioniPreavviso ?? ""} className="md:col-span-2" />
                    <Textarea name="motivazioneMancatoPreavviso" defaultValue={detail.procedimento.motivazioneMancatoPreavviso ?? ""} className="md:col-span-2" />
                    <Textarea name="noteChecklistContraddittorio" defaultValue={detail.procedimento.noteChecklistContraddittorio ?? ""} className="md:col-span-2" />
                  </div>
                  <Button type="submit">Aggiorna checklist</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        </section> : null}

        {activeSection === "decisione" ? <Card>
          <CardHeader>
            <CardTitle>Provvedimento finale registrato</CardTitle>
            <CardDescription>
              Registrazione di atto già adottato: la registrazione nel sistema non costituisce adozione del provvedimento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Proposta istruttoria (non vincolante)</p>
                <p className="mt-1">{detail.procedimento.propostaEsitoIstruttorio ? formatEnumLabel(detail.procedimento.propostaEsitoIstruttorio) : "Nessuna proposta"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Checklist contraddittorio</p>
                <div className="mt-1">
                  <ProcedimentoChecklistBadge complete={detail.procedimento.checklistContraddittorioCompleta} />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Matrice decisionale applicata</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {decisionRules.map((rule) => (
                  <li key={rule.tipoDecisione} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <span className="font-medium text-slate-900">{rule.label}</span>: {rule.effettoLabel}
                  </li>
                ))}
              </ul>
            </div>

            {decisioneConclusiva ? (
              <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">Provvedimento registrato (sola lettura)</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <p><span className="font-medium">Tipo decisione:</span> {formatEnumLabel(decisioneConclusiva.tipoDecisione)}</p>
                  <p><span className="font-medium">Effetto:</span> {formatEnumLabel(decisioneConclusiva.effettoTitolo)}</p>
                  <p><span className="font-medium">Numero atto:</span> {decisioneConclusiva.numeroAtto}</p>
                  {decisioneConclusiva.protocolloAtto ? <p><span className="font-medium">Protocollo atto:</span> {decisioneConclusiva.protocolloAtto}</p> : null}
                  <p><span className="font-medium">Data atto:</span> {formatDateIT(decisioneConclusiva.dataAtto)}</p>
                  <p><span className="font-medium">Data efficacia:</span> {formatDateIT(decisioneConclusiva.dataEfficacia)}</p>
                  <p><span className="font-medium">Stato effetto:</span> {getStatoEffettoLabel(decisioneConclusiva.statoEffetto)}</p>
                  <p><span className="font-medium">Effetto applicato il:</span> {decisioneConclusiva.effettoApplicatoAt ? formatDateIT(decisioneConclusiva.effettoApplicatoAt) : "Non ancora applicato"}</p>
                  <p><span className="font-medium">Organo competente:</span> {decisioneConclusiva.organoCompetente}</p>
                  {decisioneConclusiva.adottanteNome ? <p><span className="font-medium">Adottante nominativo:</span> {decisioneConclusiva.adottanteNome}</p> : null}
                  {decisioneConclusiva.adottanteQualifica ? <p><span className="font-medium">Adottante qualifica:</span> {decisioneConclusiva.adottanteQualifica}</p> : null}
                  {decisioneConclusiva.registeredByUserEmail ? <p><span className="font-medium">Registrato da:</span> {decisioneConclusiva.registeredByUserEmail}</p> : null}
                  <p><span className="font-medium">Stato concessione:</span> {decisioneConclusiva.statoConcessionePrecedente ? `${formatEnumLabel(decisioneConclusiva.statoConcessionePrecedente)} -> ${decisioneConclusiva.statoConcessioneSuccessivo ? formatEnumLabel(decisioneConclusiva.statoConcessioneSuccessivo) : "nessuna variazione"}` : "Nessuna variazione"}</p>
                </div>
                <p>
                  <span className="font-medium">Scostamento da istruttoria:</span> {decisioneConclusiva.scostamentoDaIstruttoria ? "Sì" : "No"}
                </p>
                {decisioneConclusiva.motivazioneScostamentoIstruttoria ? (
                  <p><span className="font-medium">Motivazione scostamento:</span> {decisioneConclusiva.motivazioneScostamentoIstruttoria}</p>
                ) : null}
                {decisioneConclusiva.statoEffetto === "PENDENTE" ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                    Decisione registrata - effetto previsto dal {formatDateIT(decisioneConclusiva.dataEfficacia)} - non ancora applicato.
                  </p>
                ) : null}
                <p><span className="font-medium">Motivazione sintetica:</span> {decisioneConclusiva.motivazioneSintetica}</p>
                <div className="flex flex-wrap gap-3">
                  {decisioneConclusiva.documentoId && detail.documentiPrincipali.some(
                    (documento) => documento.id === decisioneConclusiva.documentoId && documento.isFileAvailable,
                  ) ? (
                    <Link href={`/documenti/${decisioneConclusiva.documentoId}/download`} prefetch={false} className="text-sm underline underline-offset-4">
                      Apri documento atto conclusivo
                    </Link>
                  ) : decisioneConclusiva.documentoId ? <span className="text-sm">Documento atto conclusivo non ancora verificato</span> : null}
                  <Link href={`/concessioni/${detail.concessione.id}`} className="text-sm underline underline-offset-4">
                    Apri concessione collegata
                  </Link>
                  <Link href="/audit" className="text-sm underline underline-offset-4">
                    Apri registro attività
                  </Link>
                </div>
              </div>
            ) : null}

            {canRenderFinalizeForm ? (
              <form action={finalizeProcedimentoDecisionAction} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                <input type="hidden" name="procedimentoId" value={detail.procedimento.id} />
                <input type="hidden" name="confermaFinalizzazione" value="CONFIRMO_REGISTRAZIONE_ATTO" />
                <p className="text-sm font-medium text-slate-900">Registra provvedimento finale</p>
                <p className="text-xs text-slate-500">La registrazione nel sistema non costituisce adozione del provvedimento. L&apos;atto deve essere già stato adottato dall&apos;organo competente.</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Tipo decisione
                    <Select name="decisionType" required defaultValue={decisionRules[0]?.tipoDecisione ?? ""}>
                      {decisionRules.map((rule) => (
                        <option key={rule.tipoDecisione} value={rule.tipoDecisione}>
                          {rule.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Documento atto conclusivo
                    <Select name="documentoId" defaultValue="" required>
                      <option value="">Seleziona documento</option>
                      {detail.documentiPrincipali.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.nome} ({formatEnumLabel(doc.tipologia)})
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Numero atto
                    <Input name="numeroAtto" required placeholder="Es. DEL-2026-001" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Protocollo atto
                    <Input name="protocolloAtto" required placeholder="Es. PROT-2026-12345" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Data atto
                    <Input name="dataAtto" type="date" required />
                  </label>
                  <label className="text-sm text-slate-700">
                    Data efficacia
                    <Input name="dataEfficacia" type="date" required />
                  </label>
                  <label className="text-sm text-slate-700">
                    Organo competente (adotta l&apos;atto)
                    <Input name="organoCompetente" required placeholder="Es. Comitato di Gestione" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Adottante nome (opzionale)
                    <Input name="adottanteNome" placeholder="Es. Mario Rossi" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Adottante qualifica (opzionale)
                    <Input name="adottanteQualifica" placeholder="Es. Presidente del Comitato" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Scostamento da istruttoria
                    <Select name="scostamentoDaIstruttoria" defaultValue="false" required>
                      <option value="false">No</option>
                      <option value="true">Si</option>
                    </Select>
                  </label>
                  <label className="text-sm text-slate-700 md:col-span-2">
                    Motivazione scostamento istruttoria (obbligatoria se scostamento=Si)
                    <Textarea name="motivazioneScostamentoIstruttoria" rows={2} />
                  </label>
                  <label className="text-sm text-slate-700 md:col-span-2">
                    Motivazione sintetica
                    <Textarea name="motivazioneSintetica" rows={3} required />
                  </label>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Conferma esplicita richiesta: la registrazione nel software non prova la competenza amministrativa dell&apos;utente registrante.
                </div>
                <SubmitButtonPending pendingLabel="Registrazione provvedimento in corso...">Conferma registrazione provvedimento</SubmitButtonPending>
              </form>
            ) : null}

            {!canRegisterDecision ? (
              <p className="text-sm text-slate-500">Profilo non autorizzato alla registrazione del provvedimento finale.</p>
            ) : null}
          </CardContent>
        </Card> : null}

        {activeSection === "istruttoria" ? <Card>
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
        </Card> : null}

        {activeSection === "concession" ? (
          <FascicoloConcession
            model={{
              number: detail.concessione.numeroAtto,
              state: formatEnumLabel(detail.concessione.stato),
              concessionaire: detail.concessionario.denominazione,
              releaseDate: formatDateIT(detail.concessione.dataRilascio),
              expiryDate: formatDateIT(detail.concessione.dataScadenza),
              openHref: `/concessioni/${detail.concessione.id}`,
              title: [
                { label: "Numero atto", value: detail.concessione.numeroAtto },
                { label: "Data rilascio", value: formatDateIT(detail.concessione.dataRilascio) },
                { label: "Data scadenza", value: formatDateIT(detail.concessione.dataScadenza) },
                { label: "Stato", value: formatEnumLabel(detail.concessione.stato) },
                { label: "Riferimento normativo", value: detail.procedimento.riferimentoNormativo ? formatEnumLabel(detail.procedimento.riferimentoNormativo) : null },
              ],
              property: [
                { label: "Ubicazione", value: detail.concessione.ubicazione },
              ],
              activity: [
                { label: "Attività", value: formatEnumLabel(detail.concessione.attivita) },
                { label: "Tipologia bene", value: formatEnumLabel(detail.concessione.tipologiaBene) },
              ],
              fee: [
                { label: "Canone annuo", value: detail.concessione.canoneAnnuo !== null ? formatCurrencyEUR(detail.concessione.canoneAnnuo) : null },
                { label: "Categoria canone", value: detail.concessione.categoriaCanone },
              ],
              normativeReferences: [
                detail.procedimento.riferimentoNormativo ? formatEnumLabel(detail.procedimento.riferimentoNormativo) : null,
                ...normeCollegate.map((item) => item.codice),
              ].filter((item): item is string => Boolean(item)),
              indicators: {
                openIssues: openIssueCount,
                openDeadlines: detail.scadenzeRilevanti.filter((item) => item.stato === "APERTA").length,
                expiredDeadlines: detail.scadenzeRilevanti.filter((item) => item.stato === "SCADUTA").length,
                criticalPayments: detail.pagamentiCritici.length,
                activeProceedings: detail.procedimento.stato === "IN_CORSO" ? 1 : 0,
                documents: detail.documentiPrincipali.length,
              },
            }}
          />
        ) : null}

        {activeSection === "issues" ? (
          <FascicoloIssues
            model={{
              issues: [
                ...(detail.criticitaCollegata ? [{
                  id: detail.criticitaCollegata.id,
                  type: formatEnumLabel(detail.criticitaCollegata.tipologia),
                  description: detail.criticitaCollegata.descrizione,
                  severity: detail.criticitaCollegata.gravita as FascicoloIssueSeverity,
                  status: detail.criticitaCollegata.stato as FascicoloIssueStatus,
                  detectedAt: formatDateIT(detail.criticitaCollegata.dataRilevazione),
                  normativeReference: detail.criticitaCollegata.riferimentoNormativo,
                  origin: "Procedimento",
                  links: [
                    { label: "Apri criticità", href: `/criticita/${detail.criticitaCollegata.id}` },
                    { label: "Apri concessione", href: `/concessioni/${concessione.id}` },
                  ],
                }] : []),
                ...detail.altreCriticitaAperte.map((item) => ({
                  id: item.id,
                  type: formatEnumLabel(item.tipologia),
                  description: item.descrizione,
                  severity: item.gravita as FascicoloIssueSeverity,
                  status: item.stato as FascicoloIssueStatus,
                  detectedAt: formatDateIT(item.dataRilevazione),
                  origin: `Concessione ${concessione.numeroAtto}`,
                  links: [
                    { label: "Apri criticità", href: `/criticita/${item.id}` },
                    { label: "Apri concessione", href: `/concessioni/${concessione.id}` },
                  ],
                })),
              ],
            }}
          />
        ) : null}

        {activeSection === "deadlines" ? (
          <FascicoloDeadlines
            model={{
              deadlines: detail.scadenzeRilevanti.map((item) => ({
                id: item.id,
                date: formatDateIT(item.dataScadenza),
                description: item.descrizione,
                type: formatEnumLabel(item.tipologia),
                status: item.stato as FascicoloDeadlineStatus,
                origin: `Concessione ${concessione.numeroAtto}`,
                links: [{ label: "Apri concessione", href: `/concessioni/${concessione.id}` }],
              })),
              candidates: [],
            }}
          />
        ) : null}

        {activeSection === "timeline" ? (
          <FascicoloTimeline
            events={timelineEvents}
            nextDeadline={nextDeadline ? formatDateIT(nextDeadline.dataScadenza) : null}
          />
        ) : null}

        {activeSection === "reports" ? <FascicoloReport snapshots={structuredReportSnapshots} /> : null}
      </div>
    </FascicoloShell>
  );
}
