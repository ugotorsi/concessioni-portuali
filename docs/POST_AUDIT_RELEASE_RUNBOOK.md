# Runbook di integrazione e rilascio post-audit

## 1. Scopo e vincoli

Questa procedura porta il candidato post-audit dalla revisione alla pubblicazione
senza usare Production come ambiente di prova. I gate sono fail-closed.

Sono vietati durante preflight e collaudo:

- modifiche a dati, policy, AI, provider, automazioni o worker Production;
- `prisma db push`, `prisma migrate reset`, seed e riparazioni manuali;
- disabilitazione di trigger o vincoli;
- stampa, copia in artifact o recupero interattivo di connection string;
- uso di dati autentici nella Preview;
- avvio di elaborazioni AI.

Il workflow read-only e il rehearsal attestano lo stato; non correggono dati.

## 2. Canale Production strettamente read-only

### 2.1 Ruolo PostgreSQL dedicato

Un DBA autorizzato crea un login esclusivo per il preflight. Sostituire password e
nome database tramite il secret manager; non inserirli nel repository o nei log.

```sql
CREATE ROLE noetra_release_readonly
  LOGIN
  PASSWORD '<GENERATA_DAL_SECRET_MANAGER>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

ALTER ROLE noetra_release_readonly SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE <NOETRA_PRODUCTION_DB> TO noetra_release_readonly;
GRANT USAGE ON SCHEMA public TO noetra_release_readonly;
GRANT SELECT ON TABLE
  public."Concessione",
  public."Procedimento",
  public."ActivityLog"
TO noetra_release_readonly;
```

Il ruolo non deve ricevere membership, privilegi DML, `CREATE` su database/schema
o privilegi sulle sequence. Se `public` eredita `CREATE` da `PUBLIC`, il preflight
si blocca: il DBA deve valutarne la revoca e il successivo grant esplicito ai soli
ruoli applicativi, in una modifica infrastrutturale separata.

La verifica applicativa controlla nuovamente:

- transazione `READ ONLY`;
- assenza di privilegi di creazione, DML, trigger e sequence su tutti gli schemi
  non di sistema;
- assenza di `SUPERUSER` e `BYPASSRLS`;
- duplicati dei titoli normalizzati e concessioni prive di tenant;
- catena completa `ActivityLog`, in batch e senza emettere contenuti delle righe.

### 2.2 GitHub Environment

Un amministratore del repository crea l'Environment `production-readonly`:

1. limita i deployment branch al branch ufficiale di rilascio;
2. configura almeno un required reviewer non coincidente con chi avvia il job;
3. salva soltanto `NOETRA_PRODUCTION_READONLY_DATABASE_URL`;
4. vieta l'accesso al secret a workflow diversi da quello approvato.

Il workflow manuale `.github/workflows/production-readonly-preflight.yml` usa
`contents: read`, non ha trigger automatici e non pubblica artifact. Il reviewer
controlla SHA e motivazione prima di autorizzare l'esecuzione. Il job accetta
soltanto `release/v7-integrated-services`, richiede lo SHA completo e lo confronta
con `HEAD`; il secret e disponibile esclusivamente allo step finale, non a
checkout o installazione dipendenze.

Output ammesso: conteggi, codici di anomalia, ordinali e fingerprint SHA-256
dell'identita database. Nessuna riga o credenziale viene emessa.

Il login read-only deve usare lo stesso host, porta e nome database del
`DATABASE_URL` applicativo Production, non una replica o un pool endpoint
alternativo. Solo cosi `productionDatabaseIdentityFingerprint` rappresenta
l'identita da escludere in Preview e rehearsal.

Esito richiesto:

```text
safeToMigrate=true
normalizedDuplicateGroups=0
concessionsWithoutTenant=0
auditChain.valid=true
auditChain.verifiedCount=activityLogCount
auditChain.baselineAnchorVerified=true
auditChain.algorithmCounts.LEGACY_SEED_STRING_METADATA=10
auditChain.algorithmCounts.CANONICAL_WITHOUT_ENTE_ID=0
auditChain.algorithmCounts.CANONICAL_WITH_ENTE_ID>=249
```

