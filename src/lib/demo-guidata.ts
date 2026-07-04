export type GuidedDemoSlide = {
  id: number;
  title: string;
  subtitle?: string;
  body: string;
  bullets?: string[];
  speakerNotes: string;
  narrationScript: string;
  visitIntro?: string;
  badges?: string[];
  actionLabel?: string;
  actionHref?: string;
};

export const GUIDED_DEMO_STATE_STORAGE_KEY = "concessioni-demo-guidata-state";

export type GuidedDemoSessionState = {
  slideId: number;
  slideIndex: number;
  autoNarration: boolean;
  wasSpeaking: boolean;
  lastVisitedHref?: string;
  lastVisitedLabel?: string;
  pausedForVisit?: boolean;
  updatedAt: string;
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
    narrationScript:
      "Apriamo la demo con il suo messaggio principale: non stiamo presentando un software operativo generico, ma una piattaforma che organizza il lavoro istruttorio sulle concessioni portuali. Il valore nasce dalla capacità di collegare informazioni che spesso restano separate, come documenti, pagamenti, sopralluoghi e procedimenti. In questo modo il fascicolo diventa unitario, leggibile e utile alla decisione amministrativa. Nei prossimi passaggi vedremo come questo approccio riduce dispersione, migliora tracciabilità e supporta una gestione più consapevole dei casi complessi.",
    badges: ["AI", "Fascicolo"],
  },
  {
    id: 2,
    title: "Il contesto nazionale",
    body:
      "Le concessioni portuali operano in un ecosistema complesso: Autorità, porti, operatori, sistemi documentali, PEC, protocolli, pagamenti, Port Community System e strumenti GIS.",
    speakerNotes:
      "Il punto di partenza è la frammentazione. Le Autorità e gli enti concedenti dispongono già di molti sistemi, ma spesso le informazioni restano distribuite tra portali, documenti, pagamenti, comunicazioni e fascicoli non sempre connessi tra loro.",
    narrationScript:
      "Per capire perché questa piattaforma è necessaria, partiamo dal contesto reale. Le autorità e gli enti concedenti lavorano già con molti strumenti, ciascuno utile ma spesso isolato dagli altri. La conseguenza è che il fascicolo istruttorio non si compone in modo naturale: serve tempo per ricostruire passaggi, verificare evidenze e allineare informazioni provenienti da canali diversi. La piattaforma si colloca qui, come livello di coordinamento intelligente che rende coerente ciò che oggi è distribuito.",
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
    narrationScript:
      "Il punto di partenza è semplice: le informazioni esistono, ma spesso vivono in luoghi diversi. Una concessione ha pagamenti, documenti, PEC, sopralluoghi, criticità e procedimenti. Se questi elementi restano separati, ricostruire il fascicolo diventa lento e fragile. La piattaforma nasce per collegarli e renderli leggibili in un unico percorso istruttorio.",
    badges: ["Fascicolo", "Audit"],
  },
  {
    id: 4,
    title: "Non un gestionale",
    body: "Un gestionale registra. Una piattaforma intelligente collega, segnala, guida e documenta.",
    speakerNotes:
      "Questa è la distinzione essenziale. Il gestionale conserva informazioni. La piattaforma intelligente mette in relazione quelle informazioni, costruisce una vista istruttoria e aiuta l’ente a non perdere passaggi rilevanti.",
    narrationScript:
      "Questa è la distinzione centrale della demo. Un gestionale conserva informazioni. Una piattaforma intelligente, invece, collega quelle informazioni e aiuta l’ente a capire cosa significano nel procedimento. Qui non stiamo mostrando un archivio più elegante: stiamo mostrando un livello di governo istruttorio, capace di unire dati, documenti, criticità, scadenze e decisioni amministrative.",
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
    narrationScript:
      "A questo punto è utile chiarire il posizionamento: la piattaforma non sostituisce i sistemi esistenti, li mette in relazione. PEC, protocollo, documentale, pagamenti, GIS e strumenti verticali continuano a fare il proprio lavoro. Il valore aggiunto è uno strato istruttorio superiore, capace di offrire una lettura integrata del caso. Questa scelta riduce attrito organizzativo, facilita l’adozione e rende il progetto compatibile con la realtà operativa di enti e autorità.",
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
    narrationScript:
      "L’intelligenza artificiale non deve essere presentata come un decisore. Il suo ruolo è più serio e più utile: assistere il funzionario. L’AI legge il fascicolo, collega evidenze, segnala passaggi mancanti, propone checklist e aiuta a costruire report o bozze. Ma la decisione resta dell’amministrazione, con responsabilità umana e motivazione verificabile.",
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
    narrationScript:
      "Dopo il ruolo dell’AI, entra in gioco un altro elemento decisivo: la base normativa. Una piattaforma istruttoria deve aiutare a mantenere riferimenti coerenti con norme, prassi e giurisprudenza, senza promettere automatismi giuridici. Per questo il sistema valorizza fonti aggiornabili e versionate, così da rendere più robusti checklist, motivazioni e passaggi procedimentali. Il risultato è una maggiore continuità tra lavoro operativo quotidiano e quadro regolatorio che evolve nel tempo.",
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
    narrationScript:
      "Automazione non significa decisione automatica. Significa rendere più controllabili i passaggi ripetitivi: scadenze, avvisi, checklist, collegamenti tra documenti, report e audit. Il potere amministrativo resta umano, ma il percorso che porta alla decisione diventa più ordinato e meno dipendente dalla memoria individuale degli uffici.",
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
    narrationScript:
      "Qui il messaggio va formulato con attenzione. La piattaforma non rende un provvedimento inattaccabile e non impedisce il contenzioso. Però aiuta a ridurre le vulnerabilità tipiche: fascicoli incompleti, contraddittorio non tracciato, memorie non valutate, motivazioni deboli o documenti dispersi. Un provvedimento costruito su un percorso ordinato è più leggibile, più difendibile e meno esposto a errori.",
    badges: ["Audit", "Art. 47"],
  },
  {
    id: 10,
    title: "Il fascicolo intelligente",
    body:
      "Ogni documento può essere collegato a concessione, criticità, procedimento, pagamento, sopralluogo o report, con metadati, protocollo, PEC, hash e audit.",
    speakerNotes:
      "Il fascicolo non è un semplice archivio file. È un insieme di evidenze collegate, verificabili e consultabili nel punto in cui servono: sulla criticità, sul procedimento, sul pagamento, sul sopralluogo o nel report.",
    narrationScript:
      "Ora vediamo il fascicolo intelligente in pratica. Ogni documento non è solo archiviato, ma contestualizzato nel punto giusto: concessione, criticità, procedimento, pagamento, sopralluogo o report. Questo consente una consultazione più rapida e una maggiore coerenza istruttoria, perché le evidenze sono disponibili dove servono davvero. Se vuoi, da questa slide puoi aprire direttamente il fascicolo documentale per vedere come metadati, protocollo, PEC e audit dialogano nella stessa esperienza.",
    visitIntro:
      "Adesso sospendo la demo e apro il fascicolo documentale. Quando hai finito, torna alla demo guidata: riprenderemo da questa slide.",
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
    narrationScript:
      "Entriamo negli scenari: il primo riguarda la morosità con possibile rilevanza ex art. 47. Il punto non è solo il numero economico, ma la lettura istruttoria complessiva: pagamenti, comunicazioni, documenti, criticità e procedimento devono convergere in un quadro unico. In questo modo l’ente può valutare con maggiore precisione tempi, rischi e passaggi necessari. Dalla slide puoi aprire subito gli scenari demo e seguire il caso nel suo sviluppo operativo.",
    visitIntro:
      "Adesso sospendo la demo e apro gli scenari. Dopo la visita, torna alla demo guidata per proseguire dalla slide corrente.",
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
    narrationScript:
      "Il secondo scenario affronta l’occupazione difforme, dove la dimensione tecnica e quella amministrativa devono restare allineate. La piattaforma collega sopralluogo, localizzazione, evidenze documentali e percorso procedimentale nello stesso fascicolo, riducendo il rischio di frammentazione tra uffici. Questo rende più semplice ricostruire i fatti e preparare valutazioni coerenti. Anche qui puoi aprire direttamente la sezione scenari per vedere il percorso completo dalla rilevazione alle attività istruttorie successive.",
    visitIntro:
      "Sospendo la demo e apro gli scenari contestuali. Al termine, torna alla demo guidata per riprendere il filo.",
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
    narrationScript:
      "In questa fase evidenziamo un principio importante: la regolarizzazione è un elemento istruttorio rilevante, ma non un automatismo conclusivo. La piattaforma traccia tempi, esiti e verifiche, così che il fascicolo riporti con chiarezza cosa è stato fatto e con quale risultato. Questo aiuta a evitare omissioni e a mantenere una valutazione equilibrata prima di eventuali determinazioni finali. In sostanza, il sistema aumenta qualità e trasparenza del procedimento, senza sostituire il giudizio amministrativo.",
    badges: ["Art. 47"],
  },
  {
    id: 14,
    title: "Procedimento e art. 10-bis",
    body:
      "La piattaforma distingue procedimento d’ufficio e istanza di parte, tracciando comunicazione di avvio, contraddittorio, preavviso di rigetto e valutazione delle osservazioni.",
    speakerNotes:
      "Il procedimento amministrativo è fatto di passaggi. La piattaforma aiuta a verificare che quei passaggi siano presenti, coerenti e documentati, senza sostituire la valutazione del responsabile.",
    narrationScript:
      "Qui vediamo il presidio sul procedimento e sul tracciamento dell’art. 10-bis. La piattaforma distingue i percorsi d’ufficio da quelli su istanza di parte e rende visibili i passaggi fondamentali: avvio, contraddittorio, preavviso, osservazioni e valutazione. Questo approccio riduce il rischio di passaggi incompleti e aiuta a costruire un fascicolo più leggibile anche in sede di verifica successiva. Se vuoi approfondire, puoi entrare direttamente nel modulo procedimenti dalla call to action della slide.",
    visitIntro:
      "Sospendo la demo e apro il modulo procedimenti. Quando rientri, ripartiamo da questa stessa slide.",
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
    narrationScript:
      "La vista territoriale aggiunge una prospettiva decisiva: collega il dato amministrativo alla dimensione fisica delle aree portuali. In demo la mappa è GIS-ready, quindi orientata all’integrazione progressiva senza sostituire cartografie ufficiali o rilievi tecnici. Il valore immediato è contestualizzare concessioni, criticità e sopralluoghi nello stesso percorso istruttorio. Dalla slide puoi aprire la mappa e verificare come la lettura geografica rafforza la comprensione del caso.",
    visitIntro:
      "Sospendo la demo e apro la mappa territoriale. Dopo la visita, torna alla demo guidata e riprendiamo dal punto corrente.",
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
    narrationScript:
      "Quando serve consolidare il lavoro istruttorio, il report PDF istituzionale riassume il quadro in modo ordinato: fascicolo, criticità, procedimenti, documenti e disclaimer. È uno strumento di supporto, non un atto decisorio automatico. Il suo valore è rendere più agevole la ricostruzione del caso per chi deve valutare o riesaminare il percorso amministrativo. Puoi usare il link della slide per aprire i report demo e vedere come questa sintesi si integra nella narrativa complessiva della piattaforma.",
    visitIntro:
      "Sospendo la demo e apro i report istituzionali. Quando torni, la demo riparte da questa slide.",
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
    narrationScript:
      "Un altro pilastro del progetto è la fiducia operativa: ruoli, audit trail, controlli di sicurezza e test automatizzati. In un contesto amministrativo, poter ricostruire chi ha fatto cosa, quando e su quale evidenza è fondamentale per governance e responsabilità. La piattaforma incorpora questo livello di tracciabilità come parte del processo, non come aggiunta successiva. Il risultato è una base più robusta per controllo interno, audit e gestione di eventuali vulnerabilità procedimentali.",
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
    narrationScript:
      "Il modello di adozione deve essere graduale. Prima una demo guidata, poi un pilot su un perimetro limitato, ad esempio alcune concessioni o una specifica area portuale. Da lì si passa alla configurazione dei dati reali, alla formazione, al canone annuale e ai moduli opzionali: protocollo, PEC, GIS avanzato, storage esterno, aggiornamento normativo e assistente AI.",
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
    narrationScript:
      "Il valore atteso non è soltanto tecnologico. È soprattutto organizzativo e amministrativo: meno dispersione, più tracciabilità e una migliore capacità di governare criticità e tempi istruttori. Questo impatto si traduce anche in maggiore qualità difensiva, perché un fascicolo ordinato rende più semplice spiegare le scelte adottate e dimostrare la coerenza del percorso seguito. In breve, la piattaforma migliora il lavoro quotidiano degli uffici e rafforza la qualità complessiva delle decisioni.",
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
    narrationScript:
      "La roadmap proposta è progressiva e realistica: prima dimostrazione e setup del pilot, poi import dei fascicoli e allineamento dei workflow, infine integrazioni con ecosistemi esistenti e misurazione dei risultati. Questo consente di governare tempi, rischi e priorità senza interrompere l’operatività ordinaria degli uffici. Il vantaggio di questo approccio è trasformare la demo in un percorso concreto di adozione, con obiettivi verificabili lungo 30, 60 e 90 giorni.",
    badges: ["Business plan", "GIS"],
  },
  {
    id: 21,
    title: "Chiusura",
    body:
      "La piattaforma non decide al posto dell’ente: rende più ordinato, verificabile e difendibile il percorso che porta alla decisione.",
    speakerNotes:
      "Questa è la sintesi del progetto. Una piattaforma intelligente non sostituisce il potere amministrativo, ma rafforza il procedimento, collega le evidenze e migliora la qualità della decisione.",
    narrationScript:
      "Chiudiamo tornando al punto essenziale: la piattaforma non decide al posto dell’ente. Il suo compito è rendere il procedimento più ordinato, verificabile e difendibile, collegando evidenze che oggi risultano spesso disperse. L’AI agisce come relatore e copilota istruttorio, non come sostituto della responsabilità amministrativa. Se desideri, da qui puoi riaprire i moduli principali e gli scenari per una seconda lettura guidata focalizzata sul tuo caso d’uso.",
    badges: ["AI", "Audit", "Fascicolo"],
  },
];
