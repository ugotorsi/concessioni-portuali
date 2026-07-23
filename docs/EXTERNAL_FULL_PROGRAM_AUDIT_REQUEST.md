# External Full Program Audit Request — Concessioni Portuali

## 1. Executive summary
Concessioni Portuali e una piattaforma modulare di supporto istruttorio per rapporti concessori demaniali/pubblici.
Il sistema e rivolto a concessionari strutturati, AdSP, enti concedenti, comuni costieri e consulenti tecnico-giuridici.
Il problema che risolve è la frammentazione informativa tra dati concessori, criticità, procedimenti, pagamenti, scadenze e report.
La soluzione integra in un unico flusso operativo: monitoraggio, supporto istruttorio, tracciabilità delle azioni e output documentali.
L’architettura è moderna (Next.js + TypeScript + Prisma + PostgreSQL), con autenticazione reale, RBAC, middleware di sicurezza e baseline test automatizzati.
Sono state completate le issue critiche della Phase 1 (#1-#8), incluse sicurezza, audit trail, checklist contraddittorio, PDF server-side e documentazione GDPR/DPIA draft.
Lo stato attuale e "institutional demo-ready", ma non production-ready pieno.
Persistono gap infrastrutturali, documentali e compliance che richiedono hardening prima della produzione.
Si richiede audit esterno indipendente per:
- validare la credibilità tecnica e giuridico-funzionale dell’MVP;
- identificare rischi tecnici/compliance residui;
- definire una roadmap 30/60/90 giorni orientata a demo avanzata PA e produzione;
- supportare decisioni go/no-go su presentazioni istituzionali e sviluppo commerciale.

Cornice legale/posizionamento da applicare nell audit:
- art. 18 L. 84/1994 come verticale speciale portuale (non base universale);
- art. 36 cod. nav. come base generale concessoria;
- art. 37 cod. nav. come presidio procedurale comparativo;
- art. 47 cod. nav. come regola trasversale di decadenza;
- d.l. 400/1993 come riferimento centrale verticale turistico-ricreativa;
- art. 12 direttiva 2006/123/CE come vincolo su risorse scarse, selezione trasparente/imparziale e no proroghe automatiche generalizzate.

## 2. Contesto funzionale
Il progetto copre il ciclo principale della gestione concessoria demaniale/pubblica:
- gestione anagrafiche concessioni e concessionari;
- monitoraggio obblighi concessori;
- presidio criticità tecnico-giuridiche-economiche;
- gestione procedimenti con checklist contraddittorio;
- gestione pagamenti e morosità;
- monitoraggio scadenze amministrative/tecniche;
- gestione sopralluoghi;
- reportistica istruttoria e report direzionali;
- audit eventi operativi;
- profili art. 47 Cod. Nav. nelle criticità;
- PDF istituzionali server-side;
- documentazione privacy/GDPR/DPIA in stato draft.

Verticali di dominio:
- Verticale A (attiva): portuale/AdSP.
- Verticale B (roadmap): marittima turistico-ricreativa per comuni costieri.

## 3. Architettura tecnica
Stack e componenti principali:
- Next.js App Router;
- TypeScript;
- Prisma ORM;
- PostgreSQL su Docker Compose;
- NextAuth (credentials);
- middleware centralizzato sicurezza/redirect/rate-limit baseline;
- PDFKit per report PDF server-side;
- Vitest per unit/integration baseline;
- Playwright per E2E baseline.

Struttura di repository rilevante:
- `src/app` per pagine/route;
- `src/server/actions` per mutazioni server-side;
- `src/server/queries` per accesso dati;
- `src/server/pdf` per composizione report PDF;
- `src/server/audit` per tracciabilità eventi/hash chain;
- `src/lib` per auth, utilità, policy applicative;
- `prisma` per schema/seed;
- `docs` per governance, roadmap, compliance draft;
- `tests/unit` e `tests/e2e` per regressioni automatiche.

## 4. Modello dati principale
Entità core:
- User: identità applicativa, ruolo, attivazione, password hash.
- Concessionario: anagrafica soggetto titolare/referente.
- Concessione: nucleo del rapporto concessorio.
- ObbligoConcessorio: adempimenti e verifiche periodiche.
- Scadenza: termini amministrativi/tecnici/economici.
- Criticità: anomalie con profilo gravità, stato, fonte, art. 47.
- Procedimento: iter istruttorio con checklist contraddittorio e warning.
- Pagamento: canoni, stato pagamento, morosità.
- Sopralluogo: evidenze tecniche su stato luoghi/conformità.
- Report: output istruttorio/direzionale con stato validazione.
- ActivityLog: audit eventi con hash chain tamper-evident applicativa.
- Normativa (NormaFonte/NormaVersione/NormaImpatto): collegamento norma-caso operativo.

Elementi normativi/procedurali modellati:
- enum Art. 47 Cod. Nav. per classificazione criticità rilevanti;
- enum/checklist procedimento per passaggi di contraddittorio.

## 5. Funzionalità implementate
### 5.1 Autenticazione e ruoli
- Login reale con NextAuth credentials.
- RBAC con ruoli operativi e profilo consultivo VIEWER_ADSP.

### 5.2 Sicurezza middleware
- Protezione rotte, redirect non autenticati, blocchi perimetrali VIEWER_ADSP.
- Security headers baseline e rate limiting baseline su endpoint sensibili.

### 5.3 Audit trail hash chain
- Logging eventi sensibili con actor/context.
- Hash chaining su ActivityLog (tamper-evident applicativa).

### 5.4 Criticità e art. 47
- Mapping strutturato art. 47 su criticità.
- Filtri e visibilità dedicata in UI/export.

### 5.5 Procedimenti e checklist contraddittorio
- Checklist procedimentale strutturata con completezza/missing/warning.
- No automatismo decisorio: supporto istruttorio, non sostituzione dell’autorità.

### 5.6 PDF report server-side
- Report PDF istituzionali server-side con sezioni standard e disclaimer.
- Policy download per ruolo/stato validazione + audit download.

### 5.7 Export CSV
- Export CSV su aree operative principali (criticità, scadenze, pagamenti, procedimenti, report).

### 5.8 Test automatici
- Vitest baseline su auth/ruoli/rate limit/audit hash/PDF helper.
- Playwright baseline su auth/ruoli, headers, audit, art. 47, checklist, policy PDF.

### 5.9 Privacy/GDPR draft
- Registro trattamenti draft.
- DPIA draft non approvata.
- Data retention draft.
- Security measures draft.
- Gap privacy e next steps.

### 5.10 Seed demo
- Dataset demo controllato e riproducibile per test e demo istituzionali.

### 5.11 Dashboard e navigazione
- Vista 360 per moduli concessori con indicatori e navigazione ruolo-consapevole.

## 6. Phase 1 completata
Issue chiuse con commit noti e impatto:

1. #1 Auth reale
- Cosa è stato fatto: autenticazione reale con NextAuth e sessione JWT.
- Commit: d13baa3 feat: add real demo authentication with NextAuth
- Impatto: credibilità istituzionale e controllo accessi di base.

2. #2 Art. 47 mapping
- Cosa è stato fatto: mapping strutturato art. 47 su criticità + filtri/export.
- Commit: 156676d feat: add art 47 mapping to criticita
- Impatto: rafforzamento presidio giuridico-istruttorio su decadenza.

3. #3 Server-side PDF reports
- Cosa è stato fatto: report PDF server-side con audit download.
- Commit: a9ef266 feat(report): implement institutional server-side PDF with audit trail
- Impatto: output più difendibile in contesti istituzionali.

4. #4 Audit trail
- Cosa è stato fatto: baseline audit con hash chain tamper-evident.
- Commit: 8d60107 feat: add immutable audit trail baseline
- Impatto: migliore tracciabilità e accountability applicativa.

5. #5 Vitest/Playwright
- Cosa è stato fatto: baseline test unit + E2E.
- Commit: db28610 test: add Vitest and Playwright baseline
- Impatto: riduzione regressioni sui flussi core.

6. #6 Security middleware
- Cosa è stato fatto: middleware centralizzato, headers, rate limiting baseline.
- Commit: 53d3b26 feat: add security middleware and headers
- Impatto: posture security minima più coerente.

7. #7 Checklist contraddittorio
- Cosa è stato fatto: checklist procedimento con logica completezza/warning.
- Commit: 48b838a feat: add procedimento contraddittorio checklist
- Impatto: maggiore trasparenza istruttoria e presidio passaggi essenziali.

8. #8 GDPR/DPIA draft
- Cosa è stato fatto: set documentale privacy/GDPR/DPIA draft.
- Commit: 01a2cff docs: add GDPR and DPIA documentation draft
- Impatto: base preliminare compliance per interlocuzione istituzionale.

## 7. Validazioni tecniche
Comandi eseguiti (ultima run):
- `npm run test`: pass.
- `npm run build`: pass.
- `npm run check`: pass.
- `npm run test:e2e`: pass.
- `npm run db:push`: pass.
- `npm run db:seed`: pass.
- Docker/PostgreSQL: attivi e funzionanti.

Evidenze richieste:

### git log --oneline -10
```text
3ee9127 (HEAD -> main, origin/main) test: stabilize report pdf e2e test
01a2cff docs: add GDPR and DPIA documentation draft
a9ef266 feat(report): implement institutional server-side PDF with audit trail
48b838a feat: add procedimento contraddittorio checklist
156676d feat: add art 47 mapping to criticita
db28610 test: add Vitest and Playwright baseline
8d60107 feat: add immutable audit trail baseline
53d3b26 feat: add security middleware and headers
d13baa3 feat: add real demo authentication with NextAuth
5e71ae5 docs: add phase 1 milestone and issue templates
```

### git status --short
```text
M MVP_STATUS.md
M README.md
M docs/EXTERNAL_AI_REVIEW.md
M docs/LEGAL_COVERAGE_MATRIX.md
M docs/PHASE_1_INSTITUTIONAL_HARDENING.md
M docs/PROJECT_EVALUATION.md
M docs/privacy/DATA_RETENTION_POLICY_DRAFT.md
M docs/privacy/DPIA_DRAFT.md
M docs/privacy/GDPR_REGISTER_DRAFT.md
M docs/privacy/PRIVACY_GAPS_AND_NEXT_STEPS.md
M docs/privacy/SECURITY_MEASURES_DRAFT.md
```

### gh issue list --state closed --limit 20
```text
Showing 8 of 8 issues in ugotorsi/concessioni-portuali that match your search

ID  TITLE                          LABELS                    UPDATED
#8  Add GDPR and DPIA document...  phase-1, priority-hig...  about 8 minutes ago
#7  Add procedural adversarial...  phase-1, priority-hig...  about 13 hours ago
#6  Add security middleware, h...  phase-1, priority-cri...  about 19 hours ago
#5  Add Vitest and Playwright ...  phase-1, priority-cri...  about 13 hours ago
#4  Add immutable audit trail ...  phase-1, priority-cri...  about 14 hours ago
#3  Implement professional ser...  phase-1, priority-hig...  about 11 hours ago
#2  Add art. 47 Cod. Nav. mapp...  phase-1, priority-hig...  about 13 hours ago
#1  Implement real authenticat...  phase-1, priority-cri...  about 20 hours ago
```

Nota stato: working tree non clean al momento della stesura perché sono in corso correzioni linguistiche documentali.

## 8. Punti forti
- Verticalità giuridico-dominiale rara rispetto a gestionali generalisti.
- Flusso operativo coerente: criticità → art.47 → procedimento → contraddittorio → report.
- Audit trail applicativo già integrato nei flussi sensibili.
- Presenza di baseline test automatizzati ripetibili.
- PDF istituzionali server-side con controlli ruolo/validazione.
- Pacchetto privacy/GDPR draft pronto per revisione legale.
- Demo istituzionale già presentabile con narrativa tecnico-amministrativa.

## 9. Limiti e rischi attuali
- Non production-grade pieno.
- Nessuna conservazione digitale a norma.
- Nessuna integrazione protocollo/PEC.
- Nessuna firma digitale.
- Nessuno storage documentale robusto.
- Nessuna integrazione SIEM/WORM.
- Nessuna MFA.
- Hardening infrastrutturale non completo.
- Assenza pipeline CI/CD consolidata.
- Nessun penetration test formalizzato.
- Nessun deployment reale istituzionale validato.
- Modulo GIS non completo.
- Workflow documentale non completo.
- Gestione allegati avanzata non presente.
- Privacy notice formale non consolidata.
- DPIA non approvata formalmente.

## 10. Gap prioritari
### P0 (prima produzione)
- MFA + hardening sessioni/secret management.
- Backup cifrati + restore testato + RPO/RTO.
- Cifratura at rest + key management.
- Playbook incident/data breach.
- DPA/nomine formalizzate + privacy notice + DPIA approvata.
- Logging infrastrutturale centralizzato, alerting, SIEM.

### P1 (demo istituzionale avanzata)
- Workflow procedimentale più vincolato.
- Gestione documentale e allegati strutturata.
- Integrazione protocollo/PEC (anche pilota).
- Reportistica avanzata con scenario pack istituzionale.

### P2 (evoluzioni commerciali)
- Modulo GIS operativo.
- Integrazioni con sistemi terzi PA/ERP.
- CI/CD con security gates completi.
- Observability avanzata e benchmark performance.

## 11. Domande per la AI valutatrice
- La separazione core comune vs verticali normative e coerente e comunicabile?
- Il framing legale (art. 18 speciale, art. 36 base, art. 37 comparativa, art. 47 trasversale, d.l. 400/1993, art. 12 dir. 2006/123) e correttamente recepito?
- Questo è un MVP credibile per contesto pubblico/para-pubblico?
- Cosa manca in modo imprescindibile per una PA?
- Quali rischi tecnici principali vedi?
- Quali rischi giuridici/compliance principali vedi?
- Quali parti sembrano deboli o incoerenti?
- Quali test mancano per ridurre rischio regressione?
- Quanto è vendibile oggi e a quali condizioni?
- Quale roadmap prioritaria consiglieresti?
- Quali feature elimineresti o semplificheresti?
- Quali feature aggiungeresti prima di demo istituzionale estesa?
- Quali issue apriresti dopo la Phase 1?

## 12. Rating richiesto
Richiesto rating 1-10 su:
- qualità tecnica;
- architettura;
- sicurezza;
- compliance GDPR;
- coerenza giuridica;
- qualità UX;
- maturità prodotto;
- vendibilità a PA/AdSP;
- manutenibilità;
- readiness demo;
- readiness production.

## 13. Output richiesto alla AI esterna
Si richiede output strutturato con:
- giudizio sintetico;
- rating tabellare;
- top 10 problemi;
- top 10 miglioramenti;
- roadmap 30/60/90 giorni;
- rischi bloccanti;
- suggerimenti commerciali;
- decisione finale go/no-go demo.

## 14. Allegati/istruzioni per revisore
Il revisore dovrebbe analizzare almeno:
- `README.md`
- `MVP_STATUS.md`
- `docs/LEGAL_COVERAGE_MATRIX.md`
- `docs/PHASE_1_INSTITUTIONAL_HARDENING.md`
- `docs/privacy/*`
- `prisma/schema.prisma`
- `tests/e2e/*`
- `tests/unit/*`
- `src/server/actions/*`
- `src/server/queries/*`
- `src/server/pdf/reportPdf.ts`
- `middleware.ts`

Richiesta metodologica: audit severo, completo, non autocelebrativo, con evidenza dei blocchi reali alla produzione.

Claim da evitare nella valutazione e nel posizionamento:
- non presentare il prodotto come production-ready generalizzato per tutti i comuni costieri;
- non presentare compliance automatica totale o decisioni automatiche di decadenza/revoca;
- non presentare firma/conservazione/PEC/protocollo come pienamente operativi.