Il preflight ancora i primi 259 eventi al record e all'hash finale verificati
fuori dal database nel candidato di rilascio. Eventi successivi sono ammessi
soltanto nel formato corrente; il conteggio corrente puo quindi aumentare, ma i
10 seed legacy e gli zero eventi pre-tenant non possono cambiare. Il formato
seed legacy e valido soltanto nel prefisso iniziale della catena; il formato
senza `enteId` e valido soltanto prima del primo evento nel formato corrente.
`CURRENT_HASH_MISMATCH`, `PREVIOUS_HASH_MISMATCH`,
`HASH_ALGORITHM_DOWNGRADE`, anchor non valido o conteggi legacy diversi dal
baseline bloccano il rilascio. Non ricalcolare o riscrivere gli eventi: una
anomalia deve essere classificata come `PREEXISTING_PRODUCTION_HISTORY` e
gestita con un intervento separato.

## 3. Preview PR isolata

L'owner infrastrutturale crea un database vuoto/sintetico dedicato alla PR, vi
applica le migrazioni con `prisma migrate deploy` e usa esclusivamente il seed
demo autorizzato. Il database non deve essere un alias, pool o branch collegato a
Production.

Configurare in Vercel variabili **Preview branch-scoped**:

```text
NOETRA_REQUIRE_ISOLATED_PREVIEW=true
NOETRA_PREVIEW_DATA_CLASSIFICATION=SYNTHETIC_ISOLATED
NOETRA_EXPECTED_PREVIEW_DATABASE_FINGERPRINT=<fingerprint Preview>
NOETRA_PRODUCTION_DATABASE_FINGERPRINT=<productionDatabaseIdentityFingerprint>
AI_REAL_DATA_ENABLED=false
ASYNC_PROVIDER_EXECUTION_ENABLED=false
AUTOMATIC_RESEARCH_EXECUTION_ENABLED=false
DOCUMENT_WORKER_ACTIVATION_MODE=DISABLED
DATABASE_URL=<secret database sintetico>
```

Il fingerprint usa soltanto host, porta e nome database normalizzati. Il comando
seguente lo verifica senza stampare la URL:

```text
npm run runtime:verify-isolated-preview
```

Ogni runtime con `VERCEL_ENV=preview` applica automaticamente il controllo e si
blocca se il marker, la classificazione, i fingerprint o i controlli non sono
coerenti. In ambienti non Preview il marker non attiva il gate.

## 4. Collaudo autenticato Preview

Sono necessari due accessi distinti, senza aggirare le protezioni:

1. un membro Vercel autorizzato completa Vercel Authentication;
2. un amministratore di test fornisce tramite secret manager un account
   applicativo sintetico, abilitato MFA, e il relativo TOTP.

Il collaudo deve:

- confermare deployment ID, branch e SHA della PR;
- autenticarsi con Vercel Authentication e poi con MFA applicativa;
- usare soltanto il fascicolo sintetico;
- validare professionalmente una proposta di riconciliazione;
- verificare collegamento/materializzazione, idempotenza e storico;
- verificare che nessuna AI, ricerca automatica o coda worker sia partita;
- rieseguire `runtime:verify-isolated-preview`.

Screenshot e trace non devono contenere secret, TOTP o dati autentici.

## 5. Rehearsal migrazione

### 5.1 Ambiente

Per dimostrare la compatibilita esatta con i dati storici serve un clone
Production isolato e autorizzato. La sua creazione e un intervento umano minimo
obbligatorio e non e sostituibile da una simulazione. Il clone:

- non deve condividere endpoint o credenziali con Production;
- deve essere accessibile soltanto al team di release;
- non deve avviare applicazione, AI, automazioni o worker;
- deve essere eliminato secondo la retention approvata.

In assenza dell'autorizzazione al clone si puo provare la meccanica su dati
sintetici, ma il gate di compatibilita storica resta non superato.

### 5.2 Procedura

