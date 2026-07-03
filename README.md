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
L'accesso demo avviene da `/login` tramite cookie `cp_demo_role`.
Ruoli principali:
- `ADMIN`
- `OPERATORE_SOCIETA`
- `GIURIDICO`
- `TECNICO`
- `ECONOMICO`
- `VIEWER_ADSP`

`VIEWER_ADSP` e consultivo: accesso a viste read-only e restrizioni su aree operative (AI e creazione nuove pratiche).

## AI, normativa, export
- Modulo AI assistivo (non sostituisce validazione umana)
- Modulo normativa con impatti sui flussi
- Export CSV sui moduli operativi
- PDF report disponibile su route dedicate

## Limiti noti
- Senza Docker/PostgreSQL attivi, le pagine dati dinamiche possono rispondere con errore.
- Il file `middleware.ts` non e presente: la protezione accessi e gestita server-side nelle pagine/route.
- `.env.example` puo essere ignorato da `.gitignore` se e presente la regola `.env*`.
