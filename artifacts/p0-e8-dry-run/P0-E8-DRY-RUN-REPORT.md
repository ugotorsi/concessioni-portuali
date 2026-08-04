# P0-E8 Dry-Run Report (Temporary PostgreSQL)

Date: 2026-08-04
Branch: p0-e8-baseline-audit
Scope: local temporary PostgreSQL only

## Safety constraints honored

- Neon staging not used.
- Production DB not used.
- No prisma db push.
- No prisma migrate reset on real environments.
- No seed on real environments.
- No secrets recorded.

## Baseline target

- File: prisma/baselines/20260803_p0_e8_empty_to_current/baseline.sql
- SHA256: FFA1BB29079925FBC87DFCFD56D03704F8349CB7FDBE925961A932D469B7BCF6

## Executed command set (sanitized)

1. Start temporary PostgreSQL 16 container and create two empty DBs.
2. Pre-check on DB A:
   - count public tables
   - check _prisma_migrations existence
   - count enums
3. Apply baseline SQL to DB A only.
4. Run checks on DB A:
   - table count
   - enum count
   - FK count
   - index count
   - expected table set vs schema-derived table set
   - expected enum set vs schema-derived enum set
5. Prisma checks on DB A:
   - npx prisma validate
   - npx prisma generate
   - npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
6. Strategy B simulation on DB B:
   - apply same baseline SQL
   - npx prisma migrate resolve --applied 20260727_decisione_procedimento_minima
   - npx prisma migrate resolve --applied 20260802_p0d1_stato_effetto
   - npx prisma migrate status
   - npx prisma migrate deploy
   - npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

## Phase 1 pre-check (DB A, empty)

- public tables: 0
- _prisma_migrations: 0
- application enums: 0

Result: PASS

## Phase 2 baseline apply (DB A)

- apply exit code: 0
- SQL errors: none
- post tables: 27
- post enums: 59
- post foreign keys: 55
- post indexes: 213

Result: PASS

## Phase 3 schema comparison (DB A vs prisma/schema.prisma)

- prisma validate: exit 0
- prisma generate: exit 0
- migrate diff: exit 0
- diff output: "-- This is an empty migration."
- expected tables from schema: 27
- actual tables in DB: 27
- missing tables: 0
- extra tables: 0
- expected enums from schema: 59
- actual enums in DB: 59
- missing enums: 0
- extra enums: 0

Result: PASS

## Static SQL checks

- baseline DROP statements: 0
- baseline DML statements (INSERT/UPDATE/DELETE/TRUNCATE): 0

Result: PASS

## Phase 4 migration history simulation (Strategy B, DB B)

Applied resolve operations:

1. 20260727_decisione_procedimento_minima
2. 20260802_p0d1_stato_effetto

Observed results:

- resolve #1 exit: 0
- resolve #2 exit: 0
- migrate status exit: 0
- migrate status message: Database schema is up to date
- migrate deploy exit: 0
- migrate deploy message: No pending migrations to apply
- post-deploy diff exit: 0
- post-deploy diff output: "-- This is an empty migration."

Rows in _prisma_migrations after resolve:

- 20260727_decisione_procedimento_minima | applied=true
- 20260802_p0d1_stato_effetto | applied=true

Result: PASS

## Analysis of the two target migrations

Migration 20260727_decisione_procedimento_minima introduces:

- enum TipoDecisioneProcedimento
- enum EffettoTitoloProcedimento
- table DecisioneProcedimento
- related indexes and foreign keys

Migration 20260802_p0d1_stato_effetto introduces:

- enum StatoEffettoProcedimento
- columns on DecisioneProcedimento: statoEffetto, effettoApplicatoAt, effectVersion
- index DecisioneProcedimento_statoEffetto_dataEfficacia_idx
- conservative data backfill updates

Baseline includes the final schema objects from both migrations. On an empty DB, the data-backfill updates are no-op by definition.

Conclusion:

- both migrations must be marked applied in history alignment scenario
- order should be chronological
- risk of double application exists if migrations are executed after baseline without resolve
- risk is avoided by resolve-first strategy B, then status, then deploy

## Mandatory test matrix

- baseline applied on empty DB: PASS
- final schema diff empty: PASS
- all tables present: PASS
- all enums present: PASS
- FK and indexes present: PASS
- migrate resolve simulated: PASS
- migrate status coherent: PASS
- migrate deploy post-resolve: PASS
- no DROP/DML in baseline: PASS
- temporary DB removed: PASS (see cleanup)
- git diff --check: PASS

## Cleanup

- Temporary PostgreSQL container removed.
- Temporary DBs removed with container lifecycle.

## Artifacts produced

- artifacts/p0-e8-dry-run/phase1_precheck.txt
- artifacts/p0-e8-dry-run/phase2_apply_status.txt
- artifacts/p0-e8-dry-run/phase2_post_counts.txt
- artifacts/p0-e8-dry-run/phase2_tables.txt
- artifacts/p0-e8-dry-run/phase2_enums.txt
- artifacts/p0-e8-dry-run/phase3_validate.log
- artifacts/p0-e8-dry-run/phase3_generate.log
- artifacts/p0-e8-dry-run/phase3_diff.sql
- artifacts/p0-e8-dry-run/phase3_static_checks.txt
- artifacts/p0-e8-dry-run/phase3_enum_checks.txt
- artifacts/p0-e8-dry-run/phase3_no_dml_drop_check.txt
- artifacts/p0-e8-dry-run/phase4_status.log
- artifacts/p0-e8-dry-run/phase4_deploy.log
- artifacts/p0-e8-dry-run/phase4_post_deploy_diff.sql
- artifacts/p0-e8-dry-run/phase4_migration_rows.txt
