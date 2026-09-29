# Lotto 8 Acceptance Report

## 1. Mandato
Il Lotto 8 rende operativa la coda applicativa con processo persistente, concorrenza multi-fascicolo, controllo monetario, health/queue, migrazione additiva e readiness di staging. Non introduce logica giuridica o professionale.

## 2. Perimetro autorizzato
Tutto il lavoro e le verifiche sono stati eseguiti in `C:\Users\ugoto\AppData\Local\Temp\concessioni-trusted-release-d252788`. Nessun commit, push, deploy, provider reale, database remoto o test AI reale è stato eseguito.

## 3. Baseline e storia
Baseline dichiarata: `bbd3a92da0b82431bd88d7c69f3fed912b509828`. Il worktree conteneva modifiche dei Lotti 1-7, preservate. La regressione di fingerprint storico scoperta dalla suite completa è stata corretta e il valore V1 fisso è nuovamente identico.

## 4. Architettura
Il runtime riusa `AsyncJob`, il registry applicativo e le primitive di lease/retry esistenti. Non esiste un secondo motore di coda.

## 5. Processo persistente
`npm run worker:async` avvia un processo separato da Next.js. Startup, bootstrap, esecuzione, drain, teardown e failure reporting sono espliciti.

## 6. Configurazione
Concorrenza, backoff, retry base, allowlist operative e di procedimento, provider mode e stime monetarie sono validate fail-closed. La concorrenza ammessa è 1-32.

## 7. Lane concorrenti
Ogni processo crea lane indipendenti con worker ID distinti. Il default resta una lane; il drain attende i job attivi e non apre nuovi claim dopo shutdown.

## 8. Claim atomico
Il claim usa `FOR UPDATE SKIP LOCKED`, lease token e transizione atomica. Il registry resta l’unico dispatch authority.

## 9. Multi-fascicolo
`procedimentoId` è scope diretto del job. Fascicoli diversi possono avanzare in parallelo; una subquery esclude un secondo lease vivo sullo stesso procedimento.

## 10. Priorità e aging
Le priorità `HIGH`, `NORMAL`, `LOW` sono ordinate con aging, evitando che il lavoro meno prioritario resti indefinitamente escluso.

## 11. Dipendenze
`dependsOnJobId` consente il claim solo dopo successo del parent. Un parent terminale produce `DEPENDENCY_TERMINAL_FAILURE` visibile agli operatori.

## 12. Lease e heartbeat job
Owner, token, scadenza e heartbeat proteggono ogni mutazione. Lease scadute sono recuperabili senza duplicare l’autorità di scrittura.

## 13. Retry
I failure retryable usano backoff esponenziale limitato a 24 ore. I failure non retryable diventano terminali; il conteggio tentativi non viene azzerato.

## 14. Cancellazione
La cancellazione è cooperativa, vince le race osservabili e richiede prova di lease corrente prima della finalizzazione.

## 15. Idempotenza
L’idempotency key resta stabile per scope e operazione logica. I campi Lotto 8 espliciti entrano nel request fingerprint; se assenti, il fingerprint storico V1 resta byte-identico.

## 16. Provider gate
Quando `ASYNC_PROVIDER_EXECUTION_ENABLED=false`, le operazioni provider-backed non sono claimabili e restano in coda. Le operazioni locali continuano.

## 17. Policy budget
Il gate richiede policy abilitate applicabili per `GLOBAL`, `TENANT` e `PROCEDIMENTO`. Policy assente non equivale a budget illimitato.

## 18. Reservation lifecycle
La reservation centrale supporta reserve, settle, release ed expiry. Le policy sono bloccate in transazione serializable; una reservation riattivata riparte dalla finestra corrente.

## 19. Protezione effetti esterni
Una reservation idempotente già attiva restituisce conflitto e il callback provider non viene invocato. Successo e failure producono rispettivamente settle e release.

## 20. Adapter reali
Gli adapter predefiniti di analisi fascicolo e ricerca automatica passano dal cost gate. Nei test sono usate esclusivamente dipendenze sintetiche o mock.

## 21. Worker heartbeat
Il worker registra stato, concorrenza e heartbeat. Gli stati comprendono esecuzione, draining e stopped; l’heartbeat scade reservation obsolete.

