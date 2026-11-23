# Security review del candidato di rilascio

Data: 23 novembre 2026

## Ambito

La review ha esaminato le vulnerabilita `high` segnalate nella catena
Prisma/Effect, il grafo Auth.js interessato dagli override npm e la compatibilita
del runtime Prisma dopo l'aggiornamento delle dipendenze.

## Risultati

| Severita | Componente | Vulnerabilita | Esposizione NOETRA | Esito |
| --- | --- | --- | --- | --- |
| High | Effect 3.20.0 | CVE-2026-121707, ReDoS in `Schema.TemplateLiteral` | Il percorso vulnerabile non era usato dal codice applicativo; Effect era transitivo alla configurazione Prisma | Aggiornato a 3.22.1 |
| High | deepmerge-ts | CVE-2026-40345, esaurimento dello stack con oggetti ciclici | Raggiungibile solo durante il merge della configurazione Prisma trusted, non da input HTTP | Verificata la versione corretta 8.0.2 |

I tre record `high` iniziali dell'audit erano aggregazioni di questi due advisory,
non tre vulnerabilita distinte.

## Remediation

- allineati `prisma`, `@prisma/client` e `@prisma/adapter-pg` alla versione
  7.10.1;
- fissato Effect 3.22.1 tramite l'unico oggetto npm `overrides`, preservando
  l'override Auth.js esistente;
- rimossa la dipendenza inutilizzata `@auth/prisma-adapter`;
- mantenuti NextAuth 4.24.15, `@auth/core` 0.41.3 e `cookie` 0.7.2;
- aggiornato il mapping delle collisioni uniche per supportare sia
  `constraint.fields` sia `constraint.index` restituito dall'adapter Prisma
  7.10;
- rigenerato il lockfile con npm 10.8.2, la versione usata dalla CI.

## Verifiche

- `npm audit`: 0 vulnerabilita;
- `npm audit --omit=dev`: 0 vulnerabilita;
- installazione pulita con `npm ci` 10.8.2;
- validazione e generazione Prisma, seguite dall'applicazione da zero di 64
  migrazioni su PostgreSQL 16;
- 4.691 test unitari/PostgreSQL superati e 35 saltati;
- 35 test mirati del servizio di identita canonica superati dopo
  l'installazione pulita;
- build Next.js Production e `npx tsc --noEmit` superati;
- gate CI `staging-release-gate` e deployment Vercel Preview superati.

## Limiti operativi distinti dalla sicurezza del codice

La readiness Production sul database reale e la readiness delle credenziali dei
connettori automatici devono essere verificate nell'ambiente persistente. Le
variabili Vercel di tipo `Secret`, inclusa `DATABASE_URL`, non sono esportabili
con `vercel env run`; questa protezione non e stata aggirata.

Il controllo dei connettori e read-only e non chiama provider:

```text
npm run runtime:verify-automatic-research-connectors
```

Non e stato eseguito alcun deploy Production durante questa review.
