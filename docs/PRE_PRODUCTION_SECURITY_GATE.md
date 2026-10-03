# Pre-production security gate - app.noetra.it

Data verifica: 2026-10-03

Checkout autorizzato: `C:\Users\ugoto\AppData\Local\Temp\concessioni-trusted-release-d252788`

Branch verificato: `security-hardening-preprod-2111445`

Implementation SHA verificato: `215ff15605bfecfc3ee60468ed80c4d82fcb7d29`

Target consentito: Vercel Preview `staging-operativo` / Neon branch `staging-operativo`

Production e DNS: non modificati; `app.noetra.it` non associato.

## Esito

**HARDENING PRE-PRODUCTION NON SUPERATO.**

La patch applicativa locale compila e supera i test. Auth.js, credenziali demo e rate limiting distribuito Preview sono stati chiusi con evidenza; il gate rimane chiuso per recovery Neon inadeguata. Non sono stati eseguiti deploy Production o associazioni di custom domain.

## Matrice iniziale e finale

| Controllo | Iniziale | Finale locale | Evidenza / residuo |
| --- | --- | --- | --- |
| Bypass admin passwordless | FAIL | PASS | Bypass e form staging rimossi; variabile Preview rimossa |
| MFA ruoli privilegiati | FAIL | PASS locale | TOTP enrollment/challenge, secret AES-256-GCM, recovery code hash |
| Sessioni e cookie | PARTIAL | PASS locale | TTL 8 ore, cookie secure/HttpOnly/SameSite, revalidation utente/ruolo/lockout |
| Password policy | PARTIAL | PASS locale | Minimo predefinito 12; bcrypt gia presente |
| Tenant isolation | FAIL | PASS locale | Risorse senza tenant negate per default; test aggiornati |
| RBAC server-side | PARTIAL | PASS locale | Helper di ruolo su azioni/query; `VIEWER_ADSP` consultivo |
| CSRF / Origin API cookie | PARTIAL | PASS locale | JSON + same-origin obbligatori in Preview/production sulle mutation custom |
| Security headers / CSP | FAIL | PASS build | CSP production senza `unsafe-eval`; header difensivi centralizzati |
| Rate limiting | PARTIAL | **PASS PREVIEW** | Upstash Marketplace Preview; prova condivisa in due processi completata |
| Audit trail | PARTIAL | PASS con residuo | Eventi auth/logout e catena SHA-256; storage nello stesso DB |
| Temporary DB recon | FAIL | PASS | Route, helper, token Vercel e bypass middleware rimossi |
| Dependency security | FAIL | PASS critical gate | 0 critical; 4 high nella sola catena CLI Prisma, non importata dal runtime |
| Secret hygiene | FAIL | PASS staging | 13 demo disattivati; 1 identita operativa random; seed vietato in Preview/production |
| Backup / PITR / restore | FAIL | **FAIL** | Free: 6 ore, 10/10 branch; recovery leggibile ma obsoleta e schema non allineato |
| Build e unit test | PARTIAL | PASS | 3.349 test passati; build Next 16.3.8 e typecheck passati |
| Preview security QA | N/D | PARTIAL | Preview rate-limit READY e prova distribuita PASS; QA completa ancora pendente |

## Matrice RBAC

Legenda: `R` lettura, `W` modifica, `V` validazione/finalizzazione, `-` negato.

| Dominio / azione | ADMIN | OPERATORE_SOCIETA | GIURIDICO | TECNICO | ECONOMICO | VIEWER_ADSP |
| --- | --- | --- | --- | --- | --- | --- |
| Dati tenant e dashboard | R/W | R/W | R | R | R | R limitato |
| Criticita | R/W | R/W | R/W | R/W | R/W | R |
| Pagamenti | R/W | R/W | R | R | R/W | R |
| Sopralluoghi | R/W | R/W | R | R/W | R | R |
| Procedimenti | R/W/V | R/W | R/W/V | R | R | R |
| Normativa, lettura | R | R | R | R | R | R |
| Normativa, aggiornamento | W | W | W | - | - | - |
| Classificazione/scadenza concessione | W | W | W | - | - | - |
| Validazione report | V | - | V | - | - | - |
| PDF report | R | R | R | R | R | R solo validati |
| AI e export operativi | W | W | W | W | W | - |

Il controllo di autorizzazione e applicato lato server; la UI non e considerata un confine di sicurezza. Il tenant context richiede `defaultTenantId` e le letture/scritture negano `enteId` mancante salvo eccezioni esplicite.

## Classificazione API

