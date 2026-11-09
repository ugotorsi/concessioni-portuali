# NOETRA — Root Cause Analysis and Definitive Solutions

## 1. Scope and decision

This report reviews the Production observations documented in
`NOETRA_PRODUCTION_E2E_REPORT.md` and `NOETRA_POST_AUDIT_PRIORITY_DIAGNOSIS.md`,
the Production code at commit `d034460ea858675a62c3ee4e12d52664ea501007`,
and the three remediation commits on
`fix/noetra-post-audit-remediation-20261109`:

1. `bf715282fd891a939d77edb64ea540dd8a97344f` — effective AI control representation;
2. `ea28284ed6a2d44c9bc3323dc15b9e6e95ca0efb` — reviewed concession reconciliation;
3. `10b2769b04f6aa4505407f0e50e90b53f7c4219c` — draft idempotency and archival.

The investigation was read-only with respect to Production. No real database,
fascicolo, AI control, provider, worker, automation, deployment or paid operation
was modified or started.

### Final judgment: **GO for PR review; Production remains NO-GO**

The structural candidate and its isolated PostgreSQL/MFA evidence are complete
and PR #73 is technically suitable for integration review. The remaining
operational blockers now have fail-closed tooling and one release runbook, but
the required human-authorized executions have not been represented as complete.
Production promotion remains **NO-GO** until:

- the protected read-only Production preflight proves normalized-title
  uniqueness and the complete existing ActivityLog chain;
- the migration passes on an authorized isolated Production clone;
- the official PR Preview is bound to a synthetic database and passes the
  authenticated MFA workflow;
- the release manager approves backup, maintenance window, migration and
  publication separately;
- any later Selvara repair is executed as a new reviewed revision/proposal,
  never as an overwrite.

This is a release gate, not evidence that Production is currently changing data
spontaneously.

## 2. Evidence and limits

### Verified

- Production deployment identity was verified separately as
  `dpl_Bpn8UqwPzsWcg9o68irz2XvkR4HQ` at commit
  `d034460ea858675a62c3ee4e12d52664ea501007`.
- The Selvara extraction contains concession title `17/2023`.
- The title was present in the analytical/documentary chain but absent from the
  authoritative operational concession relation.
- The last observed runtime representation was global command ON, effective AI
  ON, real-data deployment authorization ON, OpenAI manual operation available,
  general automation OFF, automatic research OFF, and no active job/worker.
- Settled costs after the visible ON transition were EUR 0.215059, associated
  with four legal-research executions and one automatic fascicolo analysis.
- The previously recorded jobs were consistent with manual requests; there is
  no evidence of spontaneous automatic execution.

### Not verified and therefore not asserted

- The exact timestamp, actor reason and full metadata of the Production
  `AI_GLOBAL_CONTROL_CHANGE` event.
- End-to-end integrity of the complete Production ActivityLog hash chain.
- Absence of historical normalized concession-number duplicates in Production.
- The final tenant ownership semantics of `Concessionario`, because the current
  model has no `enteId`.
- A Production Selvara repair, because no real-data mutation was authorized.

## 3. Root-cause matrix

