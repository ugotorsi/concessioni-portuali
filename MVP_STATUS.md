# MVP Status - Concessioni Portuali

## Stato attuale
Progetto ripristinato e avviabile in locale con stack Next.js + Prisma + PostgreSQL Docker.

## Moduli disponibili
- Dashboard
- Concessioni
- Criticita
- Pagamenti
- Sopralluoghi
- Procedimenti
- Report
- Normativa
- AI assistiva
- Vista consultiva AdSP
- Export CSV e PDF report

## Cosa funziona
- Build produzione (`npm run build`) verde
- Check progetto (`npm run check`) verde
- Prisma validate/generate/push verdi con DB attivo
- Seed demo eseguibile e completato
- Accessi ruolo-based verificati (ADMIN e VIEWER_ADSP)
- Export report CSV verificato
- PDF report verificato su report esistente

## Anomalie residue
- `middleware.ts` assente (attualmente non bloccante: guard server-side operative)
- Stato Git da consolidare in base alla policy del team

## Prossimi step
1. Consolidare baseline Git del ripristino
2. Definire eventuale introduzione middleware centralizzato solo se richiesto
3. Mantenere audit periodico su DB/container e dipendenze
