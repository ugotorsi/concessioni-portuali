# NOETRA multi-AI: qualificazione sintetica

Data: 2026-11-05  
Issue: [#70](https://github.com/ugotorsi/concessioni-portuali/issues/70)

## Perimetro

La qualificazione usa esclusivamente dati sintetici, chiavi fittizie e trasporti
iniettati. Non esegue chiamate ai provider, non legge credenziali configurate e
non modifica database, variabili di ambiente, pricing approvato o gate runtime.

OpenAI resta il provider principale. Anthropic e DeepSeek conservano:

- `technicalQualificationApproved: false`;
- `realDataApproved: false`;
- `automaticExecutionApproved: false`;
- `pricingVersion: null`.

## Esito

| Controllo | Claude Sonnet 5 | DeepSeek V4 Pro | Note |
|---|---|---|---|
| Trasporto simulato, zero rete provider | PASS | PASS | Sono accettati solo transport iniettati nei test. |
| Contratto JSON NOETRA | PASS | PASS | Anthropic usa JSON Schema strict; DeepSeek JSON object con schema nelle istruzioni. |
| JSON malformato o campi extra | PASS | PASS | Output respinto. |
| Riferimenti pagina forniti | PASS | PASS | I `basisRefs` top-level sono confrontati con le pagine inviate. |
| Evidence span sconosciuto | PASS | PASS | L'item viene quarantinato e il risultato non e promovibile. |
| Citazioni canoniche | PASS | PASS | Le quote sono ricostruite dal server dagli evidence span autenticati. |
| Non-fabbricazione semantica del modello reale | NOT TESTED | NOT TESTED | Richiede il successivo test generativo sintetico autorizzato. |
| Prompt injection nel documento | PASS | PASS | Il testo resta tra delimitatori untrusted e non altera il payload simulato. |
| Limite input e risposta | PASS | PASS | Input eccessivo bloccato prima del transport; risposta eccessiva respinta. |
| Timeout, 4xx, 5xx, rate limit | PASS | PASS | Errore tipizzato, una sola chiamata. |
| Retry o fallback automatico | PASS | PASS | Nessun retry e nessun secondo provider. |
| Metering input/output/cache | PASS | PASS | Normalizzazione e contabilizzazione verificate. |
| Metering assente o incoerente | PASS | PASS | Fail-closed. |
| Pricing assente o costo oltre cap | PASS | PASS | Fail-closed. |
| Pricing ufficiale di riferimento | PASS | PASS | Versionato ma non approvato e non collegato al catalogo runtime. |
| Privacy per fascicoli reali | NOT TESTED | FAIL | Entrambi restano bloccati; DeepSeek presenta blocker documentali. |
| Generazione live | NOT TESTED | NOT TESTED | Richiede autorizzazione separata. |

## Correzioni prodotte dalla qualificazione

1. Il servizio di analisi ora rifiuta `basisRefs` top-level non presenti negli
   estratti forniti.
2. Il metering Anthropic somma `input_tokens`,
   `cache_read_input_tokens` e `cache_creation_input_tokens` nel totale input
   logico richiesto dal contratto contabile NOETRA. I tre componenti restano
   separati per la tariffazione.

## Catalogo economico non approvato

Versione: `MULTI_AI_PRICING_REFERENCE_2026_11_05`  
Valuta: USD per 1 milione di token.  
Tasso USD/EUR: non impostato.  
Stato: `REFERENCE_ONLY_UNAPPROVED`.

### Anthropic

Fonte ufficiale consultata il 2026-11-05:
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).

| Voce | USD / MTok |
|---|---:|
| Input | 2.00 |
| Output | 10.00 |
| Cache hit/refresh | 0.20 |
| Cache write 5 minuti | 2.50 |
| Cache write 1 ora | 4.00 |

Il preventivo sintetico usa prudenzialmente 4 USD/MTok per ogni cache write.
La generazione/tokenizzazione specifica di Sonnet 5 deve ancora essere
confermata prima dell'approvazione economica.

### DeepSeek

Fonte ufficiale consultata il 2026-11-05:
[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/).

| Voce | Off-peak USD / MTok | Peak USD / MTok |
|---|---:|---:|
| Input cache miss | 0.66 | 1.32 |
| Input cache hit | 0.022 | 0.044 |
| Output | 1.98 | 3.96 |

Il preventivo usa sempre le tariffe peak. Le finestre dichiarate sono
01:00-04:00 e 06:00-10:00 UTC nei giorni feriali, escluse le festivita
cinesi. La tariffa e una fotografia datata e deve essere ricontrollata prima
di ogni approvazione.

## Privacy Anthropic API

Stato complessivo: **NOT TESTED / real data BLOCKED**.

PASS documentali:

