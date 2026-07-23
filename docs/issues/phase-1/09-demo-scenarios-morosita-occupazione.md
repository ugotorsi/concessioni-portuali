# Add institutional demo scenarios for morosità and occupazione difforme

## Obiettivo
Rafforzare seed e percorso demo con due casi istituzionali completi: morosità rilevante e occupazione difforme.

## Motivazione strategica
Aumenta qualita commerciale e istituzionale delle demo, mostrando valore concreto su casi ad alto impatto.

## Ambito
- Definizione dataset scenari.
- Script demo guidato end-to-end.
- Output report/KPI attesi per ciascun scenario.

## File coinvolti
- prisma/seed.ts
- src/app/demo/page.tsx
- src/app/report/page.tsx
- docs/DEMO_SCENARIOS_INSTITUTIONAL.md

## Attività tecniche
- Preparare dati seed realistici per entrambi i casi.
- Definire percorso demo con passaggi e tempi standard.
- Collegare evidenze a criticità/procedimenti/report.
- Formalizzare KPI narrativi (rischio, tempo, decisioni supportate).

## Criteri di accettazione
- Due scenari eseguibili senza workaround.
- Durata demo prevedibile e ripetibile.
- Evidenze e output coerenti con obiettivi istituzionali.
- Documentazione scenario disponibile.

## Test richiesti
- Smoke test esecuzione completa scenario morosità.
- Smoke test esecuzione completa scenario occupazione difforme.
- Verifica consistenza output report.

## Rischi
- Seed non stabile tra run successive.
- Narrazione demo non allineata ai dati reali mostrati.

## Dipendenze
- Beneficia di Issue 3 e Issue 7 completate.

## Priorità
High

## Complessita
Media

## Label suggerite
demo, seed, legal-domain, phase-1, priority-high

