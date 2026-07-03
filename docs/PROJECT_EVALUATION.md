# Valutazione complessiva progetto Concessioni Portuali

## 1. Executive summary
Concessioni Portuali e un MVP avanzato di piattaforma verticale per monitoraggio tecnico-amministrativo delle concessioni demaniali portuali, con forte orientamento al supporto istruttorio e alla governance del rischio.

Il progetto e tecnicamente ripristinato, coerente e dimostrabile end-to-end in ambiente locale Docker + PostgreSQL, con build e check verdi, seed dati realistico e flussi applicativi funzionanti su moduli core.

Il valore principale e la modellazione di dominio gia ampia (concessioni, criticita, pagamenti, scadenze, procedimenti, sopralluoghi, report, normativa, impatti normativi) e la separazione consultiva per profilo AdSP.

Il limite principale e che il sistema e ancora in modalita demo governance: autenticazione semplificata a cookie ruolo, assenza di IAM enterprise, assenza middleware centralizzato e assenza di presidio compliance completo per uso reale in contesti pubblici.

Valutazione sintetica: ottima base MVP verticale, forte valore dimostrativo e buon potenziale SaaS/enterprise; non ancora pronto per produzione istituzionale senza un ciclo di hardening sicurezza, workflow formale e compliance.

## 2. Stato attuale del progetto
### 2.1 Implementato e verificato
- Stack Next.js App Router + TypeScript + Prisma + PostgreSQL Docker.
- Build e check tecnici verdi.
- Data model ampio e coerente col dominio.
- Seed demo ricco e multi-modulo.
- Moduli operativi con query dedicate e dashboard KPI.
- Export CSV server-side su 5 aree.
- PDF report server-side con controllo ruolo/validazione.
- Distinzione ruoli back-office vs VIEWER_ADSP.
- Modulo normativa con fonti, versioni e impatti.
- Modulo AI assistivo con disclaimer e policy di non-decisione.

### 2.2 Predisposto
- Struttura per audit log e tracciabilita azioni (ActivityLog) gia presente.
- Percorso demo guidato per presentazioni istituzionali.
- Modulo concessionari predisposto ma non operativo (placeholder).
- Cartelle validations e types predisposte.

### 2.3 Mancante
- Autenticazione reale (identity provider, utenti reali, password/MFA/SSO).
- Autorizzazione enterprise centralizzata e policy engine.
- Middleware centralizzato route protection.
- Test automatici (unit, integration, e2e).
- Pipeline CI/CD e quality gate.
- Gestione documentale reale (upload storage, versionamento, firma, protocolli).
- Audit trail forense completo (who/when/why con userId reale).
- Osservabilita strutturata (logging, metrics, tracing).

### 2.4 Strategico da sviluppare
- Workflow amministrativo formalizzato con stati, SLA e responsabilita.
- Fascicolo digitale e orchestrazione procedimentale completa.
- Integrazioni con ecosistemi pubblici e sistemi terzi.
- AI governance avanzata (guardrail, audit prompt/output, human approval robusta).

