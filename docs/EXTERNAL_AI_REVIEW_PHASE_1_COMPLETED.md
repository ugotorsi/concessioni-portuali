# External AI Review Phase 1 Completed — Concessioni Portuali

"Documento di audit esterno ricevuto dopo il completamento della Phase 1 Institutional Hardening. Il documento non certifica la conformità del progetto, ma costituisce una valutazione indipendente utile per roadmap e priorità successive."

## 1. Giudizio sintetico
La valutazione esterna ricevuta da Simpliciter.AI conferma che Concessioni Portuali è un MVP verticale credibile, con buona coerenza dominio-architettura e risultati concreti dopo la chiusura della Phase 1 (#1-#8).

Il prodotto è ritenuto adeguato per demo istituzionali guidate e confronto tecnico con stakeholder pubblici/para-pubblici, ma non ancora pronto per messa in produzione a rischio regolatorio accettabile.

Il punto di forza è la catena funzionale integrata tra criticità, art. 47, procedimenti, checklist contraddittorio, report e audit. I principali limiti restano su compliance formale, sicurezza enterprise, conservazione documentale e governance operativa di produzione.

## 2. Rating tabellare
| Dimensione | Rating (1-10) | Osservazioni |
| --- | --- | --- |
| Qualità tecnica | 8.2 | Stack moderno, struttura modulare e baseline test presente |
| Architettura | 8.0 | Buona separazione app/server/lib, modello dati esteso |
| Sicurezza | 6.8 | Migliorata in Phase 1, ma non enterprise-complete |
| Compliance GDPR | 6.1 | Presente solo documentazione draft, manca formalizzazione |
| Coerenza giuridica | 7.6 | Buon allineamento dominio concessorio/procedimentale |
| Qualità UX | 7.2 | Interfaccia funzionale, orientata a uso operativo |
| Maturità prodotto | 7.0 | Institutional demo-ready, non production-ready |
| Vendibilità PA/AdSP | 7.3 | Buon potenziale, dipende da hardening successivo |
| Manutenibilità | 7.8 | Codebase leggibile con separazione responsabilità |
| Readiness demo | 8.0 | Presentabile in tavoli tecnici con perimetro chiaro |
| Readiness production | 5.8 | Gap bloccanti su compliance, security e operations |

## 3. Top 10 problemi
1. Assenza di DPIA formalmente approvata con governance ente/DPO.
2. Assenza di privacy notice complete e processi diritti interessati operativi.
3. Mancanza di MFA e session hardening avanzato per ruoli critici.
4. Rate limiting non distribuito e controlli anti-abuso non cluster-ready.
5. Audit tamper-evident applicativo ma non conservazione forense/WORM.
6. Assenza integrazione protocollo/PEC e catena documentale amministrativa completa.
7. Assenza firma digitale/conservazione a norma per output documentali.
8. Logging infrastrutturale e incident response non formalizzati.
9. Assenza pipeline CI/CD security-complete (SAST, dependency scanning, policy gates).
10. Modulo GIS e gestione allegati avanzata non ancora maturi.

## 4. Top 10 miglioramenti
1. Formalizzare DPIA, nomine privacy e privacy notice con ente/DPO.
2. Introdurre MFA e policy password/session enterprise.
3. Migrare rate limiting a backend distribuito (Redis/Upstash o equivalente).
4. Integrare SIEM/alerting e policy di log retention verificabile.
5. Definire backup cifrati, restore testato e obiettivi RPO/RTO.
6. Attivare procedura data breach con runbook e responsabilità chiare.
7. Introdurre protocollo/PEC e tracciamento comunicazioni ufficiali.
8. Rafforzare governance documentale (versioning, firma, conservazione).
9. Ampliare test integration/e2e su scenari procedimentali edge-case.
10. Preparare kit demo istituzionale con scenari replicabili e KPI.

## 5. Roadmap 30/60/90 giorni
### 30 giorni
- Chiudere gap privacy minimi: DPIA working version, privacy notice draft, registro trattamenti allineato a owner.
- Rafforzare security baseline: MFA per admin/ruoli sensibili, session policy più rigida.
- Stabilizzare osservabilità: logging centralizzato, alert minimi su eventi critici.

### 60 giorni
- Integrare processi documentali/procedimentali: protocollazione minima e tracciamento comunicazioni.
- Definire retention policy applicata con primi automatismi purge/archiviazione.
- Estendere suite test con scenari multi-ruolo, regressioni PDF/export e failure-path.

### 90 giorni
- Hardening pre-produzione: backup cifrati, restore test, vulnerability management periodico.
- Decisione architettura deployment reale (cloud/on-prem) con requisiti compliance.
- Preparazione dossier go/no-go production basato su evidenze tecniche e legali.

## 6. Rischi bloccanti demo
- Scope creep: promesse oltre il perimetro “supporto istruttorio”.
- Ambiguità comunicativa su AI e responsabilità decisionale finale.
- Mancanza storytelling strutturato per casi istituzionali ripetibili.
- Rischio percezione “non enterprise” se non evidenziati limiti e roadmap.

## 7. Rischi bloccanti produzione
- Compliance privacy non formalizzata (DPIA/notice/diritti interessati).
- Sicurezza non completa (MFA, hardening infrastrutturale, SIEM, incident response).
- Assenza catena documentale amministrativa a valore legale completo.
- Mancanza di controlli operativi continuativi (CI/CD security e vulnerability process).

## 8. Suggerimenti commerciali
- Posizionare il prodotto come piattaforma di Regulatory Intelligence per concessioni portuali.
- Vendere inizialmente valore su riduzione tempi istruttori e aumento tracciabilità.
- Usare demo verticali guidate (morosità e occupazione difforme) come leva primaria.
- Offrire pacchetto “Institutional Hardening” come step commerciale separato.

## 9. Suggerimenti tecnici
- Consolidare policy sicurezza enterprise (MFA, session controls, secrets management).
- Aumentare copertura test con focus sui flussi ad alto rischio regolatorio.
- Introdurre logging/monitoring strutturato con alert su anomalie operative.
- Preparare checklist tecnica pre-produzione con evidenze verificabili.

## 10. Suggerimenti giuridico/compliance
- Validare formalmente basi giuridiche per categoria trattamento con titolare.
- Completare DPIA e registro trattamenti con owner e responsabilità.
- Formalizzare policy retention/cancellazione/anonimizzazione con massimario ente.
- Definire processi per richieste diritti interessati e gestione data breach.

## 11. Funzionalità da rimuovere o rinviare
- Funzionalità AI non essenziali non supportate da governance/controlli solidi.
- Estensioni UX non critiche che non aumentano evidenza istruttoria/compliance.
- Feature avanzate non core (moduli sperimentali) fino al completamento gap P0.

## 12. Funzionalità da aggiungere subito
- MFA e session hardening su ruoli ad alto privilegio.
- Tracciamento avanzato accessi e alerting baseline.
- Workflow minimo privacy operativo (intake richieste diritti, breach playbook).
- Kit demo istituzionale standardizzato con script e KPI.

## 13. Decisione finale
- Go demo: Sì, con perimetro dichiarato e senza claim di compliance/production readiness.
- No-go production: Sì, finché non sono chiusi i gap bloccanti su security, compliance e governance documentale.

## 14. Stato presa in carico raccomandazioni
- Raccomandazione CI/CD presa in carico come prima issue Phase 2.
- Issue di riferimento: #11 Add CI/CD baseline with GitHub Actions.
- Baseline workflow introdotta in `.github/workflows/ci.yml` (senza deploy automatico in questa fase).
- Follow-up dominio art. 47 preso in carico con Issue #12: estensione campi regolarizzazione su Criticita (stato/esito/verifica) e nota esplicita di assenza automatismi su decadenza.
- Raffinamento procedimentale preso in carico con Issue #13: distinzione d ufficio/istanza di parte e tracciamento istruttorio art. 10-bis senza automatismi decisori.
- Mitigazione rischio P0/P1 rate limit presa in carico con Issue #14: adapter Redis-ready (Upstash) con fallback memory limitato a dev/demo/CI.
- Baseline IAM hardening presa in carico con Issue #15: lockout temporaneo su tentativi falliti, messaggistica login generica anti-enumeration e predisposizione campi MFA/password policy.
- Raffinamento PDF istituzionale preso in carico con Issue #16: frontespizio, struttura sezioni, header/footer ricorrenti, box riepilogativi e disclaimer istruttori rafforzati su art. 47/regolarizzazione/contraddittorio/art. 10-bis.
- Kit demo istituzionale preso in carico con Issue #17: nuova pagina scenari guidati con seed realistico su morosita art. 47, occupazione difforme, regolarizzazione pre-provvedimentale, contraddittorio incompleto e tracciamento art. 10-bis.
- Baseline fascicolo documentale preso in carico con Issue #18: upload/download documenti, storage locale configurabile, collegamento multi-entita, audit eventi documentali e integrazione nei report PDF (senza pretesa di conservazione legale in questa fase).
- Hardening tecnico Issue #18 completato: warning Turbopack filesystem tracing sul modulo document storage rimosso mantenendo storage locale demo server-side.
- Raccomandazione modulo GIS presa in carico con Issue #10: baseline mappa demo territoriale `/mappa` in modalita GIS-ready placeholder (nessuna API key esterna), marker su concessioni/criticita/sopralluoghi, fallback coordinate e collegamenti rapidi a schede dettaglio.
- Metadati territoriali demo introdotti: area descrizione, zona portuale, riferimento catastale e localizzazione descrittiva per supportare storytelling istituzionale senza dati sensibili reali.
- Raccomandazione kit demo istituzionale avanzato presa in carico con Issue #20: nuova sezione `/demo-guidata` con storytelling a slide AI-led, speaker notes, posizionamento non gestionale, narrativa su automazione del procedimento (non della decisione), link diretti a scenari/documenti/mappa/report e roadmap pilot 30/60/90.
- Rafforzamento legal assistant e business plan della demo guidata preso in carico con Issue #24: blocco narrativo dedicato a predisposizione assistita atti/comunicazioni/diffide/bandi, controllo coerenza dell atto e piano economico su orizzonti breve-medio-lungo con scenari prudente/intermedio/esteso e perimetro AdSP/porti espresso come stima prudenziale da aggiornare.
- Breakdown investimento economico demo preso in carico con Issue #25: dettaglio fasi pilot/produzione/scalabilità con range indicativi, voci costo, modello ricavi, scenari break-even e disclaimer espliciti su natura non vincolante dei valori fino a validazione pilot.
