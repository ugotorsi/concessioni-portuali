# MVP Status - Concessioni Portuali

## Stato attuale
Progetto ripristinato e avviabile in locale con stack Next.js + Prisma + PostgreSQL Docker.

## Moduli disponibili
- Dashboard
- Mappa demo territoriale
- Concessioni
- Criticita
- Pagamenti
- Sopralluoghi
- Procedimenti
- Report
- Normativa
- AI assistiva
- Vista consultiva AdSP
- Export CSV e PDF report

## Cosa funziona
- Build produzione (`npm run build`) verde
- Check progetto (`npm run check`) verde
- Prisma validate/generate/push verdi con DB attivo
- Seed demo eseguibile e completato
- Accesso demo reale email/password con utenti persistenti e ruoli applicati
- Baseline auth hardening: lockout tentativi falliti, reset contatori su login valido e messaggistica errore generica (Issue #15)
- Campi MFA-ready sul modello utente introdotti (Issue #15)
- Accessi ruolo-based verificati (ADMIN e VIEWER_ADSP)
- Middleware centralizzato con route protection e redirect anonimi
- Security headers baseline applicati
- Rate limiting centralizzato con adapter Redis-ready e fallback memory per dev/CI (Issue #14)
- Audit trail baseline con hash chaining su ActivityLog (Issue #4)
- Logging centralizzato eventi di scrittura e dinieghi autorizzativi principali
- Pagina interna `/audit` riservata ad ADMIN
- Baseline test automatizzati Vitest + Playwright (Issue #5)
- Smoke E2E su auth/ruoli, security headers e accesso audit
- Mapping strutturato art. 47 su Criticita (Issue #2)
- Filtri/UI/export Criticita allineati al profilo art.47 e rischio decadenza
- Regolarizzazione Criticita con impatto istruttorio e verifica dedicata (Issue #12)
- Estensione lista/dettaglio/export criticita con stato/esito regolarizzazione
- Checklist contraddittorio su Procedimento con update auditabile (Issue #7)
- Lista/dettaglio/export procedimenti estesi con stato checklist e warning istruttori
- Distinzione Procedimento d ufficio / istanza di parte con tracking art. 10-bis istruttorio (Issue #13)
- Refinement warning checklist su preavviso rigetto e osservazioni
- Export report CSV verificato
- PDF report istituzionale server-side (PDFKit) con template stabile, sezioni istruttorie e footer/disclaimer
- PDF istituzionale migliorato (Issue #16) con frontespizio, sommario, header/footer ricorrenti, box riepilogativi e disclaimer finali rafforzati
- Nuova sezione `/demo-scenari` con 5 scenari demo istituzionali guidati (Issue #17)
- Seed allineato a casi demo su morosita art.47, occupazione difforme, regolarizzazione, contraddittorio incompleto e art.10-bis
- Collegamenti scenario -> concessione/criticita/procedimento/report/PDF con linguaggio istruttorio non decisorio
- Audit su download PDF (`REPORT_PDF_DOWNLOAD`) e dinieghi autorizzativi su route PDF
- Test unit su PDF service e test E2E policy download PDF per ruolo/validazione
- Baseline fascicolo documentale (Issue #18): upload/download protetto, metadati estesi, collegamento multi-entita, stato `ATTIVO/ARCHIVIATO`, audit dedicato, pagina `/documenti` e integrazione su dettagli entita
- Baseline protocollo/PEC metadata (Issue #19): metadati istruttori su documenti (direzione, canale, protocollo, Message-ID/ricevute PEC), warning ricevute incomplete e sintesi in report/PDF
- Demo guidata AI-led (Issue #20): sezione `/demo-guidata` con slide navigabili, speaker notes AI, link rapidi a scenari/fascicolo/mappa/report e narrativa istituzionale su automazione del procedimento (non della decisione)
- Voce narrante demo guidata (Issue #21): Web Speech API browser-based su `/demo-guidata` con controlli leggi/pausa/riprendi/ferma, narrazione automatica opzionale e fallback senza servizi esterni/API key
- Relatore AI evoluto (Issue #22): narrazione discorsiva basata su `narrationScript` per ciascuna slide, con tono istituzionale, transizioni più naturali e superamento della lettura meccanica dei contenuti
- Demo guidata con pausa/ripresa contestuale (Issue #23): apertura moduli (fascicolo, scenari, mappa, report) con sospensione demo, stato locale in `sessionStorage`, rientro su slide corrente e box "Riprendi demo"
- Banner di rientro "Torna alla demo guidata" sui moduli visitati durante il tour con accesso rapido a `/demo-guidata?resume=1`
- Demo guidata legal assistant + business plan (Issue #24): nuove slide su supporto legale-amministrativo alla predisposizione atti e controllo coerenza, più sezione economica strutturata per perimetro nazionale, costi/tempi/ricavi e scenari prudente/intermedio/esteso
- Investment cost breakdown in demo guidata (Issue #25): dettaglio investimento per fasi (pilot, produzione ente, scalabilità multi-ente), voci costo, ricavi iniziali/ricorrenti/professionali e scenari break-even prudente/intermedio/esteso
- Seed documentale locale attivo con file su storage configurabile (`DOCUMENT_STORAGE_ROOT`) e limiti upload (`DOCUMENT_MAX_FILE_MB`)
- Warning Turbopack su filesystem tracing document storage risolto con isolamento runtime server-side del modulo storage (build pulita, senza warning NFT)
- Baseline mappa demo territoriale (Issue #10): route `/mappa` GIS-ready con lista marker, placeholder map UI e link rapidi a concessioni/criticita/sopralluoghi
- Metadati territoriali demo opzionali estesi: area descrizione, zona portuale, riferimento catastale e localizzazione descrittiva su criticita/sopralluoghi
- Nessuna API key esterna richiesta (no Google Maps/Mapbox obbligatori), coordinate solo demo/approssimative
- Documentazione privacy/GDPR/DPIA draft creata (Issue #8)

## Compliance/privacy (Issue #8)
- Registro trattamenti draft in `docs/privacy/GDPR_REGISTER_DRAFT.md`
- DPIA draft in `docs/privacy/DPIA_DRAFT.md`
- Data retention policy draft in `docs/privacy/DATA_RETENTION_POLICY_DRAFT.md`
- Security measures draft in `docs/privacy/SECURITY_MEASURES_DRAFT.md`
- Matrice gap privacy e next steps in `docs/privacy/PRIVACY_GAPS_AND_NEXT_STEPS.md`

## Audit esterno post-Phase 1
- Audit esterno ricevuto dopo completamento stream #1-#8: `docs/EXTERNAL_AI_REVIEW_PHASE_1_COMPLETED.md`
- Esito sintetico: go demo con perimetro controllato, no-go production fino a chiusura gap bloccanti.

## Project-wide assessment post cloud demo investitore
- Assessment complessivo di transizione demo -> piattaforma: `docs/PROJECT_WIDE_ASSESSMENT_PLATFORM_DEVELOPMENT.md`
- Pacchetto prompt per audit da altra AI: `docs/EXTERNAL_AI_AUDIT_PLATFORM_DEVELOPMENT_REQUEST.md`
- Roadmap piattaforma (Sprint 1-7): `docs/PLATFORM_DEVELOPMENT_ROADMAP.md`

Sintesi posizione attuale:
- cloud demo consegnata e valida come ambiente dimostrativo;
- progetto non classificabile come produzione;
- gap principali su storage documentale persistente, compliance formalizzata, hardening sicurezza enterprise e integrazioni ente.

Prossima decisione richiesta:
- confermare avvio Sprint 1 su fascicolo documentale cloud persistente.

## Sprint 1 in esecuzione - Fascicolo documentale cloud persistente
- Storage adapter astratto introdotto con backend `local` e `s3` (S3-compatible).
- Metadata storage estesi sul modello documento (provider/key/bucket/hash/dimensione/originalName).
- Upload aggiornato con metadati obbligatori (`source`, `status`), hash SHA-256 e persistenza via adapter.
- Download aggiornato su `storageKey` con fallback legacy, audit e preview semplice PDF/immagini.
- Soft delete mantenuto via archiviazione (`ARCHIVIATO` + `archivedAt`) con audit.
- Nuova documentazione tecnica: `docs/DOCUMENT_DOSSIER_STORAGE.md`.

## Phase 2 avviata
- Issue #11: Add CI/CD baseline with GitHub Actions.
- Workflow CI introdotto in `.github/workflows/ci.yml` con job separati:
	- `unit-build-check`
	- `e2e` con servizio PostgreSQL.

## Cloud demo
- Stato: primo deploy cloud completato (Issue #27), non production.
- Architettura target: Next.js su Vercel + PostgreSQL gestito + seed demo.
- Obiettivo: presentazioni esterne senza dipendenza da avvio locale Docker/terminale.
- Vincolo: nessun dato reale o riservato nel database demo cloud.
- Checklist anti-figuraccia, piano B e procedura deploy documentati in `docs/CLOUD_DEMO_DEPLOYMENT.md`.
- Dominio demo verificato: `https://concessioni-portuali-demo.vercel.app`.
- DB cloud inizializzato: `db:push` allineato e `db:seed` completato su PostgreSQL gestito.
- Rotte cloud verificate (reachability): `/`, `/login`, `/demo-guidata`, `/demo-scenari`, `/documenti`, `/mappa`, `/report`.
- Diagnostica login cloud completata (2026-07-05): utenti demo presenti nel DB target, hash password valorizzati, account non bloccati.
- Correzione cloud eseguita: `DATABASE_URL` Vercel riallineata al DB seedato (Production+Preview), `NEXTAUTH_URL` riallineata al dominio demo e redeploy production completato.
- Verifica funzionale post-fix: login admin OK, login viewer OK, demo guidata OK (voce AI + pausa/riprendi), accesso viewer a `/demo-guidata` OK.

Presidi comunicativi:
- non presentare come produzione;
- non presentare la AI come decisore automatico;
- mantenere fallback demo locale e materiale statico (PDF/screenshot/video).

Copertura baseline CI:
- install dipendenze;
- Prisma generate;
- unit test;
- build;
- check;
- E2E Playwright con seed DB;
- upload artifact report Playwright in caso di failure.

## Anomalie residue
- Backend memory mantenuto solo come fallback demo/dev; per produzione multi-istanza necessario backend distribuito (Upstash/Redis) correttamente configurato
- Hardening avanzato (WAF/CSP completa) non ancora implementato
- Non ancora inclusi SSO/SAML/OIDC enterprise e MFA end-to-end (fuori scope current baseline)
- Audit tamper-evident baseline ma non conservazione forense/immutabile a norma
- Coverage test iniziale focalizzata su flussi core, non ancora esaustiva su tutte le route/actions
- PDF polished per demo istituzionale ma non sostituisce catena documentale/protocollare a valore legale
- Stato Git da consolidare in base alla policy del team
- La checklist procedimentale non e decisore automatico e richiede valutazione giuridica caso per caso
- Draft privacy non equivalgono ad approvazione formale DPIA/compliance
- Nomine privacy, retention ufficiale, data breach workflow e gestione diritti interessati da formalizzare con ente
- Nessun deploy automatico staging/production ancora configurato
- Nessun security scan avanzato CI (SAST/dependency audit gating)
- Nessun coverage gate obbligatorio in pipeline
- Baseline GIS senza PostGIS, senza cartografia ufficiale e senza integrazione SIT/geoportale in questa fase
- Metadati protocollo/PEC tracciati solo a fini istruttori: nessuna integrazione PEC/protocollo a valore legale in questa fase
- Demo guidata AI-led orientata a storytelling istituzionale/pilot: non costituisce automazione decisionale o supporto decisorio vincolante
- Narrazione vocale dipendente dalle capacità del browser client: in assenza di `speechSynthesis` resta disponibile la fruizione testuale completa
- La voce browser resta un motore TTS locale: qualità e timbro dipendono dalle voci installate sul client
- Persistenza stato demo limitata a `sessionStorage` lato browser per UX (nessun salvataggio server/database e nessun dato sensibile)
- Supporto legale solo assistivo: bozze/schemi/precompilazione e controlli di coerenza, senza generazione automatica di provvedimenti finali e senza sostituzione del responsabile del procedimento
- Dati business plan demo su AdSP/porti esposti come stima prudenziale e da aggiornare prima di presentazioni ufficiali
- Range economici demo non vincolanti: ipotesi di lavoro da validare in sede di pilot e definizione industriale dei costi/prezzi

## Prossimi step
1. Estendere progressivamente i test su export/report PDF e procedure critiche
2. Introdurre test integration DB dedicati per server actions a maggiore impatto
3. Mantenere audit periodico su DB/container e dipendenze

