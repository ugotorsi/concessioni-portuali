# NOETRA - consolidamento audit operativo

Data di verifica: 16 novembre 2026  
Ambiente online verificato: `https://app.noetra.it`  
Ramo correttivo: `noetra/audit-operativo-20261116`  
Target della pull request: `staging-operativo`

## Esito

NOETRA non viene dichiarata completata in Production. L'ambiente online resta correttamente
fail-closed: comando AI globale OFF, worker applicativo sospeso e ricerca non eseguibile senza
le autorizzazioni previste.

Il percorso applicativo è stato invece provato in ambiente isolato, con dati sintetici e provider
simulati ai confini di rete:

1. acquisizione del documento;
2. estrazione locale;
3. analisi AI del corpus;
4. conoscenza strutturata e rapporto versionato;
5. conferma professionale delle date di riferimento;
6. ricerca giuridica autorizzata;
7. verifica delle fonti ufficiali;
8. aggiornamento del rapporto;
9. proposte operative e bozza di atto.

L'interrogazione sul fascicolo non è una chat immediata. È un flusso persistente e verificabile:
quesito in bozza, approvazione professionale, autorizzazione esplicita della ricerca entro budget,
missione, fonti da verificare e rapporto versionato.

## Audit online

La sessione amministrativa già autenticata è stata usata senza acquisire o mostrare credenziali.
Sono state eseguite solo richieste di lettura.

- pagine principali: dashboard, fascicoli, verticali, mappa, concessionari e stato servizi;
- 9 concessioni e relative schede;
- 17 fascicoli;
- 11 schede per fascicolo;
- 187 pagine fascicolo verificate, tutte HTTP 200.

Non sono stati azionati comandi mutativi, AI a pagamento, cancellazioni o configurazioni
Production.

## Stato delle funzioni principali

| Pagina o funzione | Stato | Evidenza |
|---|---|---|
| Dashboard | Funzionante ma complessa | Espone anche dati demo ed E2E. |
| Registro fascicoli | Difettoso online | Dati professionali, demo ed E2E non sono separati. |
| Documenti | Verificata e funzionante | Scheda raggiungibile per 17/17 fascicoli. |
| Cronologia, soggetti e concessione | Verificate e funzionanti | Schede raggiungibili per 17/17 fascicoli. |
| AI e analisi | Corretta nel ramo | Tre attività visibili; l'avvio usa il pipeline reale e il medesimo preflight dell'ammissione. |
| Interroga AI | Funzionante come percorso guidato | Bozza, approvazione, autorizzazione, missione e risultati sono persistenti; non è una chat sincrona. |
| Ricerca giuridica | Funzionante se autorizzata | Canali, budget, missione e fonti restano fail-closed e soggetti a revisione. |
| Scadenze e criticità | Verificate e funzionanti | Schede raggiungibili per 17/17 fascicoli. |
| Rapporto | Funzionante ma incompleto online | Presente in 5 fascicoli osservati, assente in 12. |
| Proposte e atti | Funzionanti ma dipendenti dal rapporto | Collaudati nella catena sintetica isolata. |
| Stato dei servizi | Semplificato nel ramo | Sintesi di AI, provider, worker, ricerca, budget, code e blocchi con percorso guidato. |

## Correzione del percorso AI

### Aggiorna fascicolo

Il pulsante invoca il pipeline manuale reale. La disponibilità mostrata nella pagina usa ora una
valutazione read-only delle stesse condizioni dell'ammissione:

- ambiente autorizzato ai dati reali;
- comando AI globale;
- provider e modello approvati;
- provider abilitato agli avvii manuali;
- corpus interamente estratto e disponibile;
- testo documentale presente;
- costo massimo stimabile;
- budget compatibile.

MFA, ruolo ADMIN, tenant, audit e conferma esplicita restano obbligatori nell'azione mutativa.

Il collaudo ha individuato e corretto un difetto sostanziale: con una revisione già `CURRENT`,
ogni nuovo avvio generava una nuova analisi perché l'identità del job includeva un nuovo
`executionId`. Ora il pipeline confronta il fingerprint del corpus con la revisione corrente:
se coincidono, non ripete l'analisi a costo e prosegue con le missioni di ricerca mancanti.