| Problem | Proven root cause | Classification | Consequence | Current state |
|---|---|---|---|---|
| Global AI appeared to change from OFF to ON | Runtime state is reconstructed from the latest successful ActivityLog command; the full Production event was not available in the audit evidence | Missing observability evidence; not proven authorization defect | Exact cause cannot be attributed | Representation improved; Production event still requires authorized read-only extraction |
| Malformed AI command could look like OFF | Metadata parser coerced every non-`ON` value to `OFF` | Implementation defect | Audit corruption could be presented as a legitimate command | Fixed locally: explicit `INVALID` state, fail-closed blocker, no false transition |
| Audit hash displayed as proof of integrity | UI displayed a hash but no complete chain verification was performed | Interface/assurance defect | Operators could overestimate evidentiary assurance | Fixed locally: wording corrected and complete paginated verifier implemented |
| Selvara `17/2023` absent operationally | Reconciliation ran only while processing new provider output; unchanged corpus could reuse the current revision; analysis and authoritative concession models had no complete reviewed bridge | Design gap, stale historical data, synchronization gap | Report and operational master data diverged | Deterministic/versioned bridge exists; additional local fixes make it executable and evidence-bound |
| Concession proposal could not be completed | UI only offered plain approve/reject, while the repository required an amended professional `CREATE` or `LINK_EXISTING` payload | Function present but non-operational; UI/server mismatch | Every apparent materialization failed | Fixed locally with structured professional review forms and server-side payload construction |
| Concession evidence could be invented | Only syntactic evidence validation existed | Evidence-integrity implementation defect | Authoritative data could cite unrelated or fabricated references | Fixed locally: approved evidence must exactly match immutable proposal evidence |
| Duplicate title under concurrency | `SELECT ... FOR UPDATE` cannot lock a row that does not exist; no database uniqueness constraint existed | Concurrency and idempotency defect | Concurrent procedures could create duplicate normalized titles | Fixed locally with a tenant-scoped unique expression index and `ON CONFLICT DO NOTHING` handling |
| Concessionaire tenant was not proven | `Concessionario` has no tenant key; materialization checked only global existence | Data-model/authorization ambiguity | An opaque ID from another scope could be selected | Fixed consistently with the existing model: UI and server derive eligibility from same-tenant concessions; opaque IDs are no longer entered |
| Duplicate act drafts | Creation identity was not stable for equivalent requests and historical copies already existed | Missing idempotency plus historical data | Multiple operational drafts for the same purpose | Stable creation fingerprint committed; controlled archival committed |
| Archival could break dependencies | Archival checked activity links but not inbound draft dependencies | Implementation defect | A dependent draft could regain a permanently open prerequisite | Fixed locally: active inbound dependencies block archival |
| Archival retry was not idempotent | Version validation happened before recognizing an already archived identical copy | Retry/idempotency defect | Safe retries could report a stale-version failure | Fixed locally: an identical already archived copy is reused as a no-op |
| ActivityLog hash chain has multiple writers | Three domain paths wrote `ActivityLog` directly and manually derived hashes, bypassing the centralized advisory lock; the isolated demo seed also duplicated an incomplete hash algorithm | Structural audit defect | Concurrent application writes could fork or reorder the logical chain; seeded events failed canonical verification | Fixed locally: all application writers use the centralized lock; the destructive demo seed remains a bootstrap-only writer but uses the canonical hash implementation |

## 4. Selvara end-to-end reconstruction

### 4.1 PDF → extraction

Document versions and extraction pages are immutable/versioned. Page text has a
`textSha256`, and the Selvara evidence already proves that title `17/2023` was
extracted. The failure is therefore not OCR absence.

### 4.2 Extraction → interpretation

`src/server/ai/fascicoloDocumentAnalysis.ts` recognizes a concession title with a
deterministic pattern and now labels the rule
`CONCESSION_TITLE_RECONCILIATION_V1`. It compiles provider output together with
trusted extraction evidence. The title is not accepted merely because a model
said so.

### 4.3 Interpretation → evidence

The structured-knowledge layer stores tenant/procedure/document/version/page and
text hashes. Canonical persistence validates source text and evidence hashes.
This layer is substantially sound and explains why the title could appear in
analysis/report evidence.

### 4.4 Evidence → structured knowledge

Knowledge revisions are versioned. Controlled V7 processing builds a `BUILDING`
revision and atomically promotes it to `CURRENT`; prior revisions become
historical rather than being overwritten.

### 4.5 Structured knowledge → professional validation

Operational proposals are generated from the current structured report and
retain originating item IDs and evidence. This is the correct boundary:
documentary knowledge may propose, but may not directly mutate authoritative
concessions, subjects, deadlines or criticalities.

### 4.6 Professional validation → concession

This was the first proven break in the new remediation. The committed server
required a professional payload, but the committed UI could not create one.
The local correction:

- offers explicit `LINK_EXISTING` and `CREATE` review paths;
- builds the approved payload on the server;
- carries evidence from the immutable proposal rather than from editable JSON;
- rejects plain approval for concession reconciliation;
- hides materialization unless the approved payload is professionally complete.

### 4.7 Concession → subjects, deadlines and criticalities

These downstream materializers correctly require an authoritative concession
link. They therefore could not reliably proceed while the concession bridge was
missing. They must remain separate reviewed proposals; no automatic creation of
violations or criticalities is introduced.

### 4.8 Operational state → report

