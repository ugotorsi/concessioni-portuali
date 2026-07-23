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
1. Collegare il repository GitHub a Vercel.
2. Importare il project.
3. Verificare framework `Next.js` rilevato automaticamente.
4. Configurare tutte le environment variables richieste (Production e Preview secondo necessita demo).
5. Avviare il deploy.
6. Controllare i build logs e risolvere eventuali env mancanti.
7. Aprire il dominio assegnato e testare login + percorsi demo principali.

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

