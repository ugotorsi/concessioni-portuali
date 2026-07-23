# Add procedural adversarial checklist to Procedimento

## Obiettivo
Modellare e visualizzare gli elementi minimi del contraddittorio procedimentale: comunicazione avvio, termine memorie, audizione, pareri, provvedimento finale.

## Motivazione strategica
Rafforza tenuta amministrativa del procedimento e riduce rischio contestazioni su garanzie partecipative.

## Ambito
- Estensione modello Procedimento.
- UI di compilazione e lettura checklist.
- Regole di completezza e alert.

## File coinvolti
- prisma/schema.prisma
- src/server/actions/procedimenti.ts
- src/server/queries/procedimenti.ts
- src/app/procedimenti/nuovo/page.tsx
- src/app/procedimenti/[id]/page.tsx

## Attività tecniche
- Definire campi checklist contraddittorio.
- Aggiornare action/query e validazioni.
- Rendere visibile stato checklist nel dettaglio procedimento.
- Integrare tracciamento aggiornamenti in audit.

## Criteri di accettazione
- Checklist compilabile e persistita.
- Evidenza stato completo/incompleto.
- Alert o blocco per step obbligatori mancanti.
- Dati disponibili per reportistica procedimentale.

## Test richiesti
- Test create/update procedimento con checklist.
- Test validazioni step obbligatori.
- Test visualizzazione stato checklist.

## Rischi
- Eccessiva rigidita workflow su casi eccezionali.
- Incompletezza campi rispetto prassi organizzative reali.

## Dipendenze
- Sinergia con Issue 2 (mapping legale) e Issue 4 (audit).

## Priorità
High

## Complessita
Media

## Label suggerite
legal-domain, procedimento, phase-1, priority-high

