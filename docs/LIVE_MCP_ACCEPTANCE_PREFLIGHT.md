# Block 3B.14A - Live MCP Acceptance Preflight

Status: PRE-FLIGHT COMPLETE, LIVE EXECUTION NOT RUN
Date: 2026-09-18
Branch: `staging-operativo`

This document is a no-side-effect execution plan. It does not authorize database access, Neon branch creation, migrations, WorkOS or Vercel changes, deployment, ChatGPT connection, provider calls, or push.

## MCP_OAUTH_COMMIT_SHA

`ec846ae40671eaa131c3cf9ae80c01dd4d5fa8ba`

## CURRENT_LIVE_READINESS_STATE

`OFFLINE_ACCEPTED_LIVE_NOT_RUN`

Recorded block commits:

| Block | Commit |
| --- | --- |
| 3B.13A research bridge | `b5bc9a7472e9091f7cce7b06446e81b1c4287045` |
| 3B.13B persistence | `902569e90ca41e53ba76bb690b8ea7cc34f13ea0` |
| 3B.13C MCP transport | `b15daf9d8323d5e3db87d577fa89b8d96331347b` |
| 3B.13D OAuth | `ec846ae40671eaa131c3cf9ae80c01dd4d5fa8ba` |

Offline evidence at closure:

- OAuth/MCP focused tests: 54/54 PASS.
- Bounded legal-research regression: 142/142 PASS.
- Production build: PASS.
- Prisma and migration delta in 3B.13D: zero.
- Live systems exercised: none.

Readiness is procedural only. Live execution remains gated by explicit authorization, confirmation of the authoritative Neon staging source branch, non-production WorkOS configuration, Preview environment configuration, provider entitlements, and a controlled mission-creation mechanism.

## PENDING_MIGRATIONS

The local tracking reference `origin/staging-operativo` is at `5dfab9f8b70721428da15295afef35d2f0e6ecd5`. Repository history after that reference contains these migration directories, in order:

1. `20260917_b2c15_block3b9b_temporal_assessment`
2. `20260917_block3b13b_research_persistence`

These are `CANDIDATE_PENDING`, not confirmed database-pending migrations. The repository contains no current authoritative Neon `_prisma_migrations` ledger. Actual pending status must be established on a temporary clone with `npx prisma migrate status` before applying anything.

Stop if the temporary branch reports a different set, a failed migration, modified checksum, or drift. Do not assume that the Git tracking reference equals the database deployment state.

## TEMP_NEON_VALIDATION_PLAN

### Target identity

- Source branch: `UNCONFIRMED_AUTHORITATIVE_NEON_STAGING_BRANCH`.
- Required operator confirmation: source branch name and current head timestamp/LSN in Neon.
- Temporary branch pattern: `validate-3b14a-mcp-<YYYYMMDD-HHMMUTC>-ec846ae`.
- Production branch: forbidden.

### Authorized execution sequence

1. Confirm the source is the authoritative non-production staging branch and record its branch identifier without exposing a connection string.
2. Create one temporary Neon branch from the current source head.
3. Set `DATABASE_URL` only in the authorized local process or isolated Preview validation context. Do not print it.
4. Run preflight status:

   `npx prisma migrate status`

5. Compare the reported pending list with the candidate list above. Stop on any discrepancy until reviewed.
6. Apply migrations once:

   `npx prisma migrate deploy`

7. Run status again and require no pending or failed migrations:

   `npx prisma migrate status`

8. Validate Prisma drift against the checked-in schema:

   `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`

   Expected result: empty migration or an explicitly reviewed semantic equivalent.
9. Perform read-only post-migration checks:

   - `_prisma_migrations` contains successful rows for every migration reported pending in step 4.
   - Tables exist: `ResearchMissionRecord`, `ResearchExecutionAttempt`, `ResearchEvidenceBundleRecord`.
   - Enums exist: `ResearchMissionStatus`, `ResearchExecutionState`, `ResearchCompletionState`.
   - Constraints, indexes, foreign keys, and immutability triggers from `20260917_block3b13b_research_persistence` exist.
   - No unexpected canonical-source DDL was introduced by the research migration.
10. Record only migration names, checksums/status, timestamps, and pass/fail evidence. Do not export data or secrets.
11. Delete the temporary validation branch after evidence review.

Rollback strategy: delete the temporary Neon validation branch. Do not reverse DDL and do not touch the authoritative staging or production branch.

