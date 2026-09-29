# Attivazione staging del percorso automatico del fascicolo

Data di preparazione: 28 settembre 2026. Questo documento non autorizza
operazioni remote.

## Stato e perimetro

Il percorso applicativo e completo nel checkout:

`upload -> AsyncJob -> estrazione/OCR -> analisi corpus -> ResearchMission -> executor -> bundle persistito -> vista fascicolo`

L'upload ammette il job `NEUTRAL_INTAKE_EXTRACTION_V1` nella stessa transazione
applicativa. Il processo separato `npm run worker:async` reclama il job dal
database e registra anche gli handler `FASCICOLO.AUTOMATIC_ANALYSIS_V1` e
`LEGAL_RESEARCH.EXECUTE_V1`. La richiesta HTTP e il browser possono terminare:
lo stato e nel database, le lease sono persistenti e il worker non dipende dal
processo web.

Vercel ospita il processo Next.js, ma `next start` non avvia il worker e non
esiste nel repository un cron o un manifest che lo mantenga in esecuzione.
Serve quindi un servizio Node persistente separato, con la stessa release,
comando `npm run worker:async`, restart policy, una sola istanza iniziale e log
JSON raccolti. Una funzione Vercel legata a una richiesta HTTP non e un host
valido per questo processo.

## Migrazioni

Lo staging osservato il 27 settembre aveva applicate le migrazioni fino a
`20260920_patch_g2_concessione_expiry_generation`; risultava pendente
`20260926_assisted_verification_persistence`. Prima della nuova release servono,
nell'ordine del registro Prisma:

1. `20260926_assisted_verification_persistence`
2. `20260928_automatic_fascicolo_report`

La prima aggiunge snapshot append-only di verifica assistita e l'indice univoco
`ResearchMissionRecord(id, tenantId)`. La seconda aggiunge rapporto automatico,
legami ai documenti del corpus e legami alle missioni. Entrambe sono additive,
usano foreign key `RESTRICT` e non contengono cancellazioni o aggiornamenti di
dati applicativi. La seconda presuppone le tabelle di estrazione, ricerca e
missioni gia presenti nella release staging.

La prova su clone della prima migrazione e gia disponibile. L'intera storia,
inclusa la seconda, e stata applicata soltanto al PostgreSQL sintetico locale.
Prima dello staging occorre una nuova prova su clone della sequenza completa e
un diff post-migrazione. Restano da riesaminare i tre drift nominali storici
registrati in `staging-preparation/README.md`; non applicare il file diagnostico
`remote-schema-diff.sql` come migrazione.

Rollback applicativo: arrestare il worker, disabilitare le policy e riportare
l'alias staging al deployment precedente verificato. Le nuove tabelle e righe
restano nel database. Non eseguire down migration, `DROP`, `DELETE`, reset o
ripristini automatici. Il vecchio codice e compatibile con strutture additive;
questa compatibilita va riconfermata sul clone con entrambe le migrazioni.

## Configurazione server

Gia documentate in `.env.example` prima di questa preparazione:

- database: `DATABASE_URL`;
- upload: `DOCUMENT_MAX_FILE_MB`;
- storage: `DOCUMENT_STORAGE_BACKEND`, `DOCUMENT_STORAGE_ROOT`, `S3_ENDPOINT`,
  `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_FORCE_PATH_STYLE`;
- autenticazione MCP applicativa: `WORKOS_AUTHKIT_ISSUER`, `WORKOS_API_KEY`,
  `MCP_RESOURCE_URI`, `MCP_FASCICOLO_GRANT_SECRET`,
  `MCP_FASCICOLO_GRANT_TTL_SECONDS`.

Aggiunte a `.env.example` per il percorso automatico:

- worker: `ASYNC_WORKER_ID`, `ASYNC_WORKER_IDLE_BACKOFF_MS`,
  `ASYNC_WORKER_ERROR_BACKOFF_MS`, `ASYNC_WORKER_RETRY_DELAY_MS`,
  `ASYNC_WORKER_OPERATION_ALLOWLIST`, `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST`;
- analisi AI: `AI_REAL_DATA_ENABLED`, `AI_REAL_DATA_APPROVAL_ID`,
  `AI_PROVIDER_PROJECT_CLASS`, `AI_OPENAI_API_KEY`, `AI_OPENAI_REGION`,
  `AI_OPENAI_TIMEOUT_MS`, `AI_OPENAI_MAX_RAW_RESPONSE_BYTES`,
  `AI_OPENAI_MAX_OUTPUT_TOKENS`, `AI_MAX_INPUT_BYTES`;
- ricerca automatica: `AUTOMATIC_RESEARCH_EXECUTION_ENABLED`,
  `AUTOMATIC_RESEARCH_TENANT_ALLOWLIST`,
  `AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST`,
  `AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES`, `AUTOMATIC_RESEARCH_MAX_CALLS`,
  `AUTOMATIC_RESEARCH_WORKER_ACTOR_ID`, `AUTOMATIC_RESEARCH_LEASE_MS`,
  `AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS`;
