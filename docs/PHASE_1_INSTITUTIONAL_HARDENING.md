# Phase 1 - Institutional Demo Hardening

## 1) Obiettivo fase
Portare Concessioni Portuali da stato MVP avanzato a stato "institutional demo-ready" con evidenze minime di sicurezza, compliance, tracciabilità e affidabilita operativa utili in contesti pubblici e para-pubblici.

## 2) Principi di esecuzione
- Nessuna riscrittura architetturale estesa in questa fase.
- Focus su interventi ad alto impatto percepito e regolatorio.
- Verticalizzazione su use case dimostrabili in demo istituzionale.
- Criteri di accettazione oggettivi e verificabili.

## 3) Backlog operativo prioritario

### 3.1 Autenticazione reale con NextAuth.js
- Obiettivo: sostituire il meccanismo demo cookie-based con autenticazione reale, session management robusto e RBAC coerente.
- Motivo strategico: requisito base di credibilita istituzionale, sicurezza e auditabilita accessi.
- File presumibilmente coinvolti:
  - src/lib/auth.ts
  - src/app/login/page.tsx
  - src/app/logout/route.ts
  - src/app/layout.tsx
  - src/middleware.ts (nuovo o esteso)
  - package.json
- Complessita: Alta
- Impatto: Molto alto
- Criteri di accettazione:
  - login/logout funzionanti con sessione server valida;
  - ruoli applicati su pagine, azioni e route handlers;
  - accessi non autorizzati bloccati con comportamento consistente;
  - assenza di regressioni sui flussi principali.

### 3.2 Campo lettera_art47 su Criticita
- Obiettivo: introdurre un campo strutturato `lettera_art47` per classificare la base normativa nelle criticità.
- Motivo strategico: migliora tracciabilità giuridica, filtrabilita e coerenza reportistica.
- File presumibilmente coinvolti:
  - prisma/schema.prisma
  - prisma/seed.ts
  - src/server/actions/criticità.ts
  - src/server/queries/criticità.ts
  - src/app/criticità/nuova/page.tsx
  - src/app/criticità/[id]/modifica/page.tsx
  - src/components/criticità/CriticitaFiltersBar.tsx
- Complessita: Media
- Impatto: Alto
- Criteri di accettazione:
  - campo persistito a DB e validato lato server;
  - valorizzazione obbligatoria o policy esplicita di default;
  - filtro UI disponibile per lettera art.47;
  - presenza in export/report relativi alle criticità.

