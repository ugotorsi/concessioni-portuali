export interface InvestorDemoIdentity {
  userName: string;
  organization: string;
  roleLabel: string;
  tenantId: string;
}

export interface InvestorDemoModuleItem {
  title: string;
  status: string;
  note: string;
}

export const investorDemoIdentity: InvestorDemoIdentity = {
  userName: "Demo Investitore",
  organization: "Ambiente dimostrativo",
  roleLabel: "Amministratore demo",
  tenantId: "INVESTOR-DEMO-TENANT",
};

export const investorDemoDashboard = {
  concessioniMonitorate: 12,
  procedimentiInIstruttoria: 4,
  scadenze90Giorni: 3,
  anomalieDaVerificare: 2,
  fontiDocumentali: 33,
  portiPilota: 3,
  autorita: "Autorita di Sistema Portuale del Mar Tirreno Centrale",
  porti: ["Napoli", "Salerno", "Castellammare di Stabia"],
};

export const investorDemoConcessioni: InvestorDemoModuleItem[] = [
  { title: "Concessione demo A-01", status: "Attiva", note: "Area banchina commerciale" },
  { title: "Concessione demo A-02", status: "In proroga tecnica", note: "Servizi logistici" },
  { title: "Concessione demo A-03", status: "In monitoraggio", note: "Specchio acqueo operativo" },
];

export const investorDemoProcedimenti: InvestorDemoModuleItem[] = [
  { title: "Procedimento demo P-11", status: "In corso", note: "Verifica documentale su canoni" },
  { title: "Procedimento demo P-12", status: "Da avviare", note: "Richiesta integrazione istruttoria" },
  { title: "Procedimento demo P-13", status: "In valutazione", note: "Memorie e contraddittorio" },
];

export const investorDemoDocumenti: InvestorDemoModuleItem[] = [
  { title: "Verbale demo sopralluogo", status: "Registrato", note: "Documento simulato" },
  { title: "Nota demo monitoraggio", status: "Registrato", note: "Documento simulato" },
  { title: "Allegato demo planimetrico", status: "Registrato", note: "Documento simulato" },
];

export const investorDemoScadenze: InvestorDemoModuleItem[] = [
  { title: "Scadenza demo S-01", status: "Entro 30 giorni", note: "Presidio operativo richiesto" },
  { title: "Scadenza demo S-02", status: "Entro 60 giorni", note: "Verifica programmazione" },
  { title: "Scadenza demo S-03", status: "Entro 90 giorni", note: "Aggiornamento dossier" },
];

export const investorDemoNormativa: InvestorDemoModuleItem[] = [
  { title: "Fonte demo N-01", status: "In presidio", note: "Fonte simulata con verifica professionale" },
  { title: "Fonte demo N-02", status: "In presidio", note: "Fonte simulata con collegamento procedurale" },
  { title: "Fonte demo N-03", status: "In osservazione", note: "Possibile impatto istruttorio" },
];

export const investorDemoOrchestration = {
  authority: "AdSP Mar Tirreno Centrale",
  port: "Salerno",
  confidence: "MEDIUM",
  professionalBadge: "Verifica professionale richiesta",
  disclaimer: "Output di supporto istruttorio: non costituisce decisione amministrativa e richiede verifica professionale.",
  applicableSources: ["REG-PORT-2024", "ORD-OPER-2025"],
  excludedByTerritory: ["REG-AREA-NAPOLI-2025"],
  historicalSources: ["DISCIPLINA-2019"],
  pendingSources: ["PARERE-TECNICO-2026"],
  conflicts: ["Possibile sovrapposizione tra disciplina operativa 2024 e nota tecnica 2026"],
  gaps: ["Manca allegato tecnico aggiornato per verifica completa"],
  reasoningTrace: [
    "Identificato contesto: autorita AdSP MTC, porto Salerno, data corrente.",
    "Selezionate fonti di riferimento primarie e secondarie disponibili nel perimetro demo.",
    "Segnalati elementi da verifica professionale prima di ogni atto operativo.",
  ],
};