## 22. Health snapshot
Lo snapshot aggrega queue depth, running, failed, stale leases, oldest pending, worker attivi, ultimo successo e compatibilità migrazione. Gli stati sono `HEALTHY`, `DEGRADED`, `WORKER_UNAVAILABLE`.

## 23. API amministrativa
`/api/admin/runtime-health` è admin-only e `no-store`. Risponde 200 se healthy e 503 se degraded/unavailable, senza restituire dettagli DB sensibili.

## 24. UI tecnica
`/admin/runtime` espone worker, coda, lease, failure, policy e costi recenti. Non mostra payload dei job; le tabelle hanno overflow orizzontale gestito dal componente condiviso.

## 25. Retry manuale
L’azione admin consente retry terminale auditato, aggiunge un tentativo consentito, preserva `attemptCount` e pulisce solo i codici failure sanitizzati.

## 26. Schema Prisma
Sono additivi enum, campi queue, relazioni e modelli `RuntimeWorkerHeartbeat`, `RuntimeBudgetPolicy`, `RuntimeCostReservation`. Il client Prisma 7.8 è rigenerato.

## 27. Migrazione e readiness
La migrazione `20261001_runtime_worker_cost_readiness` è additiva, con FK, check e indici; l’unicità policy usa `NULLS NOT DISTINCT`. `npm run worker:readiness` è read-only. Il runbook documenta rollout canary, servizio persistente, recovery, rollback e go/no-go. Lo staging reale non è stato contattato.

## 28. Matrice dei 60 comportamenti

| # | Comportamento verificato | Esito |
|---:|---|:---:|
| 1 | Processo worker separato da Next.js | PASS |
| 2 | Riutilizzo del registry esistente | PASS |
| 3 | Nessun secondo motore queue | PASS |
| 4 | Concorrenza default 1 | PASS |
| 5 | Concorrenza configurabile 1-32 | PASS |
| 6 | Lane con ID distinti | PASS |
| 7 | Lane realmente concorrenti | PASS |
| 8 | Drain su SIGTERM | PASS |
| 9 | Nessun claim dopo shutdown | PASS |
| 10 | Backoff idle limitato | PASS |
| 11 | Backoff errori limitato | PASS |
| 12 | Recovery da errore drain | PASS |
| 13 | Claim con SKIP LOCKED | PASS |
| 14 | Lease owner/token/expiry | PASS |
| 15 | Heartbeat lease job | PASS |
| 16 | Recupero lease scaduta | PASS |
| 17 | Un lease vivo per procedimento | PASS |
| 18 | Procedimenti diversi concorrenti | PASS |
| 19 | Scope procedimento persistito | PASS |
| 20 | Allowlist procedimento | PASS |
| 21 | Allowlist operazione | PASS |
| 22 | Priorità HIGH/NORMAL/LOW | PASS |
| 23 | Aging anti-starvation | PASS |
| 24 | Dipendenza ammessa dopo successo | PASS |
| 25 | Dipendenza terminale segnalata | PASS |
| 26 | Parent non concluso non claimabile | PASS |
| 27 | Retry esponenziale | PASS |
| 28 | Backoff massimo 24 ore | PASS |
| 29 | Failure non retryable terminale | PASS |
| 30 | Retry manuale preserva tentativi | PASS |
| 31 | Retry manuale auditato | PASS |
| 32 | Cancellazione cooperativa | PASS |
| 33 | Race cancellazione riconciliata | PASS |
| 34 | Idempotency key stabile | PASS |
| 35 | Campi Lotto 8 nel fingerprint | PASS |
| 36 | Fingerprint legacy preservato | PASS |
| 37 | Provider disabilitati non claimati | PASS |
| 38 | Job locali continuano senza provider | PASS |
| 39 | Stime positive obbligatorie | PASS |
| 40 | Policy GLOBAL obbligatoria | PASS |
| 41 | Policy TENANT obbligatoria | PASS |
| 42 | Policy PROCEDIMENTO obbligatoria | PASS |
| 43 | Lock policy prima del calcolo | PASS |
| 44 | Transazione serializable | PASS |
| 45 | Cap verificato prima dell’insert | PASS |
| 46 | Reservation idempotente | PASS |
| 47 | Duplicate reservation blocca callback | PASS |
| 48 | Successo provider fa settle | PASS |
| 49 | Failure provider fa release | PASS |
| 50 | Reservation scaduta esclusa dallo spend | PASS |
| 51 | Riattivazione ricalcola i cap | PASS |
| 52 | Riattivazione resetta finestra | PASS |
| 53 | Heartbeat worker persistito | PASS |
| 54 | Reservation stale scaduta da heartbeat | PASS |
| 55 | Health distingue worker unavailable | PASS |
| 56 | API health admin-only | PASS |
| 57 | Errori API sanitizzati | PASS |
| 58 | UI non espone payload | PASS |
| 59 | Migrazione additiva vincolata | PASS |
| 60 | Readiness staging fail-closed | PASS |

