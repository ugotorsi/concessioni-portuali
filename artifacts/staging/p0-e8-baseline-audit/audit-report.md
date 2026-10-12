# P0-E8 Baseline Audit

Generated at: 2026-08-03T17:33:40.835Z

## Migration History Assessment
- Existing migrations: 2
- Existing migration names: 20260727_decisione_procedimento_minima, 20260802_p0d1_stato_effetto
- Prisma enums: 59
- Prisma models: 27
- Enums created by history: 3
- Tables created by history: 1
- Prisma migrate deploy on empty DB likely safe: no

## Baseline Static Verification
- Baseline path: prisma/baselines/20260803_p0_e8_empty_to_current/baseline.sql
- Baseline line count: 1504
- CREATE TYPE count: 59
- CREATE TABLE count: 27
- CREATE UNIQUE INDEX count: 15
- CREATE INDEX count: 171
- DROP statements present: no
- DML statements present (INSERT/UPDATE/DELETE/MERGE/TRUNCATE): no
- Missing enums in baseline: 0
- Missing tables in baseline: 0
- FK missing target table references: 0
- FK missing source table references: 0

## Risk Summary
- HIGH risk objects: 83
- MEDIUM risk objects: 0

## Artifacts
- object-matrix.csv
- baseline-static-verification.json
