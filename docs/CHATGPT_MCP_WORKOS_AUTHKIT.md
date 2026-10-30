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
```

Requisiti:

- `WORKOS_AUTHKIT_ISSUER` e `MCP_RESOURCE_URI` devono essere URL HTTPS senza query, frammenti o credenziali.
- `MCP_RESOURCE_URI` deve coincidere esattamente con il resource indicator configurato in WorkOS e richiesto da ChatGPT.
- L'alias dedicato NOETRA Preview
  `concessioni-portuali-demo-v7-mcp-preview.vercel.app` consente esclusivamente
  `/api/mcp` e `/.well-known/oauth-protected-resource`; qualsiasi altro percorso,
  incluse pagine, API applicative e asset statici, risponde `404` senza redirect.
- L'hostname dedicato non sostituisce OAuth: `/api/mcp` continua a richiedere un token
  WorkOS valido e le autorizzazioni locali su attore, tenant e missione.
- Non committare valori reali.

Il valore esatto di `MCP_RESOURCE_URI` deve essere registrato anche in WorkOS AuthKit,
Connect -> Configuration -> Resource Indicators. La registrazione Preview protetta usa:

```powershell
npm run runtime:configure-workos-mcp-resource -- --resource https://concessioni-portuali-demo-v7-mcp-preview.vercel.app/api/mcp --apply --confirm-resource https://concessioni-portuali-demo-v7-mcp-preview.vercel.app/api/mcp
```

Il comando accetta soltanto tale URI esatto, rifiuta wildcard e ambienti AuthKit non
Staging, conserva tutti gli indicatori esistenti e verifica la postcondizione mediante
una nuova lettura API.

## Binding server-side attore-missione

OAuth identifica l'attore e il tenant; l'accesso a una missione richiede inoltre un'assegnazione persistita e immutabile della `ResearchMission` al `User.id` locale esposto nella claim firmata `urn:concessioni-portuali:actor_id`.

La superficie admin di creazione assegna la missione a un attore attivo e deriva il tenant dalla sua membership predefinita. Le missioni legacy senza assegnatario restano invisibili. `research_list_pending` filtra per tenant e attore assegnato; get, claim, submit, defer e complete ripetono lo stesso controllo sulla missione persistita prima di operare. Il modello non puo fornire o sovrascrivere `tenantId`, `actorId`, `caseId` o `fascicoloScopeId` come selettori di autorizzazione.

Il percorso operativo e: Concessioni Portuali crea e assegna la missione -> ChatGPT personale la prende tramite MCP -> ChatGPT usa i propri connettori autorizzati -> ChatGPT restituisce e completa il bundle tramite MCP. Non sono richiesti client provider programmatici nel backend.

Il `fascicoloScopeId` continua a essere derivato dal server usando tenant e case reference della missione persistita. La separazione delle conversazioni ChatGPT per fascicolo resta difesa in profondita e non sostituisce l'assegnazione applicativa.

## Limiti di attivazione ChatGPT

MCP e un protocollo client-initiated: il backend pubblica missioni persistenti, ma non puo avviare una conversazione o un'attivita nell'account ChatGPT dell'utente. Non esiste nel contratto una chiamata backend che riutilizzi la sessione o l'abbonamento ChatGPT personale.

Le attivita ChatGPT basate su eventi supportano soltanto gli eventi indicati dal prodotto ChatGPT, attualmente Gmail, Slack e GitHub. Un nuovo documento NOETRA non e un evento ChatGPT supportato. La Responses API puo invocare un server MCP remoto, ma costituisce un'esecuzione API separata e potenzialmente a pagamento: non deve essere usata come sostituto implicito dell'account ChatGPT o dei suoi plugin.

Il comportamento supportato e quindi:

1. il nuovo documento genera una missione `PENDING`, assegnata all'attore locale;
2. i controlli periodici generano missioni `SUBSEQUENT_TREATMENT_SEARCH` deduplicate per fascicolo e periodo;
3. ChatGPT, avviato dall'utente o da una modalita ChatGPT che supporti effettivamente il connettore MCP, elenca e prende le missioni;
4. ChatGPT usa i plugin autorizzati dall'utente e restituisce fonti e bundle al server MCP;
5. NOETRA aggiorna copertura, conflitti, lacune e rapporto lasciando ogni valutazione in stato di revisione professionale.

Non configurare automazioni Gmail, Slack o GitHub come trigger fittizi per documenti NOETRA.

## Controlli periodici

Il worker applicativo puo creare missioni di controllo periodico senza eseguire provider:

```dotenv
PERIODIC_LEGAL_RESEARCH_ENABLED="true"
PERIODIC_LEGAL_RESEARCH_INTERVAL_DAYS="30"
```

L'opzione e disabilitata per default. L'intervallo ammesso e 1-365 giorni. Il worker riconcilia al massimo una volta l'ora e crea nuove missioni soltanto quando l'ultima missione corrente del fascicolo e antecedente alla soglia. Ogni missione conserva `tenantId`, `procedimentoId`, revisione e attore assegnato; un fascicolo di rinnovo usa un `procedimentoId` autonomo e non eredita missioni o conclusioni dal fascicolo precedente.

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