## 29. Matrice dei 36 criteri di completamento

| # | Criterio | Evidenza | Esito |
|---:|---|---|:---:|
| 1 | Runtime persistente disponibile | script `worker:async` | PASS |
| 2 | Configurazione server validata | test runtime config | PASS |
| 3 | Concorrenza bounded | test 3 lane | PASS |
| 4 | Graceful shutdown | test SIGTERM/drain | PASS |
| 5 | Claim atomico | SQL persistence | PASS |
| 6 | Mutazioni lease-authoritative | test worker/persistence | PASS |
| 7 | Recovery lease scadute | test persistence | PASS |
| 8 | Scope diretto procedimento | schema/domain/persistence | PASS |
| 9 | Esclusione intra-procedimento | asserzione SQL diretta | PASS |
| 10 | Concorrenza inter-procedimento | claim e lane tests | PASS |
| 11 | Priorità e aging | ordering SQL tests | PASS |
| 12 | Dipendenze | claim dependency tests | PASS |
| 13 | Blocked reason terminale | reconciliation tests | PASS |
| 14 | Retry esponenziale capped | failure tests | PASS |
| 15 | Retry manuale admin | action e audit tests | PASS |
| 16 | Cancellazione preservata | worker tests | PASS |
| 17 | Idempotenza preservata | domain tests | PASS |
| 18 | Compatibilità fingerprint Lotti 1-7 | fingerprint fisso | PASS |
| 19 | Provider mode fail-closed | config/claim tests | PASS |
| 20 | Budget centrale | cost module tests | PASS |
| 21 | Scope budget completi | missing-policy tests | PASS |
| 22 | Cap concorrenti serializzati | transaction/lock SQL | PASS |
| 23 | Duplicate effect impedito | callback non invocato | PASS |
| 24 | Settle importo reale | composed gate test | PASS |
| 25 | Release su errore | composed gate test | PASS |
| 26 | Expiry reservation | heartbeat/cost queries | PASS |
| 27 | Adapter AI protetto | analysis job tests | PASS |
| 28 | Adapter research protetto | research job tests | PASS |
| 29 | Heartbeat worker | runtime health tests | PASS |
| 30 | Health queue/lease/failure | snapshot tests | PASS |
| 31 | Endpoint admin sanitizzato | route tests | PASS |
| 32 | UI tecnica buildabile | Next.js production build | PASS |
| 33 | Migrazione additiva | static + PGlite tests | PASS |
| 34 | Prisma valido/generato | validate + generate | PASS |
| 35 | Regressione repository verde | 3.325 test passati | PASS |
| 36 | Staging readiness documentata | command + runbook; non eseguita remotamente | READY |

## 30. Validazione finale e verdetto
Collaudo Lotto 8 focalizzato: 10 file, 126 test passati. Regressione completa finale: 211 file passati, 1 saltato; 3.325 test passati, 5 saltati. Build Next.js, TypeScript, Prisma validate e Prisma generate riusciti. La prima esecuzione parallela aveva un failure reale di fingerprint, corretto, e nove timeout PGlite; il run finale seriale con timeout 15 secondi è interamente verde. Nessun Playwright, staging reale o provider reale è stato eseguito, coerentemente con i vincoli.

**LOTTO 8 CHIUSO NEL PERIMETRO LOCALE VALIDATO; STAGING PRONTO AL GO/NO-GO, NON ESEGUITO.**
