# Runbook Neon Staging - P0-E8 Baseline (Not Executed)

Status: proposed only, not executed in this dry-run

## Preconditions

- Approved maintenance window.
- Explicit authorization to operate on staging.
- Confirm target is staging, not production.
- Confirm baseline file hash matches approved value.
- Confirm migration folders present and immutable:
  - 20260727_decisione_procedimento_minima
  - 20260802_p0d1_stato_effetto

## Pre-check

1. Verify connectivity to staging with least privilege credentials.
2. Verify current schema snapshot metadata.
3. Verify there is no active deploy that may race schema operations.
4. Verify Prisma schema version and baseline hash are the approved ones.
5. Verify expected empty-vs-current strategy is still valid for target DB state.

Stop condition:

- If target DB is not the expected staging instance, stop immediately.

## Backup or Snapshot

1. Create DB snapshot or logical backup per platform policy.
2. Validate backup completion and retention label.
3. Record backup identifier in change ticket.

Stop condition:

- If backup cannot be verified, do not continue.

## Apply baseline

1. Apply only baseline SQL:
   - prisma/baselines/20260803_p0_e8_empty_to_current/baseline.sql
2. Use transactional and stop-on-error mode where feasible.
3. Record start/end timestamps and SQL exit code.

Stop condition:

- Any SQL error, object conflict, or unexpected DDL output.

## Align migration history (Strategy B)

1. Set staging datasource via environment variable (do not print URL).
2. Mark applied in chronological order:
   - npx prisma migrate resolve --applied 20260727_decisione_procedimento_minima
   - npx prisma migrate resolve --applied 20260802_p0d1_stato_effetto
3. Confirm rows in _prisma_migrations for both entries.

Stop condition:

- If resolve fails for any migration, stop and investigate before deploy.

## Prisma checks

1. npx prisma migrate status
2. npx prisma migrate deploy
3. npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

Expected outcomes:

- status coherent and up to date
- deploy no-op (no recreate attempts)
- diff empty or semantically equivalent

Stop condition:

- Any "already exists" error
- Any pending migration mismatch
- Any non-empty unexpected diff

## Endpoint reconnaissance

1. Execute smoke checks on critical API endpoints.
2. Execute read-path checks on concession/procedimento/decisione flows.
3. Verify no regression in document and legal-source modules.
4. Verify application logs for migration/runtime DB errors.

Stop condition:

- Any blocking functional regression.

## Rollback policy

1. If failure occurs before write traffic resumes, restore from snapshot.
2. If failure occurs after write traffic resumes, trigger incident protocol and data consistency assessment.
3. Preserve logs and migration traces for postmortem.

## Security and logging constraints

- Do not print passwords, tokens, full connection URLs, or real hostnames.
- Do not export data dumps into PR artifacts.
- Keep logs to operational metadata only.
