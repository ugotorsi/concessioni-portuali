# ChatGPT MCP OAuth con WorkOS AuthKit

## Scopo

Questa integrazione espone `https://<app-host>/api/mcp` come risorsa MCP remota protetta da OAuth 2.1, mantenendo NextAuth come login dell'applicazione e il database locale come autorita per utenti e tenant.

WorkOS AuthKit opera in modalita Standalone Connect. Non sostituisce NextAuth e non decide l'accesso ai dati locali.

L'autorizzazione e composta da tre layer distinti:

- OAuth autentica il token WorkOS verificando RS256, issuer, audience/resource, scadenza, subject e claim identita/tenant. Gli scope OAuth standard gestiti dal flusso sono `openid`, `profile`, `email` e `offline_access`.
- L'applicazione risolve actor, ruolo e membership dal database locale e deriva i permessi interni `research:read` e `research:write` tramite la policy tenant esistente. I claim JWT `scope`, `scp` e `permissions` non concedono permessi applicativi.
- Il `ResearchFascicoloAccessGrant` autorizza lo specifico fascicolo per tutti i tool case-specific.

## Contratto di identita

- L'endpoint di completamento Standalone riceve l'utente autenticato da NextAuth.
- `User.id` locale viene inviato a WorkOS come `user.id` e memorizzato come `user.external_id`.
- Il JWT WorkOS deve esporre `user.external_id` nella claim firmata `urn:concessioni-portuali:actor_id`.
- La claim opzionale `urn:concessioni-portuali:tenant_id` contiene il tenant scelto durante il consenso.
- La claim standard `sub` identifica l'utente WorkOS e viene usata solo nel claimant tecnico `workos:<sub>`.
- Ad ogni richiesta MCP, l'applicazione verifica che l'utente locale sia attivo e membro del tenant indicato. Il database locale resta autoritativo.

Non usare email o `sub` WorkOS come identificatore locale persistente.

## Variabili ambiente

Configurare nell'ambiente applicativo:

```dotenv
WORKOS_AUTHKIT_ISSUER="https://<authkit-domain>"
WORKOS_API_KEY="<secret>"
MCP_RESOURCE_URI="https://<app-host>/api/mcp"
MCP_FASCICOLO_GRANT_SECRET="<at-least-32-random-bytes>"
MCP_FASCICOLO_GRANT_TTL_SECONDS="1800"
```

Requisiti:

- `WORKOS_AUTHKIT_ISSUER` e `MCP_RESOURCE_URI` devono essere URL HTTPS senza query, frammenti o credenziali.
- `MCP_RESOURCE_URI` deve coincidere esattamente con il resource indicator configurato in WorkOS e richiesto da ChatGPT.
- `MCP_FASCICOLO_GRANT_SECRET` deve essere un segreto server-side di almeno 32 byte, distinto dalle chiavi OAuth e ruotato tramite la gestione segreti dell'ambiente.
- `MCP_FASCICOLO_GRANT_TTL_SECONDS` e opzionale, vale 1800 per default ed e accettato solo tra 300 e 3600 secondi.
- Non committare valori reali.

## Trusted fascicolo access grant

OAuth identifica l'attore e il tenant; non autorizza da solo un fascicolo. Tutti i tool case-specific richiedono anche un grant applicativo firmato e a breve durata nell'header:

```http
X-Concessioni-Fascicolo-Grant: fg1.<payload-base64url>.<hmac-base64url>
```

Il backend Concessioni Portuali emette il grant esclusivamente nel processo server trusted chiamando direttamente `mintResearchFascicoloAccessGrant(...)`, usando la missione memorizzata e la policy tenant locale. Non esiste un endpoint HTTP di mint esposto al browser. Il payload lega versione, purpose, attore, tenant, scope fascicolo derivato, missione origine, emissione, scadenza e nonce. Il grant non e un argomento tool, non viene persistito o loggato e non deve entrare nel model context.

`research_capabilities` resta disponibile con il solo OAuth. `research_list_pending` e tutti i tool che leggono o mutano missioni richiedono il grant; la lista viene filtrata allo scope firmato e ogni operazione verifica la missione memorizzata prima di procedere. Grant assente, invalido, scaduto, riferito a un altro attore/tenant o a un altro fascicolo fallisce chiuso.

Il percorso produttivo e: backend Concessioni Portuali -> esecuzione programmatica OpenAI -> MCP. Il backend conserva il raw grant server-side e lo inoltra soltanto nell'header `X-Concessioni-Fascicolo-Grant`, fuori dal contesto del modello, tramite un client Streamable HTTP oppure tramite gli header del server MCP nell'OpenAI Agents SDK. Il grant non e nel prompt, non e scelto dal modello, non e copiato dall'utente e non dipende da ChatGPT Project Memory.

