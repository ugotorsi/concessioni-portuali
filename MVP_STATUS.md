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
- Accessi ruolo-based verificati (ADMIN e VIEWER_ADSP)
- Middleware centralizzato con route protection e redirect anonimi
- Security headers baseline applicati
- Rate limiting demo/base su route sensibili
- Audit trail baseline con hash chaining su ActivityLog (Issue #4)
- Logging centralizzato eventi di scrittura e dinieghi autorizzativi principali
- Pagina interna `/audit` riservata ad ADMIN
- Baseline test automatizzati Vitest + Playwright (Issue #5)
- Smoke E2E su auth/ruoli, security headers e accesso audit
- Mapping strutturato art. 47 su Criticita (Issue #2)
- Filtri/UI/export Criticita allineati al profilo art.47 e rischio decadenza
- Checklist contraddittorio su Procedimento con update auditabile (Issue #7)
- Lista/dettaglio/export procedimenti estesi con stato checklist e warning istruttori
- Export report CSV verificato
- PDF report verificato su report esistente

## Anomalie residue
- Rate limiting non distribuito (in-memory, non adatto a multi-istanza production)
- Hardening avanzato (WAF/CSP completa) non ancora implementato
- Non ancora inclusi SSO/SAML/OIDC enterprise e MFA (fuori scope Phase 1 Issue #1)
- Audit tamper-evident baseline ma non conservazione forense/immutabile a norma
- Coverage test iniziale focalizzata su flussi core, non ancora esaustiva su tutte le route/actions
- Stato Git da consolidare in base alla policy del team
- La checklist procedimentale non e decisore automatico e richiede valutazione giuridica caso per caso

## Prossimi step
1. Estendere progressivamente i test su export/report PDF e procedure critiche
2. Introdurre test integration DB dedicati per server actions a maggiore impatto
3. Mantenere audit periodico su DB/container e dipendenze
