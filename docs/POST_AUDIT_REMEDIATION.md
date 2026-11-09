# Risanamento tecnico post-collaudo

## Stato AI globale

La pagina amministrativa rappresenta separatamente:

- comando persistente richiesto dall'amministratore;
- autorizzazione del deployment ai dati reali;
- kill-switch e blocchi effettivi;
- stato effettivo;
- provider manualmente idonei e capacita automatica;
- automazione generale;
- ultimo evento audit, motivazione, hash e contatori di cancellazione.

Un evento di controllo privo di stati `ON`/`OFF` validi e rappresentato come
`INVALID`, mantiene l'esecuzione disabilitata e non viene trasformato
silenziosamente in un comando `OFF`. L'hash del singolo evento e distinto
dall'esito della verifica completa della catena.

La diagnostica e in sola lettura. Non cambia controlli, provider, policy, worker o
automazioni.

Tutti i writer applicativi di `ActivityLog` usano il writer transazionale
centralizzato, che acquisisce lo stesso advisory lock prima di leggere la coda
della catena. Il verificatore completo rilegge gli eventi in ordine
`createdAt/id`, controlla ogni `previousHash` e ricalcola ogni `currentHash` in
batch, senza caricare l'intera tabella in memoria.

Il seed demo distruttivo resta separato dal percorso applicativo perche ricrea la
catena da un database ripulito, ma usa la stessa funzione canonica di hashing,
incluso `enteId`, affinche anche i dati seed superino il verificatore completo.

## Riconciliazione del titolo concessorio

Il contratto server-side
`CONCESSION_TITLE_RECONCILIATION_V1` ricostruisce un titolo soltanto quando il
corpus contiene un unico numero coerente e conserva gli evidence span del
documento. La proposta operativa `CONCESSION_LINK_OR_CREATE` e deterministica e
resta non materializzabile finche un professionista non approva un payload
completo.

La UI di revisione presenta soltanto concessioni e concessionari gia associati
allo stesso ente. Il server ripete comunque i controlli di tenant e costruisce il
payload professionale usando le evidenze immutabili della proposta: l'operatore
non puo sostituire versione documentale, pagina o hash.

La materializzazione ammette esclusivamente:

- collegamento a una concessione esistente dello stesso ente, con numero e data
  verificati;
- creazione di una concessione con tutti i campi obbligatori, concessionario
  gia associato allo stesso ente, almeno un'evidenza identica a quella della
  proposta e assenza di collisioni per ente/numero normalizzato.

La transazione collega il procedimento e registra una materializzazione
idempotente. Scadenze e criticita continuano a richiedere proposte distinte,
review professionale e una concessione gia collegata. Nessuna violazione o
criticita viene creata dalla sola riconciliazione del titolo.

La migrazione
`20261109_add_concession_operational_proposal` aggiunge esclusivamente il nuovo
valore enum. La migrazione successiva
`20261110_concession_normalized_identity` interrompe esplicitamente
l'applicazione se rileva duplicati storici e, soltanto su dati coerenti, aggiunge
un indice univoco tenant-scoped sul numero normalizzato. La loro applicazione a
Production e la successiva riconciliazione dei dati richiedono autorizzazioni
operative separate.

## Bozze

Le nuove bozze usano una fingerprint SHA-256 e una chiave stabile per
problematica e modello. Le creazioni ripetute sono idempotenti e serializzate.

Le copie storiche possono essere archiviate soltanto quando:

- riferimento e copie hanno versione e hash attesi;
- problema, modello e contenuto coincidono;
- la copia non e collegata a un'attivita;
- nessuna bozza attiva dipende dalla copia;
- un operatore autorizzato conferma e motiva l'operazione.

L'archiviazione aggiunge una versione immutabile `ARCHIVIATA` alla catena audit;
non elimina bozze, versioni o eventi. Ripetere la stessa richiesta su una copia
gia archiviata e un no-op idempotente.

## Gate di rilascio

Il canale Production read-only, l'isolamento obbligatorio della Preview, il
rehearsal della migrazione e la procedura di pubblicazione sono definiti in
`docs/POST_AUDIT_RELEASE_RUNBOOK.md`. I gate non riparano dati e non autorizzano
AI, automazioni, worker o modifiche ai fascicoli reali.
