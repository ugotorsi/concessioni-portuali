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
| `TECHNICAL_SOURCES_MCP_TOKEN_URL` | HTTPS Stytch OAuth token endpoint (`*.customers.stytch.dev/.com`, `test.stytch.com` or `api.stytch.com`), no query or credentials. |
| `TECHNICAL_SOURCES_MCP_CLIENT_ID` | Dedicated Stytch M2M client (`m2m-client-test-…` / `m2m-client-live-…`). |
| `TECHNICAL_SOURCES_MCP_CLIENT_SECRET` | Secret of that M2M client (secret). |
| `TECHNICAL_SOURCES_MCP_SCOPE` | Dedicated scope granted to the M2M client, e.g. `noetra:technical-read`. |

The provider performs an OAuth `client_credentials` request without redirects, validates the JWT-shaped bearer token, its scope and expiry, and caches it in memory until 60 seconds before expiry (at most one hour). A partial configuration fails closed with `M2M_AUTH_NOT_CONFIGURED`.

The MCP resource server must explicitly accept the same client with `AUTH_M2M_CLIENT_ID` and `AUTH_M2M_SCOPE` (see `docs/OAUTH_SETUP.md` in the MCP repository). The M2M token must carry the issuer and audience already configured on the resource server.

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
2. Publish the MCP integration branch on Render with `AUTH_M2M_CLIENT_ID` and `AUTH_M2M_SCOPE` set and the OAuth configuration complete; confirm `/health` reports the intended mode.
3. Apply the migration to the staging database under an authorized write window (`prisma migrate deploy`).
4. Run one authorized end-to-end call from the Ricerca section of an attested test procedure and check the stored record and audit event.

All automated tests use mocked transport and identity. No AI provider is involved.
