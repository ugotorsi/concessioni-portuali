# Workflow procedimentale guidato — verifica di rilascio

Percorso: problematica → analisi giuridica → attività → atti → esecuzione → esito.

## Schema e migrazioni

Il workflow non introduce tabelle o colonne. Attività, transizioni, evidenze e
collegamenti alle bozze sono eventi immutabili in `ActivityLog`; proposte,
riconciliazioni, Knowledge, snapshot del rapporto e documenti usano tabelle
esistenti.

Dopo l'integrazione di `release/v7-integrated-services` il ramo contiene 59
migrazioni. Le sei aggiunte sono `20261018_technical_source_research`,
`20261020_fascicolo_analysis_evaluation`,
`20261023_fascicolo_knowledge_stable_identity_contract`,
`20261029_v7_provider_output_recovery`,
`20261101_research_provider_oauth_credential` e
`20261107_professional_legal_questions`. Il 4 novembre 2026 una lettura in
transazione `READ ONLY` di `_prisma_migrations` sul branch Neon Production
`production-v7-selvara-candidate-20261029` ha accertato 59 migrazioni su 59,
tutte completate e nessuna annullata. È lo stesso endpoint usato dal worker
Render e protetto da `EXPECTED_DATABASE_HOST_PREFIX`.

**Nessuna migrazione è necessaria per questo rilascio.** Né la build né
`release-production.ts` eseguono migrazioni.

### Drift preesistente fra migrazioni e `schema.prisma`

Riprodotto su un PostgreSQL temporaneo e vuoto con `prisma migrate deploy`
seguito da `prisma migrate diff --from-config-datasource --to-schema`.
Nessuna differenza è introdotta da questo lavoro: `prisma/` non è modificato.

| Differenza | Oggetti | Classificazione |
|---|---|---|
| Nomi di vincoli FK e indici scritti a mano nelle migrazioni, diversi dai nomi generati da Prisma | 31 vincoli, 7 indici | Cosmetica; nessun effetto funzionale |
| `TIMESTAMPTZ` nelle migrazioni contro `TIMESTAMP(3)` nello schema | Proposte, report, ricerca, budget e heartbeat runtime | Le migrazioni sono più corrette; allinearle convertirebbe colonne Production |
| Default `now()` su `updatedAt` presente solo nelle migrazioni | 4 tabelle | Innocuo: Prisma valorizza comunque il campo |
| `structuredReportId` `VARCHAR` contro `TEXT` e FK `ON DELETE` differente | `FascicoloOperationalProposal` | Le migrazioni sono più restrittive; non serve modificarle |

Non si deve usare `db push` né una migrazione di allineamento generata: le
modifiche di tipo sulle date non sono necessarie e alterebbero dati
autoritativi. Un eventuale allineamento dello schema Prisma alle migrazioni,
cioè `@db.Timestamptz` e `@map` dei nomi, è un intervento separato.

## Verifiche sulla revisione rilasciata

- `npx tsc --noEmit`: superato.
- `npx vitest run --maxWorkers=1`: 3.767 test superati; 10 saltati perché
  richiedono un PostgreSQL dedicato tramite variabile esplicita:
  - `fascicolo-operational-concurrency-postgres` (4), eseguito separatamente
    con `NOETRA_ISOLATED_PG_URL`: 4/4 superati;
  - `research-question-review-postgres` (1), eseguito separatamente con
    `NOETRA_GUIDED_E2E_PG_URL`: 1/1 superato;
  - `fascicolo-automatic-persistence.integration` (5), eseguito con
    `AUTOMATIC_FASCICOLO_DATABASE_URL`: 2 superati e 3 falliti con
    `TERMINAL_FAILED`. I tre fallimenti sono identici sul commit base `dc5732c`
    e quindi preesistenti. Riguardano la pipeline di analisi automatica, che
    resta disattivata.
- ESLint sui file modificati: 0 errori; 3 warning preesistenti per import
  inutilizzati in `src/app/procedimenti/[id]/page.tsx`.
- `npm run build` con database e segreti isolati: superato.
- `npm run test:e2e:guided-isolated` su database con tutte le migrazioni:
  5/5 scenari superati. Gli scenari coprono Porto Aurora fino al completamento
  persistente, un caso non portuale con riesame, un'attività condivisa, un
  procedimento concluso in riesame e una riconciliazione reversibile.

