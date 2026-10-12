# P0-E8 Baseline Strategy and Dry-Run Plan

## Scope and Safety
- Baseline generated offline from `prisma/schema.prisma`.
- No connection to Neon staging was required for baseline generation.
- No `prisma migrate deploy`, no `db push`, no `reset`, no `seed`, no production deploy.

## Facts Collected
- Prisma schema objects: 59 enums, 27 models.
- Existing migration directories: 2.
- Existing migrations create only:
  - enums: `TipoDecisioneProcedimento`, `EffettoTitoloProcedimento`, `StatoEffettoProcedimento`
  - tables: `DecisioneProcedimento`
- `DecisioneProcedimento` migration depends on pre-existing tables (`Ente`, `Procedimento`, `Concessione`, `Documento`, `User`) not created by migration history.
- Conclusion: current migration history is incremental and not bootstrap-complete for an empty database.

## Strategy Options

### A) New initial baseline migration + ordered incremental realignment
- Description:
  - Add a new migration at the beginning that creates full schema from empty.
  - Rebase/realign incremental migrations so they do not recreate already created objects.
- Advantages:
  - Full `prisma migrate deploy` compatibility on empty DB.
  - Clean long-term migration history.
- Risks:
  - High rewrite effort; requires careful migration ordering and conflict resolution.
  - Increased risk of regressions in existing environments if not managed with strict rollout controls.

### B) Apply baseline SQL manually, then mark migration state with `prisma migrate resolve`
- Description:
  - Apply `baseline.sql` on empty DB.
  - Mark selected migrations as applied to align Prisma migration history.
- Advantages:
  - Fastest route for staging bootstrap.
  - Minimal disruption to existing migration files.
- Risks:
  - Operational complexity: resolve steps must exactly match applied state.
  - Easy to drift if process is not strictly documented and automated.

### C) Controlled regeneration of migration history for staging only
- Description:
  - Create a staging-specific migration chain from current schema.
  - Keep production/mainline migration chain unchanged.
- Advantages:
  - Allows rapid staging recovery without touching production flow.
- Risks:
  - Dual history maintenance cost.
  - Tooling/process complexity and higher drift risk between environments.

## Recommended Strategy
- Recommended: **B** for immediate staging bootstrap, with strict runbook and verification gates.
- Rationale:
  - Current history is clearly non-bootstrap on empty DB.
  - Baseline SQL generated from schema is complete and deterministic.
  - Strategy B avoids invasive migration-history rewrites while unblocking empty staging quickly.
- Governance requirements:
  - Keep baseline file immutable once approved.
  - Record exact `migrate resolve` actions in a runbook.
  - Require post-apply checks (`migrate status`, schema diff, smoke query checks).

## Proposed Dry-Run (Do Not Run on Neon)
Use a disposable local PostgreSQL database only.

1. Start ephemeral PostgreSQL (example):
```bash
docker run --rm --name p0e8-baseline-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=p0e8_baseline -p 5544:5432 -d postgres:16
```

2. Apply baseline SQL manually:
```bash
psql "postgresql://postgres:postgres@localhost:5544/p0e8_baseline" -v ON_ERROR_STOP=1 -f prisma/baselines/20260803_p0_e8_empty_to_current/baseline.sql
```

3. Validate Prisma schema and client generation:
```bash
set DATABASE_URL=postgresql://postgres:postgres@localhost:5544/p0e8_baseline
npx prisma validate
npx prisma generate
```

4. Verify migration status coherence (after applying chosen resolve policy):
```bash
set DATABASE_URL=postgresql://postgres:postgres@localhost:5544/p0e8_baseline
npx prisma migrate status
```

5. Verify resulting schema equivalence:
```bash
set DATABASE_URL=postgresql://postgres:postgres@localhost:5544/p0e8_baseline
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
```
Expected: empty diff.

6. Safety checks on baseline file:
```bash
# no DROP / no DML expected
```

## Determinism Evidence
- Baseline file hash (SHA256): `FFA1BB29079925FBC87DFCFD56D03704F8349CB7FDBE925961A932D469B7BCF6`
- Regenerated baseline hash (SHA256): `FFA1BB29079925FBC87DFCFD56D03704F8349CB7FDBE925961A932D469B7BCF6`
- Match: true

## Artifacts
- `prisma/baselines/20260803_p0_e8_empty_to_current/baseline.sql`
- `artifacts/staging/p0-e8-baseline-audit/audit-report.md`
- `artifacts/staging/p0-e8-baseline-audit/object-matrix.csv`
- `artifacts/staging/p0-e8-baseline-audit/baseline-static-verification.json`
- `scripts/db/p0-e8-baseline-audit.mjs`
