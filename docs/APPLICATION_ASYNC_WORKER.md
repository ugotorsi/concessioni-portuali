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
| `ASYNC_WORKER_EXIT_ON_IDLE` | `false` | one-off mode; exit after the first empty scoped claim |
| `ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES` | `true` | disable for document-analysis one-off jobs |
| `ASYNC_WORKER_OPERATION_ALLOWLIST` | empty | comma-separated canary scope |
| `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST` | empty | comma-separated canary scope |
| `ASYNC_WORKER_DEDICATED_MODE` | `false` | when `true`, both allowlists are required and non-empty |
| `ASYNC_PROVIDER_EXECUTION_ENABLED` | `false` | blocks provider-backed claims when false |
| `ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR` | required for generic workers or an allowlist containing `FASCICOLO.AUTOMATIC_ANALYSIS_V1` | positive decimal, max 6 decimals |
| `ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR` | required for generic workers or an allowlist containing `LEGAL_RESEARCH.EXECUTE_V1` | positive decimal, max 6 decimals |
| `ASYNC_READINESS_REQUIRE_LIVE_WORKER` | `false` | set true for post-start readiness |
| `DOCUMENT_WORKER_ACTIVATION_MODE` | `DISABLED` | `DISABLED` or `RENDER_ONE_OFF` |
| `DOCUMENT_WORKER_ACTIVATION_TIMEOUT_MS` | `10000` | 1000-30000 ms |
| `RENDER_APPLICATION_WORKER_SERVICE_ID` | empty | Render `srv-...` or `crn-...` base service |
| `RENDER_DOCUMENT_OCR_WORKER_SERVICE_ID` | empty | Render `srv-...` or `crn-...` OCR base service |
| `RENDER_WORKER_API_KEY` | empty | server-side secret; never logged |
| `DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST` | empty | required scoped recovery procedures |

Provider credentials are validated by their adapters only when the corresponding workload is eligible. Never print environment values.

## Selvara failed one-off recovery

`recoverSelvaraFailedDocumentAnalysisActivation` is a server-only, incident-specific
recovery function. It is not exposed through a route, action, or generic retry, and its
caller supplies only the administrator identity. Every invocation reads the dedicated
service, exact one-off, complete paginated job list, and complete paginated job logs
directly from the official Render API. It requires the service to remain suspended and
all execution gates to remain off. The verified `failed` job must have the exact original
command and a terminal timestamp, with no other one-off targeting the application job.
The complete logs must prove the exact fatal configuration event after process startup
and before the runtime-created event; missing, incomplete, contradictory, or unparseable
evidence fails closed before database access.

After remote verification, the function revalidates the immutable Selvara authorization
and unchanged application job under a serializable transaction and row lock, rejects
competing application work, and appends a reconciled `NOT_REQUESTED` ledger entry with
the independently produced evidence and administrator identity. It never updates the
`AsyncJob` row. This recovery retains the original V3 purpose and
`NOETRA-V3-SELVARA-2026-10-25-ONE-SHOT` approval. The V7 approval is not accepted by
the recovery and the V3 approval does not authorize V7 admission or provider spend.

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

## NOETRA V7 controlled Selvara collaudo