Stato attuale (Issue #2 baseline implementata):
- estensione modello `Criticita` con campi strutturati: `rilevanzaArt47`, `letteraArt47`, `rischioDecadenza`, `motivazioneArt47`, `azioneIstruttoriaArt47`;
- validazione server-side in create/update criticità con regole condizionali quando `rilevanzaArt47=true`;
- sezione UI dedicata in nuova/modifica/dettaglio criticità con disclaimer non-vincolante;
- filtri lista criticità su rilevanza, lettera e rischio decadenza;
- export CSV criticità esteso con colonne art.47.

Evoluzione Phase 2 (Issue #12):
- estensione `Criticita` con campi regolarizzazione (`regolarizzata`, `dataRegolarizzazione`, `descrizioneRegolarizzazione`, `esitoRegolarizzazione`, `verificataRegolarizzazione`, `dataVerificaRegolarizzazione`, `noteVerificaRegolarizzazione`);
- filtri/lista/dettaglio/export allineati al tracciamento regolarizzazione;
- nota esplicita di perimetro: la regolarizzazione incide sull istruttoria ma non determina automatica esclusione della decadenza.

### 3.3 PDF report lato server professionale
- Obiettivo: elevare i PDF a formato istituzionale con sezioni standard, metadati e impaginazione robusta.
- Motivo strategico: output formale difendibile in tavoli tecnici, contraddittorio e condivisione inter-ente.
- File presumibilmente coinvolti:
  - src/app/report/[id]/pdf/route.ts
  - src/server/queries/report.ts
  - src/lib/utils.ts
  - src/types/index.ts (o file type coerente)
- Complessita: Media-Alta
- Impatto: Molto alto
- Criteri di accettazione:
  - PDF con header/footer istituzionale e metadata minimi;
  - struttura sezioni consistente (fatti, analisi, evidenze, proposta);
  - gestione errori e fallback dati incompleti;
  - risultato stampabile e leggibile senza corruzioni layout.

### 3.4 Audit trail forense/immutabile
- Obiettivo: implementare catena eventi non alterabile in modo silente (tamper-evident) per azioni sensibili.
- Motivo strategico: riduce rischio in audit/controlli e rafforza tenuta probatoria.
- File presumibilmente coinvolti:
  - prisma/schema.prisma
  - src/server/actions/*.ts
  - src/lib/auth.ts
  - src/server/queries/*.ts
  - src/lib/utils.ts
- Complessita: Alta
- Impatto: Critico
- Criteri di accettazione:
  - eventi principali registrati con attore, timestamp, oggetto, azione;
  - meccanismo tamper-evident verificabile;
  - consultazione audit con filtri minimi;
  - evidenza di verifica integrità su campione eventi.

Stato attuale (Issue #4 baseline implementata):
- estensione `ActivityLog` con `esito`, `metadata`, `previousHash`, `currentHash`, contesto request e actor snapshot;
- utility centralizzata per logging append-only logico con hash chaining SHA-256;
- integrazione nelle principali server actions operative e log eventi `AUTHZ_DENIED` quando praticabile;
- vista interna `/audit` accessibile solo ad `ADMIN`.

Limiti residui:
- baseline tamper-evident applicativa, non conservazione a norma/WORM;
- necessario hardening successivo su policy DB append-only, backup/retention, firma e integrazione SIEM.

### 3.5 Test automatici Vitest + Playwright
- Obiettivo: introdurre baseline test unitari/integration e scenari e2e critici.
- Motivo strategico: aumenta affidabilita release e riduce regressioni su flussi regolatori.
- File presumibilmente coinvolti:
  - package.json
  - vitest.config.ts (nuovo)
  - playwright.config.ts (nuovo)
  - tests/unit/** (nuovo)
  - tests/e2e/** (nuovo)
- Complessita: Media
- Impatto: Alto
- Criteri di accettazione:
  - suite test eseguibile in CI locale;
  - copertura minima su auth, criticità, procedimenti, export/report;
  - almeno 2 scenari e2e end-to-end passanti;
  - report test leggibile e riproducibile.

Stato attuale (Issue #5 baseline implementata):
- configurati `vitest.config.ts` e `playwright.config.ts` con script npm dedicati;
- introdotti test unitari su rate limiting, capability ruoli e hash audit;
- introdotti smoke test E2E su auth/ruoli, security headers e accesso audit;
- documentati prerequisiti DB e flusso di esecuzione test locali.

Evoluzione Phase 2 (Issue #13):
- distinzione esplicita tra procedimenti d ufficio e a istanza di parte su modello Procedimento;
- tracking istruttorio preavviso di rigetto ex art. 10-bis (stato, date, osservazioni, valutazione), senza automatismi decisori;
- refinement checklist/warning su dettaglio/lista/export/PDF in ottica supporto istruttorio caso per caso.

### 3.6 Middleware centralizzato, security headers, rate limiting
- Obiettivo: centralizzare controlli trasversali in middleware con politiche di sicurezza uniformi.
- Motivo strategico: diminuisce superfici di errore e standardizza la postura security.
- File presumibilmente coinvolti:
  - src/middleware.ts (nuovo)
  - next.config.ts
  - src/lib/auth.ts
  - src/app/**/route.ts
- Complessita: Media-Alta
- Impatto: Alto
- Criteri di accettazione:
  - security headers applicati alle route pertinenti;
  - rate limiting attivo su endpoint sensibili;
  - policy accesso coerente e centralizzata;
  - nessuna rottura dei percorsi applicativi autorizzati.

### 3.7 Checklist contraddittorio su Procedimento
- Obiettivo: aggiungere checklist strutturata per garantire passaggi minimi di contraddittorio.
- Motivo strategico: migliora trasparenza e resilienza in contestazioni procedimentali.
- File presumibilmente coinvolti:
  - prisma/schema.prisma
  - src/server/actions/procedimenti.ts
  - src/server/queries/procedimenti.ts
  - src/app/procedimenti/nuovo/page.tsx
  - src/app/procedimenti/[id]/page.tsx
- Complessita: Media
- Impatto: Alto
- Criteri di accettazione:
  - checklist compilabile con stati e date;
  - blocco/alert se step obbligatori mancanti;
  - visibilita checklist nel dettaglio procedimento;
  - tracciamento modifiche checklist in audit trail.

Stato attuale (Issue #7 baseline implementata):
- estensione modello `Procedimento` con campi checklist contraddittorio e `propostaEsitoIstruttorio` strutturata;
- utility assistiva `src/lib/procedimento-checklist.ts` per completezza/missing/warning senza automatismi decisori;
- creazione e aggiornamento checklist in server actions con audit `PROCEDIMENTO_CREATE` e `PROCEDIMENTO_CHECKLIST_UPDATE`;
- UI nuova/dettaglio/lista procedimenti allineata con badge completa/incompleta, warning e filtri opzionali;
- export CSV procedimenti esteso con colonne checklist e seed con casi completo/incompleto/art.47 decadenziale.

Limiti espliciti:
- la checklist non costituisce provvedimento e non sostituisce il responsabile del procedimento;
- la completezza tecnica della checklist non equivale a legittimita automatica dell atto finale.

### 3.8 DPIA/GDPR documentation draft
- Obiettivo: redigere bozza operativa DPIA/GDPR orientata al sistema e ai trattamenti principali.
- Motivo strategico: prerequisito frequente per valutazioni istituzionali e procurement.
- File presumibilmente coinvolti:
  - docs/privacy/GDPR_REGISTER_DRAFT.md (nuovo)
  - docs/privacy/DPIA_DRAFT.md (nuovo)
  - docs/privacy/DATA_RETENTION_POLICY_DRAFT.md (nuovo)
  - docs/privacy/SECURITY_MEASURES_DRAFT.md (nuovo)
  - docs/privacy/PRIVACY_GAPS_AND_NEXT_STEPS.md (nuovo)
  - README.md
  - MVP_STATUS.md
- Complessita: Media
- Impatto: Medio-Alto
- Criteri di accettazione:
  - mappatura trattamenti/dati/ruoli aggiornata;
  - rischi privacy e misure mitigative documentate;
  - punti aperti e decisioni richieste esplicitati;
  - versione pronta per revisione legale esterna.

Stato attuale (Issue #8 baseline implementata):
- creati 5 documenti privacy draft in `docs/privacy/` (registro trattamenti, DPIA, retention, misure sicurezza, gap/next steps);
- allineato README con sezione privacy/GDPR/DPIA draft e limiti espliciti;
- aggiornato MVP status con completamento stream privacy e limiti residui;
- nessuna dichiarazione di conformità GDPR definitiva e nessuna DPIA formalmente approvata.
- audit esterno post-Phase 1 disponibile in `docs/EXTERNAL_AI_REVIEW_PHASE_1_COMPLETED.md` per prioritizzazione roadmap successiva.

### 3.9 Due scenari demo istituzionali: morosita e occupazione difforme
- Obiettivo: preparare due percorsi demo guidati con dati, script narrativo e KPI di esito.
- Motivo strategico: aumenta conversione commerciale e chiarezza del valore in contesti pubblici.
- File presumibilmente coinvolti:
  - docs/DEMO_SCENARIOS_INSTITUTIONAL.md (nuovo)
  - prisma/seed.ts
  - src/app/demo/page.tsx
  - src/app/report/page.tsx
- Complessita: Media
- Impatto: Alto
- Criteri di accettazione:
  - script demo ripetibile in <= 20 minuti;
  - dataset coerente con entrambi gli scenari;
  - output finale comprensibile per pubblico non tecnico;
  - KPI narrati (tempo, evidenze, decisioni supportate).

### 3.10 GIS/map placeholder o primo modulo GIS base
- Obiettivo: inserire una prima capacita geospaziale (placeholder evolutivo o MVP GIS base).
- Motivo strategico: rafforza use case su occupazioni difformi e valutazioni territoriali.
- File presumibilmente coinvolti:
  - src/app/concessioni/[id]/page.tsx
  - src/components/** (nuovo modulo mappa)
  - src/types/**
  - docs/GIS_ROADMAP_NOTE.md (nuovo)
- Complessita: Media-Alta
- Impatto: Medio-Alto
- Criteri di accettazione:
  - visualizzazione posizione/area minima per concessione campione;
  - fallback testuale se dato geospaziale assente;
  - assenza regressioni UI su mobile/desktop;
  - nota tecnica chiara su limiti del modulo fase 1.

## 4) Sequenziamento consigliato (6-8 settimane)
1. Settimane 1-2: autenticazione reale + middleware/security baseline.
2. Settimane 2-3: campo lettera_art47 + checklist contraddittorio.
3. Settimane 3-5: audit trail forense + PDF professionale.
4. Settimane 5-6: test automatici e2e/unit.
5. Settimane 6-7: demo scenari istituzionali e tuning storytelling.
6. Settimane 7-8: GIS placeholder/base e rifinitura documentale DPIA/GDPR.

## 5) KPI di uscita fase
- Tasso pass test automatici >= 90% sulle suite critiche.
- 100% azioni sensibili tracciate in audit trail.
- 2 demo istituzionali complete e ripetibili senza interventi manuali ad hoc.
- 1 set PDF report professionale validato internamente.
- Bozza DPIA/GDPR pronta per revisione legale.

## 6) Definition of Done Phase 1
La fase e considerata completata quando:
- i 10 stream prioritari sono implementati almeno a livello "institutional demo-ready";
- i criteri di accettazione sono verificati e documentati;
- il sistema e presentabile in contesto istituzionale con rischio operativo/compliance ridotto rispetto allo stato attuale.
