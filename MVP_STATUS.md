# MVP Status - Concessioni Portuali

## Stato attuale
Progetto ripristinato e avviabile in locale con stack Next.js + Prisma + PostgreSQL Docker.

## Moduli disponibili
- Dashboard
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
- Audit su download PDF (`REPORT_PDF_DOWNLOAD`) e dinieghi autorizzativi su route PDF
- Test unit su PDF service e test E2E policy download PDF per ruolo/validazione
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

## Phase 2 avviata
- Issue #11: Add CI/CD baseline with GitHub Actions.
- Workflow CI introdotto in `.github/workflows/ci.yml` con job separati:
	- `unit-build-check`
	- `e2e` con servizio PostgreSQL.

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

## Prossimi step
1. Estendere progressivamente i test su export/report PDF e procedure critiche
2. Introdurre test integration DB dedicati per server actions a maggiore impatto
3. Mantenere audit periodico su DB/container e dipendenze

