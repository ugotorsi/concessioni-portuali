import type { StructuredReportProceduralContext } from "@/server/fascicolo-report/structured-report";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

/**
 * Fictitious fascicoli with materially different phases, titles, dates and issues.
 * None of them is Selvara: they prove that the pipeline is general.
 */

let counter = 0;
const sha = (value: string) => Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);

export function kItem(
  kind: StructuredKnowledgeReadItem["kind"],
  text: string,
  pages: number[] = [1],
  extra: Partial<StructuredKnowledgeReadItem> = {},
): StructuredKnowledgeReadItem {
  counter += 1;
  const id = `${kind.toLowerCase()}-${counter}`;
  return {
    id,
    kind,
    semanticKey: sha(id),
    contentFingerprint: sha(`${id}f`),
    normalizedText: text,
    payload: {},
    confidence: 0.9,
    status: "AI_PROPOSED",
    reviewVersion: 1,
    evidence: pages.map((pageNumber) => ({
      basisRef: `DOCUMENT_1.PAGE_${pageNumber}`,
      documentoId: "doc-1",
      documentFileVersionId: "ver-1",
      pageNumber,
      textSha256: sha(`${id}${pageNumber}`),
    })),
    ...extra,
  };
}

export function procedural(overrides: Partial<StructuredReportProceduralContext>): StructuredReportProceduralContext {
  return {
    stato: "DA_AVVIARE",
    tipologia: "ALTRO",
    origineProcedimento: "UFFICIO",
    dataAvvio: null,
    dataProvvedimentoFinale: null,
    comunicazioneAvvioInviata: false,
    contestazioneFormaleInviata: false,
    memorieRicevute: false,
    audizioneSvolta: false,
    controdeduzioniValutate: false,
    checklistContraddittorioCompleta: false,
    finalAct: null,
    concessione: null,
    documentTitles: [],
    ...overrides,
  };
}

export function knowledgeModel(input: {
  createdAt: string;
  facts?: StructuredKnowledgeReadItem[];
  legalActs?: StructuredKnowledgeReadItem[];
  issues: Array<{ text: string; from: StructuredKnowledgeReadItem[] }>;
}): StructuredKnowledgeReadModel {
  const legalIssues = input.issues.map((issue) => ({
    ...kItem("LEGAL_ISSUE", issue.text),
    originatingItemIds: issue.from.map((item) => item.id),
  }));
  return {
    revision: {
      id: "revision-scenario",
      corpusFingerprint: sha("corpus"),
      contractVersion: "FASCICOLO_KNOWLEDGE_V1",
      createdAt: new Date(`${input.createdAt}T09:00:00.000Z`),
      completedAt: new Date(`${input.createdAt}T09:01:00.000Z`),
      warnings: [],
    },
    subjects: [],
    partyRoles: [],
    facts: input.facts ?? [],
    events: [],
    legalActs: input.legalActs ?? [],
    measures: [],
    contradictions: [],
    gaps: [],
    deadlineCandidates: [],
    legalIssues,
    researchQuestions: [],
    timeline: [],
  } as StructuredKnowledgeReadModel;
}

export interface Scenario {
  name: string;
  input: Parameters<typeof import("@/server/fascicolo-report").buildStructuredFascicoloReport>[0];
}

function scenario(name: string, proceduralContext: StructuredReportProceduralContext, knowledge: StructuredKnowledgeReadModel): Scenario {
  return { name, input: { tenantId: "tenant-acceptance", procedimentoId: `proc-${name}`, knowledge, missions: [], proceduralContext } };
}

const auroraOccupation = kItem("FACT", "Verbale di sopralluogo del 15/01/2026: sulla banchina portuale di Porto Aurora è stato rilevato un manufatto prefabbricato di 40 mq installato dal concessionario all'esterno del perimetro dell'area in concessione, senza autorizzazione dell'Autorità di sistema portuale.", [3, 4]);
const auroraTitle = kItem("FACT", "Atto di concessione demaniale marittima n. 3/2021 rilasciato il 20/01/2021 per area portuale e banchina ai sensi dell'art. 18 L. 84/1994.", [1]);

const feeFact = kItem("FACT", "Per l'annualità 2026 la rata contrattuale del canone demaniale di 48.000 euro risulta versata solo in acconto per 12.000 euro; residuano 36.000 euro non corrisposti alla scadenza del 31/03/2026.", [5]);
const feeTitle = kItem("FACT", "Concessione n. 11/2024 rilasciata il 04/04/2024 per terminal portuale ai sensi dell'art. 18 L. 84/1994.", [1]);

