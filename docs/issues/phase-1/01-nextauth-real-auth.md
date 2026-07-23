# Implement real authentication with NextAuth.js

## Obiettivo
Sostituire login demo/cookie ruolo con autenticazione reale, utenti persistenti e sessione sicura.

## Motivazione strategica
E un prerequisito per credibilita istituzionale, controllo accessi robusto e tracciabilità affidabile degli attori operativi.

## Ambito
- Integrazione NextAuth.js con sessione server-side.
- Persistenza utenti, ruoli e sessioni su database.
- Migrazione dai guard demo cookie-based verso policy coerenti.

## File coinvolti
- src/lib/auth.ts
- src/app/login/page.tsx
- src/app/logout/route.ts
- src/app/layout.tsx
- src/middleware.ts
- package.json

## Attività tecniche
- Integrare NextAuth.js e configurare provider/strategy per fase demo istituzionale.
- Definire modello utenti/ruoli/sessioni persistente.
- Implementare callback/session mapping ruoli.
- Aggiornare protezioni route/pagine/actions per usare sessione reale.
- Gestire redirect login/logout e session expiration.

## Criteri di accettazione
- Login/logout funzionanti senza cookie ruolo demo.
- Sessione valida e persistente lato server.
- Ruoli applicati in modo consistente su pagine, actions e route handlers.
- Accessi non autorizzati bloccati con comportamento deterministico.

## Test richiesti
- Test integrazione login/logout.
- Test autorizzazione per almeno ADMIN, OPERATORE_SOCIETA e VIEWER_ADSP.
- Test sessione scaduta/revocata.

## Rischi
- Regressioni su flussi esistenti dipendenti da cp_demo_role.
- Incoerenza tra ruoli UI e autorizzazioni server.

## Dipendenze
- Nessuna dipendenza bloccante; stream fondazionale.

## Priorità
Critical

## Complessita
Alta

## Label suggerite
auth, security, phase-1, priority-critical

