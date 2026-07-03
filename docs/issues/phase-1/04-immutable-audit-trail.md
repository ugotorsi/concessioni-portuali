# Add immutable audit trail baseline

## Obiettivo
Rafforzare ActivityLog verso audit trail non manipolabile, con dati essenziali per ricostruzione forense.

## Motivazione strategica
Riduce rischio legale/compliance e migliora la difendibilita delle azioni in caso di verifica o contenzioso.

## Ambito
- Estensione logging eventi sensibili.
- Introduzione meccanismi tamper-evident baseline.
- Consultazione minima eventi audit.

## File coinvolti
- prisma/schema.prisma
- src/server/actions/
- src/server/queries/
- src/lib/auth.ts
- src/lib/utils.ts

## Attivita tecniche
- Definire modello evento audit con actor, azione, target, timestamp, contesto.
- Implementare hash o chaining semplice per evidenza integrita.
- Integrare logging in actions critiche.
- Esporre query base per consultazione/verifica.

## Criteri di accettazione
- Azioni critiche tracciate con metadati minimi.
- Integrita eventi verificabile.
- Audit consultabile con filtri base.
- Nessuna regressione di performance in flussi principali.

## Test richiesti
- Test creazione evento su action sensibile.
- Test verifica integrita catena/hash.
- Test query audit con filtri.

## Rischi
- Overhead prestazionale su azioni ad alta frequenza.
- Logging incompleto in punti non coperti.

## Dipendenze
- Consigliata chiusura o stabilita Issue 1 (identity affidabile).

## Priorita
Critical

## Complessita
Alta

## Label suggerite
audit, compliance, security, phase-1, priority-critical
