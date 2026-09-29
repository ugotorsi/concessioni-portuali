# Application Async Worker

The application worker is a persistent process separate from `next start`. It reuses the `AsyncJob` engine and application handler registry; it does not create a second queue.

## Commands

```text
npm run worker:readiness
npm run worker:async
```

The readiness command is read-only. It checks database connectivity, the Lotto 8 migration, provider-mode cost configuration, required budget scopes, and optionally a live worker heartbeat. It prints one sanitized JSON result and exits non-zero on failure.

## Configuration

| Variable | Default | Constraint |
|---|---:|---:|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `ASYNC_WORKER_ID` | host/process | 1-256 characters; unique per process |
| `ASYNC_WORKER_CONCURRENCY` | `1` | 1-32 lanes |
| `ASYNC_WORKER_IDLE_BACKOFF_MS` | `1000` | 100-60000 ms |
| `ASYNC_WORKER_ERROR_BACKOFF_MS` | `5000` | 100-60000 ms |
| `ASYNC_WORKER_RETRY_DELAY_MS` | `30000` | base delay, 0-2592000000 ms |
| `ASYNC_WORKER_OPERATION_ALLOWLIST` | empty | comma-separated canary scope |
| `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST` | empty | comma-separated canary scope |
| `ASYNC_PROVIDER_EXECUTION_ENABLED` | `false` | blocks provider-backed claims when false |
| `ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR` | required when providers enabled | positive decimal, max 6 decimals |
| `ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR` | required when providers enabled | positive decimal, max 6 decimals |
| `ASYNC_READINESS_REQUIRE_LIVE_WORKER` | `false` | set true for post-start readiness |

Provider credentials are validated by their adapters only when the corresponding workload is eligible. Never print environment values.

## Staging Rollout

1. Back up staging and record the current migration head and queue counts.
2. Deploy application code with `ASYNC_PROVIDER_EXECUTION_ENABLED=false`.
3. Apply migrations with `npm exec prisma migrate deploy`.
4. Run `npm run worker:readiness`; require `ready:true` and `migrationCompatible:true`.
5. Start one worker process with concurrency `1` and a unique worker ID.
6. Set `ASYNC_READINESS_REQUIRE_LIVE_WORKER=true` and rerun readiness.
7. Verify `/api/admin/runtime-health` and `/admin/runtime`: live heartbeat, no stale lease, expected queue depth.
8. Admit only synthetic/canary jobs through operation and procedimento allowlists.
9. Test `SIGTERM` while a synthetic job is active; confirm no new claim and clean drain.
10. Configure enabled EUR budget policies for GLOBAL, TENANT, and PROCEDIMENTO scopes.
11. Only after separate authorization, configure provider credentials, positive cost estimates, and enable provider execution.
12. Remove canary allowlists only after queue, failure, latency, and cost observations are accepted.

## Persistent Service

Run the worker under the platform process manager with automatic restart and graceful `SIGTERM`. A systemd deployment can use:

```ini
[Service]
Type=simple
WorkingDirectory=/srv/concessioni
EnvironmentFile=/etc/concessioni/worker.env
ExecStart=/usr/bin/npm run worker:async
Restart=on-failure
RestartSec=5
TimeoutStopSec=360
KillSignal=SIGTERM
```

Use one service instance per unique `ASYNC_WORKER_ID`. Horizontal processes and local lanes share the same atomic `FOR UPDATE SKIP LOCKED` claim authority.

## Health And Operations

The admin-only health endpoint is `/api/admin/runtime-health`; the admin technical page is `/admin/runtime`. They expose worker freshness, queue depth, oldest pending age, running/failed jobs, stale leases, last success, migration compatibility, configured caps, and cost reservations. They never expose job payloads.

Terminal failures remain visible in `AsyncJob`. Admin retry adds one allowed attempt, preserves `attemptCount`, clears sanitized failure codes, and writes an audit event. Dependencies with terminal parents remain queued with `DEPENDENCY_TERMINAL_FAILURE` for operator inspection.

## Recovery And Rollback

- Provider incident: set `ASYNC_PROVIDER_EXECUTION_ENABLED=false` and restart the worker. Provider-backed jobs remain queued; local jobs continue.
- Worker incident: send `SIGTERM`, wait for drain, then stop the service. Expired leases are recoverable by the next worker.
- Cost incident: disable provider mode after recording current reservations. Expired reservations are released by worker heartbeat.
- Application rollback: roll back code while keeping the additive schema. Do not reverse the migration or drop runtime tables during incident response.
- Database incompatibility: do not start the worker. Restore from the approved backup or deploy the compatible code/migration pair.

## Go/No-Go

Go requires: migration compatible, readiness exit zero, live heartbeat after start, provider mode false for initial canary, zero stale leases, complete scoped caps before providers, synthetic multi-fascicolo completion, graceful shutdown proof, and admin health visibility.

No-go applies to: missing migration, missing cap scope, invalid cost estimate, absent worker with queued work, stale leases not recovered, duplicate material effects, unsanitized logs, or any real provider/network call during synthetic acceptance.