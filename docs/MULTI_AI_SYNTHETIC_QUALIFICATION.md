# NOETRA multi-AI: qualificazione sintetica

Data: 2026-11-05  
Issue: [#70](https://github.com/ugotorsi/concessioni-portuali/issues/70)

## Perimetro

La qualificazione usa esclusivamente dati sintetici, chiavi fittizie e trasporti
iniettati. Non esegue chiamate ai provider, non legge credenziali configurate e
non modifica database, variabili di ambiente, pricing approvato o gate runtime.

OpenAI resta il provider principale. Anthropic e DeepSeek conservano:

- `technicalQualificationApproved: false`;
- `realDataApproved: false`;
- `automaticExecutionApproved: false`;
- `pricingVersion: null`.

## Esito

| Controllo | Claude Sonnet 5 | DeepSeek V4 Pro | Note |
|---|---|---|---|
| Trasporto simulato, zero rete provider | PASS | PASS | Sono accettati solo transport iniettati nei test. |
| Contratto JSON NOETRA | PASS | PASS | Anthropic usa JSON Schema strict; DeepSeek JSON object con schema nelle istruzioni. |
| JSON malformato o campi extra | PASS | PASS | Output respinto. |
| Riferimenti pagina forniti | PASS | PASS | I `basisRefs` top-level sono confrontati con le pagine inviate. |
| Evidence span sconosciuto | PASS | PASS | L'item viene quarantinato e il risultato non e promovibile. |
| Citazioni canoniche | PASS | PASS | Le quote sono ricostruite dal server dagli evidence span autenticati. |
| Non-fabbricazione semantica del modello reale | NOT TESTED | NOT TESTED | Richiede il successivo test generativo sintetico autorizzato. |
| Prompt injection nel documento | PASS | PASS | Il testo resta tra delimitatori untrusted e non altera il payload simulato. |
| Limite input e risposta | PASS | PASS | Input eccessivo bloccato prima del transport; risposta eccessiva respinta. |
| Timeout, 4xx, 5xx, rate limit | PASS | PASS | Errore tipizzato, una sola chiamata. |
| Retry o fallback automatico | PASS | PASS | Nessun retry e nessun secondo provider. |
| Metering input/output/cache | PASS | PASS | Normalizzazione e contabilizzazione verificate. |
| Metering assente o incoerente | PASS | PASS | Fail-closed. |
| Pricing assente o costo oltre cap | PASS | PASS | Fail-closed. |
| Pricing ufficiale di riferimento | PASS | PASS | Versionato ma non approvato e non collegato al catalogo runtime. |
| Privacy per fascicoli reali | NOT TESTED | FAIL | Entrambi restano bloccati; DeepSeek presenta blocker documentali. |
| Generazione live | NOT TESTED | NOT TESTED | Richiede autorizzazione separata. |

## Correzioni prodotte dalla qualificazione

1. Il servizio di analisi ora rifiuta `basisRefs` top-level non presenti negli
   estratti forniti.
2. Il metering Anthropic somma `input_tokens`,
   `cache_read_input_tokens` e `cache_creation_input_tokens` nel totale input
   logico richiesto dal contratto contabile NOETRA. I tre componenti restano
   separati per la tariffazione.

## Catalogo economico non approvato

Versione: `MULTI_AI_PRICING_REFERENCE_2026_11_05`  
Valuta: USD per 1 milione di token.  
Tasso USD/EUR: non impostato.  
Stato: `REFERENCE_ONLY_UNAPPROVED`.

### Anthropic

Fonte ufficiale consultata il 2026-11-05:
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).

| Voce | USD / MTok |
|---|---:|
| Input | 2.00 |
| Output | 10.00 |
| Cache hit/refresh | 0.20 |
| Cache write 5 minuti | 2.50 |
| Cache write 1 ora | 4.00 |

Il preventivo sintetico usa prudenzialmente 4 USD/MTok per ogni cache write.
La generazione/tokenizzazione specifica di Sonnet 5 deve ancora essere
confermata prima dell'approvazione economica.

