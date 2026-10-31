# Selvara V7 - Protocollo di collaudo AI reale controllato

Stato: **DISABILITATO - NON AUTORIZZATO ALL'ESECUZIONE**

Questo protocollo prepara un solo collaudo reale sul fascicolo Selvara. Non abilita
provider, non ammette job, non esegue missioni e non autorizza modifiche a Production.

## Ambito immutabile

- Ambiente: Preview/Staging Selvara, mai Production.
- Tenant: `cmrzd08yp000dqwudd9dvaidl`.
- Procedimento: `procedimento-intake-9e04f4d4cdbf092845b57c66`.
- Missione: `research-mission:c0cf02cb6dfdd5ff5eab8c0bfac2817ad7a63149b6df8bc51129fe50a06d59e6`.
- Corpus: fingerprint
  `c9f04d508174cba8e7939704da11921963c60656660df988ee4cb5fdd25cdd5f`.
- Approvazione predisposta, ma non concessa:
  `NOETRA-V7-SELVARA-2026-10-29-CONTROLLED-ONE-SHOT-08`.
- Operazione AI: `FASCICOLO.AUTOMATIC_ANALYSIS_V1`, un solo job con
  `maxAttempts=1`.

Ogni difformita di tenant, procedimento, missione, corpus, attore autenticato,
approvazione, provider o commit interrompe il collaudo prima di una chiamata esterna.

## Gate iniziali

Fino all'autorizzazione esplicita immediatamente precedente al collaudo devono restare:

```text
AI_REAL_DATA_ENABLED=false
ASYNC_PROVIDER_EXECUTION_ENABLED=false
AUTOMATIC_RESEARCH_EXECUTION_ENABLED=false
DOCUMENT_WORKER_ACTIVATION_MODE=DISABLED
```

Sono inoltre obbligatori:

1. Preview e worker sullo stesso commit approvato.
2. Database e storage non-production identificati.
3. Identita, tenant, procedimento, missione e corpus verificati in sola lettura.
4. Nessun job precedente claimable per la stessa approvazione.
5. Preflight V7 positivo eseguito con
   `npm run runtime:verify-v7-one-shot-08-preflight`.
6. Budget GLOBAL, TENANT e PROCEDIMENTO capienti per l'intero massimo riservato.
7. Inventario del pack locale eseguito con `npm run legal:audit:adsp-mtc`.
   Un corpus locale incompleto deve essere dichiarato e non puo essere presentato come
   verifica ufficiale delle fonti mancanti.
8. Nuova autorizzazione esplicita dell'utente che riporti approvazione, limiti e
   commit esatti.

## Limiti inderogabili

- Chiamate AI di analisi: massimo **1**.
- Tentativi del job AI: massimo **1**, senza retry automatici o manuali.
- Missioni di ricerca eseguite: massimo **1**, esclusivamente quella indicata sopra.
- Richieste a provider di ricerca: massimo **6** complessive.
- Acquisizioni read-only di fonti ufficiali: massimo **12**.
- Budget complessivo: massimo **EUR 2,00**, inclusi analisi e ricerca.
- Il massimo calcolato dal preflight e tutte le riserve runtime devono essere minori
  o uguali al tetto complessivo. In caso contrario non si esegue il collaudo.
- Timeout, rate limit, risposta incompleta o uso non contabilizzabile sono terminali:
  il costo massimo riservato viene considerato consumato e non si ritenta.

## Sequenza autorizzabile

1. Catturare in sola lettura commit, deployment, database, attore pseudonimizzato,
   tenant, procedimento, missione, corpus e budget disponibili.
2. Eseguire il preflight economico e conservare fingerprint, modello, limiti token,
   massimo EUR, tasso di cambio e data della tariffa.
3. Abilitare soltanto il processo one-shot e la sua allowlist esatta. La ricerca
   automatica generale resta disabilitata.
4. Ammettere una volta il job AI vincolato all'approvazione e osservarlo fino a
   `SUCCEEDED` o `TERMINAL_FAILED`.
5. Verificare acquisizione dei documenti, questioni giuridiche, riferimenti temporali,
   affermazioni supportate, evidenze persistite e rapporto strutturato.
6. Solo se il risultato AI e valido, autorizzare nel medesimo budget la singola
   missione di ricerca gia esistente. Non creare o eseguire altre missioni.
7. Verificare per ogni conclusione rilevante almeno una fonte ufficiale, la data di
   efficacia, eventuali fonti contrarie e la distinzione tra fatto, regola e inferenza.
8. Verificare che evidenze, relazioni, revisione e rapporto appartengano al tenant e
   al fascicolo autorizzati e che il rapporto derivi dalla revisione verificata.
9. Disabilitare immediatamente tutti i gate, arrestare il worker one-shot e
   riconciliare chiamate, token, costi e artefatti.

## Arresto immediato

Arrestare senza retry in caso di:

- mismatch di identita, tenant, fascicolo, missione, corpus, approvazione o commit;
- accesso a Production o a un provider/progetto non approvato;
- superamento di chiamate, token, tempo o budget;
- mutazione non prevista, nuova missione o riassegnazione;
- fonte non verificabile presentata come ufficiale;
- assenza di fonti contrarie quando la conclusione le richiede;
- incongruenza temporale delle norme;
- persistenza parziale, isolamento tenant non dimostrato o rapporto non tracciabile;
- segreto o dato personale esposto nei log.

## Criteri di superamento

Il collaudo e superato solo se una prova persistita dimostra congiuntamente:

1. corpus autenticato e completo per i documenti Selvara autorizzati;
2. questioni giuridiche pertinenti e motivate;
3. ricerca normativa e giurisprudenziale tracciabile;
4. fonti ufficiali e contrarie verificate, con validita temporale esplicita;
5. conclusioni collegate puntualmente a evidenze e limiti dichiarati;
6. revisione umana obbligatoria e nessuna decisione automatica;
7. isolamento tenant e autorizzazioni invariati;
8. rapporto consultabile/esportabile derivato dalla revisione verificata;
9. una sola analisi, una sola missione, limiti rispettati e costo riconciliato;
10. gate nuovamente disabilitati al termine.

Qualunque requisito non dimostrato produce esito **FAIL/INCONCLUDENTE**, non un
successo parziale.

## Evidenze e chiusura

Conservare identificativi pseudonimizzati, timestamp, request ID, fingerprint,
contatori chiamate/token, costo riservato e consuntivo, fonti con URL e data di
accesso, esito dei controlli di qualita, ID revisione e rapporto. Non conservare
segreti, token o contenuti di autenticazione.

Il rollback operativo consiste nel ripristino dei gate disabilitati, arresto del
worker e conservazione immutata degli artefatti diagnostici. Non eliminare risultati,
missioni o ledger di costo per mascherare un fallimento.
