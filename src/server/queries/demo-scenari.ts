import { prisma } from "@/lib/prisma";

export interface DemoScenarioBlueprint {
  slug: string;
  title: string;
  description: string;
  administrativeProblem: string;
  platformFocus: string;
  modules: string[];
  riskLevel: "MEDIO" | "ALTO" | "CRITICO";
  concessioneNumeroAtto: string;
  notes: string;
}

export interface DemoScenarioItem {
  slug: string;
  title: string;
  description: string;
  concessionVertical: string | null;
  administrativeProblem: string;
  platformFocus: string;
  modules: string[];
  riskLevel: "MEDIO" | "ALTO" | "CRITICO";
  concessioneId: string | null;
  criticitaId: string | null;
  procedimentoId: string | null;
  reportId: string | null;
  pdfUrl: string | null;
  notes: string;
}

export const DEMO_SCENARIO_BLUEPRINTS: DemoScenarioBlueprint[] = [
  {
    slug: "morosita-art47",
    title: "Morosita rilevante ex art. 47",
    description:
      "Scenario con canone scaduto e profilo art. 47 da valutare in istruttoria, con procedimento d ufficio e report validato.",
    administrativeProblem:
      "Morosita reiterata su concessione attiva con rischio decadenziale alto come elemento da valutare.",
    platformFocus:
      "Allineamento tra pagamenti, criticita art. 47, procedimento e documento istruttorio validato.",
    modules: ["Concessioni", "Pagamenti", "Criticita", "Procedimenti", "Report"],
    riskLevel: "ALTO",
    concessioneNumeroAtto: "CP-014/2020",
    notes:
      "Profilo istruttorio: la rilevanza ex art. 47 costituisce supporto al responsabile del procedimento e non automatismo decisorio.",
  },
  {
    slug: "occupazione-difforme",
    title: "Occupazione difforme / uso non conforme",
    description:
      "Scenario tecnico-giuridico con rilievi da sopralluogo, criticita di occupazione difforme e ordine di ripristino con checklist non completa.",
    administrativeProblem:
      "Uso difforme del bene rispetto al titolo con necessita di verifica tecnica e presidio procedimentale.",
    platformFocus:
      "Collegamento tra sopralluogo, criticita, warning checklist e report istituzionale.",
    modules: ["Concessioni", "Sopralluoghi", "Criticita", "Procedimenti", "Report"],
    riskLevel: "ALTO",
    concessioneNumeroAtto: "CP-001/2021",
    notes:
      "Profilo istruttorio: il warning evidenzia passaggi da completare e supporta il responsabile del procedimento.",
  },
  {
    slug: "regolarizzazione-pre-provvedimento",
    title: "Regolarizzazione prima del provvedimento finale",
    description:
      "Scenario con criticita art. 47 regolarizzata in corso istruttorio, con evidenza documentale della regolarizzazione e report dedicato.",
    administrativeProblem:
      "Necessita di valutare gli effetti della regolarizzazione senza automatica archiviazione del procedimento.",
    platformFocus:
      "Tracciamento regolarizzazione, verifica successiva e narrativa PDF istituzionale.",
    modules: ["Criticita", "Procedimenti", "Report"],
    riskLevel: "MEDIO",
    concessioneNumeroAtto: "CP-067/2018",
    notes:
      "La regolarizzazione e un elemento da valutare e non determina in automatico esito favorevole o archiviazione.",
  },
  {
    slug: "contraddittorio-incompleto",
    title: "Contraddittorio incompleto",
    description:
      "Scenario con procedimento sfavorevole in corso e checklist incompleta, utile per illustrare warning alto e guidance istruttoria.",
    administrativeProblem:
      "Passaggi essenziali del contraddittorio non ancora completati prima della proposta conclusiva.",
    platformFocus:
      "Evidenza checklist, warning e punti di attenzione procedimentale.",
    modules: ["Procedimenti", "Criticita", "Report"],
    riskLevel: "CRITICO",
    concessioneNumeroAtto: "CP-067/2018",
    notes:
      "Supporto al responsabile del procedimento: il sistema segnala criticita istruttorie ma non adotta decisioni.",
  },
  {
    slug: "istanza-parte-art10bis",
    title: "Istanza di parte e art. 10-bis",
    description:
      "Scenario a istanza di parte con preavviso di rigetto tracciato e osservazioni ricevute, per illustrare il presidio istruttorio caso per caso.",
    administrativeProblem:
      "Gestione del preavviso ex art. 10-bis e valutazione motivata delle osservazioni.",
    platformFocus:
      "Tracking di preavviso, osservazioni e motivazione istruttoria nel procedimento.",
    modules: ["Procedimenti", "Criticita", "Report"],
    riskLevel: "MEDIO",
    concessioneNumeroAtto: "CP-058/2019",
    notes:
      "Art. 10-bis trattato come profilo istruttorio da valutare in concreto, non come automatismo applicativo.",
  },
  {
    slug: "comune-costiero-stagionale",
    title: "Concessione turistico-ricreativa in Comune costiero",
    description:
      "Scenario dimostrativo su concessione stagionale turistico-ricreativa con focus su comparazione ex art. 37 e presidio istruttorio.",
    administrativeProblem:
      "Gestione di profili combinati: stagionalita, morosita/residui e istanza concorrente in area costiera ad uso turistico.",
    platformFocus:
      "Visibilita della verticale turistico-ricreativa/comune costiero nel percorso concessione-criticita-procedimento-report.",
    modules: ["Concessioni", "Criticita", "Procedimenti", "Report"],
    riskLevel: "MEDIO",
    concessioneNumeroAtto: "CP-031/2017",
    notes:
      "Supporto istruttorio: art. 47 trattato come profilo di rischio/procedura e non come automatismo di decadenza.",
  },
];