The first V7 Selvara attempt used approval
`NOETRA-V7-SELVARA-2026-10-26-CONTROLLED-ONE-SHOT` and terminal job
`cmvpei5gt0000c0ud3f9txqil`. The second used approval
`NOETRA-V7-SELVARA-2026-10-26-CONTROLLED-ONE-SHOT-02` and terminal job
`cmvpfm50p000010udtpjtrfn3`. The third used approval
`NOETRA-V7-SELVARA-2026-10-27-CONTROLLED-ONE-SHOT-03` and terminal job
`cmvqkf4ow0000vcudzvjcfdy7`; all historical identities are immutable. The prepared
fourth single-attempt admission bound the V7 document-analysis contract, corpus
fingerprint, and `NOETRA-V7-SELVARA-2026-10-27-CONTROLLED-ONE-SHOT-04` approval.
The fifth admission used the distinct
`NOETRA-V7-SELVARA-2026-10-29-CONTROLLED-ONE-SHOT-05` identity. Its deterministic
logical operation ID is
`42135b9b107af8c93a6336f4086502c5b90744d296653bac7e8076d342f5253d`.
Job `cmvtfse9c0000lkud7rga99sp` made its single provider call, then failed terminally
with `V7_OUTPUT_INCOMPLETE` before persistence. It settled EUR 0.193852 and released
EUR 0.564705. No retry was performed. The failure exposed a mismatch between the
strict provider schema, which allowed empty required collections, and the V7
post-response completeness gate. The corrected schema requires those collections
to be non-empty and the runtime now distinguishes empty required sections from
incomplete document-inventory coverage. For the unchanged 40-page corpus, the
corrected schema estimates 40,376 input tokens and EUR 0.758624 maximum cost, still
within the existing EUR 0.762000 approval ceiling. Any future paid attempt requires
a new explicit authorization. The sixth identity
`NOETRA-V7-SELVARA-2026-10-29-CONTROLLED-ONE-SHOT-06` was executed once as job
`cmvtheqez0000koudqkfrg9c4`. It failed terminally with `INVALID_PROVIDER_OUTPUT`
before persistence, settled EUR 0.176573, and released EUR 0.582051. Safe
diagnostics established that the provider proposed incompatible research
reference-date item kinds and unverifiable inventory-to-item relations. The
deterministic compiler now downgrades incompatible dates to `UNKNOWN` and rebuilds
inventory relations only from retained items with authenticated overlapping
evidence. No retry was performed; any later paid attempt requires a new explicit
authorization and immutable identity.
The prepared seventh identity is
`NOETRA-V7-SELVARA-2026-10-29-CONTROLLED-ONE-SHOT-07`. It binds the same authenticated
40-page corpus to the structurally separated provider contract: the provider proposes
only interpretive items and evidence-span selections, while the server owns document
inventory, provenance, canonical quotations, proceeding anchors, reference dates, and
verified relationships. The request estimates 37,077 input tokens and at most EUR
0.752726 with the unchanged 64,000-token output ceiling. The existing EUR 0.758624
runtime reservation and EUR 0.762000 approved ceiling remain unchanged. The seventh
identity was executed once as application job `cmvtkqcav0000pcudris24p6p` and Render
one-off `job-dbhkhj8ae00c73e0rlg0`. The provider call completed with EUR 0.140966
internally accounted cost, but the application job failed terminally before report
persistence with Prisma `P2028` while persisting structured knowledge. The immediate
failure was the default 5-second interactive transaction timeout on a persistence
transaction that took about 6.5 seconds. The structural cause was an N+1 pattern:
evidence authorization and item, evidence, and relation writes incurred one Neon
round-trip per row. These operations are now performed with bounded JSON recordset
validation and batch inserts. Fascicolo knowledge persistence also uses a bounded
30-second transaction timeout as a safety margin; other serializable transactions
retain their existing default. The 40-page offline integration test enforces no more
than 25 knowledge-persistence query calls for 60 accepted items. No retry or eighth
paid attempt was performed.

The prepared eighth identity is
`NOETRA-V7-SELVARA-2026-10-29-CONTROLLED-ONE-SHOT-08`. It is distinct from the
terminal seventh job and binds the same tenant, proceeding, authenticated 40-page
corpus fingerprint, controlled V7 purpose, operation, contract, and economic
preflight. Admission remains single-attempt (`maxAttempts=1`) and is not authorized
until a new explicit approval is given. Preparing this identity does not admit a
job, enable a gate, or call a provider.

The isolated database proof is fail-closed and uses an in-memory fixture provider,
never a configured AI provider. Run it only against an explicitly approved,
non-production database with all worker/provider gates disabled:

```bash
PERSISTENCE_E2E_ALLOWED=true npm run test:persistence:e2e -- \
  --execute-isolated-e2e --run-id <isolated-run-id>
```

The harness creates unique synthetic tenant, procedure, document, extraction, and
40-page records; compiles and authenticates structured knowledge; persists and
promotes the revision and report atomically; reads it through the application query;
checks report idempotency and tenant isolation; and proves an invalid-evidence
transaction leaves no revision while preserving the prior `CURRENT` revision.
Repeating the same admission reuses the same job. Changing the approved preflight after admission causes
an idempotency conflict instead of creating a second attempt. The job has
`maxAttempts=1`; provider timeouts, rate limits, unavailable responses, malformed or
incomplete output, and knowledge-quality failures are terminal. Manual retry is
disabled for this purpose. The targeted one-off uses a 15-minute lease so a configured
600-second provider timeout cannot expire the claim; non-targeted application workers
retain their five-minute lease.