Reports are revisioned snapshots. A repair must produce a new knowledge/report
revision or a new proposal tied to the current report, preserving prior
snapshots as historical evidence.

### Exact interruption point

For Selvara, information reached extraction, interpretation, evidence,
structured knowledge and analytical reporting. It stopped at the reviewed
transition from documentary knowledge to authoritative `Concessione`, first
because no complete bridge existed and then, in the initial remediation,
because the UI could not satisfy the server contract.

### Generality

The mechanism is not hard-coded for Selvara. It is driven by:

- a versioned concession-title contract;
- tenant/procedure/report fingerprints;
- originating knowledge item IDs;
- immutable evidence;
- normalized title identity;
- professional `LINK_EXISTING` or `CREATE` decisions.

It therefore applies to other fascicoli that contain a uniquely supported
concession title. Ambiguous titles remain non-materializable.

## 5. Critical review of the three commits

### 5.1 `bf71528` — AI state representation

**What is correct**

- Separates requested command, deployment authorization, effective state,
  provider capability and automation.
- Does not change a real control.
- Exposes the latest transition reason and cancellation counts.

**Defect found**

- Invalid/missing command metadata was rendered as OFF.
- A stored hash was visually described under “integrity” without chain
  verification.

**Local completion**

- Adds `controlEventStatus: ABSENT | VALID | INVALID`.
- Fails closed on invalid metadata and exposes `INVALID_CONTROL_EVENT`.
- Prevents a new transition from silently treating a malformed predecessor as
  OFF.
- Labels the hash as an identifier whose chain is not verified in that view.

### 5.2 `ea28284` — concession reconciliation

**What is correct**

- Deterministic, versioned extraction reconciliation.
- No historical report overwrite.
- Transactional procedure link.
- Reviewed create/link distinction.
- One-time materialization record.

**Defects found**

1. no UI path to build the required payload;
2. approved evidence not bound to proposal evidence;
3. non-existent-key race in duplicate detection;
4. concessionaire tenant scope not proven;
5. initial test used artificial evidence and therefore did not prove integrity;
6. report evidence contained additional nullable provenance fields that did not
   satisfy the strict materialization contract.

**Local completion**

- Structured professional review forms and server-side composition.
- Exact immutable-evidence equality check.
- Unique expression index on
  `(enteId, lower(regexp_replace(numeroAtto, whitespace)))`.
- `INSERT ... ON CONFLICT DO NOTHING RETURNING` mapped to
  `CONCESSION_COLLISION`.
- Conservative same-tenant existing-association check for concessionaires.
- Tenant-filtered concession and concessionaire selections replace opaque IDs.
- Generation projects the exact immutable materialization evidence shape; when
  version, basis reference, page or hash is incomplete it emits a manual
  verification note instead of a non-operational concession proposal.
- Behavioral tests for evidence tampering and the complete reviewed path.

**Migration risk**

The unique index intentionally fails if historical normalized duplicates exist.
That is safer than silently choosing a winner. Production needs a read-only
preflight and, if necessary, a separately authorized deduplication plan before
the migration can run.

### 5.3 `10b2769` — draft idempotency and archival

**What is correct**

- Stable creation fingerprint and deterministic key.
- Serializable locking around draft changes.
- Immutable archive versions rather than deletion.
- Expected-version/hash checks and activity-link protection.

**Defects found**

- inbound draft dependencies were not checked;
- retrying the same archival could fail on the original expected version.

**Local completion**

- Blocks archival of any copy referenced by an active draft.
- Treats an already archived copy with the same content hash as an idempotent
  no-op.
- Adds regression tests for both cases.

## 6. AI control and execution analysis

| Layer | Actual controlling fact | Finding |
|---|---|---|
| Administrative command | Latest successful `AI_GLOBAL_CONTROL_CHANGE` | Persistent command, now represented independently |
| Effective state | Command ON + deployment authorization + emergency switch inactive | Correctly distinct from command |
| Kill-switch | `AI_GLOBAL_EMERGENCY_DISABLED` | Has precedence and blocks execution |
| Deployment authorization | real-data approval environment contract | Immutable per Vercel deployment; not an admin-command substitute |
| Providers | credential, current verification, technical qualification, pricing and real-data approval | `manualEligible` is capability, not current execution |
| Manual operation | global effective state + provider manual control + provider eligibility | Can be available while general automation is OFF |
| Automatic operation | provider automatic eligibility plus separate automation/admission controls | Must not be inferred from provider readiness alone |
| General automation | latest successful automation-control event | Separate OFF state cancels queued automatic work |
| Worker | runtime/lease/job state | No active worker/job was observed in the audit |
| Costs | settled runtime usage records | Costs prove executions, not their cause |
| ActivityLog | command and operation audit events | Full Production event and full-chain verification still required |

