# Runbook Neon Staging - P0-E8 Baseline (Not Executed)

Status: proposed only, not executed in this dry-run.

## 0. Scope e divieti

- Solo Vercel Preview.
- Solo branch staging-operativo.
- Production vietata.
- `prisma db push` vietato.
- `prisma migrate reset` vietato.
- seed vietato.

Stop condition:

- Se un solo vincolo sopra non e rispettato, fermarsi subito.

## 1. Verifica ambiente

1. Confermare `VERCEL_ENV=preview`.
2. Confermare `VERCEL_GIT_COMMIT_REF=staging-operativo`.
3. Confermare il commit atteso autorizzato nel change ticket.
4. Confermare che l'ambiente target sia staging e non production.

Stop condition:

- Se uno dei valori non coincide, stop immediato.

## 2. Verifica DB vuoto

1. Eseguire ricognizione read-only su database target.
2. Richiedere evidenza esplicita:
   - `connected=true`
   - `publicTablesCount=0`
   - `prismaMigrationsPresent=false`
3. Verificare assenza di tabelle inattese in `public`.

Stop condition:

- Se il DB non e vuoto o se esistono tabelle inattese, non procedere.

## 3. Snapshot / recovery point

1. Creare snapshot Neon, branch Neon o recovery point equivalente.
2. Registrare identificativo recovery point e timestamp UTC.
3. Verificare che il recovery point sia ripristinabile secondo policy.

Stop condition:

- Se il recovery point non e verificato, fermarsi.

## 4. Conferma manuale obbligatoria

- Inserire gate operativo esplicito prima di qualunque scrittura:
  - NON PROSEGUIRE finche un operatore autorizzato non conferma per iscritto:
  - APPLY BASELINE TO NEON STAGING

Stop condition:

- Nessuna conferma scritta, nessuna operazione di scrittura.

## 5. Applicazione baseline

1. Applicare esclusivamente il file committato:
   - `prisma/baselines/20260803_p0_e8_empty_to_current/baseline.sql`
2. Verificare SHA256 atteso prima dell'applicazione.
3. Eseguire in modalita stop-on-error.
4. Registrare exit code e timestamp start/end.

Stop condition:

- STOP CONDITION: se l'hash SHA256 del file baseline non coincide esattamente con
   FFA1BB29079925FBC87DFCFD56D03704F8349CB7FDBE925961A932D469B7BCF6,
   non applicare alcun SQL e interrompere immediatamente la procedura.
- Stop se exit code diverso da 0.
- Stop su qualsiasi errore SQL.
- Stop se emergono oggetti inattesi nel database durante i controlli immediati.

## 6. Verifica immediata

1. Verificare conteggio tabelle.
2. Verificare conteggio enum.
3. Verificare assenza errori SQL.

Stop condition:

- Qualsiasi difformita rispetto ai conteggi attesi.

## 7. Migration resolve

1. `npx prisma migrate resolve --applied 20260727_decisione_procedimento_minima`
2. `npx prisma migrate resolve --applied 20260802_p0d1_stato_effetto`
3. Eseguire strettamente in questo ordine.

Stop condition:

- Qualsiasi exit code non zero.

## 8. Prisma migrate status

- Eseguire `npx prisma migrate status`.

Stop condition:

- Stato non coerente o mismatch inatteso.

## 9. Prisma migrate deploy

- Eseguire `npx prisma migrate deploy`.

Stop condition:

- Errore `already exists`, migration pendenti inattese, o exit non zero.

## 10. Ricognizione finale

Endpoint temporaneo identificato:

- `GET /api/admin/db-recon-preview-temp`

Vincoli endpoint:

- Uso consentito solo su Preview/staging-operativo.
- Autenticazione con token tecnico temporaneo o sessione ADMIN reale.
- Token mai scritto nel runbook e mai nei log.

Verifiche richieste:

1. Pre-baseline:
   - `connected=true`
   - `publicTablesCount=0`
   - `prismaMigrationsPresent=false`
2. Post-baseline+resolve+deploy:
   - `connected=true`
   - `publicTablesCount>0`
   - `_prisma_migrations` presente con le due migration marcate applied.

Stop condition:

- Se expected pre-state o post-state non corrispondono, fermare il rilascio.

## 11. Prisma schema diff

- Eseguire:
  - `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`

Esito atteso:

- Diff vuoto (`-- This is an empty migration.`) o semanticamente equivalente e approvato.

Stop condition:

- Diff non atteso o non giustificato.

## 12. Chiusura e rimozione strumenti temporanei

1. Archiviare evidenze operative minime (exit code, timestamp, hash baseline).
2. Rimuovere endpoint/strumenti temporanei solo dopo approvazione separata.
3. Confermare che nessun segreto sia stato scritto in log o artefatti.

Stop condition:

- Nessuna rimozione strumenti temporanei senza approvazione separata.

## Sicurezza e logging

- Non stampare URL complete di connessione.
- Non stampare hostname reali.
- Non stampare password, token, bearer o api key.
- Non esportare dump dati nei materiali PR.
