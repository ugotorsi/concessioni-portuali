# Application Async Worker

This process operationalizes the existing `AsyncJob` engine and application handler registry. It does not define a queue, lease, retry, heartbeat, cancellation, or workload implementation.

## Runtime

Run one initial worker process with:

```text
npm run worker:async
```

The normal web process (`next start`) does not start this worker automatically. The web process and `npm run worker:async` are separate processes and must be deployed and started separately.

The worker drains one job at a time through `drainOneApplicationAsyncJob`. An idle iteration waits before polling again. A recoverable drain error is reported and followed by a separate bounded backoff. `SIGINT` and `SIGTERM` stop new drain attempts and let the active drain finish under the existing lease and heartbeat semantics.

This block does not authorize activation in staging or production. Do not start this command against either environment until a later environment-specific database gate has been authorized and completed.

Block 3B.7 did not deploy the worker to staging or production and did not run the worker against a real database. Its authorized tests and smoke checks ran without using a staging or production database. Any real worker activation requires separate authorization.

## Configuration

`DATABASE_URL` is required. The process fails before starting when it is absent.

Optional server-side variables:

| Variable | Default | Bounds |
|---|---:|---:|
| `ASYNC_WORKER_ID` | `<hostname>:<pid>` | 1-256 characters |
| `ASYNC_WORKER_IDLE_BACKOFF_MS` | `1000` | 100-60000 ms |
| `ASYNC_WORKER_ERROR_BACKOFF_MS` | `5000` | 100-60000 ms |
| `ASYNC_WORKER_RETRY_DELAY_MS` | `30000` | 0-2592000000 ms |

Provider credentials remain optional. They are validated by the provider adapter only when the corresponding workload is eligible.

## Observability

The process emits one-line JSON events for start, stop, shutdown request, processed jobs, idle transition, recoverable loop errors, and fatal configuration. Error messages and environment values are not logged.

Idle reporting is transition-based rather than emitted on every empty poll. Deploy the first runtime with one process and concurrency `1`; the existing database lease protocol remains the authority if future deployments add worker processes.

## Deployment Gate

Before activation, verify the target schema contains the committed `AsyncJob` and intake migrations, configure durable document storage, set a unique `ASYNC_WORKER_ID`, and confirm log collection. Then prove upload through official lookup in an authorized non-production environment and test graceful termination while a job is running.