### Why the observed ON/OFF difference cannot yet be attributed

The code proves how state is reconstructed, but not who or why the Production
event was emitted. Attribution requires the exact Production ActivityLog row,
including ID, timestamp, actor, reason, previous/new state, request context and
hash neighbors. Any stronger conclusion would be invented.

## 7. ActivityLog structural finding and implemented resolution

`src/server/audit/auditLog.ts` correctly serializes central hash-chain writes
with a transaction advisory lock and monotonic timestamp. The independent
review found direct writers in:

- `src/server/actions/procedimenti.ts`;
- `src/server/procedimenti/applyRegisteredDecisionEffect.ts`.

Those paths previously read the same predecessor without the central chain
lock. They now call `createAuditLogInTransaction` inside their existing domain
transaction. A source scan confirms that the only remaining application call
to `activityLog.create` is inside the central writer.

The destructive demo seed is intentionally not an application writer: it first
clears `ActivityLog` and then creates a fresh genesis sequence. The review found
that it duplicated an older hash algorithm which omitted `enteId`. It now calls
the canonical `computeAuditHash` implementation, so seeded chains are compatible
with the same complete-chain verifier without importing runtime authentication
or transaction context into bootstrap code.

### Implemented solution

1. Every ActivityLog write is routed through `createAuditLogInTransaction`.
2. Tests prove lock-before-read-before-create ordering and the single global
   advisory-lock resource.
3. `verifyCompleteAuditLogChain` reads bounded pages in `(createdAt, id)` order,
   carries the previous page hash, checks every pointer and recomputes every
   current hash.
4. Tampered payloads and forked pointers identify the first invalid record.
5. The destructive demo seed uses the same canonical hash function while
   remaining explicitly outside the live application write path.

Production verification remains read-only and requires separate operational
authorization; implementing the verifier does not claim that historical
Production rows have already passed it.

## 8. Alternatives considered

### Concession identity

- **Application-only collision query:** rejected; an absent row cannot be locked.
- **Transaction advisory lock:** viable, but every creation path must use the
  same lock and key.
- **Serializable transaction only:** useful defense, but callers must retry
  serialization failures and all creation paths must use the same isolation.
- **Unique expression index:** selected as the final invariant because the
  database protects every writer. PostgreSQL explicitly supports unique indexes
  on expressions for normalized identities.
- **Stored normalized column:** also viable and easier for Prisma introspection,
  but requires a larger backfill and schema change.

### Evidence binding

- **Accept professional free-text evidence:** rejected; syntactic validity is
  not provenance.
- **Query evidence tables only at materialization:** viable.
- **Require equality with immutable proposal evidence:** selected now; the
  proposal is already tied to the current revision/report and originating item.
  A future defense-in-depth query may additionally verify the underlying
  evidence rows.

### Concessionaire tenancy

- **Global existence check:** rejected.
- **Add `enteId` immediately:** architecturally explicit but unsafe without
  historical ownership analysis and backfill.
- **Require an existing same-tenant association:** selected conservative
  rule, consistent with the existing query model. The professional UI lists
  only entities derived from same-tenant concessions and the server repeats the
  same check.

### Historical Selvara repair

- **Update the old report/revision:** rejected; destroys evidentiary history.
- **Mutate the concession directly:** rejected; bypasses professional review.
- **Regenerate versioned analysis/proposal and materialize after review:**
  selected.

## 9. Alignment with official platform guidance

- PostgreSQL documents that a unique expression index can enforce normalized
  equality that is not expressible as a simple column constraint:
  <https://www.postgresql.org/docs/current/indexes-expressional.html>.
- PostgreSQL documents Serializable guarantees and `ON CONFLICT` behavior:
  <https://www.postgresql.org/docs/current/transaction-iso.html>.
- Prisma production guidance requires checking migration history, previewing
  pending operations and applying reviewed migrations rather than ad-hoc schema
  changes:
  <https://www.prisma.io/docs/orm/migrations/applying-a-migration>.
