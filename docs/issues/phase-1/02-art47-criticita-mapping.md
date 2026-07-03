# Add art. 47 Cod. Nav. mapping to Criticita

## Obiettivo
Aggiungere mapping giuridico esplicito delle criticita alle fattispecie dell'art. 47 Codice della Navigazione.

## Motivazione strategica
Rende il presidio delle criticita giuridicamente tracciabile e migliora la qualita istruttoria per diffida/decadenza/revoca.

## Ambito
- Estensione modello dati Criticita con classificazione art. 47.
- Aggiornamento creazione/modifica/filtro criticita.
- Coerenza output report/export.

## File coinvolti
- prisma/schema.prisma
- prisma/seed.ts
- src/server/actions/criticita.ts
- src/server/queries/criticita.ts
- src/app/criticita/nuova/page.tsx
- src/app/criticita/[id]/modifica/page.tsx
- src/components/criticita/CriticitaFiltersBar.tsx

## Attivita tecniche
- Introdurre campo strutturato lettera_art47 (enum o valore controllato).
- Aggiornare validazioni server e form UI.
- Abilitare filtro e badge dedicato.
- Estendere query/report/export con nuova informazione.

## Criteri di accettazione
- Campo art.47 persistito e validato.
- Campo valorizzabile in creazione e modifica criticita.
- Filtro UI funzionante.
- Presenza del mapping in output report/export principali.

## Test richiesti
- Test action create/update criticita con art.47.
- Test query filtro per lettera art.47.
- Test regressione pagine criticita.

## Rischi
- Dati legacy senza mapping.
- Tassonomia incompleta delle fattispecie art.47.

## Dipendenze
- Preferibile allineamento con stream procedimentale (Issue 7).

## Priorita
High

## Complessita
Media

## Label suggerite
legal-domain, prisma, phase-1, priority-high