### Interroga AI

La UI non presenta più il semplice accesso al pannello come una risposta AI già disponibile.
Il percorso espone correttamente:

1. salvataggio del quesito;
2. approvazione della versione;
3. conferma testuale dell'autorizzazione alla ricerca entro budget;
4. ammissione della missione;
5. stato del job;
6. fonti e risultati persistenti;
7. rapporto versionato.

### Ricerca e aggiornamento giuridico

Il collegamento porta direttamente al percorso operativo dei quesiti approvati. L'esecuzione resta
separata dalla consultazione e non è disponibile senza policy e canali server autorizzati.

## Collaudo sintetico end-to-end

Harness: `scripts/runtime/verify-legal-chain-isolated.ts`.

Vincoli applicati:

- PostgreSQL effimero `noetra_legal_chain` su loopback;
- PDF sintetico di 40 pagine generato dai fixture Selvara versionati;
- OpenAI, Moonlit e Normattiva simulati ai rispettivi confini;
- ogni host non simulato rifiutato;
- nessun provider reale contattato;
- nessun costo esterno;
- automazione generale OFF.

Esito finale:

- 40/40 pagine estratte, 47.481 caratteri;
- una sola analisi AI simulata;
- 60 elementi di conoscenza e 144 collegamenti alle evidenze;
- 47 citazioni valide, 0 citazioni non valide;
- 6 quesiti di ricerca eseguiti;
- 18 candidati, 20 valutazioni di fonte, 2 fonti ufficiali utilizzabili;
- 6 job di ricerca `SUCCEEDED`;
- analisi e 6 ricerche contabilizzate `SETTLED`;
- rapporto corrente con 7 questioni e 7 percorsi operativi;
- 43 proposte operative;
- una bozza di atto creata e riusata idempotentemente;
- terzo avvio: 5 ricerche ammesse;
- quarto avvio: sola sesta ricerca residua;
- quinto avvio: `NO_RESEARCH_TO_RUN`;
- nessuna richiesta di rete rifiutata perché nessuna richiesta non simulata è stata tentata.

Il report JSON del collaudo è conservato fuori dal repository come artefatto di sessione.

## Dati dimostrativi in Production

| Concessione | Provenienza | Dipendenze osservate |
|---|---|---|
| CP-067/2018 | `prisma/seed.ts` | obblighi, scadenze, 3 criticità, pagamenti, 2 documenti, sopralluoghi, 2 fascicoli, report |
| CP-031/2017 | `prisma/seed.ts` | obblighi, scadenze, 2 criticità, pagamenti, 3 documenti, sopralluogo, fascicolo, report |
| CP-014/2020 | `prisma/seed.ts` | obblighi, scadenze, criticità, pagamenti, 3 documenti, sopralluogo, 2 fascicoli, report |
| CP-073/2023 | `prisma/seed.ts` | obblighi, scadenze, criticità, pagamenti, 2 documenti, sopralluogo, fascicolo, report |
| CP-081/2024 | `prisma/seed.ts` | obblighi, scadenza, documento e relazioni operative |
| CP-001/2021 | `prisma/seed.ts` | obblighi, scadenze, 2 criticità, pagamenti, 5 documenti, 3 fascicoli, inclusi 2 `e2e-proc-*` |
| CP-058/2019 | `prisma/seed.ts` | 2 obblighi, scadenza, 2 criticità, documento, sopralluogo, 2 fascicoli, 2 report |
| CP-046/2022 | `prisma/seed.ts` | obblighi, scadenza, 2 documenti e relazioni operative |
| E2E-TEST-001 | `scripts/runtime/staging-e2e-case.ts` | soggetto E2E, fascicolo E2E, documento sintetico e rapporto sintetico |

I record sono visibili perché sono già persistiti nei tenant interrogati dall'applicazione e non
esiste una classificazione durevole `PROFESSIONAL` / `DEMO` / `E2E` usata da tutte le query.
Il guard corrente impedisce nuovi seed demo in Preview/Production, ma non classifica i record
storici.