1. Conservare dal preflight Production `concessionCount`, `procedureCount` e
   `productionDatabaseIdentityFingerprint`.
2. Calcolare il fingerprint del clone con la stessa funzione e verificarne la
   diversita da Production.
3. Sul clone, prima della migrazione, eseguire `npx prisma migrate status`.
4. Applicare esclusivamente `npx prisma migrate deploy`.
5. Impostare nel solo processo di verifica:

```text
NOETRA_REHEARSAL_DATA_CLASSIFICATION=PRODUCTION_SNAPSHOT_ISOLATED
NOETRA_REHEARSAL_DATABASE_URL=<secret clone>
NOETRA_REHEARSAL_DATABASE_FINGERPRINT=<fingerprint clone>
NOETRA_PRODUCTION_DATABASE_FINGERPRINT=<fingerprint Production>
NOETRA_EXPECTED_CONCESSION_COUNT=<preflight>
NOETRA_EXPECTED_PROCEDURE_COUNT=<preflight>
```

6. Eseguire:

```text
npm run runtime:verify-post-audit-migration-rehearsal -- --confirm-isolated-rehearsal
```

Esito richiesto: conteggi invariati, zero duplicati, zero procedimenti orfani,
indice univoco valido e migrazione registrata come completata. La migrazione non
aggiorna righe: controlla i duplicati e crea l'indice tenant-scoped.

## 6. Gate di integrazione PR

Integrare soltanto se sono contemporaneamente verdi:

- review e check GitHub/Vercel sullo SHA esatto;
- test unitari, PostgreSQL, build e lint senza nuovi errori;
- preflight Production read-only;
- rehearsal sul clone autorizzato;
- Preview isolata e collaudo autenticato MFA;
- backup/restore point Production approvato;
- finestra di manutenzione approvata per `CREATE UNIQUE INDEX`, che acquisisce
  lock sulla tabella.

Qualsiasi differenza di SHA, fingerprint, conteggio, catena audit o alias e un
`NO-GO`.

## 7. Migrazione e pubblicazione

1. Registrare deployment Production corrente, commit, migration head e backup.
2. Applicare `npx prisma migrate deploy` con il canale Production autorizzato.
3. Verificare `npx prisma migrate status` e l'esistenza/validita dell'indice.
4. Rilasciare esclusivamente:

```text
npm run deploy:production -- --expected-commit <SHA_COMPLETO>
```

Lo script crea il deployment con `--skip-domain`, verifica identita e login,
controlla che l'alias non sia cambiato, promuove e riverifica `app.noetra.it`.
Per un deployment gia creato ma non promosso usare `--resume-deployment
<dpl_ID>`; se e gia live usare `--verify-only`. Non impostare alias manualmente.

## 8. Abort e ripristino

Interrompere prima della promozione se un gate fallisce. Non correggere dati
durante la finestra.

Se la migrazione fallisce prima della creazione dell'indice, conservare log e
stato Prisma e aprire l'incidente; non usare `migrate resolve` senza diagnosi e
approvazione. Se il codice nuovo fallisce ma la migrazione e riuscita, mantenere
l'indice additivo e ripristinare il deployment applicativo precedente. Rimuovere
l'indice soltanto con change separato, dopo aver escluso dipendenze del codice.

Se un deployment e pronto ma non promosso, lasciare invariato l'alias. Se la
promozione e gia avvenuta e l'health check fallisce, ripromuovere il deployment
Production precedente secondo la procedura Vercel autorizzata, quindi eseguire
`--verify-only` sul relativo SHA.

## 9. Interventi umani minimi residui

1. DBA: ruolo read-only e, se necessario, clone isolato + backup.
2. Repository admin: Environment GitHub, secret e reviewer.
3. Infrastructure owner: database sintetico e variabili Vercel branch-scoped.
4. Vercel member: autenticazione alla Preview protetta.
5. Test admin: account applicativo sintetico MFA e TOTP via secret manager.
6. Release manager: approvazione integrazione, migrazione e promozione.

Nessuno di questi interventi autorizza AI, worker, modifiche ai fascicoli reali
o riparazioni dati.
