# Migrazione a PostgreSQL (Docker)

## Configurazione raccomandata

Per sviluppo serio e allineato alla roadmap, usare PostgreSQL in Docker.

Parametri standard:

- image: `postgres:16`
- host port: `5433`
- database: `concessioni_portuali`
- user/password: `concessioni` / `concessioni`

URL raccomandata:

```bash
DATABASE_URL="postgresql://concessioni:concessioni@localhost:5433/concessioni_portuali?schema=public"
```

## Comandi Docker

Avvio servizio database:

```bash
docker compose up -d
```

Verifica stato:

```bash
docker compose ps
```

Stop servizio:

```bash
docker compose down
```

## Passaggio da SQLite a PostgreSQL

1. Impostare la `DATABASE_URL` PostgreSQL nel file `.env` (partendo da `.env.example`).
2. Avviare PostgreSQL con Docker.
3. Applicare schema e seed:

```bash
npx prisma db push
npx prisma db seed
```

4. Verificare applicazione:

```bash
npm run build
npm run check
```

Nota Prisma 7:

- la URL datasource viene letta da `prisma.config.ts`
- evitare modifiche incompatibili che forzano `url` nel datasource dello schema

## Rischi e attenzioni

- SQLite non replica vincoli/comportamenti PostgreSQL in modo completo.
- Query e tipi dati possono comportarsi diversamente tra SQLite e PostgreSQL.
- Eseguire sempre `db push` e `db seed` sull'ambiente PostgreSQL prima di test funzionali.

## Politica d'uso ambienti

- Non usare SQLite in ambiente demo istituzionale o produzione.
- Usare SQLite solo come rollback temporaneo per sviluppo locale quando Docker non è disponibile.