## WORKOS_CONFIGURATION_MANIFEST

| Item | Classification | Required state |
| --- | --- | --- |
| Authorization server / issuer | WORKOS_DASHBOARD, SERVER_ENV | Non-production AuthKit HTTPS issuer; exact value stored as `WORKOS_AUTHKIT_ISSUER` |
| Standalone Login URI | DERIVED_PUBLIC_URL, WORKOS_DASHBOARD | `https://<preview-host>/api/auth/workos/complete` |
| ChatGPT redirect URI | CHATGPT_CONNECTION, WORKOS_DASHBOARD | Copy exact URI shown by ChatGPT; never reconstruct it |
| MCP resource indicator | DERIVED_PUBLIC_URL, WORKOS_DASHBOARD, SERVER_ENV, CHATGPT_CONNECTION | Exact `https://<preview-host>/api/mcp`; stored as `MCP_RESOURCE_URI` |
| Protected resource metadata | DERIVED_PUBLIC_URL | `https://<preview-host>/.well-known/oauth-protected-resource` |
| Allowed browser/client origins | CHATGPT_CONNECTION, SERVER_ENV | Exact observed/documented origins only, comma-separated in `MCP_ALLOWED_ORIGINS` when an Origin header is sent |
| OAuth scopes | WORKOS_DASHBOARD, CHATGPT_CONNECTION | Only WorkOS-supported standard scopes: `openid profile email offline_access` |
| Research permissions | APPLICATION_LOCAL | `research:read` and `research:write`, derived from local actor role and tenant membership; never requested from WorkOS |
| Authorization flow | WORKOS_DASHBOARD, CHATGPT_CONNECTION | Authorization code with PKCE S256 |
| Offline access | WORKOS_DASHBOARD, CHATGPT_CONNECTION | Request and permit `offline_access` only for refresh-token use |
| Refresh tokens | WORKOS_DASHBOARD | Enabled for the non-production client; rotation/revocation behavior confirmed before use |
| CIMD | WORKOS_DASHBOARD, CHATGPT_CONNECTION | Enabled/preferred for MCP client metadata discovery |
| DCR | WORKOS_DASHBOARD, CHATGPT_CONNECTION | Enable only as the documented fallback when CIMD is unavailable |
| JWKS | DERIVED_PUBLIC_URL | Issuer JWKS at `<issuer>/oauth2/jwks`; HTTPS and reachable by Preview runtime |
| Token algorithm | WORKOS_DASHBOARD | RS256 only |
| Token claims | WORKOS_DASHBOARD | Valid `iss`, `aud` equal to resource, `exp`/`nbf`, `sub`, actor and tenant claims; JWT scope/permission claims do not grant application permissions |
| Local actor claim | WORKOS_DASHBOARD | `urn:concessioni-portuali:actor_id` populated from `user.external_id` |
| Tenant consent claim | WORKOS_DASHBOARD | `urn:concessioni-portuali:tenant_id`, constrained to locally supplied memberships |
| Identity mapping | WORKOS_DASHBOARD, SERVER_ENV | Local immutable `User.id` stored as WorkOS `user.external_id`; no email matching and no Prisma mapping table |
| WorkOS API credential | SERVER_ENV | Secret `WORKOS_API_KEY`; Preview only, server-only |

JWT acceptance requires a matching `kid` from JWKS, RS256 signature, exact issuer and audience/resource, valid time window, signed local actor claim, WorkOS `sub`, active local user, and current local tenant membership. Read/write permissions are derived afterward from local policy.

## VERCEL_PREVIEW_ENV_MANIFEST

Actual Vercel values/presence were not queried because this block forbids external actions. `EXISTING` and `NEW` below refer to repository/application history, not verified dashboard state.

| Variable | Repository classification | Sensitivity | Visibility | Requirement |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | EXISTING | SECRET | SERVER_ONLY | Required; temporary or authoritative non-production DB selected for the authorized phase |
| `NEXTAUTH_SECRET` | EXISTING | SECRET | SERVER_ONLY | Required for existing application login |
| `NEXTAUTH_URL` | EXISTING | PUBLIC_CONFIGURATION | SERVER_ONLY_ENV | Exact Preview base URL |
| `WORKOS_AUTHKIT_ISSUER` | NEW_3B13D | PUBLIC_CONFIGURATION | SERVER_ONLY_ENV | Required |
| `WORKOS_API_KEY` | NEW_3B13D | SECRET | SERVER_ONLY | Required |
| `MCP_RESOURCE_URI` | NEW_3B13D | PUBLIC_CONFIGURATION | SERVER_ONLY_ENV | Exact Preview `/api/mcp` URL |
| `MCP_ALLOWED_ORIGINS` | NEW_CONDITIONAL | PUBLIC_CONFIGURATION | SERVER_ONLY_ENV | Required only when the accepted ChatGPT request sends an Origin different from Preview origin |
| `LEGAL_DATA_HUNTER_API_KEY` | EXISTING_CODE_CONDITIONAL | SECRET | SERVER_ONLY | Only for the platform-side LDH provider path; not a substitute for a ChatGPT provider connection |