- Next.js requires Server Actions to validate input and perform authorization on
  the server:
  <https://nextjs.org/docs/app/guides/authentication#authorization>.
- Vercel documents that environment changes do not mutate an existing
  deployment and require a new deployment:
  <https://vercel.com/docs/environment-variables/managing-environment-variables>.

The implemented direction follows those practices: authorization and Zod
validation remain server-side, the database owns uniqueness, migrations are
explicit, and deployment authorization is displayed separately from mutable
administrative commands.

## 10. Validation

### Completed

- Targeted remediation regression: 7 files, 64 tests passed.
- Final focused regression after the split identity migration: 4 files,
  48 tests passed; migration PGlite test: 17 tests passed.
- ESLint: 0 errors; 121 pre-existing warnings.
- Final lint of all changed TypeScript files: 0 errors; 3 pre-existing unused
  import warnings in the procedure detail page.
- Next.js production build: passed with a non-persisted local
  `NEXTAUTH_SECRET`.
- Final full serial regression: 355 files and 4577 tests passed;
  5 files/35 tests intentionally skipped. The five PostgreSQL concurrency
  tests were then executed separately against PostgreSQL 16 and all passed.
- Final targeted architectural suite: 9 files and 112 tests passed.
- Historical-integrity suite: 5 files and 101 tests passed; the PostgreSQL-only
  integration file was initially skipped before the isolated cluster was
  provisioned.
- A disposable PostgreSQL 16 cluster accepted the complete sequence of 61
  migrations from an empty database.
- The normalized concession identity migration:
  - rejected a synthetic historical duplicate with
    `CONCESSION_NORMALIZED_IDENTITY_DUPLICATES_REQUIRE_REVIEW`;
  - left the unique index absent after the failed preflight;
  - rejected the same normalized title in one tenant;
  - accepted the same normalized title in a different tenant.
- The real PostgreSQL concurrency suite passed 5/5 tests, including independent
  sessions, idempotent retry, stale-version rejection, complete ActivityLog
  verification and persisted-tampering detection.
- The corrected demo seed produced a canonically valid 10-record ActivityLog
  chain.
- The MFA-authenticated guided Playwright suite passed 5/5 tests against the
  disposable PostgreSQL database with providers, workers and automatic research
  disabled. The concession scenario generated `17/2023` from immutable
  evidence, required structured professional review, materialized it, displayed
  it in the authoritative concession section and preserved reconciliation
  history.
- After the browser suite, all 65 ActivityLog records passed complete-chain
  verification. SQL postconditions confirmed one unchanged current knowledge
  revision, one unchanged current report, one materialized proposal, one linked
  concession, two reconciliation events and one reversal event.
- Independent review identified a real missing date-discrepancy condition:
  equal normalized title numbers with different exact release dates now produce
  a review proposal; equal numbers and dates do not.
- The review also raised a possible legacy hash incompatibility, but comparison
  with the exact Production commit `d034460ea858675a62c3ee4e12d52664ea501007`
  disproved it: that version already includes `enteId` in the canonical hash.

### Required before Production activation

- Execute the protected read-only Production preflight now provided for
  normalized concession numbers and the complete ActivityLog chain.
- Execute the migration rehearsal on an authorized isolated Production clone.
- Bind the official PR Preview to a fingerprinted synthetic database and run an
  authenticated release-preview E2E that:
  1. generates a concession proposal from immutable evidence;
  2. professionally links or creates the concession;
  3. proves a second request is reused;
  4. rejects altered evidence;
  5. rejects a cross-tenant concession/concessionaire;
  6. preserves the superseded report/revision.

## 11. Dependency-ordered remediation plan

### P0 — Production activation blockers

1. Review and merge the validated candidate without deploying it.
2. Run read-only normalized-title duplicate and ActivityLog-chain preflights
   against Production through an authorized operational channel.
3. Execute the authenticated release-preview E2E.
4. Authorize the Production migration/deployment separately only if all
   preflights pass.

### P1 — controlled data repair

1. Create a new Selvara analysis/knowledge revision or current-report proposal.
2. Professionally verify evidence, dates, title number and concessionaire.
3. Link an existing concession if authoritative; otherwise create one through
   the reviewed flow.
