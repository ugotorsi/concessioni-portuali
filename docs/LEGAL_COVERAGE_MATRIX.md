# Matrice di copertura giuridico-funzionale

## 1. Obiettivo del documento
Questa matrice collega norme, obblighi, procedimenti, dati e funzionalita applicative della piattaforma Concessioni Portuali, con finalita di valutazione giuridico-amministrativa e di pianificazione evolutiva.

Il documento distingue esplicitamente tra:
- copertura gia implementata;
- copertura parziale;
- gap;
- sviluppi consigliati.

La base di analisi e costituita da:
- modello dati reale in [prisma/schema.prisma](prisma/schema.prisma);
- valutazione progettuale in [docs/PROJECT_EVALUATION.md](docs/PROJECT_EVALUATION.md).

## 2. Entità principali del modello dati
### User
- Funzione giuridico-amministrativa: rappresenta il soggetto operatore interno/abilitato al sistema, base minima di accountability.
- Dati rilevanti: nome, email, ruolo, attivo, createdAt/updatedAt.
- Collegamenti: relazione con ActivityLog.
- Livello maturita attuale: Medio.
Nota: utile per MVP, ma manca piena identita legale/organizzativa (profilazione ente, deleghe, unita organizzativa, autenticazione reale).

### Concessionario
- Funzione giuridico-amministrativa: anagrafica soggetto concessionario (persona giuridica) titolare del rapporto.
- Dati rilevanti: denominazione, codiceFiscale, partitaIva, sedeLegale, PEC, legaleRappresentante.
- Collegamenti: 1:N verso Concessione.
- Livello maturita attuale: Medio-Alto.

### Concessione
- Funzione giuridico-amministrativa: nucleo del titolo concessorio e del fascicolo logico operativo.
- Dati rilevanti: numeroAtto, dataRilascio, dataScadenza, normaRiferimento, stato, canoneAnnuo, ubicazione, descrizioneBene.
- Collegamenti: verso ObbligoConcessorio, Scadenza, Criticita, Procedimento, Sopralluogo, Pagamento, Documento, Report, NormaImpatto, ActivityLog.
- Livello maturita attuale: Alto (MVP).

### ObbligoConcessorio
- Funzione giuridico-amministrativa: presidio degli obblighi derivanti dal titolo e dalle prescrizioni.
- Dati rilevanti: tipologia, descrizione, frequenza, dataProssimaVerifica, stato.
- Collegamenti: N:1 verso Concessione.
- Livello maturita attuale: Medio-Alto.

### Scadenza
- Funzione giuridico-amministrativa: controllo termini (concessione, canoni, garanzie, adempimenti, termini procedimentali).
- Dati rilevanti: tipologia, dataScadenza, preavvisoGiorni, stato.
- Collegamenti: N:1 verso Concessione.
- Livello maturita attuale: Alto (MVP).

### Criticita
- Funzione giuridico-amministrativa: registrazione anomalie tecnico-giuridico-economiche e rischio.
- Dati rilevanti: tipologia, gravita, fonte, descrizione, riferimentoNormativo, stato, dataRilevazione, rilevanzaArt47, letteraArt47, rischioDecadenza, motivazioneArt47.
- Collegamenti: N:1 verso Concessione, 1:N verso Procedimento, 1:N verso NormaImpatto.
- Livello maturita attuale: Alto (MVP).

### Procedimento
- Funzione giuridico-amministrativa: rappresentazione dell iter istruttorio-amministrativo (diffida, contestazione, recupero canoni, avvio decadenza/revoca).
- Dati rilevanti: tipologia, stato, dataAvvio, dataScadenzaContraddittorio, dataProvvedimentoFinale, riferimentoNormativo, checklist contraddittorio (avvio/memorie/audizione/contestazione/valutazione/proposta esito).
- Collegamenti: N:1 verso Concessione, opzionale N:1 verso Criticita, 1:N verso NormaImpatto.
- Livello maturita attuale: Alto (MVP) con checklist istruttoria; workflow formale completo ancora in evoluzione.