function buildFallbackScenarios(): DemoScenarioItem[] {
  return DEMO_SCENARIO_BLUEPRINTS.map((blueprint) => ({
    slug: blueprint.slug,
    title: blueprint.title,
    description: blueprint.description,
    concessionVertical: null,
    administrativeProblem: blueprint.administrativeProblem,
    platformFocus: blueprint.platformFocus,
    modules: blueprint.modules,
    riskLevel: blueprint.riskLevel,
    concessioneId: null,
    criticitaId: null,
    procedimentoId: null,
    reportId: null,
    pdfUrl: null,
    notes: `${blueprint.notes} Dati demo temporaneamente non disponibili.`,
  }));
}

function reportTitleForSlug(slug: string): string {
  switch (slug) {
    case "morosita-art47":
      return "DEMO-01 - Morosita art. 47";
    case "occupazione-difforme":
      return "DEMO-02 - Occupazione difforme";
    case "regolarizzazione-pre-provvedimento":
      return "DEMO-03 - Regolarizzazione pre-provvedimentale";
    case "contraddittorio-incompleto":
      return "DEMO-04 - Contraddittorio incompleto";
    case "istanza-parte-art10bis":
      return "DEMO-05 - Istanza di parte e art. 10-bis";
    default:
      return "";
  }
}

