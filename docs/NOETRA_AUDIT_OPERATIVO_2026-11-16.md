# NOETRA - consolidamento audit operativo

Data di verifica: 16 novembre 2026  
Ambiente online verificato: `https://app.noetra.it`  
Ramo correttivo: `noetra/audit-operativo-20261116`  
Target della pull request: `staging-operativo`

## Esito

NOETRA non viene dichiarata completata in Production. L'ambiente online resta correttamente
fail-closed: comando AI globale OFF, worker applicativo sospeso e ricerca non eseguibile senza
le autorizzazioni previste.

Il percorso applicativo è stato invece provato in ambiente isolato, con dati sintetici e provider
simulati ai confini di rete:

1. acquisizione del documento;
2. estrazione locale;
3. analisi AI del corpus;
4. conoscenza strutturata e rapporto versionato;
5. conferma professionale delle date di riferimento;
6. ricerca giuridica autorizzata;
7. verifica delle fonti ufficiali;
8. aggiornamento del rapporto;
9. proposte operative e bozza di atto.

L'interrogazione sul fascicolo non è una chat immediata. È un flusso persistente e verificabile:
quesito in bozza, approvazione professionale, autorizzazione esplicita della ricerca entro budget,
missione, fonti da verificare e rapporto versionato.

## Audit online

La sessione amministrativa già autenticata è stata usata senza acquisire o mostrare credenziali.
Sono state eseguite solo richieste di lettura.

- pagine principali: dashboard, fascicoli, verticali, mappa, concessionari e stato servizi;
- 9 concessioni e relative schede;
- 17 fascicoli;
- 11 schede per fascicolo;
- 187 pagine fascicolo verificate, tutte HTTP 200.

Non sono stati azionati comandi mutativi, AI a pagamento, cancellazioni o configurazioni
Production.

## Stato delle funzioni principali

| Pagina o funzione | Stato | Evidenza |
|---|---|---|
| Dashboard | Funzionante ma complessa | Espone anche dati demo ed E2E. |
| Registro fascicoli | Difettoso online | Dati professionali, demo ed E2E non sono separati. |
| Documenti | Verificata e funzionante | Scheda raggiungibile per 17/17 fascicoli. |
| Cronologia, soggetti e concessione | Verificate e funzionanti | Schede raggiungibili per 17/17 fascicoli. |
| AI e analisi | Corretta nel ramo | Tre attività visibili; l'avvio usa il pipeline reale e il medesimo preflight dell'ammissione. |
| Interroga AI | Funzionante come percorso guidato | Bozza, approvazione, autorizzazione, missione e risultati sono persistenti; non è una chat sincrona. |
| Ricerca giuridica | Funzionante se autorizzata | Canali, budget, missione e fonti restano fail-closed e soggetti a revisione. |
| Scadenze e criticità | Verificate e funzionanti | Schede raggiungibili per 17/17 fascicoli. |
| Rapporto | Funzionante ma incompleto online | Presente in 5 fascicoli osservati, assente in 12. |
| Proposte e atti | Funzionanti ma dipendenti dal rapporto | Collaudati nella catena sintetica isolata. |
| Stato dei servizi | Semplificato nel ramo | Sintesi di AI, provider, worker, ricerca, budget, code e blocchi con percorso guidato. |

## Correzione del percorso AI

### Aggiorna fascicolo

Il pulsante invoca il pipeline manuale reale. La disponibilità mostrata nella pagina usa ora una
valutazione read-only delle stesse condizioni dell'ammissione:

- ambiente autorizzato ai dati reali;
- comando AI globale;
- provider e modello approvati;
- provider abilitato agli avvii manuali;
- corpus interamente estratto e disponibile;
- testo documentale presente;
- costo massimo stimabile;
- budget compatibile.

MFA, ruolo ADMIN, tenant, audit e conferma esplicita restano obbligatori nell'azione mutativa.

Il collaudo ha individuato e corretto un difetto sostanziale: con una revisione già `CURRENT`,
ogni nuovo avvio generava una nuova analisi perché l'identità del job includeva un nuovo
`executionId`. Ora il pipeline confronta il fingerprint del corpus con la revisione corrente:
se coincidono, non ripete l'analisi a costo e prosegue con le missioni di ricerca mancanti.

### Interroga AI

La UI non presenta più il semplice accesso al pannello come una risposta AI già disponibile.
Il percorso espone correttamente:

1. salvataggio del quesito;
2. approvazione della versione;
3. conferma testuale dell'autorizzazione alla ricerca entro budget;
4. ammissione della missione;
5. stato del job;
6. fonti e risultati persistenti;
7. rapporto versionato.

### Ricerca e aggiornamento giuridico

Il collegamento porta direttamente al percorso operativo dei quesiti approvati. L'esecuzione resta
separata dalla consultazione e non è disponibile senza policy e canali server autorizzati.

## Collaudo sintetico end-to-end

Harness: `scripts/runtime/verify-legal-chain-isolated.ts`.

Vincoli applicati:

