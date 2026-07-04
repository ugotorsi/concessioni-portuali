export type GuidedDemoSlide = {
  id: number;
  title: string;
  subtitle?: string;
  body: string;
  bullets?: string[];
  speakerNotes: string;
  badges?: string[];
  actionLabel?: string;
  actionHref?: string;
};

export const GUIDED_DEMO_SLIDES: GuidedDemoSlide[] = [
  {
    id: 1,
    title: "Concessioni Portuali",
    subtitle: "Piattaforma intelligente di governo istruttorio",
    body:
      "Una piattaforma per trasformare dati, documenti, pagamenti, sopralluoghi, criticità e procedimenti in un fascicolo istruttorio unitario, tracciabile e orientato alla decisione amministrativa.",
    speakerNotes:
      "Questa demo non presenta un gestionale tradizionale. Presenta un livello intelligente di coordinamento istruttorio, pensato per aiutare enti concedenti, Autorità di Sistema Portuale e strutture tecniche a governare concessioni, criticità e procedimenti con maggiore ordine, tracciabilità e consapevolezza.",
    badges: ["AI", "Fascicolo"],
  },
  {
    id: 2,
    title: "Il contesto nazionale",
    body:
      "Le concessioni portuali operano in un ecosistema complesso: Autorità, porti, operatori, sistemi documentali, PEC, protocolli, pagamenti, Port Community System e strumenti GIS.",
    speakerNotes:
      "Il punto di partenza è la frammentazione. Le Autorità e gli enti concedenti dispongono già di molti sistemi, ma spesso le informazioni restano distribuite tra portali, documenti, pagamenti, comunicazioni e fascicoli non sempre connessi tra loro.",
    badges: ["GIS", "PEC"],
  },
  {
    id: 3,
    title: "Il problema",
    body:
      "Dati e documenti sono spesso disponibili, ma non sempre sono collegati in un percorso istruttorio leggibile.",
    bullets: [
      "concessioni",
      "pagamenti",
      "sopralluoghi",
      "PEC",
      "protocolli",
      "criticità",
      "procedimenti",
      "memorie",
      "report",
    ],
    speakerNotes:
      "Il problema non è solo conservare dati. Il problema è ricostruire rapidamente cosa è successo, quali evidenze sono disponibili, quali passaggi istruttori mancano e quali rischi amministrativi emergono.",
    badges: ["Fascicolo", "Audit"],
  },
  {
    id: 4,
    title: "Non un gestionale",
    body: "Un gestionale registra. Una piattaforma intelligente collega, segnala, guida e documenta.",
    speakerNotes:
      "Questa è la distinzione essenziale. Il gestionale conserva informazioni. La piattaforma intelligente mette in relazione quelle informazioni, costruisce una vista istruttoria e aiuta l’ente a non perdere passaggi rilevanti.",
    badges: ["AI"],
  },
  {
    id: 5,
    title: "Dove si colloca la piattaforma",
    body:
      "La piattaforma non sostituisce PEC, protocollo, PCS, documentale, pagamenti o GIS. Si colloca sopra o accanto ai sistemi esistenti come strato intelligente di governo istruttorio.",
    bullets: [
      "PEC e protocollo",
      "documentale",
      "pagamenti",
      "Port Community System",
      "GIS",
      "fascicolo istruttorio",
      "report e audit",
    ],
    speakerNotes:
      "Il valore non è sostituire i portali esistenti. Il valore è leggerli insieme. La piattaforma diventa un cruscotto istruttorio che collega concessione, documenti, criticità, pagamenti, sopralluoghi, procedimenti e report.",
    badges: ["PEC", "GIS", "Audit"],
  },
  {
    id: 6,
    title: "L’AI come copilota istruttorio",
    body:
      "L’intelligenza artificiale non decide al posto dell’ente. Organizza evidenze, segnala criticità, suggerisce passaggi istruttori e supporta la costruzione di provvedimenti più completi, tracciabili e motivati.",
    bullets: [
      "collega dati e documenti",
      "segnala profili di rischio",
      "suggerisce checklist",
      "evidenzia lacune",
      "prepara bozze",
      "supporta report e motivazione",
    ],
    speakerNotes:
      "L’AI lavora sul fascicolo, non al posto dell’amministrazione. Non firma, non decide e non adotta provvedimenti. Aiuta però il responsabile a leggere meglio il quadro istruttorio, riducendo dispersioni, omissioni e incoerenze.",
    badges: ["AI", "Fascicolo"],
  },
  {
    id: 7,
    title: "Aggiornamento normativo continuo",
    body:
      "Una piattaforma intelligente può collegare criticità e procedimenti al quadro normativo e giurisprudenziale rilevante, con fonti aggiornabili, versionate e verificabili.",
    bullets: [
      "Codice della Navigazione",
      "art. 47 Cod. Nav.",
      "L. 241/1990",
      "art. 10-bis",
      "giurisprudenza",
      "prassi amministrative",
      "fonti MIT, ANAC, AdSP",
    ],
    speakerNotes:
      "La piattaforma non deve promettere conoscenza normativa assoluta. Deve però poter integrare fonti aggiornate, versionate e citabili, aiutando l’ente a mantenere checklist e riferimenti coerenti con l’evoluzione normativa e giurisprudenziale.",
    badges: ["Art. 47"],
  },
  {
    id: 8,
    title: "Automazione del procedimento, non della decisione",
    body:
      "La piattaforma può automatizzare scadenze, checklist, avvisi, collegamenti tra atti, raccolta documenti e generazione di report. La decisione resta umana, motivata e imputabile all’amministrazione.",
    bullets: [
      "scadenziario",
      "alert",
      "checklist contraddittorio",
      "preavviso ex art. 10-bis",
      "fascicolo documentale",
      "protocollo e PEC",
      "report",
      "audit trail",
    ],
    speakerNotes:
      "Automatizzare il procedimento non significa automatizzare il potere amministrativo. Significa ridurre errori ripetitivi, rendere visibili i passaggi mancanti e consentire all’ente di decidere su un fascicolo più ordinato.",
    badges: ["Audit", "PEC"],
  },
  {
    id: 9,
    title: "Provvedimenti più robusti, meno vulnerabili",
    body:
      "Un provvedimento è più solido quando il fascicolo è completo, il contraddittorio è tracciato, le evidenze sono collegate, la motivazione è coerente e ogni passaggio è documentato.",
    bullets: [
      "comunicazione di avvio",
      "contestazione formale",
      "memorie",
      "osservazioni valutate",
      "regolarizzazione considerata",
      "art. 10-bis tracciato",
      "PEC e protocollo collegati",
      "audit delle attività",
    ],
    speakerNotes:
      "La piattaforma non impedisce l’impugnazione. Riduce però le vulnerabilità tipiche: carenze istruttorie, difetti di motivazione, omissioni nel contraddittorio, mancata valutazione delle memorie e disordine documentale.",
    badges: ["Audit", "Art. 47"],
  },
  {
    id: 10,
    title: "Il fascicolo intelligente",
    body:
      "Ogni documento può essere collegato a concessione, criticità, procedimento, pagamento, sopralluogo o report, con metadati, protocollo, PEC, hash e audit.",
    speakerNotes:
      "Il fascicolo non è un semplice archivio file. È un insieme di evidenze collegate, verificabili e consultabili nel punto in cui servono: sulla criticità, sul procedimento, sul pagamento, sul sopralluogo o nel report.",
    actionLabel: "Apri fascicolo documentale",
    actionHref: "/documenti",
    badges: ["Fascicolo", "PEC", "Audit"],
  },
  {
    id: 11,
    title: "Scenario: morosità ex art. 47",
    body:
      "Dal pagamento scaduto alla criticità rilevante, fino al procedimento d’ufficio e al report istruttorio.",
    speakerNotes:
      "Questo scenario mostra come una morosità possa essere letta non solo come dato contabile, ma come profilo istruttorio collegato a documenti, solleciti, PEC, procedimento e possibile rilevanza ex art. 47 Cod. Nav.",
    actionLabel: "Apri scenari demo",
    actionHref: "/demo-scenari",
    badges: ["Art. 47", "Business plan"],
  },
  {
    id: 12,
    title: "Scenario: occupazione difforme",
    body:
      "Sopralluogo, evidenze documentali, localizzazione, criticità e procedimento vengono collegati nello stesso percorso istruttorio.",
    speakerNotes:
      "Nel caso dell’occupazione difforme, il valore è collegare verbale, foto, sopralluogo, localizzazione, criticità e contraddittorio, evitando che le informazioni restino disperse tra uffici e fascicoli.",
    actionLabel: "Apri scenari demo",
    actionHref: "/demo-scenari",
    badges: ["GIS", "Fascicolo"],
  },
  {
    id: 13,
    title: "Regolarizzazione prima del provvedimento finale",
    body:
      "La regolarizzazione non cancella automaticamente la criticità, ma diventa un elemento istruttorio da valutare prima di eventuali determinazioni finali.",
    speakerNotes:
      "Il sistema traccia la regolarizzazione, la data, l’esito e la verifica. Non decide che la decadenza sia esclusa. Aiuta però a evitare che un elemento rilevante venga ignorato.",
    badges: ["Art. 47"],
  },
  {
    id: 14,
    title: "Procedimento e art. 10-bis",
    body:
      "La piattaforma distingue procedimento d’ufficio e istanza di parte, tracciando comunicazione di avvio, contraddittorio, preavviso di rigetto e valutazione delle osservazioni.",
    speakerNotes:
      "Il procedimento amministrativo è fatto di passaggi. La piattaforma aiuta a verificare che quei passaggi siano presenti, coerenti e documentati, senza sostituire la valutazione del responsabile.",
    actionLabel: "Apri procedimenti",
    actionHref: "/procedimenti",
    badges: ["Audit", "Art. 47"],
  },
  {
    id: 15,
    title: "Mappa GIS-ready",
    body:
      "La vista territoriale consente di localizzare concessioni, criticità e sopralluoghi, collegando il dato amministrativo alla dimensione fisica dell’area.",
    speakerNotes:
      "La mappa è una baseline GIS-ready. Non sostituisce cartografie ufficiali o rilievi tecnici, ma permette alla demo di mostrare il territorio come parte del fascicolo.",
    actionLabel: "Apri mappa",
    actionHref: "/mappa",
    badges: ["GIS"],
  },
  {
    id: 16,
    title: "PDF istituzionale",
    body:
      "Il report PDF sintetizza fascicolo, criticità, procedimenti, documenti, protocollo, PEC, mappa e disclaimer istruttori.",
    speakerNotes:
      "Il PDF non è un provvedimento automatico. È un documento istruttorio, pensato per ricostruire il quadro e supportare la valutazione amministrativa.",
    actionLabel: "Apri report",
    actionHref: "/report",
    badges: ["Fascicolo", "PEC"],
  },
  {
    id: 17,
    title: "Audit e sicurezza",
    body:
      "Ruoli, audit trail, hash chain, rate limit Redis-ready, lockout, CI/CD e test automatizzati rendono la piattaforma più affidabile e verificabile.",
    speakerNotes:
      "La tracciabilità è essenziale. Ogni caricamento, modifica, validazione e download rilevante deve poter essere ricostruito, soprattutto in un contesto amministrativo e contenzioso.",
    badges: ["Audit", "AI"],
  },
  {
    id: 18,
    title: "Modello di adozione",
    body:
      "Il percorso commerciale naturale è un pilot istituzionale, seguito da configurazione dati, formazione, canone annuo e moduli opzionali.",
    bullets: [
      "pilot con AdSP o ente concedente",
      "setup dati",
      "formazione",
      "canone annuo",
      "moduli opzionali",
      "integrazioni protocollo, PEC, GIS e storage",
    ],
    speakerNotes:
      "La piattaforma si presta a un modello graduale: prima una demo guidata, poi un pilot su un perimetro limitato, infine integrazioni progressive con sistemi reali.",
    badges: ["Business plan"],
  },
  {
    id: 19,
    title: "Valore economico e organizzativo",
    body:
      "La piattaforma riduce dispersione documentale, omissioni istruttorie, tempi di ricostruzione del fascicolo e vulnerabilità del procedimento.",
    bullets: [
      "meno dispersione",
      "più tracciabilità",
      "reportistica rapida",
      "controllo criticità",
      "supporto a contenzioso e audit",
      "migliore qualità istruttoria",
    ],
    speakerNotes:
      "Il beneficio non è solo tecnologico. È organizzativo, amministrativo e difensivo: sapere dove sono gli atti, quali passaggi mancano e quali evidenze supportano la decisione.",
    badges: ["Business plan", "Audit"],
  },
  {
    id: 20,
    title: "Roadmap 30 / 60 / 90 giorni",
    body:
      "Un pilot può partire con dati demo, poi integrare fascicoli reali, protocollo, PEC, storage esterno, GIS evoluto e aggiornamento normativo.",
    bullets: [
      "30 giorni: demo e configurazione pilota",
      "60 giorni: import fascicoli e workflow",
      "90 giorni: integrazioni e misurazione risultati",
    ],
    speakerNotes:
      "La roadmap deve essere credibile. Non promette tutto subito, ma propone un percorso progressivo: dimostrazione, validazione, integrazione e consolidamento.",
    badges: ["Business plan", "GIS"],
  },
  {
    id: 21,
    title: "Chiusura",
    body:
      "La piattaforma non decide al posto dell’ente: rende più ordinato, verificabile e difendibile il percorso che porta alla decisione.",
    speakerNotes:
      "Questa è la sintesi del progetto. Una piattaforma intelligente non sostituisce il potere amministrativo, ma rafforza il procedimento, collega le evidenze e migliora la qualità della decisione.",
    badges: ["AI", "Audit", "Fascicolo"],
  },
];