Admission requires a local preflight with all of these values:

- `AI_V7_PREFLIGHT_APPROVAL_ID`;
- `AI_V7_APPROVED_MAX_OUTPUT_TOKENS`;
- `AI_V7_APPROVED_MAX_COST_EUR`;
- `AI_OPENAI_MAX_INPUT_TOKENS`, `AI_OPENAI_MAX_OUTPUT_TOKENS`;
- `AI_MAX_INPUT_BYTES`, `AI_OPENAI_MAX_RAW_RESPONSE_BYTES`;
- `AI_OPENAI_TIMEOUT_MS`;
- `AI_OPENAI_USD_TO_EUR_RATE`, `AI_OPENAI_USD_TO_EUR_RATE_DATE`,
  `AI_OPENAI_USD_TO_EUR_RATE_SOURCE`;
- `ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR`, equal to the computed worst-case EUR
  amount so the runtime reserves the full approved execution maximum.

The controlled V7 path requires `NOETRA_CANONICAL_IDENTITY_V3_ENABLED=false`. It writes
a distinct `FASCICOLO_STRUCTURED_KNOWLEDGE_V7` revision contract so the verified V7
result cannot be confused with the existing same-corpus V1 revision. Canonical identity
V3 requires a separate future compatibility decision and is rejected before admission.
The V7 revision remains `BUILDING` while missions are reconciled and its structured
report is prepared from that exact revision. Promotion to `CURRENT`, supersession of
the prior current revision, and report persistence are the final transaction. A
reconciliation, report, or finalization failure is terminal, leaves the prior revision
current, and never exposes the incomplete report as definitive.

The preflight measures the serialized provider request, includes reasoning tokens in
the billable output ceiling, applies the versioned model tariff, and checks every
enabled GLOBAL, TENANT, and PROCEDIMENTO budget window. Missing limits, missing budget
scopes, insufficient headroom, an unapproved output ceiling, or an unapproved monetary
maximum prevents admission.

Immediately before provider submission, the worker recognizes the controlled V7
purpose independently of the current approval configuration. It reloads the durable
job identity, requires `maxAttempts=1`, verifies tenant, procedimento, corpus,
operation, V7 contract, exact approval and deterministic logical operation ID, then
rebuilds the complete economic preflight from the acquired corpus and current runtime
configuration. The rebuilt fingerprint must equal the `trialPreflightHash` stored at
admission. Missing or replaced approval, changed limits, pricing, FX, timeout, budget
state, reservation amount or fingerprint terminates the job before provider dispatch
and is not retryable.

The OpenAI transport marks an attempt as potentially dispatched immediately before
calling the HTTP transport. A failure before that point releases the reservation. If
the request was or may have been dispatched and reliable usage is unavailable, the
runtime settles the full reserved maximum conservatively instead of releasing it.
Reliable provider usage is internally accounted at the versioned tariff, but the
provider-billed amount remains `NOT_VERIFIED` until independently reconciled. A later
output-completeness or knowledge-quality failure does not undo the settlement and
cannot schedule another V7 attempt.

For a later authorized release, preserve the dirty source worktree and `.tmp/`. Do not
use `git add -A`. Select only the reviewed V7 source, test, fixture, and documentation
paths; inspect the staged list and run `git diff --cached --check` before creating an
immutable commit. Open the release against `staging-operativo`, require the staging
workflow, TypeScript, focused tests, and production build to pass, then deploy web and
the application-worker base service from the same SHA.

Keep `AI_REAL_DATA_ENABLED=false`, `ASYNC_PROVIDER_EXECUTION_ENABLED=false`,
`DOCUMENT_WORKER_ACTIVATION_MODE=DISABLED`, and
`AUTOMATIC_RESEARCH_EXECUTION_ENABLED=false` through deployment and readiness.
Enabling the exact V7 approval and one-off activation requires a separate authorization.
After the one job reaches `SUCCEEDED` or `TERMINAL_FAILED`, restore those disabled
values, restart the affected processes, keep the worker suspended, and retain the job,
cost ledger, diagnostics, knowledge revision, and report artifacts.

