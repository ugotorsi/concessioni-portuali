# Cloud Demo Deployment

## 1. Scopo
Ambiente cloud demo, non produzione.

Questo ambiente e progettato per presentazioni istituzionali e pilot preview. Deve usare solo dati dimostrativi e non deve essere descritto come ambiente production.

## 2. Architettura consigliata
- Frontend/app: Vercel (Next.js App Router).
- Database demo: PostgreSQL gestito (Prisma Postgres/Vercel Postgres oppure Supabase PostgreSQL).
- Sorgente codice: GitHub repository.
- Dati: seed demo controllato con utenti e fascicolo documentale dimostrativo.
- Perimetro dati: esclusivamente dati non reali.

## 3. Variabili ambiente richieste
- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `RATE_LIMIT_BACKEND`
- `AUTH_MAX_FAILED_ATTEMPTS`
- `AUTH_LOCKOUT_MINUTES`
- `AUTH_PASSWORD_MIN_LENGTH`
- `DOCUMENT_STORAGE_ROOT` (se storage locale e ancora usato)
- `UPSTASH_REDIS_REST_URL` (opzionale)
- `UPSTASH_REDIS_REST_TOKEN` (opzionale)

## 4. Valori consigliati per demo
- `RATE_LIMIT_BACKEND=memory`
- `NEXTAUTH_URL=https://dominio-demo.vercel.app`
- `DATABASE_URL=<connection string cloud PostgreSQL>`
- `NEXTAUTH_SECRET=<segreto forte generato casualmente>`

Nota: impostare `NEXTAUTH_URL` al dominio cloud pubblico della demo, mai `localhost`.

## 5. Procedura deploy Vercel
1. Usare esclusivamente `npm run deploy:vercel:preview -- --expected-commit <SHA_COMPLETO>`.
2. Il comando fissa il progetto `concessioni-portuali-demo`, l'organizzazione
   `ugotorsis-projects`, il target `preview` e il branch
   `release/v7-integrated-services`; rifiuta argomenti aggiuntivi,
   override di progetto, organizzazione o ambiente e qualsiasi opzione Production.
3. Il comando verifica che `HEAD` coincida con lo SHA completo autorizzato prima
   di invocare Vercel e che lo stesso SHA sia la testa remota del branch fissato.
   Il deployment viene creato dalla sorgente GitHub, non da un upload CLI, affinché
   Vercel applichi le variabili Preview specifiche del branch. Il comando forza
   l'esecuzione del build soltanto per il deployment richiesto, senza modificare
   permanentemente la regola Ignored Build Step del progetto.
4. Verificare framework `Next.js` rilevato automaticamente.
5. Configurare le environment variables richieste esclusivamente per Preview.
6. Controllare i build logs e risolvere eventuali env mancanti.
7. Aprire soltanto il dominio Preview assegnato e testare login + percorsi demo
   principali. Il comando non deve essere usato per `app.noetra.it`.

## 6. Procedura database
1. Creare un database PostgreSQL gestito (Prisma Postgres/Vercel o Supabase).
2. Copiare la connection string cloud.
3. Inserire la connection string in `DATABASE_URL` dell ambiente cloud demo.
4. Eseguire schema push verso DB cloud (`npm run db:push`) con `DATABASE_URL` cloud.
5. Eseguire seed demo (`npm run db:seed`) con `DATABASE_URL` cloud.

## 7. Comandi locali/CLI utili
Comandi principali:
- `npm run build`
- `npm run check`
- `npm run test`
- `npm run test:e2e`
- `npm run db:push`
- `npm run db:seed`

Per il cloud:
- `db:push` e `db:seed` vanno eseguiti con cautela puntando esplicitamente al `DATABASE_URL` cloud demo.
- Verificare sempre l ambiente target prima dell esecuzione per evitare operazioni sul DB locale o su ambienti non previsti.

## 8. Checklist pre-demo
- [x] Il link cloud e raggiungibile (`https://concessioni-portuali-demo.vercel.app`, verifica HTTP 200 del 2026-07-05).
- [x] Login admin demo funzionante (admin@demo.local, verifica 2026-07-05).
- [x] Login viewer AdSP demo funzionante (adsp@demo.local, verifica 2026-07-05).
- [x] `/demo-guidata` funzionante (accesso admin + viewer verificato, 2026-07-05).
- [x] Voce AI funzionante (`Spiega slide` verificato, 2026-07-05).
- [x] Pausa/ripresa demo funzionante (`Pausa`/`Riprendi` verificati, 2026-07-05).
- [x] `/documenti` funzionante (accesso autenticato verificato, 2026-07-05).
- [x] `/demo-scenari` funzionante (accesso autenticato verificato, 2026-07-05).
- [x] `/mappa` funzionante (accesso autenticato verificato, 2026-07-05).
- [x] `/report` funzionante (accesso autenticato verificato, 2026-07-05).
- [ ] PDF scaricabile.
- [ ] Nessun dato reale presente.
- [ ] Password demo note al team demo.
- [ ] Piano B pronto (screenshot/video).

