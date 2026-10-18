# Technical sources MCP integration

The technical and urban-planning source channel is attached to the **Ricerca** and **Analisi** sections of a procedure. It is separate from legal-authority research: catalog entries, preliminary checklists and Campania WMS results are not legal conclusions or proof of compliance.

## Application contract

- `GET /api/procedimenti/{id}/technical-research` returns the latest 50 persisted results for the procedure (`hasMore` flags truncation), the current research missions of the procedure (`id`, question), `channelEnabled` and `canRequest`.
- `POST /api/procedimenti/{id}/technical-research` accepts a current research mission ID and one strictly validated MCP tool request: `search`, `fetch`, `lista_livelli_wms`, `interroga_punto_wms` or `matrice_verifiche_manufatto`.
- Reads require an authenticated user with tenant read access. Writes additionally require a same-origin JSON request, procedure-management permission, tenant write access and a `CURRENT` mission whose `caseId` and `tenantId` match the procedure.
- Composite foreign keys enforce that procedure and mission belong to the same tenant as the record; deletion of referenced procedures, missions, users or tenants is restricted.
- Each successful acquisition is appended, in one transaction with a hash-chained audit event (`TECHNICAL_SOURCE_RESEARCH_RECORDED`), as a snapshot containing the request arguments, structured response, mission-question snapshot, MCP service version, verification status, requester and retrieval timestamp. Failed acquisitions persist nothing and produce a `TECHNICAL_SOURCE_RESEARCH_FAILED` audit event with the error code only. There is no update or delete endpoint.
- The route sends no user cookie to the MCP service. Its only target is the fixed HTTPS staging endpoint; the client rejects redirects and bounds response size and duration.

### Verification status

MCP output is never probative. `verificationStatus` records which non-probative category applies:

| Value | Meaning |
| --- | --- |
| `DA_VERIFICARE_SU_FONTE_ORIGINALE` | Catalog, sheet, layer list or checklist: verify on the original official source. |
| `INDICATIVO_DA_VERIFICARE` | WMS point query returned features: indicative cartography only. |
| `RISPOSTA_VUOTA_NON_PROBATORIA` | WMS point query returned no features: this does **not** prove the absence of constraints. |

A WMS answer without an explicit `result` classification is rejected and nothing is stored.

## Machine-to-machine identity

The backend never reuses an interactive ChatGPT/Connected App token and never accepts a caller-supplied bearer token. Live calls are disabled unless **all** of the following server-side variables are set (values only in the approved secret store, never in source, logs or the browser):

| Variable | Content |
| --- | --- |
| `TECHNICAL_SOURCES_MCP_ENABLED` | Must be exactly `true` to enable the channel. |
| `TECHNICAL_SOURCES_MCP_TOKEN_URL` | `https://test.stytch.com/v1/public/{project-test-ID}/oauth2/token` for staging; only the matching `api.stytch.com` / `project-live-ID` pair is accepted for live projects. No custom domains, ports, query or credentials. |
| `TECHNICAL_SOURCES_MCP_CLIENT_ID` | Dedicated Stytch M2M client (`m2m-client-test-…` / `m2m-client-live-…`). |
| `TECHNICAL_SOURCES_MCP_CLIENT_SECRET` | Secret of that M2M client (secret). |
| `TECHNICAL_SOURCES_MCP_SCOPE` | Dedicated scope granted to the M2M client, e.g. `noetra:technical-read`. |

The provider sends a JSON POST (`Content-Type: application/json`) with exactly `grant_type: "client_credentials"`, `client_id`, `client_secret` and `scope` (space-delimited string), without redirects. It validates the JWT-shaped bearer response, token type, optional response scope and `expires_in`, and caches it in memory until 60 seconds before expiry (at most one hour). JWT cryptographic verification takes place on the MCP resource server, not in this transport adapter. A partial configuration or mismatched test/live endpoint/client fails closed with `M2M_AUTH_NOT_CONFIGURED`.

The MCP resource server must explicitly accept the same client with `AUTH_M2M_PROJECT_ID`, `AUTH_M2M_CLIENT_ID` and `AUTH_M2M_SCOPE` (all three or none; see `docs/OAUTH_SETUP.md` in the MCP repository). For this staging service it accepts test projects only. M2M tokens use issuer `stytch.com/{PROJECT_ID}` (no HTTPS prefix), audience containing `PROJECT_ID`, subject equal to the allowlisted M2M client, and project JWKS `https://test.stytch.com/v1/sessions/jwks/{PROJECT_ID}`. They do **not** use the Connected App issuer or JWKS. Signature (RS256), expiry and dedicated scope are verified under this separate profile, with no cross-profile key fallback.

