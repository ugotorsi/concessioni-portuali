import { prisma } from "@/lib/prisma";
import { formatEnumLabel } from "@/lib/utils";

export interface DemoJourneyStep {
  title: string;
  description: string;
  href: string;
  label: string;
}

export interface DemoJourneyData {
  concessioneNumeroAtto: string;
  concessionario: string;
  steps: DemoJourneyStep[];
}

export interface DemoModuleCard {
  title: string;
  subtitle: string;
  href: string;
}

export interface DemoPageData {
  journey: DemoJourneyData;
  cards: DemoModuleCard[];
}

function buildStaticCards(): DemoModuleCard[] {
  return [
    {
      title: "Dashboard operativa",
      subtitle: "Quadro sintetico KPI, priorita e azioni consigliate.",
      href: "/dashboard",
    },
    {
      title: "Concessioni",
      subtitle: "Anagrafica rapporti concessori e contesto patrimoniale.",
      href: "/concessioni",
    },
    {
      title: "Criticita",
      subtitle: "Anomalie tecniche, giuridiche ed economiche in gestione.",
      href: "/criticita",
    },
    {
      title: "Scadenze e pagamenti",
      subtitle: "Agenda adempimenti, morosita e stato economico.",
      href: "/pagamenti",
    },
    {
      title: "Procedimenti",
      subtitle: "Flusso istruttorio read-only con checklist operativa.",
      href: "/procedimenti",
    },
    {
      title: "Report",
      subtitle: "Output finali, dossier e reportistica di supporto.",
      href: "/report",
    },
  ];
}

export async function getDemoPageData(): Promise<DemoPageData> {
  const focusedConcessione = await prisma.concessione.findFirst({
    where: {
      numeroAtto: "CP-067/2018",
    },
    include: {
      concessionario: {
        select: {
          denominazione: true,
        },
      },
      sopralluoghi: {
        orderBy: [{ data: "desc" }],
        take: 1,
        select: {
          id: true,
          data: true,
          esito: true,
        },
      },
      criticita: {
        where: { stato: { in: ["APERTA", "IN_GESTIONE"] } },
        orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
        take: 1,
        select: {
          id: true,
          tipologia: true,
          gravita: true,
        },
      },
      pagamenti: {
        where: { stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] } },
        orderBy: [{ dataScadenza: "asc" }],
        take: 1,
        select: {
          id: true,
          annoRiferimento: true,
          stato: true,
        },
      },
      scadenze: {
        where: { stato: { in: ["APERTA", "SCADUTA"] } },
        orderBy: [{ dataScadenza: "asc" }],
        take: 1,
        select: {
          id: true,
          tipologia: true,
          stato: true,
        },
      },
      procedimenti: {
        where: { stato: { in: ["DA_AVVIARE", "IN_CORSO"] } },
        orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          tipologia: true,
          stato: true,
        },
      },
      report: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          tipologia: true,
          validato: true,
        },
      },
    },
  });

  if (!focusedConcessione) {
    return {
      journey: {
        concessioneNumeroAtto: "N/D",
        concessionario: "N/D",
        steps: [
          {
            title: "Concessione",
            description: "Apri il modulo concessioni per selezionare una posizione da illustrare.",
            href: "/concessioni",
            label: "Apri concessioni",
          },
        ],
      },
      cards: buildStaticCards(),
    };
  }

  const steps: DemoJourneyStep[] = [
    {
      title: "Concessione",
      description: `Base del percorso: ${focusedConcessione.numeroAtto} (${focusedConcessione.concessionario.denominazione}).`,
      href: `/concessioni/${focusedConcessione.id}`,
      label: "Apri concessione",
    },
  ];

  const sopralluogo = focusedConcessione.sopralluoghi[0];
  if (sopralluogo) {
    steps.push({
      title: "Sopralluogo",
      description: `Esito ${formatEnumLabel(sopralluogo.esito)} su rilievo tecnico recente.`,
      href: `/sopralluoghi/${sopralluogo.id}`,
      label: "Apri sopralluogo",
    });
  }

  const criticita = focusedConcessione.criticita[0];
  if (criticita) {
    steps.push({
      title: "Criticita",
      description: `${formatEnumLabel(criticita.tipologia)} (${formatEnumLabel(criticita.gravita)}).`,
      href: `/criticita/${criticita.id}`,
      label: "Apri criticita",
    });
  }

  const pagamento = focusedConcessione.pagamenti[0];
  const scadenza = focusedConcessione.scadenze[0];
  if (pagamento || scadenza) {
    steps.push({
      title: "Pagamento / Scadenza",
      description: pagamento
        ? `Posizione ${pagamento.annoRiferimento} in stato ${formatEnumLabel(pagamento.stato)} con evidenza economica.`
        : `Scadenza ${formatEnumLabel(scadenza!.tipologia)} in stato ${formatEnumLabel(scadenza!.stato)}.`,
      href: pagamento ? `/pagamenti/${pagamento.id}` : `/scadenze/${scadenza!.id}`,
      label: pagamento ? "Apri pagamento" : "Apri scadenza",
    });
  }

  const procedimento = focusedConcessione.procedimenti[0];
  if (procedimento) {
    steps.push({
      title: "Procedimento",
      description: `${formatEnumLabel(procedimento.tipologia)} in stato ${formatEnumLabel(procedimento.stato)}.`,
      href: `/procedimenti/${procedimento.id}`,
      label: "Apri procedimento",
    });
  }

  const report = focusedConcessione.report[0];
  if (report) {
    steps.push({
      title: "Report",
      description: `${formatEnumLabel(report.tipologia)} ${report.validato ? "validato" : "da validare"}.`,
      href: `/report/${report.id}`,
      label: "Apri report",
    });
  }

  return {
    journey: {
      concessioneNumeroAtto: focusedConcessione.numeroAtto,
      concessionario: focusedConcessione.concessionario.denominazione,
      steps,
    },
    cards: buildStaticCards(),
  };
}