- provider: `LEGAL_DATA_HUNTER_API_KEY`, `MOONLIT_OAUTH_STORAGE_PATH`,
  `SIMPLICITER_OAUTH_STORAGE_PATH`.

OCR e parsing PDF usano le dipendenze incluse nella release (`tesseract.js`,
dati italiani e `pdfjs-dist`): non leggono credenziali o variabili OCR.
`DIRECT_URL` e utile agli strumenti operativi gia preparati, ma Prisma in questo
checkout legge `DATABASE_URL`; non e una dipendenza del runtime applicativo.

La presenza remota delle variabili sensitive non ne prova il valore o lo scope.
Sono da verificare live: database effettivamente staging, bucket isolato,
permessi S3, chiave AI e progetto approvato, entitlement provider, log del
worker e file OAuth montati. I file `.local-storage/moonlit/oauth.json` e
`.local-storage/simpliciter/oauth.json` del computer non sono disponibili sul
server. Il worker accetta ora percorsi server espliciti, ma il servizio di host
deve fornire file protetti e persistenti. Non esegue login interattivi.

## Canary su un solo fascicolo

1. Creare e identificare un nuovo procedimento sintetico vuoto nello staging.
   Non riusare un procedimento o una missione esistente.
2. Distribuire il web con `AUTOMATIC_RESEARCH_EXECUTION_ENABLED=false` e senza
   avviare il worker. Verificare release, schema, database e storage.
3. Configurare nel servizio worker un ID univoco; limitare
   `ASYNC_WORKER_OPERATION_ALLOWLIST` alle sole operazioni
   `NEUTRAL_INTAKE_EXTRACTION_V1`, `FASCICOLO.AUTOMATIC_ANALYSIS_V1` e
   `LEGAL_RESEARCH.EXECUTE_V1`; impostare
   `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST` al solo procedimento sintetico.
4. Limitare ricerca allo stesso tenant e allo stesso procedimento tramite le
   due allowlist `AUTOMATIC_RESEARCH_*`. Autorizzare soltanto la capability
   richiesta dal canary. La policy viene verificata prima dell'ammissione e
   nuovamente prima del claim della missione.
5. Impostare il massimo per missione senza superare il budget incorporato nella
   missione. Il codice genera al massimo cinque missioni con massimo sei
   chiamate ciascuna: tetto complessivo del canary, nel caso peggiore, 30
   chiamate provider e una chiamata AI per analisi. Imporre inoltre nel progetto
   AI e negli account provider un hard cap monetario autorizzato: il codice non
   dispone oggi di un limite espresso in valuta.
6. Avviare una sola istanza persistente del worker. I filtri sono applicati
   nella query atomica di claim: job di altri fascicoli restano intatti. La
   riconciliazione non ammette missioni di altri procedimenti.

Ogni job di ricerca ha `maxAttempts=1`. Timeout, risposta persa o esito incerto
non provocano una seconda chiamata o un secondo submit; lo stato diventa
terminale e richiede riconciliazione manuale. Non riavviare alla cieca.

Disattivazione ordinaria: inviare `SIGTERM` al worker, attendere la conclusione
dell'iterazione attiva, lasciare il servizio a zero istanze e mantenere
`AUTOMATIC_RESEARCH_EXECUTION_ENABLED=false`. Per impedire anche nuove analisi,
mantenere `AI_REAL_DATA_ENABLED=false`. Le variabili modificate richiedono un
nuovo processo per diventare effettive. Non cancellare job, rapporti, missioni o
bundle gia persistiti.

## Prova di accettazione successiva

La prova live, da autorizzare separatamente, deve usare soltanto documenti e
identita sintetici:

1. Acquisire nei log del servizio persistente l'evento
   `ASYNC_WORKER_STARTED`, il suo `ASYNC_WORKER_ID` e l'identita della release.
2. Caricare dal runtime staging almeno due documenti sintetici nel procedimento
   autorizzato, senza inserire un quesito manuale.
3. Osservare nel database staging, senza mutazioni diagnostiche, la successione
   dei tre job ammessi e completati e l'assenza di claim fuori allowlist.
4. Verificare il corpus aggiornato, il rapporto, i quesiti generati, una sola
   esecuzione per missione, la contabilizzazione delle chiamate e i bundle.
5. Aprire il fascicolo sul deployment staging e verificare fonti, date, stato
   executor e requisiti professionali ancora aperti.
6. Arrestare il worker e provare che un ulteriore upload resta accodato; quindi
   riavviare il solo servizio hosting e provare la ripresa dal database. Nessun
   runner locale deve essere attivo durante la prova.

## Operazioni live da autorizzare

- creare un recovery point corrente e un clone del solo branch staging;
- provare sul clone entrambe le migrazioni e la compatibilita col vecchio client;
- verificare senza esporre segreti database, bucket, file OAuth e hard cap costi;
- applicare le due migrazioni allo staging;
- distribuire web e servizio worker dalla stessa release;
- creare il procedimento sintetico e configurare le allowlist esatte;
- avviare una sola istanza worker ed eseguire la prova di accettazione;
- in caso di esito positivo, mantenere il canary oppure autorizzare separatamente
  qualsiasi ampliamento. Nessuna allowlist va rimossa implicitamente.