Do not set `STAGING_ADMIN_BYPASS=true` for acceptance. Simpliciter and Moonlit credentials belong in their authorized provider/ChatGPT connection surfaces, not in Vercel, unless their approved integration documentation explicitly requires otherwise.

## REMOTE_MCP_VALIDATION_PLAN

Expected URLs:

- MCP: `https://<preview-host>/api/mcp`
- Protected resource metadata: `https://<preview-host>/.well-known/oauth-protected-resource`
- Standalone completion: `https://<preview-host>/api/auth/workos/complete`

Pre-ChatGPT checks, in order:

1. Preview TLS certificate is valid and all URLs remain HTTPS with no redirect to another host.
2. Protected-resource metadata returns 200, exact resource URI, one expected authorization server, and bearer header support, without research permissions advertised as OAuth scopes.
3. Issuer metadata and JWKS are reachable; keys are RSA signing keys and include usable `kid` values.
4. Unauthenticated MCP request returns 401 with `WWW-Authenticate` containing the exact resource metadata URL.
5. Invalid bearer token returns 401 and leaks no verification detail.
6. A locally read-authorized actor can initialize MCP and list tools; a local write denial returns `FORBIDDEN` without an OAuth challenge.
7. A valid token for an actor with local read/write permission can initialize and list exactly the seven bounded research tools.
8. `securitySchemes` and `_meta.securitySchemes` advertise OAuth with an empty scope list; tool permissions remain application-local.
9. A disallowed Origin returns 403; the accepted ChatGPT Origin succeeds if an Origin header is present.
10. No response or log includes tokens, API keys, database URLs, claim tokens, or stack traces.

## CHATGPT_CONNECTION_PLAN

1. In the authorized non-production ChatGPT workspace, create a custom remote MCP app named `Concessioni Portuali - Preview`.
2. Enter only `https://<preview-host>/api/mcp` as the remote MCP URL.
3. Select OAuth/discovery. Do not paste tokens or credentials.
4. Capture the exact ChatGPT redirect URI and register that URI in non-production WorkOS.
5. Confirm discovery resolves the protected-resource metadata, issuer, and PKCE S256 flow without requesting custom research scopes.
6. Authenticate through WorkOS. If redirected, complete the existing NextAuth login and choose only an authorized local tenant.
7. Approve only WorkOS-supported OAuth scopes; include `offline_access` only for the refresh-token test.
8. Refresh tools and require exactly:

   - `research_capabilities`
   - `research_list_pending`
   - `research_get_mission`
   - `research_claim_mission`
   - `research_submit_evidence_bundle`
   - `research_defer_mission`
   - `research_complete_mission`

9. Verify all tools advertise OAuth with no custom research scope and enforce local read/write permissions.
10. Do not begin provider testing until identity, tenant isolation, tool count, and local permission behavior pass.

## LEGAL_DATA_ACCEPTANCE_QUESTION

Reference date: `2026-09-18`.

Question:

> In quali condizioni il rilascio o il rinnovo di una concessione demaniale marittima in ambito portuale richiede una procedura comparativa trasparente, e quali limiti pone il diritto dell'Unione europea alle proroghe automatiche, distinguendo ove rilevante tra concessioni ex articolo 18 della legge 84/1994 e titoli ex articolo 36 del codice della navigazione?

The question is public-law, non-client-sensitive, repeatable, and suitable for Italian legislation, EU law, administrative case law, supporting/adverse authority search, exact retrieval, and official verification.

Mission profile:

- mode: `DISCOVER_AUTHORITIES`
- required capabilities: semantic discovery, exact retrieval, full-text retrieval, citation network, adverse authority discovery
- preferred source families: Italian legislation, EU legislation, administrative justice, CJEU
- required outputs: authority candidates, citation observations, legal research suggestions, evidence gaps, full text where available
- fixed bounded budget approved before execution; no provider may exceed its per-provider or total call cap