## Riconciliazione delle proposte esistenti

Non si esegue alcuna scrittura senza autorizzazione specifica.

1. Dopo il rilascio applicativo, un utente con ruolo di revisione apre la
   sezione **Proposte** del fascicolo. La pagina calcola in memoria
   l'anteprima con `previewOperationalProposalReconciliation`, rispettando il
   tenant canonico e i controlli di ruolo.
   La sezione Proposte non archivia snapshot e non scrive audit. L'unica
   scrittura automatica della pagina riguarda la sezione **Rapporto**.
2. L'anteprima mostra le proposte da conservare, accorpare o considerare
   superate, le attività nuove o condivise, le bozze collegate e un'impronta
   dell'anteprima.
3. L'applicazione richiede un'azione esplicita che ripresenta l'impronta: se i
   dati sono cambiati, viene rifiutata. Non elimina proposte né eventi di
   revisione. Registra uno stato di riconciliazione reversibile con ripristino
   compensativo.
4. Le cinque bozze di contestazione esistenti non vengono consolidate. Il
   collegamento legacy alle attività avviene solo in modo prudente e senza
   cancellazioni.

## Rilascio Production

`npm run deploy:production -- --expected-commit <SHA completo>`
utilizza `scripts/deploy/release-production.ts`. Lo script verifica identità
del progetto, configurazione del dominio, variabili richieste, worktree pulito,
presenza del commit sul remoto, target `production`, `readyState`, login sul
deployment staged e alias finale. Rifiuta inoltre i deployment Preview.

## Correzioni dopo il collaudo Production del 4 novembre 2026

Interventi applicativi validi per tutti i fascicoli. Non introducono schema,
migrazioni o scritture sui dati esistenti.

- **Analisi non aggiornata.** Il quadro è `CURRENT` solo se l'impronta del
  corpus della Knowledge coincide con quella dei documenti. La sezione Proposte
  indica quali documenti sono cambiati e offre un aggiornamento esplicito e
  auditato, disponibile solo con l'esecuzione provider abilitata.
  L'approvazione di proposte generate da un rapporto superato o da un'analisi
  non aggiornata è bloccata lato server. Attività, approvazioni e bozze restano
  nello storico.
- **Pagine e lacune.** Il rapporto distingue le pagine lette, le pagine del
  file prive di testo e le pagine dell'originale mancanti secondo la
  numerazione interna. Le pagine lette non sono più segnalate come lacune. La
  sezione «Copertura documentale» è presente nell'interfaccia, nel PDF e
  nell'RTF.
- **Catena documento → conclusione.** Se gli elementi collegati alla questione
  non contengono una prova, l'analisi cerca nella Knowledge del fascicolo gli
  elementi con lo stesso codice (I1, M4…) o con lo stesso presupposto.
  - Questi elementi restano «indicati» e non «provati».
  - La motivazione chiede di confermare il collegamento.
  - I termini come «entro il 30 settembre 2024» vengono riconosciuti.
- **Percorsi specifici.** Ogni profilo ha passaggi propri, ad esempio M4,
  investimenti, occupazioni e canoni. Le verifiche comuni degli atti di
  assenso sono condivise. Le iniziative non giustificate non diventano
  proposte approvabili e possono essere solo escluse con motivazione.
- **Norme.**
  - L'art. 10-bis L. 241/1990 è proposto solo nei procedimenti a istanza di
    parte.
  - Il D.I. 202/2022 è distinto per istituto e data.
  - Le misure ART sono valutate una per una.
  - Gli artt. 45-bis, 46 e 47 cod. nav. sono distinti.
  - L'assenza di un atto dal fascicolo non è trattata come prova della sua
    inesistenza.
- **Bozze.** La sezione Atti raggruppa le bozze per problematica e tipo di
  documento. Per i duplicati storici indica la bozza di riferimento, il
  confronto dei contenuti e un'ipotesi di riconciliazione non distruttiva.
  Nessuna bozza viene modificata.
