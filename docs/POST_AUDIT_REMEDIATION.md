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

La diagnostica e in sola lettura. Non cambia controlli, provider, policy, worker o
automazioni.

## Riconciliazione del titolo concessorio

Il contratto server-side
`CONCESSION_TITLE_RECONCILIATION_V1` ricostruisce un titolo soltanto quando il
corpus contiene un unico numero coerente e conserva gli evidence span del
documento. La proposta operativa `CONCESSION_LINK_OR_CREATE` e deterministica e
resta non materializzabile finche un professionista non approva un payload
completo.

La materializzazione ammette esclusivamente:

- collegamento a una concessione esistente dello stesso ente, con numero e data
  verificati;
- creazione di una concessione con tutti i campi obbligatori, concessionario
  esistente, almeno un'evidenza verificabile e assenza di collisioni per
  ente/numero.

La transazione collega il procedimento e registra una materializzazione
idempotente. Scadenze e criticita continuano a richiedere proposte distinte,
review professionale e una concessione gia collegata. Nessuna violazione o
criticita viene creata dalla sola riconciliazione del titolo.

La migrazione
`20261109_add_concession_operational_proposal` aggiunge esclusivamente il nuovo
valore enum. La sua applicazione a Production e la successiva riconciliazione
dei dati richiedono autorizzazioni operative separate.

## Bozze

Le nuove bozze usano una fingerprint SHA-256 e una chiave stabile per
problematica e modello. Le creazioni ripetute sono idempotenti e serializzate.

Le copie storiche possono essere archiviate soltanto quando:

- riferimento e copie hanno versione e hash attesi;
- problema, modello e contenuto coincidono;
- la copia non e collegata a un'attivita;
- un operatore autorizzato conferma e motiva l'operazione.

L'archiviazione aggiunge una versione immutabile `ARCHIVIATA` alla catena audit;
non elimina bozze, versioni o eventi.