## SIMPLICITER_ACCEPTANCE_PLAN

Initial flags: all `NOT_RUN`.

1. Confirm authenticated availability without exposing credentials: `SIMPLICITER_CONNECTED`.
2. Run the common question as bounded semantic research and record query, result count, identifiers, and call count: `SIMPLICITER_SEMANTIC_SEARCH_PASS`.
3. Select one identified authority and retrieve by exact citation/identifier: `SIMPLICITER_EXACT_RETRIEVAL_PASS`.
4. Require court/body or act type, number/year or official identifier, date where available, stable source URL/provider document ID, and provider provenance: `SIMPLICITER_SOURCE_IDENTITY_VALID`.
5. Retrieve a relevant passage/full text where licensed and available.
6. Perform cross-source discovery and capture at least one supporting and one adverse/qualifying authority, or record a bounded no-result evidence gap.
7. Add results as provider-derived `AuthorityCandidate` records with verification pending, never canonical authority records.
8. Include the execution and candidates in the submitted bundle: `SIMPLICITER_RESULT_ENTERED_BUNDLE`.

## MOONLIT_ACCEPTANCE_PLAN

Initial flags: all `NOT_RUN`.

1. Confirm authenticated account connection and record only quota state/category, never credentials: `MOONLIT_CONNECTED`.
2. Stop before search if remaining quota is insufficient for the approved budget.
3. Run semantic/hybrid search on the common question: `MOONLIT_SEARCH_PASS`.
4. Retrieve one full document and verify identity plus relevant passage: `MOONLIT_FULL_DOCUMENT_PASS`.
5. Expand the citation network for that document and test referencing and referenced authorities; test article-level relation when supported: `MOONLIT_CITATION_NETWORK_PASS`.
6. Store each provider-reported edge only as `CitationObservation` with `PROVIDER_REPORTED` provenance.
7. Do not create or infer `AuthorityTreatmentAssessment` from a citation edge. Support/adverse treatment requires a separate assessed and reviewable step: `MOONLIT_RAW_CITATION_SEMANTICS_PRESERVED`.
8. Include the execution, candidates, and raw citation observations in the bundle: `MOONLIT_RESULT_ENTERED_BUNDLE`.

## LDH_ACCEPTANCE_PLAN

Initial flags: all `NOT_RUN`.

1. Confirm authenticated availability through the approved connection: `LDH_CONNECTED`.
2. Run bounded source discovery and search for the common question/candidate identity: `LDH_DISCOVERY_PASS`.
3. Test exact/citation resolution if the selected source supports it, then retrieve document metadata/full text where available: `LDH_RETRIEVAL_PASS`.
4. Normalize only candidate fields: court/body, document type, number, year, date, ECLI/official identifier, source URL, provider document ID, passage, and provenance.
5. Keep LDH evidence classified as commercial corroboration until official reconciliation.
6. Include the execution and normalized candidate in the bundle: `LDH_RESULT_ENTERED_BUNDLE`.

## OFFICIAL_VERIFICATION_PLAN

### Administrative judgment

1. Select one sufficiently identified provider candidate.
2. Pass its structured identity to the existing OpenGA lookup.
3. Persist the provider response as an `OfficialHit` evidence record.
4. Run the existing official reconciliation path.
5. Require exact or reviewed identity agreement before canonical linkage: `OPENGA_OFFICIAL_VERIFY_PASS`.

### Legislation

1. Select one Italian legislative candidate, preferably article 18 of law 84/1994 or article 36 of the navigation code.
2. Pass a structured reference to the existing Normattiva verification path.
3. Require a unique official result or retain ambiguous/no-hit status: `NORMATTIVA_OFFICIAL_VERIFY_PASS`.

For both paths:

- A provider candidate remains `OFFICIAL_VERIFICATION_REQUIRED`, `PENDING`, or `FAILED` until reconciliation.
- No provider candidate directly creates or overwrites canonical identity.
- Required invariant: `PROVIDER_CANDIDATE_AUTO_CANONICALIZED:NO`.
- Required invariant: `OFFICIAL_RECONCILIATION_BYPASSED:NO`.

## END_TO_END_PLAN

