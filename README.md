# Concessioni Portuali

Piattaforma demo per la gestione operativa delle concessioni portuali, con moduli istruttori, monitoraggio scadenze, criticità, reportistica ed export.

## Stack
- Next.js (App Router)
- TypeScript
- Prisma ORM
- PostgreSQL
- Docker Compose

## Avvio locale
1. Installa dipendenze:
   - `npm install`
2. Avvia PostgreSQL:
   - `docker compose up -d`
3. Genera client Prisma e sincronizza schema:
   - `npm run db:generate`
   - `npm run db:push`
4. (Opzionale) Carica dati demo:
   - `npm run db:seed`
5. Avvia applicazione:
   - `npm run dev`

## Docker/PostgreSQL
- Servizio: `concessioni_portuali_db`
- Porta host: `5433`
- Immagine: `postgres:16`
- Credenziali demo: `concessioni/concessioni`

## Prisma
Comandi principali:
- `npm run db:generate`
- `npm run db:push`
- `npm run db:seed`
- `npm run db:studio`

## Comandi principali progetto
- `npm run dev`
- `npm run build`
- `npm run check`

## CI/CD baseline (Phase 2)
Pipeline GitHub Actions disponibile in `.github/workflows/ci.yml`.

Copertura CI su push e pull request verso main:
- install dipendenze con `npm ci`;
- generazione Prisma client;
- test unit (`npm run test`);
- build (`npm run build`);
- check (`npm run check`);
- E2E Playwright (`npm run test:e2e`) con servizio PostgreSQL dedicato in workflow.

In caso di failure E2E, la pipeline carica artifact:
- `playwright-report/`
- `test-results/`

Perimetro attuale:
- baseline CI presente;
- nessun deploy automatico staging/production in questa fase.

## Baseline test automatici (Issue #5)
Prerequisiti E2E:
- `docker compose up -d`
- `npm run db:push`
- `npm run db:seed`

Script test disponibili:
- `npm run test` esegue i test unit/integration Vitest in modalità run.
- `npm run test:watch` avvia Vitest in watch mode.
- `npm run test:coverage` esegue Vitest con coverage V8.
- `npm run test:e2e` esegue gli smoke test Playwright (Chromium).
- `npm run test:e2e:ui` avvia Playwright in UI mode.
- `npm run test:e2e:prepare` prepara DB demo (`db:push` + `db:seed`) senza reset forzati.
- `npm run test:all` esegue unit test + E2E in sequenza.

Baseline coperta:
- Unit: rate limiting, capability ruoli, hashing/sanitizzazione audit.
- E2E: login/redirect per ruoli, security headers baseline, accesso audit admin/viewer.

## Mapping art. 47 su Criticita (Issue #2)
- Estensione `Criticita` con campi strutturati: `rilevanzaArt47`, `letteraArt47`, `rischioDecadenza`, `motivazioneArt47`, `azioneIstruttoriaArt47`.
- Form nuova/modifica criticità con sezione dedicata e disclaimer di supporto istruttorio non vincolante.
- Filtri lista criticità per rilevanza, lettera art.47 e rischio decadenza.
- Dettaglio criticità con sezione esplicita di mapping art.47.
- Export CSV criticità esteso con colonne art.47.

## Regolarizzazione criticita (Issue #12)
- Estensione `Criticita` con campi: `regolarizzata`, `dataRegolarizzazione`, `descrizioneRegolarizzazione`, `esitoRegolarizzazione`, `verificataRegolarizzazione`, `dataVerificaRegolarizzazione`, `noteVerificaRegolarizzazione`.
- Filtri lista criticità su stato regolarizzazione ed esito regolarizzazione.
- Sezioni dedicate in form e dettaglio criticità con nota istruttoria: la regolarizzazione incide sull istruttoria ma non determina automatica esclusione della decadenza.
- Export CSV criticità esteso con colonne regolarizzazione.