### Sopralluogo
- Funzione giuridico-amministrativa: evidenza tecnica sullo stato dei luoghi e conformita.
- Dati rilevanti: data, operatori, esito, conformitaPlanimetrica, sicurezza, occupazione, interferenze.
- Collegamenti: N:1 verso Concessione.
- Livello maturita attuale: Alto (MVP).

### Pagamento
- Funzione giuridico-amministrativa: monitoraggio canoni, morosita, residui e stato versamenti.
- Dati rilevanti: annoRiferimento, importoDovuto, importoVersato, dataScadenza, stato, interessiMora.
- Collegamenti: N:1 verso Concessione.
- Livello maturita attuale: Alto (MVP).

### Documento
- Funzione giuridico-amministrativa: tracciamento documenti collegati alla concessione/fascicolo.
- Dati rilevanti: nome, tipologia, url, dataDocumento, descrizione.
- Collegamenti: N:1 verso Concessione.
- Livello maturita attuale: Medio (struttura presente, gestione documentale legale non completa).

### Report
- Funzione giuridico-amministrativa: output istruttorio e reportistica operativa/direzionale.
- Dati rilevanti: tipologia, titolo, contenuto, formato, validato.
- Collegamenti: opzionale N:1 verso Concessione, 1:N verso NormaImpatto.
- Livello maturita attuale: Alto (MVP), con validazione e PDF.

### NormaFonte
- Funzione giuridico-amministrativa: catalogo fonti normative.
- Dati rilevanti: codice, titolo, enteEmittente, ambito.
- Collegamenti: 1:N verso NormaVersione, 1:N verso NormaImpatto.
- Livello maturita attuale: Medio-Alto.

### NormaVersione
- Funzione giuridico-amministrativa: presidio evolutivo delle versioni normative.
- Dati rilevanti: versione, stato, dataEntrataVigore, dataFineVigore, urlTesto.
- Collegamenti: N:1 verso NormaFonte, 1:N verso NormaImpatto.
- Livello maturita attuale: Medio-Alto.

### NormaImpatto
- Funzione giuridico-amministrativa: ponte tra norma e caso operativo (criticita/procedimento/report/concessione).
- Dati rilevanti: modulo, severita, descrizione, azioneRichiesta.
- Collegamenti: verso NormaFonte, NormaVersione, Concessione, Criticita, Procedimento, Report.
- Livello maturita attuale: Alto concettualmente, Medio operativamente.

### ActivityLog
- Funzione giuridico-amministrativa: tracciabilita minima delle azioni applicative.
- Dati rilevanti: azione, entita, entitaId, descrizione, timestamp.
- Collegamenti: opzionale verso User e Concessione.
- Livello maturita attuale: Medio-Basso per uso forense.

## 3. Relazioni principali
Modello logico centrato sulla concessione:

Concessionario
  -> Concessione
      -> Obblighi
      -> Scadenze
      -> Criticita
      -> Procedimenti
      -> Sopralluoghi
      -> Pagamenti
      -> Documenti
      -> Report
      -> Normativa
      -> ActivityLog

Perche la struttura e corretta per vista 360 gradi:
- concentra in un unico asse informativo il titolo concessorio e i suoi effetti operativi;
- consente lettura trasversale tecnica, economica, giuridica e documentale;
- permette costruzione di percorsi istruttori end-to-end (evento -> criticita -> procedimento -> report);
- abilita trasparenza consultiva verso AdSP su report validati e indicatori principali;
- rende possibile una futura evoluzione in fascicolo digitale strutturato.