- **Leggibilità.**
  - Il rapporto espone ogni questione in forma discorsiva: fatti, presupposti
    soddisfatti, non dimostrati e determinanti, conclusione senza ripetizioni.
  - Norme e avvertenze comuni compaiono una sola volta; il dettaglio resta
    espandibile.
  - In Proposte l'intestazione mostra prima il prossimo passo e l'atto
    corrispondente.

Dopo il rilascio i rapporti vanno rigenerati, cioè archiviati di nuovo, perché
l'impronta del contenuto cambia. Le cinque bozze M4 e la coda delle proposte
Selvara non vengono modificate.

## Ripristino del motore di analisi (4 novembre 2026)

### Cause accertate

- **Codice non allineato.** Dal 3 novembre Production eseguiva questo ramo,
  privo di 140 commit di `release/v7-integrated-services`. Mancavano:
  - la correzione P2010, cioè l'`INSERT` raw in `RuntimeCostReservation` senza
    `"updatedAt"`, che è NOT NULL;
  - il percorso manuale che legge `MANUAL_RESEARCH_EXECUTION_ENABLED`;
  - il concatenamento della ricerca dopo l'analisi.

  Il ramo integra ora `release/v7` (`cea3b6e`).
- **`AUTOMATIC_RESEARCH_POLICY_OR_SCOPE_INVALID`.** È l'esito corretto dei
  controlli. Con AUTOMAZIONE OFF, o con il procedimento fuori allowlist, la
  ricerca automatica è negata. L'esito ora riporta un codice specifico:
  automazione disattivata, tenant o procedimento non ammesso, configurazione
  incompleta.
- **Coda ferma.** Il job in coda dal 1° novembre è un `DOCUMENT_EXTRACTION_V1`
  di sistema relativo a `NOETRA_V7_COLLAUDO_INTEGRATO_DEMO.pdf` (1,9 KB),
  caricato in Selvara durante il collaudo V7. Il worker one-off delle 11:10 lo
  ha avviato con i filtri corretti ma non lo ha preso in carico. Il codice di
  presa in carico è identico a quello attuale e il predicato risulta oggi
  soddisfatto. Il worker leggeva quindi un database diverso: la guardia
  `EXPECTED_DATABASE_HOST_PREFIX` è stata introdotta la sera stessa e ora
  punta all'endpoint Production. Lo stato STOPPED è quello normale dei worker
  one-off (`EXIT_ON_IDLE`).
- **PDF canonico non estratto.** Il PDF Selvara di 40 pagine non ha alcun
  tentativo né alcun job di estrazione: l'ammissione avveniva solo nel vecchio
  `uploadService`. Il PDF non è difettoso. In un collaudo isolato
  sull'originale identico (SHA-256 `644e0433…`) le 40 pagine hanno testo
  diretto sufficiente, 45.975 caratteri, senza OCR. Le pagine fisiche 2–12
  riportano la numerazione interna 7–17: le pagine interne 1–6 mancano
  nell'originale e non sono un difetto di estrazione.

### Correzioni

- `runManualLegalAnalysisPipeline`, cioè il pulsante ADMIN+MFA in
  `/admin/runtime`, ammette prima un'estrazione locale per i documenti
  correnti mai estratti. L'estrazione non usa provider e non ha costo, e
  l'esito è `DOCUMENT_EXTRACTION_STARTED`. Una richiesta ripetuta non crea
  job duplicati: il conflitto di idempotenza vale come ammissione già
  avvenuta. Le estrazioni fallite non vengono ripetute senza permesso di
  ripetizione. Dopo l'estrazione si richiede di nuovo l'analisi.
- Stati espliciti delle missioni di ricerca: richiesta, in coda, in
  esecuzione, bloccata, fallita, completata senza risultati, con fonti da
  verificare, validata. Una missione senza avanzamento oltre la soglia è
  bloccata e non più «in corso».

### Verifiche sulla revisione integrata

- `tsc`: superato.
- `npm run test:ci`: 4.419 test superati, 0 falliti, 34 saltati. I test
  saltati sono 5 file Postgres attivati da variabile d'ambiente.
- ESLint sui 318 file modificati: nessun errore nuovo. I 28 errori presenti
  sono già in `release/v7`.
