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