## 4. Campi giuridicamente sensibili
| Entita | Campo | Rilevanza giuridica | Rischio se mancante/errato | Miglioramento consigliato |
|---|---|---|---|---|
| Concessione | numeroAtto | Identifica formalmente il titolo | Ambiguita sul rapporto concessorio | Vincoli aggiuntivi su formato e unicita per ente |
| Concessione | dataRilascio | Decorrenza rapporto | Errata cronologia istruttoria | Regole di coerenza con atti/versioni |
| Concessione | dataScadenza | Termine efficacia titolo | Mancata gestione rinnovi/decadenza | Alert automatici e workflow rinnovo |
| Concessione | stato | Situazione giuridica concessione | Decisioni operative non coerenti | State machine vincolata |
| Concessione | canoneAnnuo | Base economica obblighi | Errori su morosita e recuperi | Storicizzazione importi |
| Concessione | ubicazione | Individuazione bene/area | Contenzioso su perimetro occupato | Integrazione GIS e riferimenti catastali/nautici |
| Concessione/Concessionario | concessionarioId e dati soggetto | Identifica titolare e responsabilita | Contestazioni soggettive | Gestione storico soggetti e subentri |
| Concessionario | pec | Canale comunicazioni ufficiali | Invalidita comunicazioni digitali | Entita ComunicazionePEC |
| Concessionario | codiceFiscale/partitaIva | Identita fiscale | Errori imputazione obblighi | Validazioni formali e controlli esterni |
| ObbligoConcessorio | tipologia/stato/dataProssimaVerifica | Presidio adempimenti | Inadempimenti non rilevati | SLA e reminder automatici |
| Scadenza | tipologia/dataScadenza/stato | Governo termini | Decadenze/ritardi non gestiti | Motore notifiche e escalation |
| Pagamento | importoDovuto/importoVersato | Verifica morosita e canoni | Perdita credito/ritardi recupero | Riconciliazione contabile e aging |
| Pagamento | stato | Classificazione rischio economico | Azioni non tempestive | Regole automatiche di classificazione |
| Criticita | tipologia/gravita | Qualificazione rischio | Sottostima rischio giuridico-tecnico | Tassonomia estesa e scoring |
| Criticita | riferimentoNormativo | Fondamento giuridico | Debolezza istruttoria | Obbligatorieta condizionata per tipologie critiche |
| Procedimento | dataAvvio | Tracciamento iter | Incertezza su termini procedimentali | Audit step-by-step |
| Procedimento | dataScadenzaContraddittorio | Garanzia contraddittorio | Rischio violazione garanzie partecipative | Alert e blocchi procedurali |
| Procedimento | dataProvvedimentoFinale | Chiusura iter | Fascicolo incompleto | Entita Provvedimento con esiti/motivazione |
| Sopralluogo | esito | Evidenza tecnica ufficiale | Debolezza probatoria | Allegati firmati e georeferenziati |
| Documento | nome/tipologia/url/dataDocumento | Base documentale | Inidoneita probatoria | Versionamento e conservazione |
| Report | validato | Controllo qualita/affidabilita | Uso improprio output non validati | Workflow revisione multipla |
| ActivityLog | azione/entita/createdAt | Tracciabilita minima | Accountability insufficiente | AuditEvent forense immutabile |

