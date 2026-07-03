# Add Vitest and Playwright test baseline

## Obiettivo
Introdurre test automatici minimi su query/actions e flussi demo principali.

## Motivazione strategica
Aumenta affidabilita del rilascio demo istituzionale e riduce regressioni su funzionalita critiche.

## Ambito
- Setup framework Vitest e Playwright.
- Baseline unit/integration per server logic.
- Baseline e2e su flussi core.

## File coinvolti
- package.json
- vitest.config.ts
- playwright.config.ts
- tests/unit/
- tests/e2e/

## Attivita tecniche
- Configurare runner, script e ambiente test.
- Scrivere test unitari su query/actions prioritarie.
- Scrivere scenari e2e su login, criticita/procedimento e report.
- Integrare comandi test nella routine check.

## Criteri di accettazione
- Suite test eseguibile localmente.
- Almeno 2 scenari e2e passanti.
- Copertura minima su stream critici Phase 1.
- Report test chiaro e ripetibile.

## Test richiesti
- Esecuzione completa unit + e2e.
- Verifica stabilita su due run consecutive.

## Rischi
- Flakiness e2e in ambiente locale.
- Tempi test elevati se dataset non controllato.

## Dipendenze
- Beneficia della stabilizzazione di Issue 1, 6 e 4.

## Priorita
Critical

## Complessita
Media

## Label suggerite
testing, quality, phase-1, priority-critical