Contract verified against the official Stytch [token API](https://stytch.com/docs/api-reference/consumer/api/m2m/token/get-access-token), [local authentication](https://stytch.com/docs/api-reference/consumer/api/m2m/token/authenticate-access-token) and [JWKS API](https://stytch.com/docs/api-reference/consumer/api/sessions/get-jwks) on 2026-10-18. Both JSON and form-urlencoded are supported by Stytch; JSON is used here to match its API example. No live credential exchange is performed by the automated tests.

## Migration and rollback

`prisma/migrations/20261018_technical_source_research` is purely additive: it creates one table with two indexes, four restrictive foreign keys and two CHECK constraints (tool name and verification status). No existing table or row is modified.

Rollback, only after exporting the table if its content must be preserved:

```sql
DROP TABLE IF EXISTS "TechnicalSourceResearchRecord";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261018_technical_source_research';
```

Then revert the Prisma model and back-relations. The PGlite test `tests/unit/technical-sources-research-migration.test.ts` applies the migration on an isolated in-memory database, checks tenant/procedure/mission/user constraints, CHECK constraints, indexes, restrictive deletes and the rollback.

## Activation steps (staging)

1. Provision a dedicated Stytch M2M client with the dedicated scope; configure the five `TECHNICAL_SOURCES_MCP_*` variables on the staging backend only.
2. Publish the MCP integration branch on Render with `AUTH_M2M_PROJECT_ID`, `AUTH_M2M_CLIENT_ID` and `AUTH_M2M_SCOPE` set and the existing Connected App OAuth configuration unchanged; confirm `/health` reports the intended mode.
3. Apply the migration to the staging database under an authorized write window (`prisma migrate deploy`).
4. Run one authorized end-to-end call from the Ricerca section of an attested test procedure and check the stored record and audit event.

All automated tests use mocked transport and identity. No AI provider is involved.

## Final acceptance and publication checks (2026-10-18)

- Technical-sources acceptance tests: 20/20 across five files, including the exact token endpoint, JSON request body, response validation, API authorization, UI and isolated migration.
- TypeScript (`tsc --noEmit --incremental false`) and production build passed; the build used a synthetic, process-local `NEXTAUTH_SECRET`, with no deployed secret changes.
- Final full serial app suite (`vitest run --maxWorkers=1`): **3642 passed, 0 failed, 5 skipped** (3647 total).
- MCP: **35/35 passed**, including separate cryptographic acceptance/rejection of M2M and Connected App tokens; syntax checks passed.
- Previously, the six failing files were rerun from base commit `388439885f5dfcd1b362be7aa32b7f376a79e930`, with the same dependencies. All 16 failed test identities and error classes/messages matched the integration run. They were not waived: the following corrections close every failure.

| Test file | Previous failures | Correction and acceptance evidence |
| --- | ---: | --- |
| `fascicolo-document-requirement-ui.test.ts` | 10 | Assertions now follow delegation to `DirectDocumentUploadForm` with `REQUIREMENT_EVIDENCE`, including the hidden proposal ID. Inspection also found real upload defects: missing synchronous double-submit guard, operation ID not reset after small-upload success, absent small-upload success feedback, and raw storage errors exposed for requirement evidence. These are fixed, with controls disabled while pending. Five new behavioral tests exercise small and large uploads, retries, concurrent submissions, neutral success, sanitized failures and the unchanged general-document path using mocked transport. All 91 UI tests, 9 direct-upload service tests and 30 requirement-upload tests pass. |
| `fascicolo-timeline-workspace.test.ts` | 1 | Removed-overview assertion replaced with the actual Cronologia navigation contract; existing assertions still verify both legacy/intake consumers and the five rendering/order/deduplication/empty-state scenarios. All 6 pass. |
| `async-job-worker.test.ts` | 1 | Expected bounded result metadata now includes normalized `referenceVersion: null`. All 19 worker tests pass; no worker was activated. |
| `fascicolo-research-mission-lifecycle-pglite.test.ts` | 2 | Fixture uses the real `User.ruolo` column. All 10 tests pass, including traceable versioning, reconciliation to the new CURRENT mission and rejection of an administrator without tenant membership. Application authorization is unchanged. |
| `research-assisted-verification-pglite.test.ts` | 1 | Fixture applies the real actor-binding migration to disposable PGlite and persists `assignedActorId`. The journey now explicitly denies another user in the same tenant (GET and POST 403), then uses the assigned reviewer for positive operations. Source attestations remain unchanged on append/correction; cross-tenant/role denials, stale-write conflicts, append-only persistence and pre-claim evidence gates all pass. |
| `trusted-research-mission-integration.test.ts` | 1 | Mock mission includes its assigned actor. Real trusted transport/grant/MCP handler integration passes; three additional negative cases deny another actor, no assignment and another tenant without disclosing the mission or loading assisted verification. |

No real credentials, live AI providers or staging database writes were used. Automated acceptance and an automatically generated Vercel Preview do not replace an authorized application-level staging rehearsal.