## Checklist contraddittorio su Procedimento (Issue #7)
- Estensione `Procedimento` con campi checklist procedimentale: avvio, memorie, audizione, contestazione, controdeduzioni, motivazione e proposta esito istruttorio.
- Utility dominio in `src/lib/procedimento-checklist.ts` per stato item, completezza, missing item e livello warning.
- Form creazione procedimento con sezione â€œContraddittorio e garanzie procedimentaliâ€.
- Scheda dettaglio procedimento con:
   - badge checklist completa/incompleta;
   - warning su passaggi essenziali mancanti;
   - blocco aggiornamento checklist riservato a ruoli operativi.
- Lista procedimenti con colonna checklist/warning e filtri opzionali su checklist incompleta e memorie in scadenza.
- Export CSV procedimenti esteso con campi checklist.

## Procedimento d ufficio vs istanza di parte (Issue #13)
- Estensione Procedimento con tracciamento origine (`origineProcedimento`, `procedimentoUfficio`) e campi istruttori preavviso rigetto ex art. 10-bis L. 241/1990.
- Checklist contraddittorio raffinata con percorso differenziato tra procedimenti d ufficio e a istanza di parte.
- Preavviso di rigetto trattato come tracking istruttorio: applicabilita da valutare caso per caso, senza automatismi decisori.
- Lista, dettaglio, export CSV e PDF report allineati ai nuovi campi.

Limiti e perimetro giuridico:
- La checklist ha funzione di supporto istruttorio e non costituisce provvedimento.
- Non sostituisce la valutazione del responsabile del procedimento.
- Non garantisce da sola la legittimita dell atto finale.
- Serve valutazione giuridica caso per caso.

## Auth demo e ruoli
L'accesso demo avviene da `/login` con autenticazione reale via email/password e sessione applicativa.
Ruoli principali:
- `ADMIN`
- `OPERATORE_SOCIETA`
- `GIURIDICO`
- `TECNICO`
- `ECONOMICO`
- `VIEWER_ADSP`

Credenziali demo principali:
- `admin@demo.local` / `admin123`
- `giuridico@demo.local` / `giuridico123`
- `tecnico@demo.local` / `tecnico123`
- `economico@demo.local` / `economico123`
- `adsp@demo.local` / `adsp123`

Nota transitoria: in sviluppo e mantenuto anche un fallback legacy ruolo/cookie per compatibilita demo locale.

## Auth hardening baseline (Issue #15)
- Baseline account lockout su tentativi falliti (soglia e finestra configurabili via env).
- Messaggistica di login uniformata e generica per ridurre leakage informativo.
- Campi utente predisposti per MFA (flag/secret/recovery codes), senza enforcement MFA end-to-end in questa fase.
- Password policy utility disponibile per flussi di cambio/impostazione password successivi, senza bloccare retroattivamente le credenziali demo seed esistenti.
- Variabili env introdotte:
   - `AUTH_MAX_FAILED_ATTEMPTS`
   - `AUTH_LOCKOUT_MINUTES`
   - `AUTH_PASSWORD_MIN_LENGTH`

`VIEWER_ADSP` e consultivo: accesso a viste read-only e restrizioni su aree operative (AI e creazione nuove pratiche).

## AI, normativa, export
- Modulo AI assistivo (non sostituisce validazione umana)
- Modulo normativa con impatti sui flussi
- Export CSV sui moduli operativi
- PDF report istituzionale server-side (PDFKit) su route dedicate con layout professionale, sezioni standard e metadata documento

## Scenari demo istituzionali (Issue #17)
- Nuova pagina dedicata: `/demo-scenari`.
- Finalita: raccontare casi istruttori realistici in contesto PA/AdSP senza automatismi decisori.
- Scenari disponibili:
   - DEMO-01 - Morosita art. 47
   - DEMO-02 - Occupazione difforme
   - DEMO-03 - Regolarizzazione pre-provvedimentale
   - DEMO-04 - Contraddittorio incompleto
   - DEMO-05 - Istanza di parte e art. 10-bis
- Ogni scenario espone collegamenti reali a concessione, criticita, procedimento e report/PDF.
- Presidio comunicativo: "elemento da valutare", "profilo istruttorio", "supporto al responsabile del procedimento".

