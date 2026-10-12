# Application Async Worker

The application worker is a persistent process separate from `next start`. It reuses the `AsyncJob` engine and application handler registry; it does not create a second queue.

## Commands

```text
npm run worker:readiness
npm run worker:async
npm run worker:document-extraction
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
| `ASYNC_WORKER_DEDICATED_MODE` | `false` | when `true`, both allowlists are required and non-empty |
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

## Document Extraction Activation

PDF uploads linked to a procedimento admit `DOCUMENT_EXTRACTION_V1` atomically with the
new current `DocumentFileVersion`. The HTTP request only persists the document and the
queued job; extraction remains in this separate worker.

For a scoped E2E activation that does not claim unrelated queued work, run one worker
against the E2E database with `npm run worker:document-extraction` and:

```text
ASYNC_WORKER_CONCURRENCY=1
ASYNC_WORKER_DEDICATED_MODE=true
ASYNC_WORKER_OPERATION_ALLOWLIST=DOCUMENT_EXTRACTION_V1
ASYNC_PROVIDER_EXECUTION_ENABLED=false
```

Keep `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST` set to the explicitly authorized E2E
procedimenti during canary activation. Do not run the worker with empty allowlists
while unrelated jobs are queued. The dedicated command rejects startup unless dedicated mode is enabled, the operation
allowlist contains only document-extraction operations, the procedimento allowlist is
non-empty, and provider execution is disabled. It does not load the general handler
registry or run application lifecycle bootstraps.

Scanned PDFs are not retried under `DOCUMENT_EXTRACTION_V1`. An `ADMIN` or `TECNICO`
must explicitly authorize an immutable `OCR_REQUIRED` attempt (or an
`ARTIFACT_TOO_LARGE` attempt for the V1 25-30 MB gap). This admits a versioned
`DOCUMENT_OCR_COORDINATOR_V2` job under
`DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2`; it never mutates or requeues the failed V1
job.

Do not add OCR to the existing direct-extraction worker. Run a separate service using
the OCR-specific command `npm run worker:document-ocr`, with a distinct worker ID and an OCR-only operation
allowlist:

```text
ASYNC_WORKER_CONCURRENCY=1
ASYNC_WORKER_DEDICATED_MODE=true
ASYNC_WORKER_OPERATION_ALLOWLIST=DOCUMENT_OCR_COORDINATOR_V2,DOCUMENT_OCR_PAGE_BATCH_V2
ASYNC_PROVIDER_EXECUTION_ENABLED=false
NODE_OPTIONS=--max-old-space-size=1024
```

Local OCR uses the bundled Italian Tesseract model and does not call an AI provider.
The coordinator validates the immutable file manifest and reads the structural PDF page
count without rendering or OCR. The admitted limit is 30 MiB and 100 pages. Page jobs
process inclusive ranges of five pages sequentially, with a 45-second OCR timeout per
page and an 8-million-pixel raster limit. The raster cap bounds the canvas RGBA
allocation to about 32 MB before PNG and OCR working memory.

Each completed page is persisted immediately with its source version, page number,
method, raw and normalized text, SHA-256, OCR confidence, warnings, and tool versions.
The page record is immutable. A retry skips existing checkpoints, and the final page
atomically creates one successful `DocumentExtractionAttempt` for the complete document.
Only that final attempt can update the fascicolo corpus and downstream legal analysis.
Only the next range is admitted after a range completes, so long documents yield the
OCR queue between batches instead of enqueueing all 20 ranges at once. Use
`ASYNC_WORKER_CONCURRENCY=1`; do not run two OCR jobs concurrently in the same 2 GB
instance.

Measured local profiles with Node's old-space limit set to 320 MB reached approximately
509 MB RSS for a 20-page A4 scanned PDF and 644 MB RSS for one page near the pixel
boundary. A 512 MB Render instance therefore has no safe operating margin and must not
enable either V2 OCR operation. Use a separate `1c-2g` Render background worker (2 GB
RAM) with a distinct worker ID and a non-empty procedimento allowlist. The
`20261012_document_ocr_batch_pipeline` migration is required before activation. Keep
both OCR operations absent from every deployed allowlist until the migration, service,
and explicit processing authorization have separately been approved.

The V2 batch path was also profiled with `NODE_OPTIONS=--max-old-space-size=1024`
against image-only A4 PDFs while reopening the source for each five-page job, as the
production worker does. A 50-page, 20.05 MB file completed in 262.5 seconds with a
688.5 MiB peak RSS. A 100-page, 29.96 MB file completed in 533.7 seconds with a
730.6 MiB peak RSS. Structural preflight returned the exact page count in both cases,
and all pages were extracted. These measurements support one concurrent OCR batch on
2 GB; they do not support OCR on 512 MB or multiple concurrent batches per instance.

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