- `npm run build`: superato.
- E2E guidato su database isolato con 59 migrazioni: 5/5.
- Collaudo isolato del pulsante manuale su PostgreSQL:
  - prima richiesta: 1 job di estrazione;
  - seconda richiesta: nessun duplicato;
  - worker: `SUCCEEDED`, corpus `READY`, 40 pagine;
  - terza richiesta: rifiutata con `ANALYSIS_ACTIVATION_DISABLED`, come
    previsto senza provider AI.

### Collaudo isolato dell'intera catena giuridica

Script: `scripts/runtime/verify-legal-chain-isolated.ts`, solo su database
isolato (`noetra_legal_chain`, utente `noetra_test`) con il PDF canonico
Selvara. Il comando richiede il flag `--execute-isolated-legal-chain`. I
flag AUTOMATIC_* restano spenti e ogni host non simulato viene rifiutato.

Componenti simulati:
- OpenAI: risposta offline ancorata agli span realmente estratti;
- Moonlit: elenco fisso con L. 84/1994 e una decisione fittizia;
- Normattiva: ricerca, sessione e AKN dell'art. 18 L. 84/1994.

Il resto è codice applicativo reale: pipeline manuale, worker, Knowledge,
missioni, verifica ufficiale delle fonti, rapporto, proposte, attività e
atti.

Esito (run-09):
- documento ed estrazione: 40/40 pagine, 47.374 caratteri;
- Knowledge: 60 elementi, 144 collegamenti alle evidenze, 0 citazioni non
  valide;
- conferma professionale di 3 date di riferimento, con audit;
- 6 quesiti di ricerca, ciascuno eseguito una sola volta. La verifica sul
  testo ufficiale distingue articoli pertinenti, non pertinenti e fonti non
  verificabili, e solo le fonti verificate risultano utilizzabili;
- rapporto: 7 questioni e 7 percorsi operativi;
- 43 proposte;
- un'attività approvata con verifica dell'approvazione, presa in carico e
  bozza dell'atto da modello. Una seconda creazione riusa la stessa bozza;
- costi registrati e chiusi (`SETTLED`) per l'analisi e per ogni ricerca.

Difetti emersi e corretti:
- **Riesecuzione a pagamento.** Ogni nuova richiesta manuale rimetteva in
  coda le missioni già eseguite sulla stessa revisione e chiuse come
  incomplete (`RESEARCH_INCOMPLETE`). Si ripetevano così le stesse chiamate,
  e il sesto quesito, trattenuto dal limite del ciclo, non veniva mai
  eseguito.

  `reconcileKnowledgeResearchMissions` ora non rimette in coda una missione
  con un tentativo `DEFERRED` successivo al completamento della revisione
  corrente. Il posto liberato va al quesito trattenuto dal limite del ciclo.
  Una nuova revisione della Knowledge riabilita l'esecuzione.

  Collaudo sulle richieste successive:
  - seconda richiesta: 1 solo job, il sesto quesito;
  - terza richiesta: `NO_RESEARCH_TO_RUN`, 0 job.
- **Etichetta fuorviante.** Una missione eseguita ma incompleta appariva
  «non ammessa dalla policy». Ora appare come ricerca eseguita e incompleta,
  con fonti da verificare oppure senza fonti utilizzabili. Una missione non
  ancora eseguita appare in attesa di ammissione.

### Operazioni Production ancora da autorizzare

1. Decidere se archiviare `NOETRA_V7_COLLAUDO_INTEGRATO_DEMO.pdf` da Selvara
   prima dell'estrazione. Il job in coda verrebbe altrimenti eseguito dal
   primo worker di estrazione attivato per il fascicolo e il documento di
   prova entrerebbe nella Knowledge.
2. Facoltativo: ridistribuire il worker Render `srv-daoptbp42hec73fmquo0`
   dalla revisione rilasciata. Oggi i job one-off usano la build `9c4fa0c`,
   che contiene già la correzione P2010.
3. Estrazione del PDF canonico con il pulsante manuale: locale, senza costo.
4. Analisi AI del corpus: costo stimato `ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR`.
5. Ricerca reale con provider, entro i limiti di budget configurati.

AUTOMAZIONE resta OFF: `AUTOMATIC_RESEARCH_EXECUTION_ENABLED=false` e
`SERVER_AUTONOMOUS_RESEARCH_ENABLED` non attivato.
