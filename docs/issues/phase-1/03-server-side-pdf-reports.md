# Implement professional server-side PDF reports

## Obiettivo
Sostituire/rafforzare output PDF demo con generazione server-side professionale, template istituzionale e dati istruttori.

## Motivazione strategica
Un report PDF formalizzato aumenta credibilita in interlocuzione con AdSP, partner e stakeholder pubblici.

## Ambito
- Refactoring mirato della generazione PDF lato server.
- Standardizzazione sezioni e metadata.
- Miglioramento robustezza layout/contenuti.

## File coinvolti
- src/app/report/[id]/pdf/route.ts
- src/server/queries/report.ts
- src/lib/utils.ts
- src/types/

## Attività tecniche
- Definire template istituzionale (header, footer, sezioni).
- Mappare contenuti istruttori in blocchi coerenti.
- Gestire fallback per campi mancanti.
- Inserire metadata documento e timestamp.

## Criteri di accettazione
- PDF generato server-side con layout stabile.
- Sezioni minime presenti: contesto, evidenze, analisi, proposta.
- Output leggibile/stampabile e coerente su casi demo.
- Nessuna regressione sulle route report.

## Test richiesti
- Test endpoint PDF su report valido.
- Test gestione report incompleto.
- Smoke test manuale visualizzazione/stampa.

## Rischi
- Impaginazione fragile con contenuti lunghi.
- Divergenza tra dati query e template finale.

## Dipendenze
- Beneficia di completamento Issue 2 e Issue 7.

## Priorità
High

## Complessita
Media-Alta

## Label suggerite
reports, pdf, phase-1, priority-high