For the controlled V7 run, a valid and grounded provider output is encrypted with
AES-256-GCM and written to the configured S3/R2 storage before structured knowledge
persistence begins. The artifact is bound to the immutable job, tenant, procedimento,
corpus fingerprint, and approval identifier, and is deleted after successful atomic
finalization. If the original single-attempt job terminates in the `PERSISTENCE`
category, an operator may temporarily enable
`AI_PROVIDER_OUTPUT_RECOVERY_ENABLED=true` and run:

`npm run runtime:recover-v7-provider-output -- --job-id <JOB_ID> --approval-id <APPROVAL_ID> --confirm PERSIST_ONLY_WITHOUT_PROVIDER_CALL`

The recovery command refuses non-terminal, multi-attempt, non-V7, non-persistence, or
misbound jobs. It decrypts the authenticated artifact, re-runs validation and only the
knowledge/report persistence path, audits the recovery, preserves the failed job's
historical status, makes no provider call, and deletes the artifact after success.
Keep the recovery gate false unless this explicitly authorized path is required.

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

## Event-Driven One-Off Activation

When `DOCUMENT_WORKER_ACTIVATION_MODE=RENDER_ONE_OFF`, committed document jobs request
Render one-off jobs through the official Create Job API. Activation is post-commit:
an unavailable Render API cannot roll back or delete the durable `AsyncJob`.

The application generates fixed commands with a validated procedimento identifier:

- direct extraction: only `DOCUMENT_EXTRACTION_V1`, provider execution disabled,
  command `npm run worker:document-extraction`;
- OCR: only `DOCUMENT_OCR_COORDINATOR_V2` and `DOCUMENT_OCR_PAGE_BATCH_V2`, provider
  execution disabled, command `npm run worker:document-ocr`;
- document analysis: only `FASCICOLO.AUTOMATIC_ANALYSIS_V1`, the same procedimento
  allowlist, time-watch bootstrap disabled, command `npm run worker:async`.

The analysis command does not allow `LEGAL_RESEARCH.EXECUTE_V1`. It therefore cannot
claim or execute automatic legal-research jobs. Existing provider, real-data, approval,
budget, tenant, and procedimento gates still apply to the document-analysis handler.

Each generated command sets concurrency `1`, dedicated mode, both claim allowlists,
and `ASYNC_WORKER_EXIT_ON_IDLE=true`. The worker drains eligible child jobs, exits after
the first empty scoped claim, and waits once for `ASYNC_WORKER_RETRY_DELAY_MS` after a
retryable failure. OCR coordinator and page-batch jobs remain on the existing V2
pipeline; `NEUTRAL_INTAKE_EXTRACTION_V1` is not used as an OCR replacement.

Render documents that an already running one-off job continues if its base service is
suspended. The public documentation does not explicitly guarantee that a new one-off
job can be created from an already suspended base service. Keep activation mode
`DISABLED` until this is confirmed by Render or by a separately authorized non-production
test. Do not resume a polling background worker merely to test this assumption.

If Render does not permit creation from a suspended `srv-...` base, use dedicated
Render Cron services (`crn-...`) as the base artifacts for application and OCR one-off
jobs. Configure the OCR Cron base with the approved 2 GB plan. Their ordinary schedule
must remain a low-frequency scoped recovery run, not a continuous worker and not a
frequent empty wake-up. The event-driven Create Job request remains the normal path.

Activation failures emit only a bounded error code and HTTP status. The queued job
remains recoverable. Render does not expose an idempotency key for Create Job; duplicate
one-off requests are safe at the queue level because claim authority remains
`FOR UPDATE SKIP LOCKED`, although duplicate instance startup can add cost.

### Scoped recovery

`npm run worker:document-recovery` is an optional low-frequency recovery command. It:

1. requires a non-empty `DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST`;
2. performs one scoped Neon query for due `QUEUED`/`RETRY_WAIT` jobs and expired
   `RUNNING`/`CANCELLATION_REQUESTED` leases;
3. considers only direct extraction, OCR V2, and document-analysis operations;
4. coalesces OCR coordinator and page-batch recovery per procedimento;
5. creates no one-off jobs when the scoped queue has no recoverable work.

The recovery command necessarily wakes Neon once when scheduled. Do not configure it
as a frequent poller. Enable it only as a bounded safety net after one-off creation from
the chosen base services has been validated, and select the longest acceptable recovery
interval. Future `RETRY_WAIT` jobs are ignored until `availableAt`.

### Failed canary recovery

