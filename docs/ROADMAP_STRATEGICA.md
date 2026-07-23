# Roadmap Tecnica e Strategica

## 0. Repositioning di dominio (Issue #34 / 32A)

- La piattaforma va descritta come supporto istruttorio per rapporti concessori demaniali/pubblici.
- Il dominio si articola in core comune + verticali normative progressive.
- Verticale A (attiva): portuale/AdSP con art. 18 L. 84/1994 come verticale speciale e art. 36 cod. nav. ove rilevante.
- Verticale B (roadmap): marittima turistico-ricreativa per comuni costieri con art. 36/37/47 cod. nav., d.l. 400/1993 e vincoli art. 12 direttiva 2006/123/CE.
- Art. 47 cod. nav. va mantenuto come regola trasversale di decadenza, non solo portuale.

Track evolutivo collegato:
- 32A: documentation/domain repositioning;
- 32B: data model preparation;
- 32C: UI/demo verticals.

## 1. Stato MVP attuale

- Moduli completati: Dashboard, Concessioni, Concessionari, Criticità, Scadenze, Pagamenti, Sopralluoghi, Procedimenti, Report, Normativa, Assistente AI (scaffold), Demo.
- Natura operativa controllata: ai flussi read-mostly si affiancano write minime autorizzate e tracciate su moduli core.
- SQLite temporaneo: ambiente locale semplificato per accelerare sviluppo e dimostrazione.
- Valore demo: percorso end-to-end già presentabile a soci e interlocutori istituzionali con dataset coerente multi-modulo.

## 2. Debolezze tecniche attuali

- SQLite: soluzione efficace per demo, ma non ideale per carichi concorrenti e scenari produttivi.
- Assenza autenticazione: mancano login reale, controllo sessione e governance accessi.
- Assenza CRUD: impossibilità di aggiornare operativamente il dato senza interventi esterni.
- Export professionale avviato: presenti export CSV server-side e PDF report server-side con regole ruolo.
- Assenza viste separate società/AdSP: perimetro utente non ancora differenziato per audience e responsabilità.

## 3. Debolezze di dominio

- Assenza GIS: non è presente una rappresentazione spaziale evoluta di aree, perimetri e interferenze.
- Motore normativo iniziale: introdotto modulo Normativa con fonti, versioni e impatti collegati ai moduli operativi.
- Assenza tracciamento contraddittorio procedimentale: mancano timeline strutturate e audit trail dedicati.
- Seed ancora generico: dataset valido per demo, ma non ancora strutturato su casistiche istituzionali profonde.
- Assenza automazione documentale: manca una pipeline per bozza atti, classificazione e orchestrazione documenti.

## 4. Roadmap immediata 1-2 settimane

- PostgreSQL + Docker:
  - ripristino datasource PostgreSQL e stack locale containerizzato
  - verifica migrazioni e allineamento query
- Autenticazione e ruoli:
  - login, sessione e profili minimi (società, AdSP, amministrazione)
- CRUD minimo:
  - inserimento/aggiornamento controllato su criticità, pagamenti e sopralluoghi
- Vista AdSP read-only:
  - separazione navigazione e contenuti per profilo istituzionale
- Export PDF/CSV professionale:
  - CSV server-side su criticita/scadenze/pagamenti/procedimenti/report
  - PDF server-side su report con regole ruolo
- Seed scenari art. 47:
  - casi guidati su decadenza/revoca e contraddittorio

## 5. Roadmap intermedia 1-2 mesi

- GIS:
  - visualizzazione concessioni su mappa e analisi interferenze
- Motore alert configurabile:
  - regole su scadenze, morosità, garanzie e stati procedimentali
- Generatore bozze atti:
  - template istruttori e compilazione semi-automatica
- Modulo normativa avanzato:
  - workflow completo di aggiornamento versione, validazione e storico
- Assistente AI con provider:
  - integrazione LLM con audit prompt/output e policy di sicurezza
- Upload documentale con parsing:
  - estrazione metadati, classificazione e collegamento automatico ai moduli
- Modulo bandi:
  - gestione ciclo preparazione procedura, allegati e stato avanzamento
- Dashboard duale società/AdSP:
  - indicatori e narrative differenziate per ruolo

## 6. Roadmap strategica 3-6 mesi

- Motore giuridico integrato:
  - supporto normativo contestuale su casi e passaggi istruttori
- Scoring rischio decadenza/revoca:
  - modelli di priorità basati su segnali tecnico-giuridico-economici
- Digital twin concessione:
  - fascicolo digitale dinamico con stato operativo e storico eventi
- Modulo bandi intelligente:
  - suggerimenti su criterio procedura, output e coerenza documentale
- Interoperabilità SID/BDNCP/PDND:
  - integrazione con ecosistemi pubblici e flussi informativi istituzionali
- Multi-ente white label:
  - adozione scalabile su più autorità o società in configurazione dedicata

## 7. Innovazioni differenzianti

- Motore normativo contestuale
- Generazione atti istruttori
- Scoring rischio decadenza/revoca
- Digital twin concessione
- Modulo bandi intelligente
- Dashboard duale società/AdSP

## 8. Prossimo sprint consigliato

Obiettivo sprint:

- consolidamento workflow aggiornamento normativa
- integrazione provider AI con logging e policy
- estensione export verso pacchetti direzionali (CSV+PDF combinati)
- test runtime guidati ruolo per ruolo

Deliverable attesi:

- ambiente locale stabile su PostgreSQL
- accesso autenticato con primi ruoli attivi
- operatività base in aggiornamento dato sui moduli core
- percorsi utente distinti per servizio società e vista istituzionale AdSP
