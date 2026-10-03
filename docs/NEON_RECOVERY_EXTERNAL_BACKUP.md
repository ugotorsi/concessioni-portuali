# Neon staging recovery - external backup runbook

Verification date: 2026-10-03

## Scope

- Neon project: `aged-smoke-22484639`.
- Source branch: `br-frosty-moon-atdf29s8` (`staging-operativo`).
- Isolated recovery branch: `br-weathered-term-atrel3ar`.
- Production, DNS, `app.noetra.it`, AI providers, workers and protected ResearchMission are out of scope.
- Never delete a Neon branch to make room without separate authorization.

## Current platform limits

- Plan: Free (`free_v3`).
- History window: 21,600 seconds (6 hours).
- Branches: 10 used of 10 allowed.
- Manual snapshots visible: 0.
- New branch and in-place Neon branch restore both fail with `branches limit exceeded` because restore needs a temporary branch slot.
- Neon CLI exposes snapshot and branch-restore operations but no native logical database export command; the portable export path is PostgreSQL `pg_dump`.

Branch inventory at verification time:

| Branch | Parent | Created UTC | State |
| --- | --- | --- | --- |
| `br-solitary-sunset-at2k174m` (`main`) | root | 2026-07-05 08:56:23 | ready |
| `br-frosty-moon-atdf29s8` (`staging-operativo`) | `br-solitary-sunset-at2k174m` | 2026-07-24 18:19:44 | ready |
| `br-shy-sky-atsbwqn3` | `br-frosty-moon-atdf29s8` | 2026-09-16 17:01:34 | archived |
| `br-little-sound-atjnh21c` | `br-shy-sky-atsbwqn3` | 2026-09-16 17:11:30 | archived |
| `br-shy-voice-atoo8qvd` | `br-shy-sky-atsbwqn3` | 2026-09-16 17:21:39 | archived |
| `br-fancy-glitter-atoy0slq` | `br-shy-voice-atoo8qvd` | 2026-09-18 05:36:00 | archived |
| `br-fancy-cell-atx3n15z` | `br-frosty-moon-atdf29s8` | 2026-09-21 17:27:32 | ready |
| `br-delicate-cell-at66cfki` | `br-frosty-moon-atdf29s8` | 2026-09-27 09:48:08 | ready |
| `br-frosty-cherry-atrnmbsc` | `br-frosty-moon-atdf29s8` | 2026-09-27 09:48:09 | ready |
| `br-weathered-term-atrel3ar` | `br-frosty-moon-atdf29s8` | 2026-09-29 20:06:08 | ready |

The Free PITR window is not sufficient by itself for future real operational data. This runbook therefore uses a PostgreSQL custom-format backup outside Neon and proves restore into the isolated recovery branch.

## Backup policy

- Format: PostgreSQL custom format, PostgreSQL 17 client, application schema `public` only.
- Consistency: `pg_dump --serializable-deferrable`.
- Destination: outside Git under `%LOCALAPPDATA%\Noetra\backups\neon\aged-smoke-22484639`.
- Encryption: Windows EFS for the backup directory; for off-host copies use client-side AES-256/KMS encryption before upload.
- Integrity: SHA-256 sidecar plus `pg_restore --list` validation.
- Recommended frequency before real data: hourly, giving a target backup RPO of at most 1 hour when the schedule is active.
- Recommended retention: 72 hourly, 30 daily and 12 monthly copies. Replicate encrypted copies to approved object storage in a separate failure domain before production use.

The verified 2026-10-03 backup is stored outside Git at:

`%LOCALAPPDATA%\Noetra\backups\neon\aged-smoke-22484639\concessioni-neon-recovery-20261003T132054Z\staging.dump`

Its SHA-256 is:

`a4f2ef0fb7f1de4298ba40b568a67f72183112ebf5d3b2af636e0f2b1227093e`

## Backup procedure

Build the pinned PostgreSQL client image:

```powershell
docker build --file scripts/db/Dockerfile.neon-recovery --tag local/postgres-neon-recovery:17.11 scripts/db
```

Obtain the staging connection string only in memory or a short-lived protected temporary file. Never print it or commit it. Run:

```text
pg_dump --dbname=<staging-uri-with-verify-full-and-container-ca> \
  --schema=public \
  --format=custom \
  --file=/backup/staging.dump \
  --no-owner \
  --no-privileges \
  --serializable-deferrable
```

Validate before retention:

```powershell
docker run --rm --mount "type=bind,source=<backup-dir>,target=/backup,readonly" `
  local/postgres-neon-recovery:17.11 pg_restore --list /backup/staging.dump
Get-FileHash <backup-dir>\staging.dump -Algorithm SHA256
cipher /E /A <backup-dir>\staging.dump
```

The dump must exclude Neon-managed schemas such as `neon_auth`; restoring a full-database dump into a Neon branch is not supported because those schemas already exist.

## Restore procedure

1. Confirm the target is exactly `br-weathered-term-atrel3ar`, has no application traffic and is not Production.
2. Add or start a 0.25 CU read-write compute on the target only.
3. Verify the encrypted dump checksum and `pg_restore --list`.
4. Connect to the target and run `DROP SCHEMA IF EXISTS public CASCADE;`.
5. Restore with:

```text
pg_restore --dbname=<recovery-uri-with-verify-full-and-container-ca> \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  /backup/staging.dump
```

6. Run `node scripts/db/neon-recovery-audit.mjs` once with the staging URI and once with the recovery URI in `DATABASE_URL`.
7. Run `npx prisma migrate status` against both branches and require `Database schema is up to date`.
8. Require identical table count, applied migration count, migration fingerprint, schema fingerprint and sanity entity counts.
9. Remove the connection value from the process environment immediately after each audit.
10. Delete only the temporary recovery compute endpoints after validation, leaving the restored branch intact and non-operational.

## Verified drill

- Pre-restore recovery: 63 tables, 35 applied migrations; `FascicoloIntake` absent.
- Restored staging and recovery: 84 tables and 45 applied migrations each.
- Schema fingerprint: `546780c786c8c39f62abb8cd54c7a09ffbd63e7ee4f7f65c9ba239fd8927a867` on both.
- Migration fingerprint: `f70ef5c826ef0e842f99c0e1aea361cbd79a2c6a4805cb2ee0ffba771dfb3d63` on both.
- Privacy-safe counts matched: fascicoli 0, concessioni 8, documenti 17, utenti 14.
- `prisma migrate status`: PASS and up to date on both branches with 45 local migration directories.
- Sanity query: PASS.
- Backup dump duration: 59.607 seconds.
- Warm restore plus full audit RTO: 249.317 seconds.
- Compute start operation: 0.819 seconds; observed read-only compute provisioning through CLI: 1.941 seconds.
- Conservative composite RTO from compute provisioning through verified copy: 251.258 seconds (4 minutes 11.258 seconds).
- Backup snapshot age at completed validation: approximately 352 seconds (5 minutes 52 seconds), derived from dump completion minus measured dump duration through recovery validation.
- Final isolation: the recovery branch remains present with zero compute endpoints.

The measured RPO applies to this drill copy. The continuing operational RPO is bounded by backup frequency only after scheduling is enabled.

## Optional Neon upgrade

An upgrade is not required for this pre-production gate because the external backup restore succeeded. Neon Launch would improve native recovery:

- History window up to 7 days instead of 6 hours.
- Scheduled snapshots and up to 100 manual snapshots.
- Extra branches at $1.50 per branch-month, prorated hourly.
- No monthly minimum; published usage rates include $0.106/CU-hour, $0.35/GB-month storage, $0.20/GB-month instant-restore history and $0.09/GB-month snapshot storage.

Launch is recommended before relying on Neon-native PITR for real operational data, but it does not replace an independent encrypted backup.