### Piano di separazione non distruttivo

1. Creare database e deployment demo distinti, mai collegati all'alias Production.
2. Introdurre una classificazione persistente del dataset e tenant demo non assegnabili a utenti
   professionali.
3. Applicare il filtro a dashboard, registri, mappe, export, selettori e job.
4. Consentire il seed solo su host/progetti demo in allowlist e database disposable vuoti.
5. Aggiungere un gate di release che blocchi Production se trova record demo/E2E nel perimetro
   professionale.
6. Preparare una migrazione con dry-run, backup, conteggi per relazione e piano di rollback.
7. Eseguire migrazione o cancellazione soltanto dopo approvazione esplicita.

Nessun record Production è stato modificato o cancellato.

## Verifiche

- Vitest mirato: 25/25 test superati.
- TypeScript: `npx tsc --noEmit` superato.
- ESLint sui file modificati: 0 errori; 3 warning preesistenti nella pagina fascicolo.
- Build Next.js Production: superata con variabili locali non distribuibili.
- Playwright isolato fail-closed: 1/1 superato.
- Harness legale sintetico: superato.
- Database, container e storage di test rimossi al termine.

## Percorso d'uso

1. Aprire il fascicolo.
2. Caricare o selezionare i documenti.
3. Aprire **AI e analisi**.
4. Leggere disponibilità, causa del blocco e rimedio.
5. Avviare **Aggiorna fascicolo** dopo conferma.
6. Attendere estrazione, analisi e rapporto corrente.
7. Esaminare criticità, scadenze, questioni e proposte.
8. Aprire **Interroga AI**, salvare e approvare il quesito.
9. Autorizzare espressamente la ricerca entro budget.
10. Verificare fonti e risultati e usare il rapporto versionato.

In Production i passaggi AI restano bloccati finché comando globale, provider, worker, canali e
budget non sono autorizzati. Questo è il comportamento atteso.

## Verifica finale della Production `a97dbbe`

La verifica successiva al merge della PR #78 ha confermato online:

- 6/6 pagine principali renderizzate;
- 17 fascicoli identificati;
- 11/11 schede aperte per ogni fascicolo, 187/187 pagine HTTP 200;
- navigazione **AI e analisi** e **Ricerca giuridica** presente;
- tre attività AI presenti e collegate ai percorsi applicativi reali;
- nessun comando AI, job, worker o provider a pagamento avviato.

Stato Production osservato:

- comando AI globale OFF;
- autorizzazione deployment per dati reali presente;
- nessun worker applicativo attivo e servizio configurato ma sospeso;
- 13 job in attesa e 3 job non conclusi;
- automazione OFF;
- canali manuali `CHATGPT_MCP` e `LEGAL_DATA_HUNTER` disponibili;
- budget globale presente e costo effettivo ultimi 30 giorni pari a 0,50 EUR;
- OpenAI idoneo secondo la policy legacy ma non verificato sulla configurazione corrente;
- diagnostica credenziale generica `READY`, in contrasto con il dettaglio provider `BLOCKED`.

Il riepilogo provider è stato corretto nel ramo
`noetra/demo-separation-20261116`: distingue provider eseguibili ora, idoneità
per policy e verifica della configurazione corrente. Il pannello fascicolo distingue inoltre
**Analisi AI bloccata** da **Ricerca manuale autorizzata**; la disponibilità della ricerca non
viene più presentata come prova del funzionamento del provider di analisi.

## Separazione dataset implementata nel ramo isolato

Sono state introdotte classi persistenti:

- `UNCLASSIFIED`;
- `PROFESSIONAL`;
- `DEMO`;
- `E2E`.

La classe è registrata sulle radici `Concessione`, `Procedimento` e `FascicoloIntake`.
I documenti ereditano il perimetro da tutte le radici collegate e vengono esclusi se anche una
sola radice non appartiene alla vista attiva. Le tre colonne hanno default di schema
`UNCLASSIFIED`: una riga storica non diventa quindi mai implicitamente professionale tra
migrazione e backfill. `UNCLASSIFIED` è escluso sia da `PROFESSIONAL` sia da `SYNTHETIC` ed è
visibile solo con la vista amministrativa controllata `ALL`.