## 5. Matrice fonte/requisito/copertura/gap
| Fonte / articolo | Requisito giuridico-amministrativo | Entita/funzionalita che lo copre oggi | Livello copertura | Gap | Priorita intervento |
|---|---|---|---|---|---|
| art. 36 Codice della Navigazione | Titolo concessorio, oggetto, durata, presupposti | Concessione (numeroAtto, date, tipologia, stato), Concessionario | Alta | Versionamento del titolo e atti modificativi | Alta |
| art. 47 Codice della Navigazione | Decadenza/inadempimento e presidio fattispecie | Criticita con mapping strutturato (`rilevanzaArt47`, `letteraArt47`, `rischioDecadenza`, motivazione), Procedimento (AVVIO_DECADENZA), Pagamento | Medio-Alta | Workflow formale con prove/notifiche e step obbligati | Alta |
| art. 54 Codice della Navigazione | Repressione occupazioni abusive/difformi | Criticita (OCCUPAZIONE_DIFFORME), Sopralluogo, Procedimento (ORDINE_RIPRISTINO) | Media | Evidenza probatoria allegati e catena decisionale | Alta |
| legge 241/1990 | Procedimento, motivazione, partecipazione, termini | Procedimento con checklist contraddittorio (avvio, memorie, audizione, contestazione, controdeduzioni, motivazione), Scadenza, Report | Medio-Alta | Responsabile procedimento, protocollazione, comunicazioni formali e catena atti | Altissima |
| Obblighi concessori | Monitoraggio adempimenti periodici | ObbligoConcessorio + Scadenza | Alta | Automatismi reminder/escalation | Media |
| Canoni e morosita | Presidio economico e recupero | Pagamento, Criticita economiche, Procedimento recupero | Alta | Riconciliazione contabile esterna e interessi avanzati | Alta |
| Sopralluoghi/verifiche tecniche | Evidenza tecnica su stato luoghi | Sopralluogo + collegamenti a Criticita/Procedimenti | Alta | Allegati tecnici strutturati e georeferenziazione | Alta |
| Diffida/contestazione | Avvio formale azioni amministrative | Procedimento (DIFFIDA/CONTESTAZIONE) | Media | Template atti, notifiche PEC, protocolli | Alta |
| Decadenza | Tracciamento iter e fondamento | Procedimento AVVIO_DECADENZA + Criticita | Media | Motore decisionale con step obbligati | Altissima |
| Revoca | Tracciamento iter e motivi pubblici | Procedimento AVVIO_REVOCA + Criticita | Media | Formalizzazione motivi, impatti e provvedimento | Alta |
| Contraddittorio | Gestione termini e partecipazione | Procedimento.dataScadenzaContraddittorio, dashboard/alert | Media | Comunicazioni ufficiali tracciate e ricevute | Altissima |
| Trasparenza verso AdSP | Consultazione controllata | Vista AdSP + Report validati | Alta | Canale formale scambio documentale | Media |
| Supporto istruttorio | Sintesi e priorita operative | Dashboard, Report, Normativa, AI assistiva | Alta | Workflow di approvazione strutturato | Alta |
| Tracciabilita | Audit azioni | ActivityLog + action server | Media | Audit forense immutabile con identita reale | Altissima |
| Documentale | Collegamento documenti al caso | Documento per concessione | Media | Protocollazione, versionamento, firma, conservazione | Altissima |
| Normativa/aggiornamento fonti | Versioni e impatti su moduli | NormaFonte/NormaVersione/NormaImpatto | Alta | Ingestion e diff normativi semi-automatici | Media |
| AI assistiva | Supporto non decisorio e warning | Modulo AI, ruoli, disclaimer, prompt templates | Media | Logging prompt/output, validazione e benchmark | Alta |

## 6. Gap prioritari
1. Fascicolo digitale
- Perche importante: unifica cronologia probatoria e amministrativa del caso.
- Rischio se non risolto: dispersione evidenze e debolezza difensiva.
- Entita/funzionalita da introdurre: Fascicolo, FascicoloEvento, collegamenti a tutte le entita core.

2. Protocollazione
- Perche importante: garantisce ufficialita e opponibilita degli atti/comunicazioni.
- Rischio: impossibilita di dimostrare catena formale dei passaggi.
- Entita/funzionalita: Protocollo, numerazione, registro e stato lavorazione.

3. Comunicazioni PEC
- Perche importante: canale ufficiale verso concessionari/enti.
- Rischio: invalidita o contestazione notifiche.
- Entita/funzionalita: ComunicazionePEC con ricevute invio/consegna.

4. Workflow procedimentale formalizzato
- Perche importante: garantisce correttezza iter e rispetto termini.
- Rischio: salti procedurali e contenzioso.
- Entita/funzionalita: WorkflowStep, regole di transizione, checklist obbligatorie.

