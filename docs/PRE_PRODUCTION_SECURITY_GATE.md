# Pre-production security gate - app.noetra.it

Data verifica: 2026-10-03

Checkout autorizzato: `C:\Users\ugoto\AppData\Local\Temp\concessioni-trusted-release-d252788`

Base verificata: detached HEAD `2111445`

Target consentito: Vercel Preview `staging-operativo` / Neon branch `staging-operativo`

Production e DNS: non modificati; `app.noetra.it` non associato.

## Esito

**HARDENING PRE-PRODUCTION NON SUPERATO.**

La patch applicativa locale compila e supera i test, ma il gate rimane chiuso per dipendenze runtime critiche, rate limiting non distribuito, credenziali demo non confinate/ruotate con evidenza e recovery Neon insufficiente. Non e stato eseguito deploy Preview della patch non committata e non e stata associata alcuna custom domain.

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
| Rate limiting | PARTIAL | **FAIL** | Nessuna credenziale Upstash Preview; backend predefinito in-memory |
| Audit trail | PARTIAL | PASS con residuo | Eventi auth/logout e catena SHA-256; storage nello stesso DB |
| Temporary DB recon | FAIL | PASS | Route, helper, token Vercel e bypass middleware rimossi |
| Dependency security | FAIL | **FAIL** | Da 19 a 13 advisory runtime; restano 2 critical e 5 high |
| Secret hygiene | FAIL | **FAIL** | Credenziali demo in source/test/history; confinamento e rotazione non provati |
| Backup / PITR / restore | FAIL | **FAIL** | Retention Neon 6 ore, zero snapshot, nessun restore drill corrente |
| Build e unit test | PARTIAL | PASS | 3.338 test passati; build Next 16.3.8 e typecheck passati |
| Preview security QA | N/D | **PENDING** | Nessun deploy della patch locale finche i blocker restano aperti |

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
- Conservati schema Prisma, provider flag, worker async e ResearchMission protetta.

## Evidenze di verifica

- `npm test -- --maxWorkers=1 --testTimeout=15000`: 229 file passati, 1 skipped; 3.338 test passati, 5 skipped.
- `npx tsc --noEmit`: PASS.
- `npm run build` con secret effimeri solo in memoria: PASS su Next 16.3.8.
- `git diff --check`: PASS.
- Route build: nessuna `/api/admin/db-recon-preview-temp`.
- Audit dipendenze runtime: 13 totali, 2 critical, 5 high, 5 moderate, 1 low.
- Secret scan redatta: 0 private key; 49 occorrenze di password demo in 20 file; `admin123` presente nella cronologia Git.
- Neon progetto staging: `history_retention_seconds=21600` (6 ore); lista snapshot vuota; branch checkpoint/recovery esistenti ma nessun restore drill corrente.
- Ricerca protetta: nessun diff in schema Prisma, trusted mission route o server legal-research.

## Blocker obbligatori

1. **Auth.js critico.** `next-auth@4.24.15` incorpora `@auth/core@0.34.3`; npm segnala 2 critical. La proposta automatica e un downgrade a `next-auth@4.24.7`, non accettato. Criterio di sblocco: versione/migrazione corretta e suite auth/MFA completa, oppure risk acceptance formale con mitigazioni e scadenza.
2. **Rate limiting non distribuito.** Preview non dispone di `UPSTASH_REDIS_REST_URL/TOKEN`; il default e memory per istanza. Criterio: backend distribuito configurato, fail-closed verificato e test 429 multi-richiesta.
3. **Credenziali demo.** Password note sono in seed, README, E2E e storia Git; non esiste evidenza che gli account staging siano isolati e ruotati. Criterio: account Preview dedicati, password casuali ruotate, nessun riuso esterno, seed production-safe e inventario secret/provider validato.
4. **Recovery.** PITR Neon e limitato a 6 ore, non esistono snapshot e manca un restore drill recente. Criterio: retention approvata, backup/snapshot indipendente e restore non distruttivo documentato con RPO/RTO.
5. **Release evidence.** La patch e locale su detached HEAD e non e stata sottoposta a QA Preview. Criterio: commit dedicati, push non forzato su `staging-operativo`, deploy dell'esatto SHA e test anonimo/login/MFA/logout/RBAC/cross-tenant. Questo passo viene dopo i blocker 1-4.

## Condizioni di riapertura gate

Il gate puo essere rieseguito solo dopo evidenza dei cinque criteri. Fino ad allora sono vietati deploy production, promozione del deployment, associazione di `app.noetra.it` e modifiche DNS.