## Demo guidata AI-led (Issue #20)
- Nuova pagina dedicata: `/demo-guidata`.
- Presentazione interattiva a slide con storytelling istituzionale e speaker notes AI.
- Narrazione vocale browser-based con Web Speech API (Issue #21), controlli play/pausa/riprendi/ferma e toggle narrazione automatica slide-by-slide.
- Narrazione migliorata in modalità relatore AI (Issue #22): la voce usa copioni discorsivi dedicati (`narrationScript`) e non una lettura meccanica di titolo, bullet e note.
- Visita contestuale con pausa/ripresa (Issue #23): da slide con azione è disponibile "Apri e sospendi demo" per aprire fascicolo, scenari, mappa o report senza perdere contesto.
- Ripresa intelligente su `/demo-guidata`: box "Demo sospesa" con azioni "Riprendi spiegazione", "Continua senza voce" e "Ricomincia demo".
- Banner "Torna alla demo guidata" nei moduli visitati durante il tour, con link a `/demo-guidata?resume=1`.
- Legal assistant narrativo (Issue #24): nuovo blocco slide su supporto legale-amministrativo per predisposizione assistita di atti, diffide, richieste documentali, comunicazioni di avvio, preavvisi ex art. 10-bis, contestazioni, note istruttorie, schemi di motivazione, bozze di determine, bandi e risposte a istanze/accessi agli atti.
- Controllo di coerenza dell atto: verifica guidata di evidenze, allegati, contraddittorio, memorie e riferimenti normativi prima della firma.
- Business plan strutturato (Issue #24): perimetro nazionale prudenziale, costi/tempi/ricavi per breve-medio-lungo periodo, scenari prudente/intermedio/esteso e leve ricavo modulari.
- Investment breakdown (Issue #25): nuova sezione "Investimento richiesto" con fasi pilot/produzione/scalabilità e range indicativi 35.000/70.000 €, 120.000/250.000 €, 300.000/700.000 €.
- Voci dell investimento esplicitate: sviluppo software, sicurezza/compliance, infrastruttura, supporto legale-amministrativo, integrazioni, migrazione dati, formazione, manutenzione evolutiva, AI/automazione e commercializzazione.
- Modello ricavi esteso: ricavi iniziali, ricavi ricorrenti e servizi professionali con logica break-even prudente/intermedia/estesa.
- Posizionamento esplicito: non è un gestionale, è una piattaforma intelligente di governo istruttorio.
- Link diretti a scenari demo, fascicolo documentale, procedimenti, mappa e report.
- Focus su automazione del procedimento, non della decisione.
- Sezione business plan con modello di adozione graduale e roadmap 30/60/90 giorni.

Perimetro e limiti:
- l AI agisce come copilota istruttorio e non adotta provvedimenti;
- nessun automatismo decisionale su decadenza/revoca o altri esiti amministrativi;
- la demo guidata ha finalità illustrativa istituzionale e di supporto al pilot.
- nessuna API key audio e nessun servizio esterno TTS richiesto;
- fallback testuale garantito quando il browser non supporta `speechSynthesis`.
- stato demo salvato solo lato browser in `sessionStorage` per finalità di esperienza utente (slide corrente, stato auto-narrazione, ultimo modulo visitato, timestamp);
- nessun dato sensibile o decisionale salvato in persistenza server/database per il meccanismo di ripresa demo.
- perimetro mercato demo comunicato in forma prudenziale: "Il perimetro nazionale può essere stimato, in via prudenziale e da aggiornare prima di ogni presentazione ufficiale, in 16 Autorità di Sistema Portuale e 62 porti di rilievo nazionale.".
- nota obbligatoria nei contenuti business: "Dati di contesto da verificare e aggiornare prima della presentazione commerciale o istituzionale.".
- nessuna generazione automatica di provvedimenti finali: il sistema propone bozze/schemi e supporto di coerenza, con responsabilità decisionale sempre umana.
- i numeri economici della demo sono ipotesi di lavoro non vincolanti, da validare in sede di pilot e confronto budgetario con l ente.
- il break-even puntuale va calcolato dopo definizione costi industriali e pricing effettivo di setup/canoni/moduli.

Evoluzione possibile:
- integrazione futura di voice AI server-side o TTS professionale, mantenendo il perimetro istruttorio e i presidi di legalità.
- generazione dinamica dello speech su profilo interlocutore (tecnico, giuridico, economico) mantenendo responsabilità umana e tracciabilità.
- estensione verso relatore virtuale/avatar istituzionale per demo guidate avanzate.
- introduzione di un tour engine con overlay guidati contestuali e coach vocale professionale.

## Mappa demo territoriale baseline (Issue #10)
- Nuova pagina dedicata: `/mappa`.
- Vista geografica placeholder GIS-ready senza provider esterni/API key obbligatorie.
- Marker territoriali su concessioni, criticita e sopralluoghi con fallback coordinate da concessione.
- Layout demo con pannello lista marker, canvas territoriale e link rapidi a dettaglio entita.
- Estensione schema con metadati territoriali opzionali: `areaDescrizione`, `zonaPortuale`, `riferimentoCatastale`, `localizzazioneDescrizione`.

Perimetro e limiti mappa:
- nessun PostGIS in questa fase;
- nessuna cartografia ufficiale o rilievo tecnico certificato;
- nessun layer demaniale reale;
- nessuna integrazione SIT/geoportale in questa baseline.

## Fascicolo documentale baseline (Issue #18)
- Nuovo registro documentale centrale: `/documenti`.
- Upload file locale con metadati e collegamento a una o piu entita tra concessione, criticita, procedimento, sopralluogo, pagamento, report.
- Download protetto server-side da route dedicata: `/documenti/[id]/download`.
- Archivazione documento con stato esplicito (`ATTIVO`/`ARCHIVIATO`) e restrizione consultiva per `VIEWER_ADSP` su documenti archiviati.
- Audit eventi documentali: upload, download, update metadati, archiviazione e dinieghi autorizzativi.
- Storage demo locale file-system configurabile via env:
   - `DOCUMENT_STORAGE_ROOT`
   - `DOCUMENT_MAX_FILE_MB`
- Seed demo aggiornato: file reali locali in `.local-storage/documents` e metadati documentali estesi in DB.
- Integrazione UI documenti nei dettagli entita principali e sezione "Documenti collegati" nel PDF istituzionale.

Perimetro e limiti:
- baseline documentale orientata a demo e fascicolo operativo interno;
- nessun blob binario su database;
- nessuna conservazione sostitutiva/firma/protocollazione a norma in questa fase.

## Protocollo e metadati PEC baseline (Issue #19)
- Estensione metadata documento con campi istruttori: direzione, canale, numero/data protocollo, mittente/destinatario, Message-ID PEC e riferimenti ricevute.
- Warning operativo automatico su documenti canale `PEC` con ricevute incomplete.
- Filtri e colonne dedicate nel registro documentale e pannelli documenti collegati.
- Sintesi protocollo/PEC inclusa nel PDF report istituzionale come supporto istruttorio.

Perimetro e limiti:
- metadato registrato a fini istruttori;
- nessuna integrazione con provider PEC reali;
- nessuna protocollazione legale automatica o conservazione a norma in questa baseline.

### Institutional PDF polish (Issue #16)
- Template PDF istituzionale raffinato con frontespizio, sommario sezioni e layout piu formale.
- Header ricorrente con riferimenti applicativi/data generazione.
- Footer ricorrente con numerazione pagina, ID report e dicitura "Uso interno / istruttorio".
- Sezioni dedicate a criticita, procedimenti, pagamenti, scadenze e sopralluoghi con box riepilogativi.
- Evidenza esplicita di art. 47, regolarizzazione, checklist contraddittorio e tracciamento art. 10-bis.
- Disclaimer rafforzati: supporto istruttorio, assenza di automatismi decisori e necessita di valutazione dell autorita competente.

## Security hardening (Phase 1)
- Middleware centralizzato in `middleware.ts` per primo filtro accessi/redirect.
- Redirect utenti non autenticati verso `/login` su rotte protette.
- Policy ruolo `VIEWER_ADSP` con blocco rotte operative (nuove/modifica) e redirect a `/adsp`.
- Redirect ruoli back-office da `/adsp` verso `/dashboard`.
- Security headers baseline configurati in `next.config.ts`.
- Rate limiting centralizzato con adapter configurabile (`memory` / `upstash`) su route sensibili (`/api/auth/callback/credentials`, `/export/*`).

### Rate limit backend (Issue #14)
- Configurazione via env:
   - `RATE_LIMIT_BACKEND=memory|upstash`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
- Default locale/CI: `memory` (nessun Redis richiesto).
- Se `RATE_LIMIT_BACKEND=upstash` senza credenziali:
   - in `development`/`test` fallback automatico a memory;
   - in `production` errore esplicito di configurazione.
- Risposta 429 centralizzata con header `Retry-After` e metadati rate-limit.

## Audit trail baseline (Issue #4)
- Baseline audit centralizzata con utility server in `src/server/audit/auditLog.ts`.
- Eventi principali tracciati con contesto utente reale (id, email, ruolo), entita, azione, esito e timestamp.
- Hash chaining tamper-evident: ogni `ActivityLog` salva `previousHash` e `currentHash` SHA-256.
- Raccolta context request (`ipAddress`, `userAgent`) tramite helper `src/server/audit/requestContext.ts`.
- Eventi coperti nelle server actions operative:
   - `CRITICITA_CREATE`
   - `CRITICITA_UPDATE`
   - `PAGAMENTO_UPDATE`
   - `SOPRALLUOGO_CREATE`
   - `PROCEDIMENTO_CREATE`
   - `REPORT_VALIDATE`
   - `REPORT_UNVALIDATE`
   - `REPORT_PDF_DOWNLOAD`
   - `AUTHZ_DENIED` (quando praticabile)
- Vista interna audit (`/audit`) disponibile solo per ruolo `ADMIN`.

   ## Privacy, GDPR and DPIA draft (Issue #8)
   Documentazione preliminare privacy/compliance disponibile in `docs/privacy/`:
   - `docs/privacy/GDPR_REGISTER_DRAFT.md`
   - `docs/privacy/DPIA_DRAFT.md`
   - `docs/privacy/DATA_RETENTION_POLICY_DRAFT.md`
   - `docs/privacy/SECURITY_MEASURES_DRAFT.md`
   - `docs/privacy/PRIVACY_GAPS_AND_NEXT_STEPS.md`

   Perimetro e limiti:
   - i documenti sono bozze operative e non rappresentano conformità GDPR definitiva;
   - la DPIA non e formalmente approvata;
   - prima della produzione e necessaria validazione con DPO/RPD e ente concedente.

## Audit esterno post-Phase 1
- Documento di audit esterno post completamento Phase 1: `docs/EXTERNAL_AI_REVIEW_PHASE_1_COMPLETED.md`
- Il documento supporta la prioritizzazione roadmap, ma non costituisce certificazione di conformità o readiness produzione.

## Limiti noti
- Senza Docker/PostgreSQL attivi, le pagine dati dinamiche possono rispondere con errore.
- I guard server-side restano necessari anche con middleware, come difesa ulteriore.
- Rate limiting in-memory adatto a demo/singola istanza; per produzione serve soluzione distribuita (es. Redis/Upstash).
- Il backend `memory` resta solo fallback dev/demo e non sostituisce controlli edge (WAF/API gateway) in produzione.
- CSP completa e tuning avanzato (WAF, policy enterprise) restano step successivi.
- Questa fase non include ancora SSO/SAML/OIDC enterprise ne MFA end-to-end (previsti nelle fasi successive).
- `.env.example` può essere ignorato da `.gitignore` se e presente la regola `.env*`.
- L'audit trail attuale non e una conservazione legale/fisicamente immutabile (non sostituisce SIEM/WORM).
- Per produzione sono necessari: policy DB append-only, retention/backup, firma e conservazione a norma.
- La baseline test attuale e orientata a smoke/regressioni principali, non sostituisce una suite completa di integrazione e carico.