### DeepSeek

Fonte ufficiale consultata il 2026-11-05:
[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/).

| Voce | Off-peak USD / MTok | Peak USD / MTok |
|---|---:|---:|
| Input cache miss | 0.66 | 1.32 |
| Input cache hit | 0.022 | 0.044 |
| Output | 1.98 | 3.96 |

Il preventivo usa sempre le tariffe peak. Le finestre dichiarate sono
01:00-04:00 e 06:00-10:00 UTC nei giorni feriali, escluse le festivita
cinesi. La tariffa e una fotografia datata e deve essere ricontrollata prima
di ogni approvazione.

## Privacy Anthropic API

Stato complessivo: **NOT TESTED / real data BLOCKED**.

PASS documentali:

- DPA e SCC incorporati nei Commercial Terms;
- retention API standard entro 30 giorni, con eccezioni documentate;
- input/output commercial API non usati per training per default.

Blocker:

- stato ZDR dell'organizzazione non verificato;
- storage diretto negli Stati Uniti e TIA EU-US non approvata;
- lista subprocessori e localizzazioni non acquisita;
- eventuale disciplina "Covered Model" per Sonnet 5 non verificata;
- base giuridica, informativa, segreto professionale e procedure NOETRA non
  approvate.

Fonti:

- [DPA article](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa)
- [Data Processing Addendum](https://www.anthropic.com/legal/data-processing-addendum)
- [Retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- [Zero Data Retention](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)
- [Training](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)
- [Server location](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)
- [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- [Subprocessors](https://trust.anthropic.com/subprocessors)

## Privacy DeepSeek Open Platform API

Stato complessivo: **FAIL / real data BLOCKED**.

Blocker:

- la Privacy Policy esclude espressamente i dati personali degli utenti
  downstream dall'ambito coperto per l'Open Platform;
- nessun DPA, SCC, garanzia art. 46 GDPR o TIA applicabile ai payload API e
  stato verificato;
- retention, esclusione dal training, hosting e subprocessori dei payload API
  downstream non sono documentati;
- ruoli e obblighi contrattuali per i fascicoli NOETRA richiedono un accordo
  enterprise scritto.

Il provvedimento del Garante n. 33 del 30 gennaio 2025 riguarda il servizio
DeepSeek in termini ampi, su fatti relativi al servizio consumer. Non contiene
un'esplicita inclusione o esclusione dell'Open Platform API. L'ambito API resta
quindi una questione legale non risolta; il blocco privacy autonomo rende
comunque vietato l'invio di fascicoli reali.

Fonti:

- [Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)
- [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [Garante docweb 10098477](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10098477)

## Validazione

- test mirati: 41/41 PASS;
- suite completa: 348 file PASS, 4.499 test PASS;
- skip attesi: 5 file, 34 test;
- lint delle modifiche, error-level: PASS;
- TypeScript typecheck: PASS;
- build Production locale con segreto NextAuth effimero: PASS.

## Proposta per il successivo live test sintetico

Richiede una nuova autorizzazione esplicita.

- budget massimo cumulativo: **5 USD**;
- prenotazione interna: 2,50 USD per provider;
- una richiesta a Claude Sonnet 5 e una a DeepSeek V4 Pro;
- massimo 100.000 token input e 10.000 token output per richiesta;
- nessun retry, fallback, tool, ricerca o documento reale;
- prompt e risposta interamente sintetici;
- tariffazione DeepSeek sempre al picco e cache-write Anthropic sempre alla
  tariffa prudenziale di un'ora;
- stop immediato per metering assente/incoerente, risposta non conforme,
  timeout, errore provider o preventivo oltre budget;
- consuntivo separato per provider e confronto con l'addebito effettivo.

Con i prezzi di riferimento, il worst case tariffario dei limiti proposti e
circa 0,50 USD per Anthropic e 0,1716 USD per DeepSeek. Il cap di 5 USD e una
prenotazione prudenziale, non una garanzia sulla fatturazione definitiva del
provider.