| Superficie | Autenticazione | Autorizzazione / tenant | Protezioni principali |
| --- | --- | --- | --- |
| `/api/auth/[...nextauth]` | Pubblica per login, sessione per logout | Stato utente, ruolo, lockout, MFA | Rate limit auth, cookie secure, audit |
| `/api/auth/mfa/enrollment` | Sessione enrollment limitata | Solo identita autorizzata | Rate limit, JSON, same-origin, cookie enrollment cifrato |
| `/api/auth/workos/complete` | Callback firmata/stateful | Mapping identita/ruolo | State validation e test dedicati |
| `/api/admin/runtime-health` | Sessione | ADMIN | No-store, rate limit sensibile |
| `/api/legal-sources` e download | Sessione | Ruolo + tenant | Scope tenant, validazione input |
| `/api/legal-rules/resolve` | Sessione | `canViewNormativa` | JSON, same-origin, schema Zod |
| `/api/legal-research/assisted-verification` | Sessione | ADMIN/GIURIDICO + tenant | JSON/same-origin per PUT/PATCH/POST, schema e conflict check |
| `/api/legal-research/trusted/*` | Trust/bearer dedicato | Mission/action contract | Token dedicato, schema, audit; nessun cookie CSRF |
| `/api/neutral-intakes/[id]/destination` | Sessione | Ruolo procedimenti + doppio tenant check | JSON, same-origin, schema, audit |
| `/api/mcp` e well-known OAuth | OAuth/bearer | Scope MCP | Non usa session cookie per mutation |
| Server Actions | Sessione | Helper ruolo + tenant | Validazione input e audit sulle operazioni sensibili |

## Modifiche applicate

- Rimossi login admin staging passwordless, cookie demo e route DB recon temporanea.
- Implementato TOTP MFA obbligatorio per ruoli privilegiati con enrollment ristretto.
- Rafforzati session TTL, cookie, secret validation e revalidation account.
- Reso deny-by-default l'accesso a record senza tenant.
- Aggiunti audit auth/logout, CSP e rate limit alle superfici sensibili.
- Aggiunto controllo JSON e same-origin alle mutation API con cookie di sessione.
- Aggiornati `next` da 16.2.10 a 16.3.8, `next-auth` a 4.24.15 e `@auth/prisma-adapter` a 2.11.3.
- Risolto il peer opzionale Auth Core su `0.41.3`; `getToken` ora fallisce closed su input malformato.
- Vietato il demo seed in Vercel Preview/production e senza opt-in locale esplicito.
- Ruotato staging: 13 identita demo disattivate, account operativo random con tenant membership e MFA enrollment.
- Conservati schema Prisma, provider flag, worker async e ResearchMission protetta.

## Evidenze di verifica

- `npm test -- --maxWorkers=1 --testTimeout=15000`: 230 file passati, 1 skipped; 3.349 test passati, 5 skipped.
- Suite security mirata: 15 file e 86 test passati su auth/MFA/lockout, bypass, WorkOS callback, tenant/RBAC, rate limit, same-origin, audit hash-chain e demo seed guard.
- `npx tsc --noEmit`: PASS.
- `npm run build` con secret effimeri solo in memoria: PASS su Next 16.3.8.
- `git diff --check`: PASS.
- Route build: nessuna `/api/admin/db-recon-preview-temp`.
- Audit dipendenze runtime: 9 totali, 0 critical, 4 high, 5 moderate, 0 low.
- High residue: `deepmerge-ts` (`GHSA-ggr8-5vv4-36mx`) e `mysql2` (`GHSA-3f6p-5ww8-9rcr`, `GHSA-rgwj-5xj2-c3m3`), aggregate da `@prisma/config`/`prisma` CLI. Il CLI e in `devDependencies`, non e importato dal runtime; npm include ancora il peer opzionale del client nell'audit `--omit=dev`.
- Auth.js: `GHSA-7rqj-j65f-68wh` (Email provider) non raggiungibile perche e configurato solo Credentials; `GHSA-x445-f3h2-j279` (multi OAuth account linking) non raggiungibile perche NextAuth non configura OAuth provider/linking; `GHSA-xmf8-cvqr-rfgj` (`getToken`) e corretto in 4.24.15 e protetto anche da fail-closed locale. Dependency tree unica su `@auth/core@0.41.3`.
- Secret scan redatta: 0 private key; 49 occorrenze di password demo in 20 file; `admin123` presente nella cronologia Git.
- Credenziali staging: prima 13 utenti attivi/13 password note; dopo rotazione 1 operativo attivo, 0 demo attivi, 0 match password note. `STAGING_ADMIN_EMAIL` rimosso dalla Preview. Le fixture storiche restano TEST-ONLY e la history non e stata riscritta.
- Vercel Marketplace: risorsa Upstash `concessioni-portuali-staging-rate-limit` disponibile in `fra1`; env writable limitate a Preview e `RATE_LIMIT_BACKEND=upstash`. Il token read-only non viene usato.
- Preview rate-limit `dpl_EVhsPpWyRLnSbNPLa2v1VqFQXogj`: READY su `concessioni-portuali-demo-8q7qsdf5l-ugotorsis-projects.vercel.app`; metadata `sourceCommitSha=215ff15605bfecfc3ee60468ed80c4d82fcb7d29`. Build completata con Next 16.3.8 e TypeScript.
- Prova distribuita: processo A 15 richieste consentite; processo B 15 consentite e richiesta 31 bloccata con HTTP 429; durata totale 2,93 secondi nella finestra di 60 secondi.
- Nota di riproducibilita: il commit precedente contiene `tests/unit/provider-mcp-catalog-cli.test.ts`, che importa un file rimasto non tracciato. Il bundle Preview ha incluso solo `scripts/legal-research/list-provider-tools.ts`, registrato nei metadata con SHA-256 `9433da40d2e369dcc2b7ddd556f91002225ab54a5a5225db6f8a7aaffec1946f`; il codice rate-limit distribuito corrisponde a `215ff15`.
- Neon Free: retention 21.600 secondi (6 ore), 10/10 branch, zero snapshot. Snapshot del branch child rifiutato; nuova recovery copy rifiutata con `branches limit exceeded`.
- Restore drill read-only su `br-delicate-cell-at66cfki`: query riuscita in 1.958 ms, ma 34 migration/62 tabelle contro 45/84 dello staging. Parent point: 2026-09-27T09:47:30Z. Compute recovery minimo `ep-muddy-violet-atk41e05` creato con scale-to-zero.
- Ricerca protetta: nessun diff in schema Prisma, trusted mission route o server legal-research.