export async function getDemoScenarios(): Promise<DemoScenarioItem[]> {
  try {
    const concessioni = await prisma.concessione.findMany({
      where: {
        numeroAtto: {
          in: DEMO_SCENARIO_BLUEPRINTS.map((item) => item.concessioneNumeroAtto),
        },
      },
      select: {
        id: true,
        numeroAtto: true,
        concessionVertical: true,
      },
    });

      const concessioneByNumeroAtto = new Map(
        concessioni.map((item) => [item.numeroAtto, { id: item.id, concessionVertical: item.concessionVertical }]),
      );

    const reports = await prisma.report.findMany({
      where: {
        titolo: {
          in: DEMO_SCENARIO_BLUEPRINTS.map((item) => reportTitleForSlug(item.slug)),
        },
      },
      select: {
        id: true,
        titolo: true,
      },
    });

    const reportIdByTitle = new Map(reports.map((item) => [item.titolo, item.id]));

    const scenarios = await Promise.all(
      DEMO_SCENARIO_BLUEPRINTS.map(async (blueprint) => {
        const concessioneEntry = concessioneByNumeroAtto.get(blueprint.concessioneNumeroAtto) ?? null;
        const concessioneId = concessioneEntry?.id ?? null;

        if (!concessioneId) {
          return {
            slug: blueprint.slug,
            title: blueprint.title,
            description: blueprint.description,
            concessionVertical: concessioneEntry?.concessionVertical ?? null,
            administrativeProblem: blueprint.administrativeProblem,
            platformFocus: blueprint.platformFocus,
            modules: blueprint.modules,
            riskLevel: blueprint.riskLevel,
            concessioneId: null,
            criticitaId: null,
            procedimentoId: null,
            reportId: reportIdByTitle.get(reportTitleForSlug(blueprint.slug)) ?? null,
            pdfUrl: null,
            notes: `${blueprint.notes} Concessione scenario non disponibile.`,
          } as DemoScenarioItem;
        }

        let criticitaId: string | null = null;
        let procedimentoId: string | null = null;

        if (blueprint.slug === "morosita-art47") {
          const criticita = await prisma.criticita.findFirst({
            where: {
              concessioneId,
              tipologia: "MOROSITA",
              rilevanzaArt47: true,
            },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            select: { id: true },
          });
          criticitaId = criticita?.id ?? null;

          const procedimento = await prisma.procedimento.findFirst({
            where: {
              concessioneId,
              procedimentoUfficio: true,
              comunicazioneAvvioInviata: true,
              contestazioneFormaleInviata: true,
            },
            orderBy: [{ createdAt: "desc" }],
            select: { id: true },
          });
          procedimentoId = procedimento?.id ?? null;
        }

        if (blueprint.slug === "occupazione-difforme") {
          const criticita = await prisma.criticita.findFirst({
            where: {
              concessioneId,
              tipologia: { in: ["OCCUPAZIONE_DIFFORME", "USO_NON_CONFORME"] },
            },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            select: { id: true },
          });
          criticitaId = criticita?.id ?? null;

          const procedimento = await prisma.procedimento.findFirst({
            where: {
              concessioneId,
              tipologia: "ORDINE_RIPRISTINO",
            },
            orderBy: [{ createdAt: "desc" }],
            select: { id: true },
          });
          procedimentoId = procedimento?.id ?? null;
        }

        if (blueprint.slug === "regolarizzazione-pre-provvedimento") {
          const criticita = await prisma.criticita.findFirst({
            where: {
              concessioneId,
              rilevanzaArt47: true,
              regolarizzata: true,
            },
            orderBy: [{ dataRegolarizzazione: "desc" }],
            select: { id: true },
          });
          criticitaId = criticita?.id ?? null;

          const procedimento = await prisma.procedimento.findFirst({
            where: {
              concessioneId,
              stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
            },
            orderBy: [{ createdAt: "desc" }],
            select: { id: true },
          });
          procedimentoId = procedimento?.id ?? null;
        }

        if (blueprint.slug === "contraddittorio-incompleto") {
          const criticita = await prisma.criticita.findFirst({
            where: {
              concessioneId,
              tipologia: "RISCHIO_DECADENZA",
            },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            select: { id: true },
          });
          criticitaId = criticita?.id ?? null;

          const procedimento = await prisma.procedimento.findFirst({
            where: {
              concessioneId,
              tipologia: "AVVIO_DECADENZA",
              checklistContraddittorioCompleta: false,
            },
            orderBy: [{ createdAt: "desc" }],
            select: { id: true },
          });
          procedimentoId = procedimento?.id ?? null;
        }

        if (blueprint.slug === "istanza-parte-art10bis") {
          const criticita = await prisma.criticita.findFirst({
            where: {
              concessioneId,
              tipologia: "USO_NON_CONFORME",
            },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            select: { id: true },
          });
          criticitaId = criticita?.id ?? null;

          const procedimento = await prisma.procedimento.findFirst({
            where: {
              concessioneId,
              origineProcedimento: "ISTANZA_PARTE",
              preavvisoRigettoApplicabile: true,
              statoPreavvisoRigetto: {
                in: ["INVIATO", "OSSERVAZIONI_RICEVUTE", "OSSERVAZIONI_VALUTATE"],
              },
            },
            orderBy: [{ createdAt: "desc" }],
            select: { id: true },
          });
          procedimentoId = procedimento?.id ?? null;
        }

        const reportId = reportIdByTitle.get(reportTitleForSlug(blueprint.slug)) ?? null;

        return {
          slug: blueprint.slug,
          title: blueprint.title,
          description: blueprint.description,
          concessionVertical: concessioneEntry?.concessionVertical ?? null,
          administrativeProblem: blueprint.administrativeProblem,
          platformFocus: blueprint.platformFocus,
          modules: blueprint.modules,
          riskLevel: blueprint.riskLevel,
          concessioneId,
          criticitaId,
          procedimentoId,
          reportId,
          pdfUrl: reportId ? `/report/${reportId}/pdf` : null,
          notes: blueprint.notes,
        } as DemoScenarioItem;
      }),
    );

    return scenarios;
  } catch {
    return buildFallbackScenarios();
  }
}
