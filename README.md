# Concessioni Portuali

Piattaforma demo per la gestione operativa delle concessioni portuali, con moduli istruttori, monitoraggio scadenze, criticita, reportistica ed export.

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

`VIEWER_ADSP` e consultivo: accesso a viste read-only e restrizioni su aree operative (AI e creazione nuove pratiche).

## AI, normativa, export
- Modulo AI assistivo (non sostituisce validazione umana)
- Modulo normativa con impatti sui flussi
- Export CSV sui moduli operativi
- PDF report disponibile su route dedicate

## Security hardening (Phase 1)
- Middleware centralizzato in `middleware.ts` per primo filtro accessi/redirect.
- Redirect utenti non autenticati verso `/login` su rotte protette.
- Policy ruolo `VIEWER_ADSP` con blocco rotte operative (nuove/modifica) e redirect a `/adsp`.
- Redirect ruoli back-office da `/adsp` verso `/dashboard`.
- Security headers baseline configurati in `next.config.ts`.
- Rate limiting demo/base in-memory su route sensibili (`/api/auth/callback/credentials`, `/export/*`).

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
   - `AUTHZ_DENIED` (quando praticabile)
- Vista interna audit (`/audit`) disponibile solo per ruolo `ADMIN`.

## Limiti noti
- Senza Docker/PostgreSQL attivi, le pagine dati dinamiche possono rispondere con errore.
- I guard server-side restano necessari anche con middleware, come difesa ulteriore.
- Rate limiting in-memory adatto a demo/singola istanza; per produzione serve soluzione distribuita (es. Redis/Upstash).
- CSP completa e tuning avanzato (WAF, policy enterprise) restano step successivi.
- Questa fase non include ancora SSO/SAML/OIDC enterprise ne MFA (previsti nelle fasi successive).
- `.env.example` puo essere ignorato da `.gitignore` se e presente la regola `.env*`.
- L'audit trail attuale non e una conservazione legale/fisicamente immutabile (non sostituisce SIEM/WORM).
- Per produzione sono necessari: policy DB append-only, retention/backup, firma e conservazione a norma.
