export type GuidedDemoSlide = {
  id: number;
  title: string;
  subtitle?: string;
  body: string;
  bullets?: string[];
  legalOutputs?: string[];
  businessMetrics?: {
    label: string;
    value: string;
    note?: string;
  }[];
  financialRows?: {
    horizon: "Breve periodo" | "Medio periodo" | "Lungo periodo";
    timeframe: string;
    costs: string;
    revenues: string;
    notes: string;
  }[];
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
    title: "Supporto legale-amministrativo",
    body:
      "La piattaforma può adiuvare gli uffici nella predisposizione di atti, comunicazioni, richieste, diffide, bandi, schemi di provvedimento e note istruttorie, partendo dal fascicolo e dalle evidenze già collegate.",
    bullets: [
      "bozze di comunicazione di avvio",
      "diffide e richieste documentali",
      "contestazioni",
      "preavvisi ex art. 10-bis",
      "schemi di motivazione",
      "bozze di determine",
      "bandi e avvisi",
      "note istruttorie",
      "risposte a istanze",
      "report per organi interni",
    ],
    legalOutputs: [
      "atti di impulso procedimentale",
      "bozze e schemi di provvedimento",
      "supporto a risposte su istanze e accessi agli atti",
    ],
    speakerNotes:
      "Qui la piattaforma compie un salto di valore. Non si limita a dire che esiste una criticità. Aiuta gli uffici a trasformare quella criticità in un percorso amministrativo coerente: quale atto predisporre, quali evidenze richiamare, quali passaggi verificare e quali cautele motivazionali inserire.",
    narrationScript:
      "Questo è un passaggio essenziale. Una piattaforma intelligente non deve limitarsi a mostrare dati. Deve aiutare gli uffici a lavorare meglio sugli atti. Partendo dal fascicolo, dai documenti, dalle PEC, dai pagamenti e dalle criticità, il sistema può proporre bozze di comunicazioni, diffide, richieste documentali, preavvisi, contestazioni e schemi di provvedimento. Non sono atti automatici e non sostituiscono la valutazione umana, ma diventano una base strutturata su cui l’ufficio può lavorare con maggiore rapidità e coerenza.",
    badges: ["AI", "Audit"],
  },
  {
    id: 11,
    title: "Dalla criticità all’atto",
    body:
      "Ogni criticità può diventare un percorso assistito: evidenze, base normativa, contraddittorio, schema di atto, allegati e tracciabilità.",
    bullets: [
      "rilevazione criticità",
      "fonti documentali",
      "riferimenti normativi",
      "passaggi procedimentali",
      "bozza atto",
      "allegati",
      "controllo motivazione",
      "audit",
    ],
    speakerNotes:
      "La forza del sistema è trasformare una criticità isolata in un fascicolo operativo. L’ufficio non parte da una pagina bianca, ma da una sequenza ordinata di evidenze e passaggi.",
    narrationScript:
      "Pensiamo a una morosità o a un’occupazione difforme. In un sistema tradizionale l’ufficio deve cercare i pagamenti, recuperare le PEC, verificare i sopralluoghi, ricostruire la concessione e poi scrivere un atto. Qui il percorso è diverso: la piattaforma collega gli elementi già presenti e suggerisce una traccia operativa. Quali evidenze richiamare, quale contraddittorio attivare, quali allegati inserire e quale schema motivazionale utilizzare.",
    badges: ["Fascicolo", "Art. 47", "Audit"],
  },
  {
    id: 12,
    title: "Libreria atti e modelli",
    body:
      "Il sistema può evolvere in una libreria di modelli amministrativi, personalizzabili per ente, tipologia di concessione, criticità e fase del procedimento.",
    bullets: [
      "diffida per morosità",
      "richiesta integrazione documentale",
      "comunicazione di avvio",
      "contestazione uso difforme",
      "preavviso di rigetto",
      "proposta di decadenza",
      "determina conclusiva",
      "bando o avviso",
      "schema verbale sopralluogo",
    ],
    speakerNotes:
      "La libreria atti consente di standardizzare senza irrigidire. Ogni modello resta modificabile, ma nasce già collegato al fascicolo e ai riferimenti utili.",
    narrationScript:
      "Una possibile evoluzione concreta è la libreria atti. L’ente può avere modelli propri, coerenti con il suo stile amministrativo e con la propria organizzazione. La piattaforma non impone un testo unico, ma propone una base controllata: diffide, comunicazioni di avvio, preavvisi, richieste documentali, determine, bandi e avvisi. Il vantaggio è ridurre tempi di predisposizione e disomogeneità tra uffici.",
    badges: ["AI", "Audit"],
  },
  {
    id: 13,
    title: "Controllo di coerenza dell’atto",
    body:
      "Prima della firma, la piattaforma può aiutare a verificare se l’atto richiama le evidenze corrette, considera il contraddittorio, valuta le memorie e mantiene coerenza con il fascicolo.",
    bullets: [
      "evidenze richiamate",
      "allegati presenti",
      "termini rispettati",
      "memorie valutate",
      "motivazione coerente",
      "riferimenti normativi",
      "audit del percorso",
    ],
    speakerNotes:
      "Il supporto legale più importante non è scrivere al posto dell’ufficio, ma aiutare l’ufficio a non dimenticare ciò che rende l’atto più solido.",
    narrationScript:
      "La piattaforma può diventare anche uno strumento di controllo. Prima che un atto venga firmato, il sistema può segnalare se manca un allegato, se una memoria non risulta valutata, se il contraddittorio non è completo o se la motivazione non richiama le evidenze essenziali. Questo non elimina il controllo umano, ma lo rende più ordinato e documentato.",
    badges: ["Audit", "Art. 47"],
  },
  {
    id: 14,
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
    id: 15,
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
    id: 16,
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
    id: 17,
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
    id: 18,
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
    id: 19,
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
    id: 20,
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
    id: 21,
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
    id: 22,
    title: "Business plan: perimetro nazionale",
    body:
      "Il mercato iniziale può essere stimato sulle Autorità di Sistema Portuale e sugli enti concedenti collegati, con un modello progressivo da pilot locale a diffusione nazionale.",
    bullets: [
      "16 Autorità di Sistema Portuale",
      "62 porti di rilievo nazionale",
      "enti concedenti e società in house",
      "uffici concessioni, demanio, legale, tecnico, ragioneria",
      "adozione graduale per moduli",
    ],
    businessMetrics: [
      {
        label: "Perimetro prudenziale",
        value: "16 AdSP / 62 porti",
        note: "Dati di contesto da verificare e aggiornare prima della presentazione ufficiale.",
      },
      {
        label: "Formula di riferimento",
        value: "Stima prudenziale, da aggiornare prima di ogni presentazione commerciale o istituzionale",
      },
    ],
    speakerNotes:
      "Il business plan non deve essere costruito su numeri fantasiosi. Il punto è mostrare un perimetro nazionale ragionevole e una strategia di adozione progressiva: prima un pilot, poi alcuni enti, poi moduli e integrazioni.",
    narrationScript:
      "Qui passiamo dal valore istituzionale alla sostenibilità economica. Il perimetro nazionale può essere stimato, in via prudenziale e da aggiornare prima di ogni presentazione ufficiale, in 16 Autorità di Sistema Portuale e 62 porti di rilievo nazionale. Non significa vendere subito a tutti, ma disegnare una traiettoria: un primo pilot, poi alcune adozioni mirate, poi una possibile diffusione modulare. Dati di contesto da verificare e aggiornare prima della presentazione commerciale o istituzionale.",
    badges: ["Business plan", "Audit"],
  },
  {
    id: 23,
    title: "Costi, tempi e ricavi",
    body:
      "Pianificazione economica su tre orizzonti: validazione iniziale, consolidamento e scala nazionale.",
    financialRows: [
      {
        horizon: "Breve periodo",
        timeframe: "0/12 mesi",
        costs:
          "sviluppo demo e pilot; hosting/staging; consulenza legale e tecnica; presentazioni istituzionali; prime integrazioni leggere",
        revenues:
          "1/2 pilot; setup iniziale; canone pilota; servizi di configurazione",
        notes: "Obiettivo: validazione prodotto e primo caso d’uso reale.",
      },
      {
        horizon: "Medio periodo",
        timeframe: "12/36 mesi",
        costs:
          "hardening produzione; sicurezza; object storage; integrazione protocollo/PEC; GIS evoluto; supporto clienti; aggiornamento normativo",
        revenues:
          "3/6 enti; canoni annuali; moduli opzionali; formazione; manutenzione evolutiva",
        notes: "Obiettivo: consolidamento commerciale e referenze.",
      },
      {
        horizon: "Lungo periodo",
        timeframe: "36/60 mesi",
        costs:
          "team dedicato; compliance avanzata; TTS/AI premium; marketplace modelli atti; assistenza enterprise; certificazioni e audit",
        revenues:
          "diffusione su quota significativa delle AdSP; canoni ricorrenti; moduli AI/legal assistant; integrazioni; servizi professionali",
        notes: "Obiettivo: piattaforma nazionale verticale.",
      },
    ],
    speakerNotes:
      "Questa slide deve far capire che il progetto non è solo tecnologico. Ha un percorso industriale: costi iniziali controllati, ricavi da pilot, poi canoni ricorrenti, moduli opzionali e servizi professionali.",
    narrationScript:
      "Il business plan deve essere letto per fasi. Nel breve periodo l’obiettivo non è massimizzare i ricavi, ma validare il prodotto con uno o due pilot. Nel medio periodo si punta a trasformare quei pilot in referenze, consolidando sicurezza, integrazioni e assistenza. Nel lungo periodo il valore nasce dalla ricorrenza: canoni annuali, moduli legali, moduli AI, integrazioni e servizi professionali.",
    badges: ["Business plan", "Audit"],
  },
  {
    id: 24,
    title: "Scenario ricavi",
    body:
      "Tre scenari economici indicativi guidano la lettura commerciale: prudente, intermedio, esteso.",
    bullets: [
      "Scenario prudente: 1 pilot anno 1; 3 enti entro anno 3; ricavi da setup, formazione e canone base",
      "Scenario intermedio: 2 pilot anno 1; 5/8 enti entro anno 3; moduli protocollo, PEC, GIS e legal assistant",
      "Scenario esteso: quota significativa delle 16 AdSP nel medio-lungo periodo con moduli premium e assistenza enterprise",
      "Le cifre economiche puntuali vanno definite dopo validazione del pilot, analisi dei costi di produzione e confronto con il budget degli enti",
    ],
    speakerNotes:
      "Non inserire numeri inventati se non sono ancora validati. La demo deve mostrare metodo: scenari, leve di ricavo e rapporto con il mercato potenziale.",
    narrationScript:
      "Non ha senso inventare numeri precisi prima del pilot. Ha senso però mostrare gli scenari. Uno scenario prudente parte da un singolo pilot e da pochi enti. Uno scenario intermedio considera più adozioni e moduli opzionali. Uno scenario esteso guarda alla quota significativa delle Autorità esistenti, con canoni ricorrenti e servizi specialistici. La logica economica è chiara: partire leggeri, validare, consolidare e scalare.",
    badges: ["Business plan", "GIS"],
  },
  {
    id: 25,
    title: "Leve di ricavo",
    body:
      "La sostenibilità economica nasce dalla combinazione di ricavi ricorrenti e servizi professionali ad alto valore.",
    bullets: [
      "setup iniziale",
      "importazione fascicoli",
      "configurazione workflow",
      "canone annuale",
      "modulo legal assistant",
      "modulo aggiornamento normativo",
      "modulo protocollo/PEC",
      "modulo GIS",
      "object storage",
      "formazione",
      "assistenza",
      "manutenzione evolutiva",
    ],
    speakerNotes:
      "La struttura ricavi deve restare modulare: una base annuale stabile e servizi configurabili in funzione della complessità dell’ente.",
    narrationScript:
      "Le entrate non dipendono da un solo canone. La piattaforma può generare ricavi da setup, configurazione, migrazione fascicoli, formazione e moduli opzionali. Questo consente di adattare l’offerta a enti piccoli, medi e grandi, mantenendo una base ricorrente e servizi professionali ad alto valore.",
    badges: ["Business plan", "AI"],
  },
  {
    id: 26,
    title: "Chiusura",
    body:
      "La piattaforma non decide al posto dell’ente: organizza il fascicolo, supporta la predisposizione degli atti, rafforza il procedimento e rende più solida la decisione amministrativa.",
    speakerNotes:
      "Questa è la sintesi del progetto. Una piattaforma intelligente non sostituisce il potere amministrativo, ma rafforza il procedimento, collega le evidenze, supporta la predisposizione degli atti e migliora la qualità della decisione.",
    narrationScript:
      "Chiudiamo tornando al punto essenziale: la piattaforma non decide al posto dell’ente. Organizza il fascicolo, supporta la predisposizione degli atti, rafforza il procedimento e rende più solida la decisione amministrativa. L’AI agisce come relatore e copilota istruttorio, non come sostituto della responsabilità amministrativa. Se desideri, da qui puoi riaprire i moduli principali e gli scenari per una seconda lettura guidata focalizzata sul tuo caso d’uso.",
    badges: ["AI", "Audit", "Fascicolo"],
  },
];
