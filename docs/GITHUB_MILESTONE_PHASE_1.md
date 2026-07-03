# GitHub Milestone - Phase 1 Institutional Demo Hardening

## 1. Obiettivo della milestone
Questa milestone porta Concessioni Portuali da stato MVP demo a stato demo istituzionale rafforzata, idonea a interlocuzione con AdSP, partner, consulenti e stakeholder pubblici. L'obiettivo e aumentare credibilita tecnico-giuridica, affidabilita operativa e qualita dimostrativa senza avviare ancora una trasformazione full production.

## 2. Criteri di completamento milestone
- [ ] autenticazione reale implementata
- [ ] ruoli persistenti
- [ ] protezione route centralizzata
- [ ] mapping art. 47 Cod. Nav. su criticita
- [ ] PDF report server-side professionale
- [ ] audit trail rafforzato
- [ ] test automatici minimi
- [ ] security headers/rate limiting
- [ ] checklist contraddittorio nei procedimenti
- [ ] documentazione GDPR/DPIA draft
- [ ] due scenari demo istituzionali
- [ ] GIS/map placeholder o modulo GIS base
- [ ] build/check/test verdi
- [ ] repository pulito

## 3. Issue operative

### Issue 1 - Implement real authentication with NextAuth.js
- Titolo: Implement real authentication with NextAuth.js
- Obiettivo: sostituire login demo/cookie ruolo con autenticazione reale, utenti persistenti e sessione sicura.
- Motivazione: requisito critico per credibilita istituzionale, sicurezza e tracciabilita attori.
- File presumibilmente coinvolti: src/lib/auth.ts, src/app/login/page.tsx, src/app/logout/route.ts, src/app/layout.tsx, src/middleware.ts, package.json.
- Attivita tecniche: integrazione NextAuth.js, schema utenti/sessioni, adapter DB, callback ruoli, migrazione guard lato server.
- Criteri di accettazione: login/logout funzionanti, sessione robusta, ruoli persistenti, blocco accessi non autorizzati.
- Priorita: Critical
- Complessita: Alta
- Dipendenze: nessuna dipendenza funzionale bloccante.
- Label suggerite: auth, security, phase-1, priority-critical.

### Issue 2 - Add art. 47 Cod. Nav. mapping to Criticita
- Titolo: Add art. 47 Cod. Nav. mapping to Criticita
- Obiettivo: aggiungere mapping giuridico esplicito delle criticita alle fattispecie dell'art. 47 Codice della Navigazione.
- Motivazione: rinforza tenuta giuridica e coerenza tra rilevazione rischio e base normativa.
- File presumibilmente coinvolti: prisma/schema.prisma, prisma/seed.ts, src/server/actions/criticita.ts, src/server/queries/criticita.ts, src/app/criticita/nuova/page.tsx, src/components/criticita/CriticitaFiltersBar.tsx.
- Attivita tecniche: nuovo campo strutturato, validazione, aggiornamento form e filtri, riflesso su report/export.
- Criteri di accettazione: campo persistito, valorizzabile e filtrabile; presenza in output istruttori.
- Priorita: High
- Complessita: Media
- Dipendenze: preferibile dopo baseline auth/security.
- Label suggerite: legal-domain, prisma, phase-1, priority-high.

### Issue 3 - Implement professional server-side PDF reports
- Titolo: Implement professional server-side PDF reports
- Obiettivo: sostituire/rafforzare output PDF demo con generazione server-side professionale, template istituzionale e dati istruttori.
- Motivazione: output formale utilizzabile in contesti istituzionali e inter-ente.
- File presumibilmente coinvolti: src/app/report/[id]/pdf/route.ts, src/server/queries/report.ts, src/lib/utils.ts, src/types/.
- Attivita tecniche: template PDF standard, metadata, impaginazione robusta, gestione fallback/errori.
- Criteri di accettazione: PDF con struttura istituzionale, contenuti coerenti, stampa leggibile, no regressioni route.
- Priorita: High
- Complessita: Media-Alta
- Dipendenze: utile completare art.47 e checklist procedimentale prima della versione finale.
- Label suggerite: reports, pdf, phase-1, priority-high.