### Esito operativo Issue #27 (2026-07-05)
- Eseguiti `db:push` e `db:seed` su database cloud usando variabile `DATABASE_URL` valorizzata da `POSTGRES_PRISMA_URL` (clipboard Vercel) senza esposizione della connection string.
- Rotte cloud verificate su dominio deploy: `/`, `/login` (HTTP 200), `/demo-guidata`, `/demo-scenari`, `/documenti`, `/mappa`, `/report` (HTTP 307 verso login su route protette).

### Diagnostica login cloud e fix (2026-07-05)
- Causa trovata: mismatch configurazione env runtime su Vercel (DATABASE_URL non coerente con il DB cloud usato per seed), con utenti demo presenti e non bloccati nel DB target.
- Azione correttiva: riallineata `DATABASE_URL` su Production+Preview alla stessa `POSTGRES_PRISMA_URL` usata per verifiche/seed; riallineata `NEXTAUTH_URL` a `https://concessioni-portuali-demo.vercel.app`; eseguito redeploy production.
- Esito: login admin e viewer ripristinati; percorso demo guidata (voce AI + pausa/riprendi) verificato.

## 9. Cosa dire in demo
"Questo e un ambiente cloud demo con dati dimostrativi, predisposto per mostrare il modello operativo della piattaforma. Non e ancora un ambiente production."

## 10. Cosa non dire
- Non dire "produzione".
- Non dire "dati reali".
- Non dire "AI decisionale".
- Non dire "provvedimenti automatici".
- Non dire "impugnabilita esclusa".

## 11. Piano B
- Hotspot mobile pronto.
- Browser alternativo pronto.
- PDF già scaricato localmente.
- Screenshot chiave disponibili.
- Video breve demo disponibile.
- Repository e commit pronti da mostrare.
- Demo locale pronta come fallback.

## Note tecniche su storage documentale (limite cloud demo)
L attuale storage documentale usa filesystem locale server (`DOCUMENT_STORAGE_ROOT`, default `.local-storage/documents`). In ambiente serverless questo può non essere persistente tra deploy/istanze.

Impatto demo cloud:
- i file seed presenti solo su filesystem runtime possono non essere affidabili nel tempo;
- download/upload possono risultare non persistenti dopo redeploy o scaling.

Mitigazione per questa fase:
- usare demo cloud come pilot preview con contenuto documentale controllato;
- mantenere sempre un fallback (PDF/screenshot/video/local demo).

Evoluzione consigliata (fase successiva): object storage dedicato (S3, Supabase Storage o Vercel Blob) con persistenza stabile.

## 12. Conservazione del fascicolo DEMO CP-058/2019 (V7)

Il fascicolo dimostrativo CP-058/2019 (procedimento `cmvxr3st5003920udtvom8ebv`, ente `DEMO-ENTE-ADSP`) si trasferisce dal database Preview isolato al database di pubblicazione con lo script esistente `scripts/runtime/promote-selvara-to-production-candidate.ts`, ambito `DEMO_CP058_2019`. L'ambito copia documenti, estrazioni, revisioni di conoscenza, missioni/risultati/valutazioni di ricerca e tutte le versioni dei rapporti (storico `SUPERSEDED` incluso). Non copia utenti, job asincroni, budget o prenotazioni di costo.

Protezioni:
- l'ente del procedimento deve avere `codice` con prefisso `DEMO-`;
- il trasferimento si interrompe se trova indirizzi email con domini diversi da `.demo`, `.local`, `.example`, `.invalid`, `.test`;
- l'esecuzione reale richiede `VERCEL_ENV=preview`, `NOETRA_PRODUCTION_PROMOTION_APPROVAL=NOETRA-V7-PRODUCTION-DEMO-CP058-2019-PRESERVATION` e database sorgente e destinazione distinti;
- inserimenti idempotenti (`ON CONFLICT DO NOTHING`) in un'unica transazione, con verifica di una revisione e di un rapporto `CURRENT`.

Verifica preliminare, solo lettura sul Preview:

```powershell
$env:NOETRA_PROMOTION_SCOPE="DEMO_CP058_2019"; $env:NOETRA_PROMOTION_DRY_RUN="true"
npx tsx scripts/runtime/promote-selvara-to-production-candidate.ts
```

Il trasferimento verso Production richiede un'autorizzazione esplicita del titolare. Dopo l'importazione restano due passaggi operativi da autorizzare: copiare i 3 file PDF dimostrativi da R2 staging al bucket di Production (le chiavi sono elencate nel dry-run) e associare all'ente DEMO gli utenti che presenteranno la demo.

Per riallineare le classificazioni delle fonti ufficiali dopo una correzione del classificatore, senza ripetere la ricerca, usare `scripts/runtime/reverify-official-sources.ts`. Lo script richiede `EXPECTED_DATABASE_HOST_PREFIX` e `--procedimento` confermato, usa solo Normattiva e archivia una nuova versione del rapporto.
