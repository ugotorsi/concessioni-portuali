# Data Retention Policy Draft

## Stato documento
Bozza policy conservazione dati per allineamento preliminare privacy/compliance.
Termini definitivi da validare con ente, massimario, obblighi normativi e regolamenti interni.

## 1. Principi guida
- Minimizzazione: raccogliere e mantenere solo dati necessari.
- Limitazione conservazione: mantenere i dati per il tempo strettamente necessario.
- Integrita e riservatezza: proteggere dati durante ciclo di vita.
- Accountability: responsabilità formale in capo al titolare/ente.

## 2. Distinzione ambienti
- Demo: usare dataset controllato, no persistenza non necessaria, reset periodico.
- Produzione: retention formalizzata per categoria dati, con policy approvate e auditabili.

## 3. Proposta retention preliminare (da confermare)
| Categoria | Esempi dati | Retention indicativa | Note |
| --- | --- | --- | --- |
| Utenti e account | email, ruolo, stato attivo, log accesso | da definire in base a obblighi legali e policy ente | disattivazione account e minimizzazione storici |
| Concessioni | titolo, stato, durata, riferimenti | da definire in base a massimario e obblighi amministrativi | possibile conservazione estesa per fascicolo |
| Criticita | tipologia, gravita, art.47, note istruttorie | da definire con ente e rischio contenzioso | valutare anonimizzazione post-chiusura |
| Procedimenti | fasi, termini, esiti istruttori | da definire in base a normativa procedimentale | allineare a fascicolo e provvedimenti |
| Pagamenti | importi, scadenze, morosita | da definire in base a obblighi contabili/fiscali | coordinare con sistemi contabili ufficiali |
| Sopralluoghi | esiti, verifiche, note tecniche | da definire in base a obblighi tecnici e contenzioso | minimizzare allegati non necessari |
| Report | contenuto, validazione, metadati | da definire in base a finalità istruttoria | controllo versioni e diffusione |
| Audit log | attore, azione, timestamp, hash chain | da definire con requisiti sicurezza/compliance | append-only logico, non WORM nativo |
| PDF generati/scaricati | report PDF e metadata download | da definire con policy ente e rischio divulgazione | policy specifica per download/share |

## 4. Cancellazione e anonimizzazione
- Definire processi separati per cancellazione logica, fisica e anonimizzazione.
- Applicare approccio risk-based: se obblighi di legge richiedono conservazione, limitare accesso invece di cancellare.
- Tracciare le operazioni di purge/anonimizzazione su registro tecnico/audit.

## 5. Conservazione legale/amministrativa
- Le scelte finali dipendono da:
  - massimario di selezione/scarto documentale;
  - obblighi legali e regolamentari applicabili;
  - policy interne dell ente concedente;
  - eventuali prescrizioni di autorità di controllo.

## 6. Ruoli e responsabilità
- Titolare: definisce tempi e basi giuridiche di retention.
- Responsabile trattamento: implementa controlli tecnici concordati.
- DPO/RPD: supervisiona coerenza privacy e valutazione rischi.
- Team tecnico: attua automatismi di retention, logging e verifica periodica.

## 7. Azioni prioritarie
- Mappatura completa campi/dataset con owner.
- Definizione retention per categoria con approvazione formale.
- Introduzione job periodici di purge/archiviazione controllata.
- Evidenza audit su esecuzione policy.