### Issue 4 - Add immutable audit trail baseline
- Titolo: Add immutable audit trail baseline
- Obiettivo: rafforzare ActivityLog verso audit trail non manipolabile, con dati essenziali per ricostruzione forense.
- Motivazione: riduce rischio legale e aumenta affidabilita probatoria.
- File presumibilmente coinvolti: prisma/schema.prisma, src/server/actions/*.ts, src/server/queries/*.ts, src/lib/auth.ts, src/lib/utils.ts.
- Attivita tecniche: nuovo modello evento, hash/tamper-evidence, registrazione azioni sensibili, query audit base.
- Criteri di accettazione: eventi completi tracciati, verifica integrita possibile, consultazione minima disponibile.
- Priorita: Critical
- Complessita: Alta
- Dipendenze: consigliato dopo auth reale per identity affidabile.
- Label suggerite: audit, compliance, security, phase-1, priority-critical.

### Issue 5 - Add Vitest and Playwright test baseline
- Titolo: Add Vitest and Playwright test baseline
- Obiettivo: introdurre test automatici minimi su query/actions e flussi demo principali.
- Motivazione: prevenire regressioni su componenti critici in vista demo istituzionale.
- File presumibilmente coinvolti: package.json, vitest.config.ts, playwright.config.ts, tests/unit/, tests/e2e/.
- Attivita tecniche: setup runner, test minimi core, fixture seed dedicata, script esecuzione.
- Criteri di accettazione: suite eseguibile, almeno 2 scenari e2e passanti, baseline unit test su servizi core.
- Priorita: Critical
- Complessita: Media
- Dipendenze: preferibile dopo auth/security/audit baseline.
- Label suggerite: testing, quality, phase-1, priority-critical.

### Issue 6 - Add security middleware, headers and rate limiting
- Titolo: Add security middleware, headers and rate limiting
- Obiettivo: introdurre protezione centralizzata route, security headers e rate limiting base.
- Motivazione: postura sicurezza omogenea e riduzione superfici di attacco.
- File presumibilmente coinvolti: src/middleware.ts, next.config.ts, src/lib/auth.ts, src/app/**/route.ts.
- Attivita tecniche: matcher route, header policy, limiti endpoint sensibili, gestione bypass controllati.
- Criteri di accettazione: policy centralizzata attiva, headers applicati, limitazione richieste su endpoint target.
- Priorita: Critical
- Complessita: Media-Alta
- Dipendenze: in parallelo a issue 1, da chiudere subito dopo.
- Label suggerite: security, middleware, phase-1, priority-critical.

### Issue 7 - Add procedural adversarial checklist to Procedimento
- Titolo: Add procedural adversarial checklist to Procedimento
- Obiettivo: modellare e visualizzare gli elementi minimi del contraddittorio procedimentale: comunicazione avvio, termine memorie, audizione, pareri, provvedimento finale.
- Motivazione: aumenta difendibilita procedimentale e trasparenza dell'iter.
- File presumibilmente coinvolti: prisma/schema.prisma, src/server/actions/procedimenti.ts, src/server/queries/procedimenti.ts, src/app/procedimenti/nuovo/page.tsx, src/app/procedimenti/[id]/page.tsx.
- Attivita tecniche: campi checklist, regole completezza, visualizzazione stato, log modifiche.
- Criteri di accettazione: checklist presente e tracciata, alert/blocchi su step mancanti, dettaglio procedimento aggiornato.
- Priorita: High
- Complessita: Media
- Dipendenze: coordinata con issue 2 e issue 4.
- Label suggerite: legal-domain, procedimento, phase-1, priority-high.

### Issue 8 - Add GDPR and DPIA documentation draft
- Titolo: Add GDPR and DPIA documentation draft
- Obiettivo: creare documentazione preliminare privacy/compliance per demo istituzionale e primo pilota.
- Motivazione: precondizione frequente per interlocuzione con PA e partner enterprise.
- File presumibilmente coinvolti: docs/DPIA_GDPR_DRAFT.md, docs/LEGAL_COVERAGE_MATRIX.md, docs/PROJECT_EVALUATION.md.
- Attivita tecniche: mappa trattamenti, basi giuridiche, rischio/privacy controls, backlog decisioni aperte.
- Criteri di accettazione: draft coerente, revisionabile da consulenza legale/privacy, gap esplicitati.
- Priorita: High
- Complessita: Media
- Dipendenze: alimentata dagli esiti di issue 1/4/6.
- Label suggerite: gdpr, compliance, docs, phase-1, priority-high.

### Issue 9 - Add institutional demo scenarios for morosita and occupazione difforme
- Titolo: Add institutional demo scenarios for morosita and occupazione difforme
- Obiettivo: rafforzare seed e percorso demo con due casi istituzionali completi: morosita rilevante e occupazione difforme.
- Motivazione: massimizzare efficacia demo verso stakeholder pubblici e partner.
- File presumibilmente coinvolti: prisma/seed.ts, src/app/demo/page.tsx, src/app/report/page.tsx, docs/DEMO_SCENARIOS_INSTITUTIONAL.md.
- Attivita tecniche: dataset coerente, script demo guidato, KPI outcome, output report attesi.
- Criteri di accettazione: demo ripetibile in tempi certi, risultati chiari, percorsi completi senza workaround.
- Priorita: High
- Complessita: Media
- Dipendenze: preferibile dopo issue 3 e issue 7.
- Label suggerite: demo, seed, legal-domain, phase-1, priority-high.

### Issue 10 - Add GIS map placeholder or base map module
- Titolo: Add GIS map placeholder or base map module
- Obiettivo: introdurre una prima rappresentazione geografica o placeholder evolutivo per aree, banchine e occupazioni.
- Motivazione: aumenta valore percepito e supporto ai casi occupazione difforme.
- File presumibilmente coinvolti: src/app/concessioni/[id]/page.tsx, src/components/, src/types/, docs/GIS_ROADMAP_NOTE.md.
- Attivita tecniche: componente mappa base/placeholder, dati minimi geospaziali, fallback testuale.
- Criteri di accettazione: visualizzazione base funzionante, responsive, nessuna regressione UX core.
- Priorita: Medium
- Complessita: Media-Alta
- Dipendenze: in coda alla milestone, dopo scenari demo.
- Label suggerite: gis, ux, phase-1, priority-medium.
