# Workflow procedimentale guidato — verifica di rilascio

Percorso: problematica → analisi giuridica → attività → atti → esecuzione → esito.

## Schema e migrazioni

Il workflow non introduce tabelle o colonne. Attività, transizioni, evidenze e
collegamenti alle bozze sono eventi immutabili in `ActivityLog`; proposte,
riconciliazioni, Knowledge, snapshot del rapporto e documenti usano tabelle già
presenti nelle 53 migrazioni e già lette o scritte dal codice in Production.
Il confronto degli identificatori SQL nel codice modificato con il commit
`f0454b4` non rileva nuovi oggetti di schema.

**Nessuna migrazione è necessaria per questo rilascio.**

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
