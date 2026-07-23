# Add security middleware, headers and rate limiting

## Obiettivo
Introdurre protezione centralizzata route, security headers e rate limiting base.

## Motivazione strategica
Uniforma la postura di sicurezza e riduce il rischio di esposizioni incoerenti tra route/pagine.

## Ambito
- Middleware centralizzato per policy accesso.
- Security headers per hardening HTTP.
- Rate limiting baseline su endpoint sensibili.

## File coinvolti
- src/middleware.ts
- next.config.ts
- src/lib/auth.ts
- src/app/**/route.ts

## Attività tecniche
- Definire matcher middleware per aree protette.
- Impostare security headers minimi coerenti con app.
- Implementare rate limiting base per endpoint critici.
- Standardizzare risposte per accesso negato e throttling.

## Criteri di accettazione
- Middleware attivo sulle route target.
- Headers di sicurezza presenti nelle risposte previste.
- Rate limiting funzionante su endpoint sensibili.
- Nessuna regressione sui flussi autorizzati.

## Test richiesti
- Test accesso route protette per ruoli diversi.
- Test presenza headers su response.
- Test superamento soglia rate limit.

## Rischi
- Blocchi indebiti su route legittime.
- Configurazioni headers incompatibili con alcune funzionalita.

## Dipendenze
- Coordinata con Issue 1 per allineamento auth.

## Priorità
Critical

## Complessita
Media-Alta

## Label suggerite
security, middleware, phase-1, priority-critical