1. Create one deterministic `ResearchMission` through an authorized server-side fixture or separately reviewed admin trigger using the common question, test tenant, fixed reference date, and bounded budgets.
2. Confirm persistence status `PENDING` and record mission ID without manually transferring the payload to ChatGPT.
3. In ChatGPT, call `research_list_pending`; the mission must appear through MCP.
4. Call `research_get_mission`, then `research_claim_mission` with a unique execution ID and bounded lease.
5. Execute Simpliciter, Moonlit, and LDH plans within the mission budget. Record every call in `researchToolExecutions`.
6. Assemble provider results as candidates, raw citation observations, suggestions, gaps, conflicts, and unresolved questions.
7. Preserve citation edges as observations; do not synthesize treatment assessments.
8. Run official verification for selected administrative and legislative candidates. Do not bypass reconciliation.
9. Submit one `ResearchEvidenceBundle` through `research_submit_evidence_bundle`.
10. Confirm the bundle, execution counters, provider counters, actor, mission, and execution IDs persisted.
11. Complete through `research_complete_mission` using the persisted bundle ID and claim token.
12. Confirm the mission state maps correctly from completion state and the active lease is cleared.
13. Replay the identical bundle and require idempotent reuse rather than duplication.
14. If any provider fails, submit valid partial evidence with an `errorState`, evidence gap, and `PARTIAL` or `BUDGET_EXHAUSTED` state as appropriate.
15. Verify the entire flow used MCP between platform and ChatGPT, with no mission or bundle copy/paste.

Current prerequisite: no public/UI mission-creation route exists. Before live execution, authorize either a one-shot server-side test fixture using `createResearchMissionRecord` or a separately reviewed admin-only creation surface. Do not expose mission creation anonymously.

## FAILURE_TEST_PLAN

| Case | Expected result |
| --- | --- |
| Provider unavailable | Record retryable provider `errorState`; preserve other evidence; submit `PARTIAL`; no fabricated fallback |
| Moonlit quota insufficient/exhausted | Do not exceed approved calls; record gap; use `PARTIAL` or `BUDGET_EXHAUSTED` consistently |
| No result | Record zero result count and evidence gap; do not invent authority |
| Ambiguous authority identity | Keep candidate verification pending/failed; require human review or more evidence |
| Official verifier no hit | Keep candidate non-canonical with failed/pending verification |
| Duplicate authority | Deterministic identity/deduplication applies; conflicting duplicate is rejected |
| Duplicate bundle submission | Identical fingerprint returns idempotent reuse; conflicting identity fails closed |
| Expired claim | MCP returns bounded stale/expired claim error; no write occurs; reclaim only through normal lease path |
| OAuth access token expiry | Refresh through WorkOS when `offline_access` is authorized; otherwise 401 and reauthorization, never anonymous fallback |
| Refresh token revoked/invalid | 401 and interactive reauthorization; token details never logged |
| Insufficient local MCP permission | `FORBIDDEN` without OAuth challenge; target service is not invoked |
| Cross-tenant claim | 403 based on current local membership |
| Disabled local user | 403 even when WorkOS token is otherwise valid |

## ACCEPTANCE_MATRIX_INITIAL

All statuses are initial and must remain `NOT_RUN` until observed in the authorized live execution.

| Component | AUTH | SEARCH | RETRIEVAL | CITATION | OFFICIAL_VERIFY | BUNDLE_INGEST | END_TO_END | STATUS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Concessioni Portuali MCP | NOT_RUN | N/A | NOT_RUN | N/A | N/A | NOT_RUN | NOT_RUN | NOT_RUN |
| WorkOS OAuth | NOT_RUN | N/A | N/A | N/A | N/A | N/A | NOT_RUN | NOT_RUN |
| Simpliciter | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | N/A | NOT_RUN | NOT_RUN | NOT_RUN |
| Moonlit | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | N/A | NOT_RUN | NOT_RUN | NOT_RUN |
| Legal Data Hunter | NOT_RUN | NOT_RUN | NOT_RUN | N/A | N/A | NOT_RUN | NOT_RUN | NOT_RUN |
| OpenGA | N/A | NOT_RUN | NOT_RUN | N/A | NOT_RUN | N/A | NOT_RUN | NOT_RUN |
| Normattiva | N/A | NOT_RUN | NOT_RUN | N/A | NOT_RUN | N/A | NOT_RUN | NOT_RUN |
| ResearchMission queue | NOT_RUN | NOT_RUN | NOT_RUN | N/A | N/A | N/A | NOT_RUN | NOT_RUN |
| ResearchEvidenceBundle persistence | NOT_RUN | N/A | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |

## LIVE_EXECUTION_ORDER

1. Obtain explicit authorization and confirm the authoritative Neon staging source branch.
2. Create the temporary Neon validation branch.
3. Run migration status, apply only reported pending migrations there, validate status, drift, and research schema.
4. Configure non-production WorkOS according to the manifest.
5. Configure Preview-only Vercel environment variables; do not alter Production.
6. Deploy commit `ec846ae40671eaa131c3cf9ae80c01dd4d5fa8ba` plus any separately accepted preflight prerequisites to Preview.
7. Verify TLS, protected-resource discovery, issuer metadata, JWKS, challenges, scopes, and origin handling.
8. Connect the Preview MCP to the non-production ChatGPT custom app.
9. Authenticate and verify the exact seven tools plus read/write scope enforcement.
10. Create the controlled test mission without copy/paste.
11. Run Simpliciter, Moonlit, LDH, OpenGA, and Normattiva acceptance plans.
12. Run the complete ResearchMission-to-bundle round trip and bounded failure cases.
13. Review evidence and update matrix statuses only from recorded observations.
14. Delete the temporary Neon validation branch when its evidence is accepted.
15. Only after a separate decision, consider rollout to canonical staging. Production remains untouched.

## EXTERNAL_ACTIONS_REQUIRING_AUTHORIZATION

- Read authoritative Neon staging branch metadata or migration ledger.
- Create/delete a temporary Neon branch.
- Supply a temporary branch `DATABASE_URL` and run migrations/schema queries.
- Create or change non-production WorkOS configuration.
- Set or change Vercel Preview variables.
- Deploy a Preview build.
- Fetch live issuer metadata or JWKS.
- Create/connect a ChatGPT custom MCP app and authenticate.
- Use Simpliciter, Moonlit, Legal Data Hunter, OpenGA, or Normattiva live.
- Create a test `ResearchMission` in the temporary/Preview database.
- Push Git commits.

No secret should be pasted into chat, source, logs, artifacts, or command output. Operators set secrets only in the owning secret manager/dashboard under the named variables.

## OPEN_QUESTIONS

1. What exact Neon branch is the authoritative non-production staging source? This must be confirmed in Neon, not inferred from Git.
2. Which of the two candidate migrations are already present in its `_prisma_migrations` ledger?
3. What exact Preview hostname is assigned after deployment?
4. What exact redirect URI does the ChatGPT custom app display?
5. Does ChatGPT send an `Origin` header, and if so what exact documented origin must be allowlisted?
6. Are CIMD and DCR both available in the selected non-production WorkOS environment, and which path does the current ChatGPT connector use?
7. Are refresh-token rotation and revocation policies approved for this test workspace?
8. Which test user and local tenant membership are authorized for the run?
9. Which controlled mission-creation mechanism is authorized: one-shot server-side fixture or reviewed admin trigger?
10. Are Simpliciter, Moonlit, and LDH accounts enabled with sufficient non-production quota for the bounded budget?
11. Which provider surfaces expose full text under the applicable license, and what evidence may be retained?
12. What evidence retention location is approved for live acceptance results without storing tokens or confidential content?

## FINAL FLAGS

```text
MCP_OAUTH_COMMITTED: YES
MCP_OAUTH_COMMIT_SHA: ec846ae40671eaa131c3cf9ae80c01dd4d5fa8ba
BLOCK_3B14A_LIVE_PREFLIGHT_RESULT: PASS
LIVE_WORKOS_TEST_PERFORMED: NO
LIVE_CHATGPT_MCP_TEST_PERFORMED: NO
LIVE_SIMPLICITER_TEST_PERFORMED: NO
LIVE_MOONLIT_TEST_PERFORMED: NO
LIVE_LDH_TEST_PERFORMED: NO
LIVE_OPENGA_TEST_PERFORMED: NO
LIVE_NORMATTIVA_TEST_PERFORMED: NO
REAL_DATABASE_CONNECTION_COUNT: 0
NEON_BRANCH_CREATED: NO
MIGRATION_APPLIED: NO
VERCEL_ENV_CHANGED: NO
DEPLOYMENT_PERFORMED: NO
PUSH_AUTHORIZED: NO
READY_FOR_CONTROLLED_LIVE_ACCEPTANCE: YES
```

`READY_FOR_CONTROLLED_LIVE_ACCEPTANCE: YES` means the procedure and stop gates are defined. It does not authorize execution and does not imply that external configuration is already present.
