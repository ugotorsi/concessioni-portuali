# Project-wide Assessment for Platform Development

## 1. Executive summary
Questo assessment conferma che il progetto ha superato la soglia demo tecnica e narrativa, ma non e ancora una piattaforma pronta per pilot formale ente o produzione.

Stato sintetico:
- Demo istituzionale cloud: pronta e funzionante.
- Baseline applicativa core: buona su dominio concessorio (concessioni/criticità/procedimenti/documenti/report).
- Storage documentale cloud persistente: completato nel perimetro demo avanzata (#29, #31).
- Gap bloccanti per pilot serio: compliance formalizzata, hardening sicurezza enterprise, integrazioni protocollari reali, workflow documentale a valore legale.
- Gap bloccanti per produzione: multipli e sostanziali.

Verdetto severo:
- Demo: solida.
- Pilot reale: possibile solo dopo sprint di hardening mirati.
- Produzione: no-go in stato attuale.

Riposizionamento dominio (Issue #34 / 32A):
- piattaforma di supporto istruttorio su core concessorio comune;
- verticale A portuale/AdSP già attiva;
- verticale B marittima turistico-ricreativa in roadmap.

Quadro giuridico Simpliciter:
- art. 18 L. 84/1994 come verticale speciale portuale (non base universale);
- art. 36 cod. nav. come base generale delle concessioni demaniali marittime;
- art. 37 cod. nav. come presidio della procedura comparativa;
- art. 47 cod. nav. come regola trasversale di decadenza;
- d.l. 400/1993 come fonte centrale della verticale turistico-ricreativa;
- art. 12 direttiva 2006/123/CE come vincolo su risorse scarse, selezione trasparente/imparziale e no proroghe automatiche generalizzate.

## 2. Stato attuale del progetto
Snapshot operativo eseguito in questa ricognizione:
- Branch corrente: `main`.
- Tag presenti: `v0.1.0-mvp-demo`.
- Issue assessment aperta: #28.
- Test unit: `npm run test` eseguito con 55 test passati.
- Build: `npm run build` eseguito con successo.
- Check: `npm run check` eseguito con successo.
- Docker locale: non attivo durante la ricognizione.
- Conseguenza: non verificati in questa sessione `docker compose up -d`, `npm run db:push`, `npm run db:seed`, `npm run test:e2e` locali.

Conclusione di stato:
- Qualita tecnica baseline buona per demo evoluta.
- Verifica E2E locale non rieseguita in questa sessione per assenza Docker attivo.

## 3. Cosa e già utilizzabile
Aree con base concreta e utilizzabile:
- Autenticazione con ruoli e sessione applicativa.
- Protezione route, security headers, rate limit baseline.
- Modulo concessioni e criticità con mappatura Art. 47 strutturata.
- Modulo procedimenti con checklist e tracciamento contraddittorio/10-bis.
- Fascicolo documentale baseline con metadata e audit eventi.
- Reportistica CSV e PDF istituzionale.
- Audit trail hash-chain applicativa.
- Dashboard operativa e scenari demo guidati.
- Deploy cloud demo Vercel/DB gestito per finalità presentative.

## 4. Cosa e ancora demo/scaffold
Elementi non vendibili come produzione:
- Demo guidata AI-led: forte su storytelling, non su automazione enterprise.
- Mappa: GIS-ready placeholder, non GIS operativo certificato.
- Protocollo/PEC: metadata registrati, non integrazione reale provider/ente.
- Storage documenti: persistenza cloud attiva in perimetro demo avanzata, ma senza piena catena legale (firma/conservazione/protocollo integrato).
- Normativa: modulo utile ma non ancora knowledge engine dinamico con governance forte.
- Compliance privacy: documentazione in larga parte draft.
- Multi-tenant: assente.
- AI server-side/legal assistant operativo end-to-end: non completato.

## 5. Moduli core
Mappa moduli core con classificazione severa.

| Modulo | File principali | Funzione | Stato | Dipendenze | Rischi | Test presenti | Lacune |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth e ruoli | `src/lib/auth.ts`, `src/app/login`, `src/server/actions/auth.ts`, `middleware.ts` | Accesso, sessione, autorizzazioni | MVP | next-auth, prisma, bcrypt | MFA non enforcement, session hardening incompleto | unit + e2e auth | SSO/OIDC assente |
| Sicurezza/rate limit | `middleware.ts`, `src/lib/rate-limit/*` | Header sicurezza, throttling login/export | MVP | middleware, upstash optional | in produzione serve backend distribuito configurato | unit rate-limit, e2e security-headers | no WAF/CSP avanzata |
| Audit trail | `src/server/audit/*`, `src/app/audit` | Tracciamento eventi e hash chaining | MVP | prisma ActivityLog | non WORM, non SIEM completo | unit audit-hash, e2e audit | conservazione forense assente |
| Database dominio | `prisma/schema.prisma`, `prisma/seed.ts` | Modello dati concessioni/criticità/procedimenti/documenti | quasi pilot | postgres, prisma | schema esteso ma senza multi-tenant | test indiretti unit/e2e | migrazioni enterprise e governance dati da rafforzare |
| Concessioni | `src/app/concessioni/*`, `src/server/queries/concessioni.ts` | Fascicolo concessorio base | MVP | auth, prisma | integrazioni esterne assenti | e2e copertura trasversale | import massivo assente |
| Criticità + Art.47 | `src/app/criticità/*`, `src/lib/art47.ts`, `src/server/actions/criticità.ts` | Rilevazione rischio e supporto istruttorio | quasi pilot | concessioni, normativa, procedimenti | rischio over-claim decisionale | unit art47, e2e art47 | workflow avanzato da consolidare |
| Procedimenti + 10-bis | `src/app/procedimenti/*`, `src/lib/procedimento-checklist.ts` | Contraddittorio, checklist procedurale | quasi pilot | criticità, documenti, ruoli | non sostituisce valutazione giuridica | unit checklist, e2e procedimenti | generatori atti non operativi completi |
| Documenti/fascicolo | `src/app/documenti/*`, `src/server/documents/*` | Upload/download metadata e collegamenti | MVP | storage locale/runtime, prisma | persistenza cloud e conservazione non definitive | e2e documenti, unit validazione/protocollo | object storage definitivo e firma assenti |
| Report PDF/CSV | `src/app/report/*`, `src/server/pdf/*`, `src/server/actions/report.ts` | Output reportistica istituzionale | MVP | pdfkit, dati dominio | valore probatorio non garantito | unit report-pdf, e2e report-pdf | firma digitale/conservazione assenti |

## 6. Moduli accessori

| Modulo | File principali | Funzione | Stato | Dipendenze | Rischi | Test presenti | Lacune |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `src/app/dashboard/*`, `src/server/queries/dashboard.ts` | KPI riepilogo operativo | MVP | query aggregate | KPI non ancora benchmarkati su enti reali | copertura indiretta | KPI economici avanzati da maturare |
| Mappa | `src/app/mappa/*` | Vista territoriale demo | demo | coordinate placeholder | non GIS certificato | e2e mappa | postgis/layer ufficiali assenti |
| Normativa | `src/app/normativa/*`, `src/server/queries/normativa.ts` | Catalogo fonti/impatti | scaffold avanzato | moduli core | aggiornamenti dinamici limitati | copertura indiretta | knowledge engine/versioning avanzato assente |
| AI assistiva | `src/app/ai/*`, `src/app/demo-guidata/*` | Supporto narrativo e presentativo | demo | browser TTS, script statici | percezione marketing oltre stato reale | e2e demo-guidata | integrazione server-side robusta assente |
| Demo scenari | `src/app/demo-scenari/*` | Storytelling casi istituzionali | demo solida | seed demo | sovraesposizione commerciale | unit demo-scenari, e2e demo-scenari | non e modulo operativo ente |
| Business plan narrativo | `src/app/demo-guidata/*` | Storytelling investimento | demo | contenuti statici | claim economici non validati | copertura indiretta | validazione commerciale esterna richiesta |
| Cloud deployment | `docs/CLOUD_DEMO_DEPLOYMENT.md` | Setup demo cloud | MVP demo | Vercel + DB cloud | ambiente demo non production | verifiche manuali documentate | hardening operations/staging assenti |

## 7. Debiti tecnici
- Assenza staging separato robusto (demo/pilot/prod).
- Nessun gate SAST/dependency security forte in CI.
- Nessun coverage gate obbligatorio.
- Session hardening enterprise incompleto.
- Object storage persistente cloud non definitivo.
- Conservazione audit/documenti non immutabile a norma.
- Integrazione protocollo/PEC reale assente.
- Multi-tenant e isolamento dati ente assenti.
- Observability/monitoring operativo ancora basilare.

## 8. Debiti funzionali
- Legal assistant non operativo end-to-end su atti reali.
- Normativa non ancora modulo dinamico di supporto continuo.
- Import dati ente CSV/XLSX non consolidato.
- Mancano workflow approvativi/firma/document lifecycle completi.
- KPI direzionali economico-gestionali ancora parziali.

## 9. Debiti legali/compliance
- DPIA in bozza, non formalmente approvata.
- Registro trattamenti e policy retention in stato draft.
- Mancanza procedure operative complete per diritti interessati e breach.
- Conservazione documentale e firma digitale non operative.
- Claim AI/prodotto da mantenere strettamente non decisori.

## 10. Rischi cloud
- Persistenza file non affidabile se basata su filesystem runtime.
- Ambiguita tra cloud demo e cloud production presso stakeholder.
- Assenza runbook completo incident/rollback.
- Segregazione ambienti ancora migliorabile.

## 11. Rischi dati/documenti
- Fascicolo cloud non ancora con storage definitivo enterprise.
- Tracciamento metadata protocollo/PEC non equivale a integrazione legale.
- Catena documentale non ancora conservazione sostitutiva.
- Potenziali contestazioni su affidabilità output PDF se usati oltre perimetro.

## 12. Rischi commerciali
- Sovrapromessa: confondere demo AI narrativa con prodotto AI operativo.
- Sovrapromessa: confondere supporto istruttorio con automazione decisionale.
- Time-to-pilot sottostimato senza sprint hardening.
- Business model da validare con early adopter reali.

## 13. Rischi PA/appalti
- Richieste compliance e sicurezza superiori allo stato attuale.
- Necessita prove formali su governance dati e audit.
- Necessita chiarezza contrattuale su perimetro funzionale non decisionale.
- Mancanza integrazioni ente può rallentare procurement/pilot.

## 14. Roadmap consigliata
Roadmap severa orientata pilot:
1. Sprint 1: storage documentale cloud persistente + audit metadata robusti.
2. Sprint 2: legal assistant operativo su libreria atti e output formali.
3. Sprint 3: generazione bozze e controllo coerenza fascicolo.
4. Sprint 4: modulo normativa dinamico e versionato.
5. Sprint 5: import dati ente e onboarding strutturato.
6. Sprint 6: dashboard KPI economico-operativi enterprise.
7. Sprint 7: pilot readiness (privacy, backup, monitoraggio, training).

## 15. Sprint 1 raccomandato
Titolo: Fascicolo documentale cloud persistente.

Deliverable minimi:
- Object storage definitivo (compat locale/cloud).
- Upload/download persistenti con hash e metadata completi.
- Audit su ciclo vita documento.
- Policy retention tecnica minima applicabile.

Outcome atteso:
- Riduzione rischio principale di credibilita tecnica presso ente.

## 16. Sprint 2 raccomandato
Titolo: Libreria atti e legal assistant operativo.

Deliverable minimi:
- Modelli atti (diffida, avvio, 10-bis, contestazioni, schemi provvedimento).
- Export PDF/DOCX governato.
- Presidi di coerenza giuridica e riferimenti normativi.

## 17. Sprint 3 raccomandato
Titolo: Bozze assistite e controllo coerenza.

Deliverable minimi:
- Precompilazione da dati concessione/criticità/procedimento.
- Checklist completezza fascicolo.
- Audit della generazione e del ciclo revisione.

## 18. Decisioni aperte
- Priorità investimento: consolidamento domain repositioning (32A) e preparazione modello dati (32B) prima di estensioni UI (32C).
- Scelta architettura target: single-tenant per ente o multi-tenant progressivo.
- Posizionamento commerciale iniziale: pilot operativo vs advisory/demo evoluta.
- Strategia integrazioni esterne (PEC/protocollo/GIS) in fasi.

## 19. Domande da sottoporre ad altra AI
- Quale ordine di priorità massimizza probabilita di pilot entro 90 giorni?
- Quale combinazione minima funzionale riduce rischio legale/commerciale?
- Quale architettura dati/documenti e più credibile per PA?
- Quale livello di investimento e realistico per arrivare a pilot serio?
- Quali claim commerciali devono essere evitati in modo assoluto?

## 20. Conclusione: passaggio da demo a piattaforma
Il progetto e una demo istituzionale avanzata con solide basi di dominio, non una piattaforma pronta alla produzione.

Per passare a piattaforma reale servono interventi mirati e disciplinati su:
- persistenza documentale cloud,
- compliance formalizzata,
- hardening sicurezza,
- operativita legal assistant,
- readiness pilot con processi e responsabilita esplicite.

Raccomandazione finale: procedere con piano sprint rigoroso, mantenere claim prudenti, usare la demo attuale come leva commerciale controllata e non come prova di production readiness.

## Appendice A - Valutazione funzionale 25 blocchi

| # | Blocco | Demo (1-10) | Pilot reale (1-10) | Produzione (1-10) | Priorità | Prossima azione consigliata |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Autenticazione e ruoli | 8 | 6 | 4 | Alta | Abilitare MFA, session policy e audit accessi avanzati |
| 2 | Sicurezza e rate limit | 7 | 5 | 3 | Alta | Consolidare backend distribuito e hardening CSP/WAF |
| 3 | Audit trail | 8 | 6 | 4 | Alta | Portare audit su storage immutabile e retention governata |
| 4 | Database e modello dati | 8 | 7 | 5 | Media | Definire migrazioni, governance schema, piani backup/restore |
| 5 | Concessioni | 8 | 7 | 5 | Media | Rafforzare import dati ente e validazioni avanzate |
| 6 | Criticità | 8 | 7 | 5 | Media | Estendere workflow remediation e metriche di esito |
| 7 | Art. 47 / decadenza / revoca | 8 | 7 | 5 | Alta | Consolidare presidi giuridici e output istruttori formalizzati |
| 8 | Regolarizzazione | 7 | 6 | 4 | Media | Migliorare pipeline verifica e collegamento atti |
| 9 | Procedimenti e contraddittorio | 8 | 7 | 5 | Alta | Completare workflow approvativi e gestione atti formali |
| 10 | Art. 10-bis | 7 | 6 | 4 | Media | Rafforzare tracking osservazioni e template comunicazioni |
| 11 | Documenti e fascicolo | 8 | 6 | 3 | Alta | Implementare object storage persistente e lifecycle policy |
| 12 | Protocollo/PEC metadata | 6 | 4 | 2 | Alta | Integrare provider/protocollo reale e ricevute |
| 13 | Report PDF | 8 | 6 | 4 | Media | Firma digitale, watermarking, conservazione coerente |
| 14 | Mappa/GIS-ready | 7 | 4 | 2 | Media | Evolvere verso GIS reale con layer ufficiali |
| 15 | Normativa | 7 | 5 | 3 | Media | Motore dinamico fonti/prassi/versioni |
| 16 | AI/legal assistant | 6 | 4 | 2 | Alta | Portare AI server-side con guardrail e audit output |
| 17 | Demo guidata AI-led | 9 | 5 | 2 | Bassa | Mantenere come supporto vendita, non core produzione |
| 18 | Business plan/investment | 7 | 5 | 3 | Media | Validare numeri con benchmark e early adopter |
| 19 | Cloud deployment Vercel/Neon | 8 | 6 | 4 | Alta | Separare ambienti, runbook, monitoraggio, rollback |
| 20 | Test/CI/CD | 7 | 6 | 4 | Alta | Aggiungere SAST, dependency scans, coverage gate |
| 21 | Privacy/GDPR/DPIA | 5 | 3 | 2 | Alta | Formalizzare DPIA, notice, processi diritti/breach |
| 22 | Multi-ente/multi-tenant | 3 | 2 | 1 | Alta | Disegnare strategia tenancy e isolamento dati |
| 23 | Import dati ente | 4 | 3 | 2 | Media | Costruire pipeline CSV/XLSX con mapping e quality checks |
| 24 | Storage cloud persistente | 4 | 3 | 2 | Alta | Sprint 1 dedicato a object storage persistente |
| 25 | Integrazioni PEC/protocollo/PCS/GIS | 3 | 2 | 1 | Alta | Piano integrazioni progressive con priorità PEC/protocollo |