## Stato dei quattro blocker

### AUTH.JS - PASS

- Prima: 2 critical per peer opzionale `@auth/core@0.34.3` auto-installato da NextAuth 4.24.15.
- Remediation: override mirato a `@auth/core@0.41.3`, nessuna migrazione v5; NextAuth v4 non importa il peer opzionale. `getToken` e usato una volta e ora e racchiuso in fail-closed `try/catch`.
- Finale: `npm audit --omit=dev` riporta 0 critical. Credentials, JWT/session, callback, MFA e tipi restano invariati e testati.

### RATE LIMIT - PASS PREVIEW

- Backend: Upstash REST distribuito, selezionato in Preview con `RATE_LIMIT_BACKEND=upstash` e credenziali writable `KV_REST_API_URL` / `KV_REST_API_TOKEN` generate dall'integrazione Vercel.
- Fail-closed: in production-like runtime il backend `upstash` senza URL/token writable genera errore; `KV_REST_API_READ_ONLY_TOKEN` non viene accettato per gli incrementi.
- Prova distribuita: PASS su Preview READY. Due processi distinti hanno condiviso la chiave `middleware:sensitive-api:<IP>`: 30 richieste consentite e la 31 bloccata con HTTP 429 in 2,93 secondi.
- Route coperte nel codice: login credentials, MFA verify/enrollment, export, document/legal-source/report download, admin e API legal-research sensibili.
- Scope: configurazione e verifica limitate a Vercel Preview; Production, DNS e `app.noetra.it` non modificati.

### DEMO CREDENTIALS - PASS STAGING

- Prima: 13 identita demo attive, tutte compatibili con password note; zero identita operative.
- Rotazione: 13 identita disattivate, account ADMIN operativo random creato con una tenant membership; password consegnata solo negli appunti locali e verificata contro il nuovo hash. MFA resta obbligatorio al primo accesso.
- Dopo: 1 identita operativa attiva, 0 demo attive, 0 password note corrispondenti. Seed demo impossibile in Preview/production e richiede `ALLOW_DEMO_SEED=true` solo in locale disposable.
- Classificazione: password in seed/test/README = TEST-ONLY; account staging = ROTATED; variabile bypass = REMOVED. History Git invariata.

### NEON RECOVERY - FAIL

- PITR/RPO: piano Free, history window massima 6 ore; staging e un child branch e lo snapshot diretto e stato rifiutato.
- Checkpoint: recovery del 27 settembre preservata; nessun branch e stato cancellato. Nuova copy impossibile con quota 10/10.
- Restore drill: PASS solo per leggibilita della vecchia recovery; FAIL per attualita/schema (34/62 contro 45/84).
- RTO: connessione e query minima recovery 1,958 secondi; RTO di restore/cutover completo non verificato. RPO operativo non soddisfatto.
- Azione manuale: upgrade Neon almeno Launch per history fino a 7 giorni e branch extra a pagamento, oppure backup `pg_dump` esterno approvato; creare una recovery recente e ripetere schema/query/cutover drill.

## Blocker obbligatori

1. **Recovery inadeguata.** Free limita history a 6 ore e branch a 10; la recovery disponibile e vecchia e schema-incompleta. Criterio: upgrade/backup approvato, recovery recente e restore/cutover drill.
2. **Release evidence residua.** Il deploy e la prova rate-limit Preview sono completati; resta pendente la QA completa e il commit deve diventare riproducibile senza file supplementari non tracciati.

## Condizioni di riapertura gate

Il gate puo essere rieseguito solo dopo evidenza dei cinque criteri. Fino ad allora sono vietati deploy production, promozione del deployment, associazione di `app.noetra.it` e modifiche DNS.