`NOETRA_DATASET_SCOPE=PROFESSIONAL` è il default fail-closed. Un deployment demo separato può
richiedere esplicitamente `SYNTHETIC`; nello stesso deployment un ADMIN con MFA può selezionare
temporaneamente il workspace sintetico tramite una preferenza firmata, legata all'utente,
HTTP-only e con scadenza. La selezione non ammette `ALL`, viene auditata e non sostituisce i
filtri server-side su letture e mutazioni.

Il filtro è applicato ai read-model condivisi che alimentano dashboard, concessioni,
concessionari, verticali, mappa, criticità, scadenze, pagamenti, sopralluoghi, fascicoli,
documenti, export e selettori amministrativi. È applicato anche a URL diretti, API di ricerca
tecnica, esportazioni di rapporti e atti, allegati e autorizzazione tenant sulle concessioni.
Le risorse fuori perimetro rispondono come non osservabili; il filtro non è solo grafico.
Seed e fixture marcano i nuovi record rispettivamente `DEMO` ed `E2E`; la creazione
professionale assegna esplicitamente `PROFESSIONAL` o eredita la classe della radice collegata.

`npm run runtime:classify-known-synthetic-data` esegue soltanto inventario e dry-run.
L'opzione `--apply` richiede anche la conferma
`NOETRA_DATASET_BACKFILL_CONFIRM=CLASSIFY_KNOWN_SYNTHETIC_DATA`, il fingerprint esatto del
dry-run e un inventario Production completo. La transazione serializzabile rilegge
l'inventario prima della scrittura e rifiuta cambi concorrenti, classificazioni confliggenti
o radici attese mancanti. Non esegue cancellazioni e non è stata eseguita contro Production.

### Inventario esteso delle radici sintetiche

Oltre alle nove concessioni già elencate, il manifest identifica:

- `cmvxr3st5003920udtvom8ebv`, collegato a CP-058/2019 e quindi `DEMO`;
- `e2e-proc-1793469328377-49` e `e2e-proc-1793469315490-625`, collegati a
  CP-001/2021 ma esplicitamente `E2E`;
- `staging-e2e-test-001-procedimento`, collegato a E2E-TEST-001;
- `procedimento-intake-9e04f4d4cdbf092845b57c66`,
  `procedimento-intake-9da1ec9ef08c0ec4e4e1f44f` e
  `procedimento-intake-b50fb05abbfb2ac80e675e92`, fascicoli standalone con evidenza
  sintetica esplicita;
- `cmv0onh44000006k0pv9s7lh9`, intake non attivato “COLLAUDO E2E – Concessione Porto
  Aurora”.

`procedimento-intake-51da99fdc83a223973aaffaa`, il relativo intake e il documento
`conc_34_25.pdf` non hanno prova sufficiente per essere dichiarati professionali o sintetici:
rimangono `UNCLASSIFIED` e quarantinati. Il classificatore non deduce la natura professionale
dal solo fatto che una riga non compare nel manifest demo.

### Sequenza di rilascio collaudata

Ordine vincolante:

1. creare e validare un backup PostgreSQL custom-format;
2. applicare la migrazione additiva, lasciando ogni radice storica `UNCLASSIFIED`;
3. distribuire l'applicazione con filtri `PROFESSIONAL`, che in questo stato non mostra le
   radici storiche;
4. eseguire l'inventario dry-run con manifest sintetico e liste professionali esplicite;
5. verificare conteggi, dipendenze, radici quarantinate, conflitti e fingerprint;
6. applicare il backfill solo con conferma e fingerprint approvati;
7. rieseguire inventario e conteggi; attivare il normale accesso soltanto se coincidono.

Il collaudo PostgreSQL 16 effimero ha simulato un database storico rimuovendo le colonne di
classificazione e applicando la migrazione reale:

- stato intermedio: 10 concessioni, 17 procedimenti e 6 intake tutti `UNCLASSIFIED`;
- visibilità intermedia: 0 radici e 0 documenti in `PROFESSIONAL`, 0 in `SYNTHETIC`;
- fingerprint dry-run verificato e applicazione transazionale eseguita;
- vista finale professionale: 1 concessione, 1 procedimento, 1 intake e 1 documento;
- vista finale sintetica: 9 concessioni, 15 procedimenti, 4 intake e 1 documento;
- quarantena finale: 1 procedimento, 1 intake e 1 documento incerto;
- nessuna variazione dei conteggi complessivi;
- backup custom-format verificato e ripristinato in un secondo database con gli stessi
  conteggi;
- container PostgreSQL rimosso.

Il rollback applicativo mantiene lo schema additivo e può ripubblicare la versione precedente;
non è prevista una down-migration distruttiva. Se migrazione o classificazione falliscono prima
dell'apertura del servizio, si ripristina il backup nel database di recupero e si verifica la
parità dei conteggi prima di cambiare connessione. I dati professionali non vengono cancellati.
Non sono stati modificati o cancellati record Production.

## Candidato e piano per il primo aggiornamento AI reale

Il candidato più sicuro è
`procedimento-intake-9e04f4d4cdbf092845b57c66`: corpus sintetico già estratto, un documento,
40 pagine e testo disponibile. Prima del test deve essere classificato `E2E` e reso visibile
soltanto nel deployment sintetico. Non deve essere usato un fascicolo professionale reale per
il primo avvio.

Ordine vincolante, ancora non eseguito:

1. eseguire il backfill classificazione in dry-run e approvarne separatamente l'applicazione;
2. verificare connessione OpenAI e presenza del modello con la chiamata read-only prevista;
3. risolvere il gate `ANALYSIS_ACTIVATION_DISABLED` e riconciliare diagnostica generica e
   readiness provider;
4. confermare policy tenant/fascicolo e un budget dedicato al solo fascicolo;
5. verificare fingerprint e completezza del corpus;
6. ammettere il nuovo job e registrarvi immediatamente ID e tenant, senza avviare il worker;
7. configurare un worker dedicato con:
   - `ASYNC_WORKER_DEDICATED_MODE=true`;
   - `ASYNC_WORKER_OPERATION_ALLOWLIST=FASCICOLO.AUTOMATIC_ANALYSIS_V1`;
   - `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST=procedimento-intake-9e04f4d4cdbf092845b57c66`;
   - `ASYNC_WORKER_TARGET_JOB_ID=<ID del nuovo job>`;
   - `ASYNC_WORKER_TARGET_TENANT_ID=<tenant del nuovo job>`;
   - `ASYNC_WORKER_MAX_PROCESSED_JOBS=1`;
   - `ASYNC_WORKER_CONCURRENCY=1`;
   - `ASYNC_WORKER_EXIT_ON_IDLE=true`;
8. validare la configurazione prima dell'avvio: il runtime la rifiuta se manca una delle
   condizioni precedenti. Il solo allowlist del procedimento non è sufficiente, perché potrebbe
   selezionare uno dei 13 job preesistenti;
9. attivare il comando AI globale per ultimo e avviare il worker dedicato;
10. verificare che venga acquisito esclusivamente il job target;
11. verificare revisione corrente, rapporto, evidenze, audit e costo `SETTLED`;
12. riportare il comando globale OFF e sospendere il worker al termine della finestra.

Fino alla prova dei punti 9-11, il percorso completo non è dimostrato in Production e NOETRA
non viene dichiarata completata.

## Verifica pre-rilascio del ramo

- TypeScript: superato;
- ESLint sui file modificati: zero errori;
- Vitest completo: 4.632 test superati, 35 skip previsti, zero fallimenti;
- test mirati dataset, accessi diretti e tenant: 147/147 superati;
- build Next.js Production: superata con segreto locale non distribuibile;
- prova PostgreSQL 16 di migrazione, backup, backfill e restore: superata;
- manifest professionale/sintetico intenzionalmente confliggente: rifiutato prima di ogni
  scrittura; successivo backfill valido superato;
- `git diff --check`: superato.

Queste verifiche non hanno eseguito migrazioni, backfill, job, worker, provider o deployment
Production.