## 3. Funzionalità implementate
### 3.1 Ricognizione tecnica diretta dei file chiave
- package.json: script completi per dev/build/check e ciclo Prisma.
- README.md: onboarding locale, stack, ruoli demo, limiti noti.
- MVP_STATUS.md: stato operativo MVP.
- docker-compose.yml: PostgreSQL 16 con healthcheck.
- prisma/schema.prisma: modello dominio esteso con enum e relazioni.
- prisma/seed.ts: seed idempotente pratico (clear + repopulation) per demo.
- src/lib/prisma.ts: Prisma Client con adapter PostgreSQL.
- src/lib/auth.ts: RBAC demo e funzioni capability-based.
- src/app/*: App Router con pagine modulo e detail pages.
- docs/*: strategia AI, migrazione PostgreSQL, roadmap.

### 3.2 Moduli e livelli
| Modulo | Funzione oggi | Livello maturita | Stato |
|---|---|---:|---|
| Dashboard | KPI, priorita, tabelle operative | 8/10 | Implementato |
| Concessioni | Lista + scheda 360 su concessione | 8/10 | Implementato |
| Concessionari | Entry in menu e pagina | 3/10 | Predisposto |
| Criticita | Lista, scheda, creazione/modifica controllata | 8/10 | Implementato |
| Scadenze | Agenda scadenze con lettura operativa | 8/10 | Implementato |
| Pagamenti | Monitoraggio residui/morosita + update | 8/10 | Implementato |
| Sopralluoghi | Registro tecnico + creazione | 8/10 | Implementato |
| Procedimenti | Registro istruttorio + creazione | 8/10 | Implementato |
| Report | Lista, scheda, validazione, PDF | 8/10 | Implementato |
| Normativa | Fonti/versioni/impatti + pagina aggiornamento | 7/10 | Implementato |
| AI assistiva | Template suggestion con disclaimer | 5/10 | Scaffold funzionale |
| Vista AdSP | Portale consultivo separato | 7/10 | Implementato |
| Export CSV | Criticita, scadenze, pagamenti, procedimenti, report | 8/10 | Implementato |
| Login demo/ruoli | Selezione ruolo e cookie httpOnly | 4/10 | Solo demo |

## 4. Valutazione tecnica
### 4.1 Punti solidi
- Architettura modulare chiara: separazione app pages, server queries, server actions, componenti UI.
- Uso coerente Server Components e force-dynamic dove richiesto dal dato runtime.
- Prisma ben integrato con adapter PostgreSQL e pool.
- Data model robusto e orientato al dominio.
- CSV/PDF server-side con controllo ruoli.
- RevalidatePath usato nelle action per coerenza UI-dato.

### 4.2 Fragilita tecniche
- Nessun test automatico.
- Nessuna pipeline di quality/security automation nel repository.
- Documentazione strategica in parte non allineata (alcuni testi roadmap citano ancora SQLite come stato attuale, non coerente con stack corrente PostgreSQL).
- Alcune scelte hardcoded nei flussi demo (es. caso guida demo specifico).
- Config Next minima senza policy esplicite di hardening.

### 4.3 Debito tecnico prioritario
- Introduzione test suite.
- Hardening sicurezza applicativa.
- Governance error handling e telemetry strutturata.
- Allineamento documentazione strategica allo stato reale.

## 5. Valutazione funzionale
### 5.1 Cosa consente oggi la piattaforma
- Navigare quadro completo concessioni e relativi sotto-domini operativi.
- Individuare rischi e priorita da dashboard e liste verticali.
- Aggiornare in modo controllato alcune entita core (criticita, pagamenti, sopralluoghi, procedimenti, validazione report).
- Produrre export CSV e PDF report.
- Operare con profili demo differenziati, inclusa vista consultiva AdSP.

### 5.2 Valutazione modulo per modulo
Per ogni modulo: funzione, maturita, utilita, limiti, miglioramento.

- Dashboard
  - Funzione: KPI e priorita trasversali.
  - Maturita: alta MVP.
  - Utilita: molto alta per governance operativa.
  - Limiti: assenza trend temporali e drill-down avanzato.
  - Miglioramenti: serie storiche, alert configurabili, SLA.

- Concessioni
  - Funzione: anagrafica e vista 360 per concessione.
  - Maturita: alta MVP.
  - Utilita: centrale.
  - Limiti: assenza editing strutturato concessione.
  - Miglioramenti: workflow variazioni/rinnovi/versioning titolo.

- Criticita
  - Funzione: gestione anomalie e rischio.
  - Maturita: alta MVP.
  - Utilita: altissima per presidio rischio.
  - Limiti: manca assegnazione task/owner e SLA.
  - Miglioramenti: gestione incarichi, escalation, timeline.

- Scadenze
  - Funzione: agenda adempimenti e segnali rischio.
  - Maturita: alta MVP.
  - Utilita: alta.
  - Limiti: alerting non notificante.
  - Miglioramenti: notifiche PEC/email/in-app, regole configurabili.

- Pagamenti
  - Funzione: esposizione residua e morosita.
  - Maturita: alta MVP.
  - Utilita: alta economico-legale.
  - Limiti: manca integrazione contabile esterna.
  - Miglioramenti: riconciliazione automatica, aging analysis.

- Sopralluoghi
  - Funzione: rilievi tecnici e conformita.
  - Maturita: alta MVP.
  - Utilita: alta tecnica/istruttoria.
  - Limiti: assenza allegati multimediali strutturati.
  - Miglioramenti: foto georeferenziate, checklist tecnica standard.

- Procedimenti
  - Funzione: monitoraggio iter amministrativo.
  - Maturita: alta MVP.
  - Utilita: altissima lato legale-amministrativo.
  - Limiti: workflow non formalizzato per stati/attori.
  - Miglioramenti: BPM con stati obbligati, audit decisionale.

- Report
  - Funzione: output istruttori e validazione.
  - Maturita: alta MVP.
  - Utilita: alta direzionale e istituzionale.
  - Limiti: manca versionamento editoriale report.
  - Miglioramenti: workflow revisione, firme, storico revisioni.

- Normativa
  - Funzione: fonti/versioni/impatti cross-modulo.
  - Maturita: medio-alta MVP.
  - Utilita: distintiva.
  - Limiti: aggiornamento ancora manuale guidato.
  - Miglioramenti: ingestion normativa semi-automatica + diff.

- AI
  - Funzione: suggerimenti assistivi via template.
  - Maturita: media-bassa.
  - Utilita: buona in demo, limitata in produzione attuale.
  - Limiti: nessun provider LLM live, no valutazione qualità.
  - Miglioramenti: orchestration con guardrail e approvazione umana.

- Vista AdSP
  - Funzione: consultazione protetta e focalizzata.
  - Maturita: buona MVP.
  - Utilita: alta per trasparenza istituzionale.
  - Limiti: no canale scambio formalizzato.
  - Miglioramenti: area documentale condivisa e feedback strutturati.

## 6. Valutazione giuridico-amministrativa
### 6.1 Punti di forza
- Dominio ben rappresentato su decadenza/revoca/morosita/scadenze/procedimenti.
- Esplicita separazione proposta tecnica vs decisione autoritativa.
- Presenza di disclaimer chiari su AI e natura istruttoria.
- Tracciabilita minima delle azioni tramite ActivityLog.
- Vista consultiva AdSP coerente con principio di trasparenza controllata.

### 6.2 Lacune
- Mancano workflow formali con attori pubblici/privati e stati vincolati normativamente.
- Mancano protocollazione, fascicolo amministrativo, gestione PEC, repertorio atti.
- Audit trail non e ancora probatorio completo (user identity reale non consolidata).
- Manca gestione documentale a valore legale (firma, marca, conservazione).

### 6.3 Rischi
- Uso improprio demo auth in contesti reali.
- Rischio contestazione su tracciabilita decisionale insufficiente.
- Rischio confusione tra supporto AI e decisione amministrativa se non governato.

### 6.4 Aree da rafforzare per credibilita ente pubblico
- Workflow amministrativo formale con logging forense.
- Protocollo comunicazioni ufficiali.
- Repository documentale compliance-ready.
- Controlli di accesso enterprise e segregazione tenant/ente.

## 7. Valutazione prodotto/mercato
### 7.1 Problema risolto
Riduce frammentazione operativa tra dati concessori, rischio tecnico-giuridico-economico e output istruttori, offrendo una vista integrata orientata alla decisione.

### 7.2 Target primari
- Societa concessionarie strutturate.
- Autorita di Sistema Portuale.
- Enti pubblici con demanio marittimo e concessioni complesse.
- Studi legali/amministrativi specializzati in concessioni.

### 7.3 Valore per stakeholder
- Concessionari: controllo proattivo rischio e adempimenti.
- AdSP/enti: trasparenza consultiva e quadro sintetico validato.
- Consulenti: base dati unica per istruttorie e pareri.
- Partner tech: base solida per integrazioni verticali.

### 7.4 Differenziazione vs gestionali generici
- Model data verticale sul demanio portuale.
- Modulo normativa con impatti operativi collegati a casi.
- Vista AdSP e logica duale back-office/consultazione.

### 7.5 Potenziale go-to-market
- SaaS verticale: forte potenziale su concessionari e consulenza.
- Enterprise/on-premise: potenziale alto per enti pubblici, con requisiti security/compliance maggiori.
- Verticalizzazione estendibile a concessioni pubbliche non portuali, autorizzazioni e procedimenti con analoghe esigenze.

### 7.6 Ipotesi modello business e pricing ragionevole
- Modello base: canone annuo per ente/societa + moduli add-on.
- Fasce indicative (solo stima strategica, non da codice):
  - SMB concessionario: 8k-25k euro/anno.
  - Mid-large concessionario o multi-sito: 25k-80k euro/anno.
  - Ente pubblico/AdSP enterprise: 80k-250k+ euro/anno o progetto on-premise con manutenzione.
- Add-on: AI governance, integrazioni, conservazione documentale, supporto legale operativo.

### 7.7 Rischi di mercato
- Cicli di vendita lunghi nel pubblico.
- Necessita alta customizzazione e integrazione.
- Competizione con suite PA generaliste e incumbent verticali.

## 8. Valutazione UX/UI
### 8.1 Cosa funziona
- Navigazione chiara con sidebar ruolo-aware.
- Linguaggio interfaccia coerente con dominio.
- Tabelle e badge efficaci per priorita operative.
- Struttura pagine detail molto ricca e leggibile.
- Percorso demo esplicito, utile per presentazioni.

### 8.2 Cosa migliorare
- Densita informativa elevata su alcune schermate (necessarie viste sintetiche progressive).
- Mancano componenti di analytics visuale avanzata (grafici trend, heatmap rischi).
- Mancano feedback UX su errori/action in stile production-grade (toast, retry guidance, state machine visibile).

### 8.3 Cosa manca per demo istituzionale eccellente
- Storytelling KPI con confronto periodale.
- Vista istituzionale dedicata con template presentazione dirigenziale.
- Export executive pack combinato (CSV+PDF+indicatori).

### 8.4 Cosa manca per uso quotidiano reale
- Workspace multiutente con incarichi e scadenzario personale.
- Notifiche multicanale.
- Gestione documentale operativa nativa.
- Personalizzazione viste e ricerca full-text avanzata.

## 9. Sicurezza, compliance e limiti production
### 9.1 Sicurezza sufficiente per demo
- Cookie httpOnly ruolo.
- Guard server-side per ruoli/capability.
- Restrizioni VIEWER_ADSP su rotte operative e AI.
- Protezione export e PDF con check ruolo.

### 9.2 Sicurezza insufficiente per produzione
- Nessuna autenticazione reale utente.
- Nessuna MFA/SSO/IdP.
- Nessun controllo sessione avanzato (rotazione, revoca centralizzata).
- Nessun CSRF hardening esplicito per action critiche.
- Nessun rate limiting o detection abuso.
- Nessun encryption design esplicito at-rest/field-level.

### 9.3 Interventi obbligatori pre-produzione
- IAM enterprise (OIDC/SAML), RBAC/ABAC robusto.
- Audit log forense immutabile con user identity reale.
- Security headers, CSP, secret management, hardening app.
- Data governance GDPR (retention, minimizzazione, diritti interessato, DPIA se necessario).
- Conservazione documentale e catena decisionale verificabile.

## 10. AI e automazione
### 10.1 Implementato
- Modulo AI template-based con output assistivo.
- Prompt builder interno e tipi dati dedicati.
- Restrizione ruolo per accesso AI.
- Warning esplicito: AI non decide, supporta.

### 10.2 Solo scaffold
- Nessun provider LLM runtime collegato.
- Nessun sistema di valutazione qualitativa output.
- Nessun repository audit prompt/output persistente.

### 10.3 Principio di governance
Il principio e corretto e allineato al dominio pubblico: AI propone, operatore verifica, responsabile valida, Autorita decide.

### 10.4 Opportunita reali AI
- Analisi pre-istruttoria criticita e rischio decadenza.
- Bozze strutturate atti e note istruttorie.
- Check coerenza scadenze/obblighi/pagamenti.
- Analisi impatto normativa su casi concreti.
- Riepilogo fascicolo e comparazione concessioni.

### 10.5 Rischi AI
- Hallucination normativa.
- Bias su priorita procedimentali.
- Sovra-affidamento operativo.
- Tracciabilita insufficiente se non auditata.

### 10.6 Requisiti uso responsabile
- Human-in-the-loop obbligatorio.
- Policy prompt/output + logging completo.
- Blocchi su automazione provvedimentale.
- Validation checklist legale prima di qualunque atto esterno.

## 11. Database e modello dati
### 11.1 Cosa e ben modellato
- Copertura entita core molto ampia.
- Relazioni coerenti e indici utili.
- Enum dominio ben strutturate.
- Collegamenti trasversali utili (criticita-procedimenti-report-normativa).
- ActivityLog gia presente come base di tracciabilita.

### 11.2 Cosa manca o va esteso
- Versionamento titolo concessorio e sue modifiche nel tempo.
- Fascicolo procedimentale esplicito come entita autonoma.
- Protocollo, comunicazioni PEC, notifiche e canali ufficiali.
- Unita organizzative, utenti reali, deleghe e responsabilita formali.
- Workflow autorizzativo configurabile e policy-based.
- Storico decisionale con motivazioni e allegati firmati.

### 11.3 Entita strategiche da aggiungere
- Protocollo
- ComunicazionePEC
- Fascicolo
- Soggetto (multi-ruolo)
- UnitaOrganizzativa
- Provvedimento
- Notifica
- WorkflowStep
- AllegatoVersione
- AuditEvent immutabile
- IntegrationEvent

## 12. SWOT analysis
### Strengths
- Verticalita dominio concessioni portuali.
- Data model ricco e coerente.
- Percorso demo forte e presentabile.
- Moduli core gia funzionanti e integrati.
- Export/PDF e vista AdSP gia operativi.

### Weaknesses
- Sicurezza identity non production-ready.
- Assenza test e pipeline QA automatica.
- Mancanza workflow amministrativo formalizzato.
- Modulo concessionari non completato.
- AI ancora non connessa a provider reale.

### Opportunities
- Mercato verticale ad alto valore e complessita.
- Digitalizzazione procedimenti e trasparenza ente-concessionario.
- Espansione su demanio/concessioni non portuali.
- Offerta enterprise con integrazioni istituzionali.

### Threats
- Competizione PA/enterprise consolidata.
- Vincoli normativi/compliance inaspriti.
- Rischio reputazionale su errori AI o sicurezza.
- Complessita integrazione con sistemi legacy enti.

## 13. Roadmap consigliata
### 13.1 Stabilizzazione tecnica immediata
- Obiettivi: hardening base, coerenza documentale, quality baseline.
- Interventi: test smoke/e2e minimi, lint/check estesi, allineamento docs, observability base.
- Priorita: Altissima.
- Complessita: Media.
- Impatto: Alto.

### 13.2 Demo istituzionale
- Obiettivi: massimizzare credibilita verso enti e investitori.
- Interventi: storytelling KPI, dataset casi istituzionali, demo script multi-ruolo, export executive.
- Priorita: Alta.
- Complessita: Media.
- Impatto: Alto.

### 13.3 MVP commerciale
- Obiettivi: primo prodotto vendibile a clienti privati/consulenza.
- Interventi: auth reale, onboarding tenant, billing/licensing base, support process.
- Priorita: Alta.
- Complessita: Alta.
- Impatto: Alto.

### 13.4 Versione production-grade
- Obiettivi: sicurezza/compliance e affidabilita operative.
- Interventi: IAM enterprise, audit forense, backup/DR, policy security, CI/CD completa.
- Priorita: Altissima.
- Complessita: Alta.
- Impatto: Molto alto.

### 13.5 Versione enterprise/AdSP
- Obiettivi: adozione ente pubblico e multi-organizzazione.
- Interventi: workflow amministrativo formalizzato, protocollazione, integrazioni istituzionali, on-prem.
- Priorita: Alta.
- Complessita: Molto alta.
- Impatto: Molto alto.

### 13.6 Evoluzione AI/legal intelligence
- Obiettivi: differenziazione competitiva sostenibile.
- Interventi: provider LLM, guardrail, benchmark qualità, explainability, audit AI end-to-end.
- Priorita: Media-Alta.
- Complessita: Alta.
- Impatto: Alto.

## 14. Rating finale
Scala 1-10 (stato attuale):

| Dimensione | Voto |
|---|---:|
| Completezza MVP | 8.0 |
| Qualita tecnica | 7.8 |
| Coerenza dominio | 8.7 |
| Presentabilita | 8.4 |
| Scalabilita architetturale | 7.2 |
| Sicurezza | 4.8 |
| Potenziale commerciale | 8.5 |
| Innovazione | 7.9 |

Giudizio complessivo: 7.7/10 come MVP verticale dimostrabile; 5/10 readiness produzione pubblica senza hardening.

## 15. Conclusioni operative
Il progetto e gia una piattaforma MVP concreta, non un semplice prototipo UI. La verticalita dominio, il modello dati e i flussi modulo-modulo lo rendono credibile per demo avanzate e prime iniziative commerciali.

Per passare a contesti reali (in particolare pubblici/AdSP) il delta non e sulle funzionalita base, ma su governance: sicurezza identity, workflow amministrativo formalizzato, audit forense, compliance documentale e integrazioni.

Con un piano di 2-3 release focalizzate su hardening e processi, Concessioni Portuali puo evolvere rapidamente da MVP dimostrativo a piattaforma enterprise ad alta credibilita istituzionale.

---

## Prime 10 cose da fare
1. Introdurre autenticazione reale (OIDC/SAML) con gestione utenti e ruoli persistenti.
2. Implementare middleware centralizzato di protezione route e policy di accesso.
3. Aggiungere test automatici (unit + integration + e2e) sui flussi core.
4. Implementare audit trail forense completo con user identity reale.
5. Formalizzare workflow procedimentale con stati vincolati, SLA e responsabilita.
6. Introdurre gestione documentale strutturata (upload, versioni, metadati, allegati).
7. Aggiungere notifiche operative (scadenze, morosita, criticita) multicanale.
8. Allineare documentazione strategica e tecnica allo stato PostgreSQL corrente.
9. Rendere il modulo Concessionari operativo (non placeholder).
10. Definire baseline DevSecOps (CI/CD, scan dipendenze, policy security).

## 10 criticità da non ignorare
1. Autenticazione demo a cookie ruolo non adeguata a produzione.
2. Mancanza CSRF/rate limiting/hardening security espliciti.
3. Assenza test automatici: rischio regressioni silenziose.
4. Assenza workflow amministrativo formalizzato e tracciato end-to-end.
5. Tracciabilita decisionale non ancora probatoria per contesti contenziosi.
6. Assenza gestione documentale legale (firma, conservazione, protocollazione).
7. Dipendenza da processi manuali su aggiornamento normativa.
8. AI senza provider reale e senza quality governance quantitativa.
9. Mancanza observability strutturata per operativita continuativa.
10. Rischio disallineamento tra aspettative stakeholder pubblici e maturita compliance effettiva.

## Giudizio finale sintetico (max 10 righe)
Concessioni Portuali e un MVP verticalmente centrato e gia convincente in demo tecnica e funzionale.
La copertura dominio e superiore alla media di un MVP standard e mostra una visione prodotto chiara.
Lato business, il potenziale e alto grazie alla specializzazione su un problema reale e complesso.
Il principale gap non e di feature breadth ma di governance enterprise e compliance pubblica.
Serve un ciclo deciso di hardening sicurezza, workflow formale e audit decisionale.
Con queste evoluzioni, il progetto puo posizionarsi come soluzione premium per concessionari e AdSP.
In stato attuale: ottimo per demo avanzate e discovery commerciale.
Non ancora idoneo a uso istituzionale in produzione senza interventi obbligatori.
Traiettorie AI e normativa sono promettenti ma da governare con rigore.
Raccomandazione: investire subito su production readiness e validazione pilota con stakeholder reali.
