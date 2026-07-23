# DPIA Draft

## Stato documento
Bozza DPIA preliminare non approvata.
Da validare con DPO/RPD, titolare del trattamento e governance ente prima di ogni uso produttivo.

## 1. Descrizione del trattamento
Piattaforma per gestione e monitoraggio concessioni portuali/demaniali con funzioni di:
- anagrafica concessioni e concessionari;
- monitoraggio obblighi, scadenze, pagamenti, criticità;
- supporto procedimentale e checklist contraddittorio;
- reportistica istruttoria (inclusi PDF server-side);
- audit e tracciamento eventi sicurezza.

## 2. Natura, ambito, contesto e finalità
- Natura: trattamento di dati amministrativi e potenziali dati personali di operatori/referenti.
- Ambito: ambiente applicativo web per uso interno e consultivo istituzionale.
- Contesto: demo avanzata verso scenario istituzionale, non ancora deployment compliance-ready completo.
- Finalità: supporto istruttorio, monitoraggio rischio concessorio, trasparenza operativa e sicurezza.

## 3. Necessita e proporzionalita
- Il trattamento e necessario per gestire processi concessori e istruttori complessi.
- Sono presenti controlli iniziali di accesso e segregazione ruoli.
- Va rafforzata la minimizzazione documentale/allegati in funzione delle finalità specifiche.
- Va formalizzata base giuridica per ciascun flusso operativo con owner organizzativo.

## 4. Rischi per diritti e liberta degli interessati
- Accesso non autorizzato a dati procedimentali/amministrativi.
- Profilazione impropria o percezione di valutazione automatizzata.
- Esposizione indebita di dati procedimentali tramite report/export.
- Alterazione o manipolazione audit log.
- Conservazione eccessiva non giustificata.
- Data breach con impatto su riservatezza/integrità/disponibilità.
- Esportazione PDF non controllata o non coerente con ruolo.
- Errori istruttori se il sistema viene interpretato come decisore.

## 5. Misure già presenti (baseline rilevata)
- NextAuth per autenticazione applicativa.
- RBAC con segregazione VIEWER_ADSP.
- Middleware route protection.
- Security headers baseline.
- Rate limiting baseline su endpoint selezionati.
- Audit trail con hash chain tamper-evident applicativa.
- Test automatici unit/e2e su controlli principali.
- Distinzione esplicita tra supporto istruttorio e decisione amministrativa.
- Disclaimer in report/PDF su non sostituzione dell autorità competente.

## 6. Misure da implementare prima della produzione
- DPIA formale approvata e governance privacy formalizzata.
- Nomine responsabili/sub-responsabili e DPA fornitori.
- Policy retention effettiva con meccanismi di purge/anonimizzazione.
- Backup cifrati, restore testato, policy RPO/RTO.
- Cifratura at rest e gestione chiavi.
- Procedura data breach (rilevazione, escalation, notifica, registro incidenti).
- Registro accessi avanzato e monitoraggio continuo.
- Integrazione logging infrastrutturale/SIEM e, dove richiesto, WORM.
- Hardening produzione (MFA, session security, CSP/HSTS rigorose).
- Privacy notice complete e processo diritti interessati.
- Minimizzazione allegati/documenti e controlli di export.

## 7. Valutazione rischio residuo (preliminare)
- Stato attuale: medio-alto per contesto produttivo.
- Dopo misure aggiuntive: potenzialmente medio, da rivalutare con evidenze tecniche e organizzative.
- Accettazione rischio: non determinata in questa bozza.

## 8. Decisione e governance
- Questa DPIA e un draft non approvato.
- Non costituisce decisione formale del titolare.
- Necessaria revisione con DPO/RPD, responsabili funzione e consulenza legale specialistica.