For a terminal canary failure, first correct the diagnosed configuration without
changing the job payload. In `/admin/runtime`, an ADMIN can retry the exact
`TERMINAL_FAILED` job. The audited transition preserves `attemptCount`, adds one
allowed attempt, clears only sanitized failure metadata, and returns the job to
`QUEUED`.

After that commit, the admin action requests the same scoped one-off used by normal
document admission. The closed operation mapping accepts only direct extraction, OCR
V2 coordinator/page batches, and document analysis. A terminal
`LEGAL_RESEARCH.EXECUTE_V1` job is never activated by this path. If Render activation
is unavailable, the job remains durable and the procedure-scoped recovery command can
request it later.

For OpenAI document-analysis failures, logs expose only:

- the invalid runtime environment variable name for local configuration errors; or
- the mapped error code, HTTP status, and a validated provider error code for provider
  responses.

Provider messages, response bodies, API keys, and environment values are not logged.
Document analysis uses a strict Responses JSON Schema for all structurally representable
constraints. Cross-collection constraints that JSON Schema cannot express are supplied
as versioned semantic rules and enforced again by the document-specific Zod contract
before persistence. Invalid-output logs contain only allowlisted semantic codes and
structural paths; they never contain provider output or document text. Citation
existence, uniqueness, page recovery, and material coverage remain deterministic
quality-gate checks against trusted extracted text.

The V7 provider contract keeps deterministic corpus authority out of the probabilistic
response. The provider proposes interpretive items, legal issues, research questions,
and evidence-span selections. It does not return document inventory, canonical
provenance, proceeding anchors, literal quotations, or reference-date links. The
server:

- constructs one authenticated inventory entry for every corpus page;
- derives inventory-to-item relationships from verified evidence-span overlap;
- adds an explicit `UNCERTAIN` coverage gap when a page has no verified interpretive
  item instead of declaring the page non-material;
- reconstructs unique proceeding anchors and exact research dates when the authenticated
  origins make them unambiguous; and
- quarantines an isolated unverified claim without discarding an otherwise complete
  report, while still blocking promotion when a legal origin, required relation, or
  material evidence dependency is lost.

Regression fixtures for ONE-SHOT-01 through ONE-SHOT-06 are synthetic reconstructions
of the recorded failure classes and diagnostic paths; original provider payloads were
not retained and the fixtures must not be represented as verbatim outputs. The offline
Selvara acceptance runs all 40 pages through request construction, provider-boundary
parsing, deterministic compilation, PGlite persistence, CURRENT promotion, report
archival, and report query. It also removes an essential concession-act evidence
candidate and verifies that the resulting revision/report remain non-current while the
previous CURRENT remains available.

With the same 64,000-token output ceiling and EUR/USD rate `0.89381`, the reduced V7
wire contract estimates 37,077 input tokens and a maximum of EUR `0.752726` for the
offline 40-page Selvara corpus. The existing EUR `0.758624` runtime reservation and
EUR `0.762000` approved ceiling remain conservative; this contract change does not
increase or authorize either amount.

Before retrying the canary, verify that its operation is exactly
`FASCICOLO.AUTOMATIC_ANALYSIS_V1`, its procedimento is the authorized canary, and the
corrected configuration has been deployed in the base service's latest successful
build artifact.

### Obsolete queued analysis cancellation

Use `npm run job:cancel-obsolete-analysis --` only for a named
`FASCICOLO.AUTOMATIC_ANALYSIS_V1` job whose corpus fingerprint is no longer current.
The command is dry-run by default and requires the exact job, tenant, procedimento,
obsolete fingerprint, current fingerprint, and actor role. It accepts `--apply` only
when `--confirm-job-id` repeats the exact job ID.

The apply path rechecks the scope, operation, input reference, zero attempt count,
queue state, and state version in the same serializable transaction. A successful
transition sets `CANCELLED`, preserves the row, records cancellation timestamps, and
writes `ASYNC_JOB_OBSOLETE_CORPUS_CANCELLED` to the hash-chained audit log. Repeating
the same authorized operation returns `ALREADY_CANCELLED`.

Never use this operation for a current corpus, a running job, a job with attempts, or
to delete queue history.

The existing E2E service remains unchanged: its command is
`npm run worker:document-extraction`. The event-driven code does not replace that
command and does not broaden its document-extraction-only registry or allowlists.

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