5. Responsabile del procedimento
- Perche importante: accountability amministrativa.
- Rischio: incertezza su responsabilita e competenze.
- Entita/funzionalita: Assegnazione, UnitaOrganizzativa, ruolo RUP.

6. Versionamento titolo concessorio
- Perche importante: traccia modifiche, proroghe, rinnovi, subentri.
- Rischio: ricostruzione incompleta del titolo vigente.
- Entita/funzionalita: TitoloVersione collegato a Concessione.

7. Audit log forense
- Perche importante: prova robusta di chi ha fatto cosa e quando.
- Rischio: inidoneita probatoria in audit/contenzioso.
- Entita/funzionalita: AuditEvent immutabile, hash/catena eventi, actor reale.

8. Allegati probatori
- Perche importante: supportano rilievi, contestazioni e provvedimenti.
- Rischio: istruttoria debole o contestabile.
- Entita/funzionalita: Allegato, metadati probatori, link a evento/procedimento.

9. Firma/conservazione
- Perche importante: validita legale nel tempo.
- Rischio: non conformita conservazione digitale.
- Entita/funzionalita: AllegatoVersione, esiti firma, conservazione.

10. Notifiche automatiche
- Perche importante: prevenzione ritardi su termini e adempimenti.
- Rischio: scadenze perse e aggravamento rischio decadenza.
- Entita/funzionalita: Notifica con regole, canali e stato recapito.

11. Test automatici
- Perche importante: affidabilita continua su regole giuridiche applicative.
- Rischio: regressioni silenziose in moduli critici.
- Entita/funzionalita: suite test per query/actions/permessi/route.

12. IAM/autenticazione reale
- Perche importante: sicurezza e tracciabilita identita.
- Rischio: accessi impropri e audit insufficiente.
- Entita/funzionalita: integrazione IdP, session management, RBAC/ABAC.

## 7. Entità da aggiungere al modello dati
### Fascicolo
- Scopo: contenitore ufficiale del caso concessorio/procedimentale.
- Relazioni suggerite: Concessione 1:N Fascicolo; Fascicolo 1:N eventi/documenti/provvedimenti.
- Priorita: Altissima.
- Impatto: Molto alto.

### Protocollo
- Scopo: registrazione atti/comunicazioni con numero e data certa.
- Relazioni: Fascicolo, Documento, ComunicazionePEC, Provvedimento.
- Priorita: Altissima.
- Impatto: Molto alto.

### ComunicazionePEC
- Scopo: tracciamento comunicazioni ufficiali e ricevute.
- Relazioni: Concessionario, Fascicolo, Protocollo, Procedimento.
- Priorita: Altissima.
- Impatto: Molto alto.

### Allegato
- Scopo: gestione file probatori/tecnici/istruttori.
- Relazioni: Fascicolo, Sopralluogo, Criticita, Procedimento, Report.
- Priorita: Alta.
- Impatto: Alto.

### AllegatoVersione
- Scopo: storico versioni documento e catena aggiornamenti.
- Relazioni: Allegato 1:N AllegatoVersione.
- Priorita: Alta.
- Impatto: Alto.

### Provvedimento
- Scopo: formalizzare esito amministrativo finale/intermedio.
- Relazioni: Procedimento, Fascicolo, Protocollo, Documento.
- Priorita: Altissima.
- Impatto: Molto alto.

### WorkflowStep
- Scopo: rappresentare fasi obbligatorie e transizioni.
- Relazioni: Procedimento 1:N WorkflowStep, Assegnazione, Notifica.
- Priorita: Altissima.
- Impatto: Molto alto.

### UnitaOrganizzativa
- Scopo: mappare struttura organizzativa e competenze.
- Relazioni: User, Assegnazione, Procedimento.
- Priorita: Alta.
- Impatto: Alto.