- DPA e SCC incorporati nei Commercial Terms;
- retention API standard entro 30 giorni, con eccezioni documentate;
- input/output commercial API non usati per training per default.

Blocker:

- stato ZDR dell'organizzazione non verificato;
- storage diretto negli Stati Uniti e TIA EU-US non approvata;
- lista subprocessori e localizzazioni non acquisita;
- eventuale disciplina "Covered Model" per Sonnet 5 non verificata;
- base giuridica, informativa, segreto professionale e procedure NOETRA non
  approvate.

Fonti:

- [DPA article](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa)
- [Data Processing Addendum](https://www.anthropic.com/legal/data-processing-addendum)
- [Retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- [Zero Data Retention](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)
- [Training](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)
- [Server location](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)
- [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- [Subprocessors](https://trust.anthropic.com/subprocessors)

## Privacy DeepSeek Open Platform API

Stato complessivo: **FAIL / real data BLOCKED**.

Blocker:

- la Privacy Policy esclude espressamente i dati personali degli utenti
  downstream dall'ambito coperto per l'Open Platform;
- nessun DPA, SCC, garanzia art. 46 GDPR o TIA applicabile ai payload API e
  stato verificato;
- retention, esclusione dal training, hosting e subprocessori dei payload API
  downstream non sono documentati;
- ruoli e obblighi contrattuali per i fascicoli NOETRA richiedono un accordo
  enterprise scritto.

Il provvedimento del Garante n. 33 del 30 gennaio 2025 riguarda il servizio
DeepSeek in termini ampi, su fatti relativi al servizio consumer. Non contiene
un'esplicita inclusione o esclusione dell'Open Platform API. L'ambito API resta
quindi una questione legale non risolta; il blocco privacy autonomo rende
comunque vietato l'invio di fascicoli reali.

Fonti:

- [Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)
- [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [Garante docweb 10098477](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10098477)

## Validazione

- test mirati: 41/41 PASS;
- suite completa: 348 file PASS, 4.499 test PASS;
- skip attesi: 5 file, 34 test;
- lint delle modifiche, error-level: PASS;
- TypeScript typecheck: PASS;
- build Production locale con segreto NextAuth effimero: PASS.

## Live test sintetico autorizzato: percorso operativo

L'autorizzazione registrata nella issue #70 consente esclusivamente:

- una richiesta a `claude-sonnet-5`;
- una richiesta a `deepseek-v4-pro`;
- fascicolo completamente inventato `SYN-001`;
- massimo 4.000 token input e 1.000 output per richiesta;
- budget cumulativo massimo 5 USD;
- nessun retry, fallback, tool, ricerca, documento o dato reale.

Il primo preflight del 6 novembre 2026 non ha eseguito chiamate perche
`vercel env run` non rendeva disponibili localmente i Secret Production. Le
chiavi non devono essere estratte, visualizzate, scaricate o copiate.

### Architettura temporanea

Il nuovo harness e raggiungibile soltanto quando tutte le seguenti condizioni
sono vere:

1. target Vercel `production`, necessario solo per rendere disponibili i
   Secret gia custoditi nel progetto;
2. deployment creato con `--skip-domain`, senza promozione o alias verso
   `app.noetra.it`;
3. alias temporaneo dedicato `*.vercel.app`, passato sia come `NEXTAUTH_URL`
   sia come `NOETRA_LIVE_QUALIFICATION_HOST`;
4. `NOETRA_LIVE_QUALIFICATION_ENABLED=true`;
5. authorization ID esatto `GH_ISSUE_70_2026_11_05`;
6. branch esatto `qualification/multi-ai-synthetic-20261105`;
7. commit Vercel uguale al commit esplicitamente atteso;
8. Vercel Deployment Protection attiva;
9. risorsa Upstash dedicata alla sola issue #70, diversa dallo store di rate
   limit Production;
10. sessione applicativa ADMIN gia MFA-ready e MFA verificata;
11. token CSRF HMAC legato ad amministratore, host, cookie HttpOnly e scadenza.

Quando il flag temporaneo e attivo, il middleware consente esclusivamente:

- login, logout e soli endpoint Auth.js necessari a Credentials/JWT;
- `/admin/ai-live-qualification`;
- `/api/admin/ai-live-qualification`;
- asset statici Next.js.

Dashboard, procedimenti, documenti, report e tutte le altre API applicative
restituiscono 404 sul deployment temporaneo. L'harness non importa Prisma,
repository, query di fascicolo, storage documentale o worker. L'unico accesso
applicativo ammesso e il piano di autenticazione necessario a verificare ADMIN
e MFA. Enrollment MFA, password recovery, WorkOS e ogni richiesta con header
`Next-Action` sono bloccati, inclusa l'invocazione diretta di Server Actions
attraverso una route altrimenti ammessa.

### Database di autenticazione condiviso

Il deployment non e fisicamente isolato dal database Production. Poiche usa il
target Vercel `production`, Auth.js riceve il `DATABASE_URL` Production del
progetto `concessioni-portuali-demo`. Il preflight dichiara quindi
esplicitamente `SHARED_PRODUCTION_DATABASE`.

Accessi necessari e verificati nel codice:

- login: lettura della riga `User` per email, password hash, ruolo, lockout e
  stato/segreto MFA;
- password errata: aggiornamento di tentativi falliti, ultimo errore ed
  eventuale lockout;
- login riuscito: azzeramento lockout/tentativi e aggiornamento `lastLoginAt`;
- validazione di ogni sessione: lettura `User` per stato attivo, ruolo, lockout,
  MFA e versione password;
- login, logout, successo/fallimento MFA: scrittura della catena `ActivityLog`.

Non sono effettuate letture di fascicoli, tenant, concessioni, documenti,
report o storage. L'enrollment MFA e escluso dall'allowlist, quindi il
deployment richiede un ADMIN gia configurato e non modifica segreto o recovery
code MFA. Questa dipendenza auth Production e un rischio residuo esplicito:
credenziali errate o un login riuscito producono le normali scritture auth e
audit Production.

### Concorrenza, duplicati e replay

Vercel puo eseguire piu istanze concorrenti e non offre un limite
`maxInstances` per funzione. Un lock in memoria non e quindi sufficiente.

Prima di qualunque POST provider, l'harness esegue un `SET ... NX` atomico in
una risorsa Upstash dedicata esclusivamente alla issue #70, usando il namespace
fisso:

`noetra:qualification:issue70:2026-11-05`

Il lock non ha TTL: una prenotazione, anche se il processo termina, impedisce
replay e recuperi automatici. Sono inoltre prenotati separatamente Anthropic e
DeepSeek prima del rispettivo POST. Nessun codice enumera o legge namespace
applicativi. Nel ledger sono salvati solo stato, modello, validita JSON,
validita riferimenti, token, costo stimato e anomalia redatta; mai chiavi,
prompt o risposta integrale.

Il preflight richiede
`NOETRA_LIVE_QUALIFICATION_REDIS_REST_URL` e
`NOETRA_LIVE_QUALIFICATION_REDIS_REST_TOKEN`, oltre al resource ID non segreto
`NOETRA_LIVE_QUALIFICATION_REDIS_RESOURCE_ID`, e rifiuta l'avvio se l'URL
coincide con `UPSTASH_REDIS_REST_URL` o `KV_REST_API_URL`. Il riuso dello
store Production avrebbe rischi di collisione operativa, cancellazione
accidentale e privilegi condivisi; non e piu consentito. La risorsa dedicata
deve essere collegata tramite integrazione Vercel/Shared Environment Variable
senza leggere o copiare il token. La sua configurazione richiede
un'autorizzazione operativa separata e non viene eseguita da questa PR.

### Contratto e preflight economico

Il contratto documentale V7 completo supera 35 KB prima dei dati e non e
compatibile con il limite autorizzato di 4.000 token. Il live test usa quindi
il contratto compatto `ai-fascicolo-analysis/v1`, gia condiviso dagli adapter,
con grounding limitato a `SYN.P1` e `SYN.P2`.

Il preflight conta schema, istruzioni e input con `o200k_base` e aggiunge 1.024
token di overhead prudenziale. Il POST e bloccato se la stima supera 4.000.
L'uso restituito dal provider deve inoltre essere presente, coerente e non
superare 4.000 input / 1.000 output.

Preventivo massimo:

| Provider | Criterio prudenziale | Massimo USD |
|---|---|---:|
| Claude Sonnet 5 | input/cache-write maggiore e output ufficiale | 0,026000 |
| DeepSeek V4 Pro | tariffa peak, cache miss e output | 0,009240 |
| Totale | somma | 0,035240 |

Il costo consuntivo e calcolato dai contatori provider con il catalogo di
riferimento versionato. Resta una stima tecnica distinta dalla fattura
definitiva.

### Sequenza di deployment futura

Non eseguire questa sequenza finche il commit non e stato revisionato, committato
e pubblicato sulla PR #71.

1. Annotare deployment ID attualmente servito da `app.noetra.it`.
2. Verificare che Vercel Authentication protegga i deployment Production non
   promossi del progetto.
3. Creare o collegare una risorsa Upstash dedicata con il prefisso
   `NOETRA_LIVE_QUALIFICATION_REDIS_REST_`, verificando dal pannello Vercel che
   non sia la risorsa rate-limit Production. Non estrarre il token.
4. Scegliere un alias temporaneo Vercel dedicato, per esempio
   `concessioni-portuali-demo-issue70.vercel.app`.
5. Dal worktree pulito della PR #71 eseguire un deployment Production non
   promosso, passando soltanto valori non segreti per i flag temporanei:

```powershell
vercel deploy --prod --skip-domain --yes `
  --project=prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu `
  --scope=ugotorsis-projects `
  -b NOETRA_LIVE_QUALIFICATION_ENABLED=true `
  -b NOETRA_LIVE_QUALIFICATION_AUTHORIZATION_ID=GH_ISSUE_70_2026_11_05 `
  -b NOETRA_LIVE_QUALIFICATION_HOST=concessioni-portuali-demo-issue70.vercel.app `
  -b NOETRA_LIVE_QUALIFICATION_EXPECTED_COMMIT=<COMMIT_PR_71> `
  -b NEXTAUTH_URL=https://concessioni-portuali-demo-issue70.vercel.app `
  -e NOETRA_LIVE_QUALIFICATION_ENABLED=true `
  -e NOETRA_LIVE_QUALIFICATION_AUTHORIZATION_ID=GH_ISSUE_70_2026_11_05 `
  -e NOETRA_LIVE_QUALIFICATION_HOST=concessioni-portuali-demo-issue70.vercel.app `
  -e NOETRA_LIVE_QUALIFICATION_EXPECTED_COMMIT=<COMMIT_PR_71> `
  -e NOETRA_LIVE_QUALIFICATION_REDIS_RESOURCE_ID=<RESOURCE_ID_DEDICATO> `
  -e NEXTAUTH_URL=https://concessioni-portuali-demo-issue70.vercel.app
```

I flag CLI `-b` e `-e` sono override build/runtime del singolo deployment e
assicurano che anche il middleware usi l'allowlist. In particolare,
`-e NEXTAUTH_URL=...` non modifica la variabile Production globale:
non usare `vercel env add`, `vercel env update` o il pannello Environment
Variables per `NEXTAUTH_URL`. Prima e dopo il deploy, acquisire via API Vercel
l'ID/versione della variabile Production globale e verificare che sia
invariata; ispezionare inoltre il deployment e verificare che il suo override
sia l'alias temporaneo.

6. Prima di assegnare l'alias, verificare che una richiesta anonima all'URL
   generato sia bloccata dalla Deployment Protection. Se risponde la pagina
   applicativa, eliminare il deployment e fermarsi.
7. Verificare nuovamente che `app.noetra.it` punti ancora al deployment
   annotato al punto 1.
8. Assegnare esclusivamente l'alias temporaneo:

```powershell
vercel alias set <URL_DEPLOYMENT> concessioni-portuali-demo-issue70.vercel.app `
  --scope=ugotorsis-projects
```

9. Verificare in forma anonima che `/login` sia protetto e, con accesso Vercel
   autorizzato, che `/dashboard`, `/documenti`, `/procedimenti` e una API dati
   restituiscano 404. Inviare anche un POST con header `Next-Action` alla pagina
   harness e verificare 404.
10. Accedere all'alias temporaneo come ADMIN gia MFA-ready, completare il login
   MFA e aprire
   `/admin/ai-live-qualification`.
11. Controllare che il preflight dichiari database auth Production condiviso,
    store lock dedicato, ledger `READY`, token e costo massimo; digitare
    `ESEGUI DUE TEST SYN-001` una sola volta.

### Esecuzione e registrazione

La route esegue prima Anthropic. Se qualsiasi controllo fallisce, DeepSeek
resta `NOT_TESTED` e non viene tentato. Ogni adapter ha una sola invocazione
`fetch`, timeout 45 secondi, risposta massima 128 KiB, nessun retry e nessun
fallback.

Il risultato redatto restituito dalla route e persistito nel ledger e mostra:

- PASS, FAIL o NOT_TESTED;
- modello verificato dall'adapter;
- validita JSON;
- grounding esclusivo `SYN.P1` / `SYN.P2`;
- input, cache read/write e output token;
- costo USD stimato;
- anomalia normalizzata.

Il rapporto deve essere copiato nella issue #70 distinguendo chiamate
effettivamente inviate da provider non tentati.

### Disattivazione obbligatoria

Subito dopo la registrazione:

1. rimuovere l'alias temporaneo con `vercel alias remove`;
2. eliminare il deployment temporaneo;
3. verificare che l'alias non risolva piu;
4. verificare ancora che `app.noetra.it` punti al deployment originario;
5. lasciare il ledger permanente come blocco replay e prova redatta;
6. non promuovere, unire o riusare l'harness per fascicoli reali.

La presenza delle chiavi o un eventuale PASS non modifica
`technicalQualificationApproved`, `realDataApproved`,
`automaticExecutionApproved`, `pricingVersion`, i controlli manuali o il
provider automatico.
