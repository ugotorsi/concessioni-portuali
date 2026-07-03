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
- Export report CSV verificato
- PDF report verificato su report esistente

## Anomalie residue
- Rate limiting non distribuito (in-memory, non adatto a multi-istanza production)
- Hardening avanzato (WAF/CSP completa) non ancora implementato
- Non ancora inclusi SSO/SAML/OIDC enterprise e MFA (fuori scope Phase 1 Issue #1)
- Audit tamper-evident baseline ma non conservazione forense/immutabile a norma
- Stato Git da consolidare in base alla policy del team

## Prossimi step
1. Consolidare baseline Git del ripristino
2. Definire eventuale introduzione middleware centralizzato solo se richiesto
3. Mantenere audit periodico su DB/container e dipendenze