const thirdAuthorized = kItem("FACT", "La società Logistica Delta utilizza il magazzino M2 dell'area portuale in concessione; agli atti è presente l'autorizzazione dell'Autorità di sistema portuale del 10/02/2025 all'affidamento ad altri ai sensi dell'art. 45-bis cod. nav.", [6]);
const thirdTitle = kItem("FACT", "Concessione n. 8/2019 rilasciata il 10/05/2019 per area portuale e banchina.", [1]);

const newTitle = kItem("FACT", "Atto di concessione n. 3/2026 rilasciato il 20/06/2026 per banchina portuale a seguito di procedura comparativa ex art. 18 L. 84/1994 avviata il 15/03/2026.", [1]);
const newInvest = kItem("FACT", "Il programma di attività allegato alla concessione n. 3/2026 prevede il dragaggio dell'accosto e la realizzazione di una gru di banchina entro il 31/12/2027.", [8]);

const controlTitle = kItem("FACT", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale.", [1]);
const controlEvent = kItem("FACT", "Istanza di autorizzazione al trasferimento del controllo della società concessionaria presentata il 15/04/2026.", [12]);

const reviewDecadence = kItem("LEGAL_ACT", "Determinazione n. 149/2026 dichiarativa della decadenza dalla concessione n. 5/2022 per omesso pagamento del canone.", [20]);
const reviewRequest = kItem("FACT", "Istanza di riesame in autotutela presentata dal concessionario il 16/10/2026 avverso la determinazione di decadenza n. 149/2026.", [24]);
const reviewTitle = kItem("FACT", "Concessione n. 5/2022 rilasciata il 12/09/2022 per area portuale.", [1]);
const reviewFee = kItem("FACT", "Le rate del canone demaniale 2025 e 2026 non risultano versate.", [18]);

const municipalFact = kItem("FACT", "Il Comune ha ricevuto una segnalazione certificata di inizio attività per un esercizio commerciale in centro storico.", [2]);

export const SCENARIOS: Scenario[] = [
  scenario("porto-aurora-occupazione", procedural({
    stato: "IN_CORSO",
    dataAvvio: "2026-02-01T00:00:00.000Z",
    comunicazioneAvvioInviata: true,
    contestazioneFormaleInviata: true,
    concessione: { numeroAtto: "3/2021", stato: "ATTIVA", dataRilascio: "2021-01-20T00:00:00.000Z" },
  }), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [auroraTitle, auroraOccupation],
    issues: [{ text: "Occupazione non autorizzata di area demaniale portuale oltre il perimetro della concessione", from: [auroraOccupation] }],
  })),
  scenario("canone-acconto", procedural({}), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [feeTitle, feeFact],
    issues: [{ text: "Omesso o parziale pagamento del canone demaniale", from: [feeFact] }],
  })),
  scenario("uso-terzi-autorizzato", procedural({}), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [thirdTitle, thirdAuthorized],
    issues: [{ text: "Uso del magazzino M2 da parte di terzo operatore", from: [thirdAuthorized] }],
  })),
  scenario("titolo-2026-investimenti", procedural({}), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [newTitle, newInvest],
    issues: [{ text: "Inadempimento del programma di investimenti della concessione", from: [newInvest] }],
  })),
  scenario("cambio-controllo-2026", procedural({}), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [controlTitle, controlEvent],
    issues: [{ text: "Trasferimento del controllo della società concessionaria del terminal portuale", from: [controlEvent] }],
  })),
  scenario("decadenza-con-riesame", procedural({
    stato: "CONCLUSO",
    dataAvvio: "2026-03-01T00:00:00.000Z",
    comunicazioneAvvioInviata: true,
    contestazioneFormaleInviata: true,
    memorieRicevute: true,
    controdeduzioniValutate: true,
    finalAct: { numeroAtto: "149/2026", dataAtto: "2026-09-30T00:00:00.000Z", motivazioneSintetica: "Decadenza per omesso pagamento del canone" },
    concessione: { numeroAtto: "5/2022", stato: "REVOCATA", dataRilascio: "2022-09-12T00:00:00.000Z" },
    documentTitles: ["Istanza di riesame in autotutela"],
  }), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [reviewTitle, reviewFee, reviewRequest],
    legalActs: [reviewDecadence],
    issues: [{ text: "Omesso pagamento del canone demaniale e decadenza", from: [reviewFee] }],
  })),
  scenario("materia-non-portuale", procedural({}), knowledgeModel({
    createdAt: "2026-11-03",
    facts: [municipalFact],
    issues: [{ text: "Regolarità della segnalazione certificata di inizio attività", from: [municipalFact] }],
  })),
];
