# Legal Sources Taxonomy and Rule Orchestration (39C-3)

## Obiettivo
Introdurre un sottosistema tecnico per:
- tassonomia fonti legali portuali;
- import idempotente di pack documentali;
- orchestrazione deterministica delle regole applicabili;
- evidenza obbligatoria del controllo umano.

## Modello dati
Nuove entita Prisma:
- `Authority`
- `Port`
- `PortArea`
- `LegalSource`
- `LegalRule`
- `SourceRelation`
- `DocumentGap`
- `ImportRun`

Caratteristiche principali:
- scoping tenant tramite `enteId` (con fallback su fonti globali `enteId = null`);
- upsert idempotenti su chiavi naturali (`sourceKey`, `sourceId+ruleCode`, `gapKey`);
- tracciamento import con conteggi, warning e stato finale (`SUCCESS`, `PARTIAL`, `FAILED`).

## Manifest pack
Percorso:
- `data/legal-rule-packs/adsp-mtc/manifest.json`

Contenuti:
- metadati pack (`packCode`, `packVersion`, `tenantEnteCode`);
- autorita e porto;
- lista fonti con riferimento file locale;
- regole con matcher deterministici;
- relazioni tra fonti;
- gap documentali collegabili alle regole.

## Importer
Script:
- `npm run legal:import:adsp-mtc`
- `npm run db:normalize:legal-status:dry-run`
- `npm run db:normalize:legal-status`

Comportamento:
- valida manifest con schema `zod`;
- calcola checksum SHA-256 e size dei file presenti;
- in caso di file mancanti registra warning e continua (stato `PARTIAL`);
- aggiorna `ImportRun` con conteggi e timestamp.

Prerequisito DB (dataset legacy):
- se nel DB sono presenti stati legacy `VIGENTE`, `SUPERATA`, `BOZZA`, eseguire prima la normalizzazione versionata (`dry-run` e poi run reale) prima di `prisma db push`.

## Orchestratore
Servizio:
- `resolveApplicableLegalRules(input)` in `src/server/legal-rules/orchestrator.ts`

Principi:
- matching deterministico su campi espliciti (verticale, oggetto, attivita, art.47, morosita, polizza, ecc.);
- ordinamento per priorita;
- restituzione dei gap documentali aperti collegati alle regole applicabili;
- `humanReviewRequired` sempre `true`;
- disclaimer obbligatorio in ogni risposta.

## API
Endpoint protetti:
- `GET /api/legal-sources`
- `POST /api/legal-rules/resolve`

Entrambi richiedono autenticazione e rispettano scope tenant.

## UI
Nuova sezione:
- `/normativa/orchestrazione`

Include:
- KPI fonti/regole/gap/import;
- pannello di simulazione orchestratore;
- elenco fonti recenti;
- storico import run.

## Limiti correnti
- non effettua OCR o parsing semantico dei PDF;
- non decide esiti amministrativi;
- dipende dalla qualita del manifest e dalla manutenzione delle regole;
- non sostituisce valutazione giuridica del responsabile del procedimento.