### Assegnazione
- Scopo: attribuire responsabilita operative (RUP/istruttore/revisore).
- Relazioni: User, UnitaOrganizzativa, Fascicolo/Procedimento.
- Priorita: Altissima.
- Impatto: Molto alto.

### Notifica
- Scopo: reminder e comunicazioni operative su eventi/termini.
- Relazioni: WorkflowStep, Scadenza, User/Concessionario.
- Priorita: Alta.
- Impatto: Alto.

### AuditEvent
- Scopo: logging forense immutabile con contesto completo.
- Relazioni: tutte le entita principali via riferimento polimorfico.
- Priorita: Altissima.
- Impatto: Molto alto.

### TitoloVersione
- Scopo: storicizzare evoluzione del titolo concessorio.
- Relazioni: Concessione 1:N TitoloVersione.
- Priorita: Alta.
- Impatto: Alto.

### IntegrationEvent
- Scopo: tracciare integrazioni esterne e sincronizzazioni.
- Relazioni: Fascicolo, Protocollo, Notifica, sistemi esterni.
- Priorita: Media-Alta.
- Impatto: Alto.

## 8. Roadmap giuridico-funzionale
### Fase 1 — Consolidamento MVP
- completamento concessionari;
- documenti base;
- notifiche semplici;
- miglioramento ActivityLog;
- test.

Obiettivo: consolidare affidabilita operativa e completare i moduli base mancanti.

### Fase 2 — Fascicolo e workflow
- fascicolo digitale;
- workflow procedimentale;
- protocolli;
- PEC;
- provvedimenti;
- responsabile procedimento.

Obiettivo: passare da monitoraggio operativo a processo amministrativo formalizzato.

### Fase 3 — Compliance e produzione
- IAM reale;
- audit forense;
- conservazione documentale;
- sicurezza;
- GDPR;
- ruoli ente/concessionario.

Obiettivo: readiness concreta per uso reale in contesti sensibili/istituzionali.

### Fase 4 — Legal intelligence e AI
- analisi rischio decadenza;
- bozze atti;
- confronto normativa;
- riepilogo fascicolo;
- logging prompt/output;
- validazione umana obbligatoria.

Obiettivo: differenziazione ad alto valore mantenendo governance legale e responsabilita umana.

## 9. Valutazione finale
Cosa copre bene oggi:
- modello concessione-centrico 360;
- monitoraggio obblighi/scadenze/pagamenti/criticita/procedimenti;
- reportistica operativa, export CSV e PDF;
- normativa con impatti cross-modulo;
- vista consultiva AdSP.

Cosa copre parzialmente:
- tracciabilita giuridicamente robusta;
- gestione documentale a valore legale;
- workflow amministrativo formalizzato;
- governance AI con audit strutturato.

Cosa manca per uso reale:
- IAM enterprise e identita certa;
- protocollazione e PEC;
- fascicolo digitale e provvedimenti;
- conservazione/firma e audit forense.

Perche il progetto e gia valido come MVP:
- copre in modo concreto il cuore operativo del dominio e consente demo istituzionali credibili.

Perche serve hardening per produzione pubblica:
- i requisiti di sicurezza, compliance, accountability e formalizzazione procedimentale sono superiori a quelli di un MVP demo.

| Area | Copertura attuale | Priorità evolutiva |
|---|---|---|
| titolo concessorio | Alta | Alta |
| obblighi | Alta | Media |
| scadenze | Alta | Alta |
| pagamenti | Alta | Alta |
| criticità | Alta | Alta |
| sopralluoghi | Alta | Alta |
| procedimenti | Media-Alta | Altissima |
| report | Alta | Media-Alta |
| normativa | Media-Alta | Alta |
| documentale | Media | Altissima |
| audit | Media | Altissima |
| AI | Media | Alta |
| sicurezza | Bassa-Media | Altissima |
| workflow | Media | Altissima |
| vista AdSP | Alta | Media |
