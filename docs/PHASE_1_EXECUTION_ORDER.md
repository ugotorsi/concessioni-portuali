# Phase 1 Execution Order

## Ordine consigliato delle issue
1. Completamento pagina e navigazione Verticali
2. Implementazione verticale Patrimonio immobiliare pubblico
3. Fascicolo unico del bene e dei rapporti collegati
4. Documenti e fonti normative realmente apribili
5. Collegamento completo tra beni, rapporti, soggetti, canoni, pagamenti, scadenze, obblighi, manutenzioni, sopralluoghi, criticita, procedimenti, documenti, normativa, audit, report
6. Eliminazione progressiva placeholder
7. Consolidamento RBAC ordinario per ruoli applicativi reali
8. Test, build e pubblicazione Preview su staging-operativo

## Dipendenze
- Verticali -> abilita onboarding coerente alle due verticali strategiche.
- Patrimonio immobiliare pubblico -> dipende da Verticali navigabile e tassonomia minima condivisa.
- Fascicolo unico del bene -> dipende da collegamenti modulo-modulo e modello documentale operativo.
- Documenti/fonti apribili -> dipende da storage e metadati coerenti con fascicolo.
- Collegamenti trasversali -> dipendono da allineamento identificativi tra moduli.
- Placeholder cleanup -> procede per incrementi senza bloccare il flusso principale.
- RBAC ordinario -> si consolida dopo disponibilita dei flussi reali.
- Test/build/preview -> gating finale continuo su ogni incremento.

## Cosa fare prima
- Confermare branch operativo unico: staging-operativo.
- Riclassificare issue e task demo/investitore in backlog non prioritario o da chiudere.
- Definire acceptance criteria per verticale Patrimonio immobiliare pubblico.
- Stabilire criteri di non-distruttivita DB per ogni incremento.

## Cosa non fare prima
- Non creare nuovi ambienti demo o alias investitore.
- Non introdurre modifiche narrative/decorative non funzionali al prodotto definitivo.
- Non eseguire modifiche distruttive schema DB senza autorizzazione preventiva.
- Non toccare ambienti production/main.

## Attività in parallelo
- In parallelo controllato: fascicolo bene + raccordo documenti/normativa.
- In parallelo controllato: mapping collegamenti modulo-modulo + RBAC ordinario.
- In parallelo tardivo: eliminazione placeholder residui e rifiniture UX.
- Da non parallelizzare troppo: interventi che toccano auth, tenant scope e audit.

## Definition of Done finale della Phase 1
Phase 1 e completata quando:
- la navigazione Verticali riflette le 2 verticali strategiche definitive;
- la verticale Patrimonio immobiliare pubblico e operativa almeno nel primo perimetro reale;
- il fascicolo unico collega dati essenziali bene-rapporto-soggetto-pagamento-documento-procedimento;
- non restano dipendenze bloccanti da percorsi demo investitore;
- build/check/test risultano verdi in modo ripetibile;
- documentazione compliance minima (GDPR/DPIA draft) e disponibile;
- repository risulta pulito e milestone GitHub aggiornata con evidenze tracciate.