- PostgreSQL effimero `noetra_legal_chain` su loopback;
- PDF sintetico di 40 pagine generato dai fixture Selvara versionati;
- OpenAI, Moonlit e Normattiva simulati ai rispettivi confini;
- ogni host non simulato rifiutato;
- nessun provider reale contattato;
- nessun costo esterno;
- automazione generale OFF.

Esito finale:

- 40/40 pagine estratte, 47.481 caratteri;
- una sola analisi AI simulata;
- 60 elementi di conoscenza e 144 collegamenti alle evidenze;
- 47 citazioni valide, 0 citazioni non valide;
- 6 quesiti di ricerca eseguiti;
- 18 candidati, 20 valutazioni di fonte, 2 fonti ufficiali utilizzabili;
- 6 job di ricerca `SUCCEEDED`;
- analisi e 6 ricerche contabilizzate `SETTLED`;
- rapporto corrente con 7 questioni e 7 percorsi operativi;
- 43 proposte operative;
- una bozza di atto creata e riusata idempotentemente;
- terzo avvio: 5 ricerche ammesse;
- quarto avvio: sola sesta ricerca residua;
- quinto avvio: `NO_RESEARCH_TO_RUN`;
- nessuna richiesta di rete rifiutata perché nessuna richiesta non simulata è stata tentata.

Il report JSON del collaudo è conservato fuori dal repository come artefatto di sessione.

## Dati dimostrativi in Production

| Concessione | Provenienza | Dipendenze osservate |
|---|---|---|
| CP-067/2018 | `prisma/seed.ts` | obblighi, scadenze, 3 criticità, pagamenti, 2 documenti, sopralluoghi, 2 fascicoli, report |
| CP-031/2017 | `prisma/seed.ts` | obblighi, scadenze, 2 criticità, pagamenti, 3 documenti, sopralluogo, fascicolo, report |
| CP-014/2020 | `prisma/seed.ts` | obblighi, scadenze, criticità, pagamenti, 3 documenti, sopralluogo, 2 fascicoli, report |
| CP-073/2023 | `prisma/seed.ts` | obblighi, scadenze, criticità, pagamenti, 2 documenti, sopralluogo, fascicolo, report |
| CP-081/2024 | `prisma/seed.ts` | obblighi, scadenza, documento e relazioni operative |
| CP-001/2021 | `prisma/seed.ts` | obblighi, scadenze, 2 criticità, pagamenti, 5 documenti, 3 fascicoli, inclusi 2 `e2e-proc-*` |
| CP-058/2019 | `prisma/seed.ts` | 2 obblighi, scadenza, 2 criticità, documento, sopralluogo, 2 fascicoli, 2 report |
| CP-046/2022 | `prisma/seed.ts` | obblighi, scadenza, 2 documenti e relazioni operative |
| E2E-TEST-001 | `scripts/runtime/staging-e2e-case.ts` | soggetto E2E, fascicolo E2E, documento sintetico e rapporto sintetico |

I record sono visibili perché sono già persistiti nei tenant interrogati dall'applicazione e non
esiste una classificazione durevole `PROFESSIONAL` / `DEMO` / `E2E` usata da tutte le query.
Il guard corrente impedisce nuovi seed demo in Preview/Production, ma non classifica i record
storici.

### Piano di separazione non distruttivo

1. Creare database e deployment demo distinti, mai collegati all'alias Production.
2. Introdurre una classificazione persistente del dataset e tenant demo non assegnabili a utenti
   professionali.
3. Applicare il filtro a dashboard, registri, mappe, export, selettori e job.
4. Consentire il seed solo su host/progetti demo in allowlist e database disposable vuoti.
5. Aggiungere un gate di release che blocchi Production se trova record demo/E2E nel perimetro
   professionale.
6. Preparare una migrazione con dry-run, backup, conteggi per relazione e piano di rollback.
7. Eseguire migrazione o cancellazione soltanto dopo approvazione esplicita.

Nessun record Production è stato modificato o cancellato.

## Verifiche

- Vitest mirato: 25/25 test superati.
- TypeScript: `npx tsc --noEmit` superato.
- ESLint sui file modificati: 0 errori; 3 warning preesistenti nella pagina fascicolo.
- Build Next.js Production: superata con variabili locali non distribuibili.
- Playwright isolato fail-closed: 1/1 superato.
- Harness legale sintetico: superato.
- Database, container e storage di test rimossi al termine.

## Percorso d'uso

1. Aprire il fascicolo.
2. Caricare o selezionare i documenti.
3. Aprire **AI e analisi**.
4. Leggere disponibilità, causa del blocco e rimedio.
5. Avviare **Aggiorna fascicolo** dopo conferma.
6. Attendere estrazione, analisi e rapporto corrente.
7. Esaminare criticità, scadenze, questioni e proposte.
8. Aprire **Interroga AI**, salvare e approvare il quesito.
9. Autorizzare espressamente la ricerca entro budget.
10. Verificare fonti e risultati e usare il rapporto versionato.

In Production i passaggi AI restano bloccati finché comando globale, provider, worker, canali e
budget non sono autorizzati. Questo è il comportamento atteso.
