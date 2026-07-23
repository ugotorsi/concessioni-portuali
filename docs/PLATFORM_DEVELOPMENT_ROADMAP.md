# Platform Development Roadmap

Roadmap per passaggio disciplinato da investor demo a piattaforma reale.

Principio guida:
- prima affidabilità operativa e compliance minima;
- poi automazione documentale e valore AI;
- poi scalabilita multi-ente.

Principio dominio (Issue #32 / #34):
- core comune di monitoraggio concessorio demaniale/pubblico;
- verticale A portuale/AdSP come perimetro attivo;
- verticale B marittima turistico-ricreativa come estensione progressiva.

Quadro giuridico Simpliciter da recepire in roadmap:
- art. 18 L. 84/1994: verticale speciale portuale, non base universale;
- art. 36 cod. nav.: base generale concessoria demaniale marittima;
- art. 37 cod. nav.: presidio procedura comparativa/istanze concorrenti;
- art. 47 cod. nav.: regola trasversale di decadenza;
- d.l. 400/1993: fonte centrale verticale turistico-ricreativa;
- art. 12 direttiva 2006/123/CE: selezione trasparente/imparziale e no proroghe automatiche generalizzate.

## Track di generalizzazione dominio (32A / 32B / 32C)
32A - Documentation/domain repositioning:
- aggiornamento posizionamento documentale da "port-only" a "core + verticali";
- integrazione cautele Simpliciter e fonti normative/giurisprudenziali;
- nessun impatto runtime, schema o UI.

32B - Data model preparation (successiva):
- definizione concettuale attributi verticali (es. concessionVertical/legalFramework);
- valutazione campi aggiuntivi: concessionObjectType, awardingProcedureType, publicUseConstraints, removableWorksProfile, seasonalityProfile, feeRegime, comparativeProcedureStatus, thirdPartyManagementStatus.

32C - UI/demo verticals (dopo 32B):
- scenario Comune costiero realistico (stabilimento balneare, battigia, comparativa, morosità, rischio art.47);
- reportistica verticale dedicata;
- mantenimento presidi anti-overclaim e ruolo umano decisionale.

## Sprint 1 - Fascicolo documentale cloud persistente
Obiettivo:
- eliminare il principale gap tecnico per pilot credibile.

Scope:
- object storage;
- upload/download persistente;
- hash;
- audit;
- metadati;
- compatibilita locale/cloud.

Deliverable:
- storage provider production-grade con bucket dedicato;
- astrazione storage unificata locale/cloud;
- policy dimensione/tipo file e checksum hash obbligatorio;
- audit eventi upload/download/update/archive;
- documento tecnico di fallback e disaster recovery minimo.

Exit criteria:
- file persistenti dopo redeploy;
- nessuna regressione su modulo documenti;
- tracciabilità completa del ciclo base documento.

Stato implementazione:
- completato nel perimetro demo avanzata con adapter storage astratto (`local`/`s3`), metadati obbligatori e audit upload/download.
- opzione consigliata S3-compatible: Cloudflare R2.

## Sprint 2 - Libreria atti e legal assistant operativo
Obiettivo:
- passare da storytelling legal a supporto operativo concreto.

Scope:
- modelli atti;
- diffide;
- comunicazioni avvio;
- art. 10-bis;
- contestazioni;
- schemi provvedimento;
- export PDF/DOCX.

Deliverable:
- libreria template atti con variabili standard;
- compilazione assistita da dati fascicolo;
- validazioni minime di completezza atti;
- export strutturato e versionato.

Exit criteria:
- produzione di bozze coerenti su casi demo reali;
- riduzione tempo istruttoria misurabile.

## Sprint 3 - Generazione bozze e controllo coerenza
Obiettivo:
- aumentare qualita e uniformita del fascicolo.

Scope:
- dati precompilati;
- collegamento concessione/criticità/procedimento;
- checklist;
- controllo fascicolo;
- audit generazione.

Deliverable:
- motore prefill multi-modulo;
- controlli coerenza documentale/procedimentale;
- segnali warning bloccanti/non bloccanti;
- audit di ogni generazione e revisione bozza.

Exit criteria:
- riduzione errori formali nelle bozze;
- evidenza di tracciabilità decisionale umana mantenuta.

## Sprint 4 - Normativa e fonti
Obiettivo:
- trasformare normativa da catalogo a supporto dinamico.

Scope:
- archivio norme;
- prassi;
- giurisprudenza;
- versionamento;
- collegamento a moduli.

Deliverable:
- repository fonti versionato con metadati;
- mapping impatti per modulo;
- cronologia aggiornamenti e motivazioni;
- warning su riferimenti obsoleti.

Exit criteria:
- consultazione fonti contestuale nei flussi core;
- riduzione uso riferimenti superati.

## Sprint 5 - Import dati ente e onboarding
Obiettivo:
- ridurre barriera adozione su primo ente pilot.

Scope:
- import CSV/XLSX;
- mapping campi;
- validazione dati;
- onboarding concessioni;
- pulizia dati.

Deliverable:
- wizard import guidato;
- libreria mapping configurabile;
- report errori e data quality;
- onboarding dataset iniziale con tracking stato.

Exit criteria:
- caricamento dataset ente senza interventi manuali estesi;
- tasso errore import sotto soglia definita.

## Sprint 6 - Dashboard KPI e valore economico
Obiettivo:
- rendere evidente valore economico e operativo.

Scope:
- morosità;
- scadenze;
- criticità;
- recupero potenziale;
- rischio contenzioso;
- efficienza uffici.

Deliverable:
- KPI direzionali con definizioni condivise;
- viste ruolo-specifiche;
- trend e alert economico-operativi;
- esportazione report direzionali.

Exit criteria:
- KPI leggibili da vertice ente e responsabili ufficio;
- evidenza del ritorno potenziale sul pilot.

## Sprint 7 - Pilot readiness
Obiettivo:
- chiudere gap minimi per avvio pilot ente con rischi controllati.

Scope:
- backup;
- monitoring;
- ruoli avanzati;
- privacy;
- DPIA;
- manuali;
- training;
- ambiente staging/demo/pilot separati.

Deliverable:
- piano backup/restore testato;
- monitoraggio baseline e alerting;
- policy ruoli e hardening accessi;
- set documentale privacy/compliance operativo;
- runbook e materiale training.

Exit criteria:
- checklist pilot readiness completata;
- decisione go/no-go supportata da evidenze.

## Milestone 30/60/90 giorni
- 30 giorni: Sprint 1 completato e avvio Sprint 2.
- 60 giorni: Sprint 2-3 completati, Sprint 4 avviato.
- 90 giorni: Sprint 4-5 completati, readiness Sprint 6-7 pianificata con costi/owner.

## Nota strategica
Questa roadmap evita di trattare la demo come prodotto finito.

Sequenza consigliata:
1. affidabilità documentale;
2. operativita legale assistita;
3. coerenza fascicolo;
4. evoluzione normativa;
5. onboarding dati;
6. KPI economici;
7. readiness pilot.