4. Materialize downstream subject/deadline proposals individually.
5. Create criticalities only from separately reviewed propositions.
6. Preserve old revisions/reports as superseded history.

### P2 — model hardening

1. Document explicitly that `Concessionario` is a shared registry whose tenant
   visibility derives from `Concessione.enteId`.
2. Introduce a dedicated many-to-many ownership relation only if future
   onboarding must precede the first concession.
3. Add a stored canonical concession identity if Prisma-level introspection of
   the expression index is operationally important.

### P3 — observability

1. Show command-event validity and chain-verification status separately.
2. Correlate each cost record with command, request, job and actor IDs.
3. Add dashboards for manual versus automatic admission and worker execution.

## 12. Objective resolution criteria

The branch candidate is **GO** for code review and integration into a
non-deploying release branch. Production activation remains **NO-GO** until the
remaining read-only Production and authenticated release-preview P0 checks
pass. No synthetic result in this report is presented as a Production query.

The Selvara defect is resolved only when:

- `17/2023` exists in a current authoritative concession linked to the correct
  procedure and tenant;
- the materialization cites exactly the immutable document evidence;
- old report and knowledge revisions remain queryable and unchanged;
- rerunning the same operation returns `REUSED`;
- no normalized duplicate concession exists;
- downstream operational entries are created only after separate professional
  validation.

The AI-state defect is resolved only when:

- command, event validity, deployment authorization, kill-switch, provider
  readiness, manual operation, automatic admission, worker and costs are all
  independently visible;
- malformed control events fail closed and are shown as invalid;
- the complete ActivityLog chain is verified, not merely accompanied by a hash.

The draft defect is resolved only when:

- repeated create requests return the same draft;
- historical duplicates are archived, never deleted;
- linked or dependency-referenced copies cannot be archived;
- retries are no-ops;
- the audit history remains continuous.

The structural code defects are addressed. The remaining reservations concern
facts that cannot be established without the separately authorized Production
read-only preflight and staging execution; they are not masked as completed.

## 13. Operational blocker resolution

The final blockers are addressed by reusable release controls rather than
one-off access to credentials:

- `production-readonly-preflight.yml` is manual, has `contents: read`, is
  protected by the `production-readonly` GitHub Environment and consumes one
  dedicated secret in one process.
- The Production verifier opens `BEGIN READ ONLY`, rejects any role with
  effective create/DML/sequence privileges, superuser or RLS bypass, emits only
  aggregate results and checks the complete audit chain in bounded pages.
- Direct PostgreSQL timestamps are normalized explicitly from Prisma's UTC
  `timestamp without time zone`; a real PostgreSQL proof found and eliminated
  the host-timezone false-positive before release.
- Every Vercel Preview blocks database access unless its isolation marker is
  present, the database is classified synthetic, Preview and Production
  identity fingerprints differ, and AI/provider/automatic research/worker
  execution is disabled.
- The migration rehearsal rejects the Production database fingerprint and
  verifies row counts, duplicates, orphan procedures, index validity and Prisma
  migration completion on the isolated target.
- `docs/POST_AUDIT_RELEASE_RUNBOOK.md` defines the DBA grants, GitHub/Vercel
  boundaries, MFA flow, migration order, objective gates, abort conditions and
  rollback procedure.

### New isolated proofs

- PostgreSQL 16 applied all 61 migrations and seeded 8 concessions, 8
  procedures and a valid 10-record ActivityLog chain.
- A dedicated `NOINHERIT`, `NOBYPASSRLS`, default-read-only login passed the
  aggregate preflight; an attempted `INSERT` failed with
  `cannot execute INSERT in a read-only transaction`.
- The preflight returned zero normalized duplicate groups, zero tenantless
  concessions and a valid 10/10 audit chain.
- The rehearsal returned unchanged counts, zero duplicate groups, zero orphan
  procedures, a valid unique index and a completed migration record.
- Reusing the Production fingerprint for either Preview or rehearsal was
  rejected before application/database work.

These are synthetic isolated proofs, not Production queries. The exact minimum
external interventions still required are: DBA creation of the read-only role
and authorized clone; repository administrator approval of the protected
Environment; infrastructure provisioning of the synthetic Preview; a Vercel
member session; and a synthetic MFA application account. No control can safely
or legitimately automate those approvals.