Il client ChatGPT configurato manualmente puo autenticarsi via OAuth e usare `research_capabilities`, ma non puo presentare questo header applicativo custom e quindi non puo usare i tool case-specific:

`MANUAL_CHATGPT_CASE_TOOLS_REQUIRE_TRUSTED_FASCICOLO_BINDING`

Non e attualmente implementato un mapping trusted tra `fascicoloScopeId` e conversation, thread o session OpenAI. Il grant garantisce il boundary di autorizzazione dati/tool, non l'isolamento dello storico conversazionale; tale binding resta un hardening necessario prima dell'end-to-end finale.

## Configurazione WorkOS

1. Creare o selezionare un ambiente AuthKit con dominio HTTPS pubblico.
2. Abilitare Standalone Connect.
3. Impostare la Standalone Login URI:

   `https://<app-host>/api/auth/workos/complete`

4. Abilitare Client ID Metadata Document (CIMD) per la registrazione dei client MCP.
5. Abilitare Dynamic Client Registration solo come fallback quando CIMD non e disponibile nel client.
6. Registrare il resource indicator esatto:

   `https://<app-host>/api/mcp`

7. Non configurare `research:read` o `research:write` come scope OAuth: sono permessi applicativi derivati esclusivamente dalla policy locale.
8. Configurare un JWT template per gli access token con almeno:

```json
{
  "urn:concessioni-portuali:actor_id": "{{ user.external_id }}"
}
```

9. Rendere disponibile durante il consenso la claim tenant:

   `urn:concessioni-portuali:tenant_id`

   Le scelte vengono fornite dall'applicazione usando esclusivamente le membership locali dell'utente.
10. Abilitare refresh token e `offline_access` per consentire a ChatGPT di rinnovare l'accesso senza una nuova autorizzazione interattiva. Gli access token devono essere RS256 e includere issuer, audience/resource e scadenza.
11. Copiare dalla pagina di gestione del connettore ChatGPT il redirect URI esatto e registrarlo in WorkOS. Non ricostruirlo manualmente.

## Configurazione ChatGPT

1. Creare un connettore MCP remoto con URL:

   `https://<app-host>/api/mcp`

2. Se richiesto, indicare OAuth come metodo di autenticazione.
3. Lasciare che ChatGPT scopra:

   - protected resource metadata: `https://<app-host>/.well-known/oauth-protected-resource`
   - authorization server: valore di `WORKOS_AUTHKIT_ISSUER`

4. Usare soltanto gli scope OAuth standard supportati da WorkOS (`openid profile email offline_access`).
5. Registrare in WorkOS il redirect URI mostrato da ChatGPT.

Il server pubblica `securitySchemes` sia nel campo MCP corrente sia nel mirror `_meta.securitySchemes` per compatibilita client.

## Flusso atteso

1. ChatGPT legge i metadata della risorsa protetta e avvia authorization code con PKCE S256.
2. WorkOS richiama la Standalone Login URI con `external_auth_id`.
3. Se non esiste una sessione NextAuth, l'applicazione reindirizza a `/login` conservando la callback.
4. L'applicazione ricarica utente e membership locali, quindi completa il flusso WorkOS con identita immutabile e scelte tenant consentite.
5. WorkOS torna al redirect URI ChatGPT e rilascia token per la risorsa MCP.
6. `/api/mcp` verifica firma JWKS, RS256, issuer, audience, validita temporale e claim identita/tenant, poi deriva l'autorizzazione read/write dalla policy locale.

Non esiste fallback anonimo. Configurazione provider assente produce `503 AUTH_UNAVAILABLE`; credenziali assenti o non valide producono `401`; autorizzazione locale insufficiente produce `403 FORBIDDEN` senza challenge `insufficient_scope`.

## Verifica offline

La suite non usa login provider, database di produzione o chiamate WorkOS reali:

```powershell
npx vitest run tests/unit/legal-research-mcp-auth.test.ts tests/unit/legal-research-mcp.test.ts tests/unit/workos-complete-route.test.ts
```

Copre JWT RS256/JWKS, rotazione `kid`, issuer, audience, scadenza, utenti e tenant locali, permessi applicativi, challenge OAuth, metadata MCP e completamento Standalone mockato.

## Verifica controllata prima del rilascio

- Confermare che gli URL pubblici siano HTTPS e identici tra ambiente, WorkOS e ChatGPT.
- Confermare che la JWKS pubblicata da WorkOS contenga la chiave usata dai token.
- Confermare che access token e refresh token non compaiano in log o risposte applicative.
- Eseguire un flusso end-to-end soltanto in un ambiente non produttivo autorizzato, con account e dati di test.
- Verificare revoca, scadenza, cambio tenant e disattivazione dell'utente locale.
