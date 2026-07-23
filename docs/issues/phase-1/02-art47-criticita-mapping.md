# Add art. 47 Cod. Nav. mapping to Criticità

## Obiettivo
Aggiungere mapping giuridico esplicito delle criticità alle fattispecie dell'art. 47 Codice della Navigazione.

## Motivazione strategica
Rende il presidio delle criticità giuridicamente tracciabile e migliora la qualita istruttoria per diffida/decadenza/revoca.

## Ambito
- Estensione modello dati Criticità con classificazione art. 47.
- Aggiornamento creazione/modifica/filtro criticità.
- Coerenza output report/export.

## File coinvolti
- prisma/schema.prisma
- prisma/seed.ts
- src/server/actions/criticità.ts
- src/server/queries/criticità.ts
- src/app/criticità/nuova/page.tsx
- src/app/criticità/[id]/modifica/page.tsx
- src/components/criticità/CriticitaFiltersBar.tsx

## Attività tecniche
- Introdurre campo strutturato lettera_art47 (enum o valore controllato).
- Aggiornare validazioni server e form UI.
- Abilitare filtro e badge dedicato.
- Estendere query/report/export con nuova informazione.

## Criteri di accettazione
- Campo art.47 persistito e validato.
- Campo valorizzabile in creazione e modifica criticità.
- Filtro UI funzionante.
- Presenza del mapping in output report/export principali.

## Test richiesti
- Test action create/update criticità con art.47.
- Test query filtro per lettera art.47.
- Test regressione pagine criticità.

## Rischi
- Dati legacy senza mapping.
- Tassonomia incompleta delle fattispecie art.47.

## Dipendenze
- Preferibile allineamento con stream procedimentale (Issue 7).

## Priorità
High

## Complessita
Media

## Label suggerite
legal-domain, prisma, phase-1, priority-high

