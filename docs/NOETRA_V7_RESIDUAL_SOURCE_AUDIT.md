# NOETRA V7 - Audit residuo delle fonti multi-provider

Data audit: 2 novembre 2026.

## Perimetro congelato

- Preview V7 soltanto.
- Procedimento `cmvxr3st5003920udtvom8ebv`, concessione `CP-058/2019`.
- Data di riferimento del procedimento: 12 ottobre 2026.
- Bundle Simpliciter:
  `research-bundle:96864d6e11fb36d9d28ea93a3e6d105c3cb667fabd062e9f54953690767ec2bd`.
- Bundle Moonlit:
  `research-bundle:0e00aba55a4cbb55bc6c64d7ef157a883a3c0db1cb749e11ccf388eb9050441b`.
- Nessuna nuova chiamata ai provider e nessun costo aggiuntivo.
- I bundle storici append-only non sono stati modificati.

## Metodo e significato degli esiti

L'audit confronta i candidati già acquisiti con fonti ufficiali gratuite:

- dataset OpenGA di Giustizia amministrativa per identità, data e oggetto dei
  provvedimenti TAR e Consiglio di Stato;
- EUR-Lex per identità e contenuto degli atti UE;
- Gazzetta Ufficiale, Senato, Commissione europea e Italgiure/SentenzeWeb per
  le rispettive fonti.

Gli esiti non trasformano automaticamente un candidato in precedente
applicabile:

- `PERTINENTE_VERIFICATA`: identità e contenuto ufficiale verificati e materia
  direttamente pertinente al fascicolo; l'applicabilità alla decisione resta
  soggetta alla valutazione giuridica del caso concreto.
- `NON_PERTINENTE`: il contenuto ufficiale verificato riguarda una materia
  diversa dalla concessione portuale, dai servizi passeggeri o dal procedimento
  ex art. 45-bis cod. nav.
- `NON_VERIFICABILE`: identità o contenuto specifico non sono recuperabili in
  misura sufficiente da una fonte ufficiale gratuita.

## Rivalutazione conclusiva delle sette fonti già classificate pertinenti

La verifica individuale ha corretto la precedente classificazione
`PERTINENTE_VERIFICATA`, che era eccessiva: i metadati OpenGA provano
l'identità dei cinque provvedimenti, ma non il testo ufficiale integrale né la
ratio decidendi; gli articoli 4 e 5 del regolamento (UE) 2017/352 sono
pertinenti in astratto, ma il fascicolo non contiene l'atto che qualifica la
polizza come requisito imposto a un prestatore di servizi portuali.

| Fonte | Identificativo ufficiale | Fonte primaria | Disposizione o principio verificabile | Applicabilità e limite | Esito corretto |
|---|---|---|---|---|---|
| TAR Sicilia-Catania, sez. III, n. 2351/2021 | `IT-GA:TAR-SICILIA-CATANIA:2021:2351` | OpenGA, pubblicazione 19/07/2021, ricorso 1505/2020 | Nessun principio attribuibile dai soli metadati | Revoca/archiviazione di altra concessione; manca testo e comparabilità con la polizza CP-058/2019 | `NON_VERIFICABILE` |
| TAR Abruzzo-Pescara, sez. I, n. 17/2019 | `IT-GA:TAR-ABRUZZO-PESCARA:2019:17` | OpenGA, pubblicazione 31/01/2019, ricorso 278/2017 | Nessun principio attribuibile dai soli metadati | Decadenza di altra concessione; manca il testo ufficiale e il nesso con requisiti assicurativi | `NON_VERIFICABILE` |
| TAR Lazio-Roma, sez. V-ter, n. 9229/2026 | `IT-GA:TAR-LAZIO-ROMA:2026:9229` | OpenGA, pubblicazione 18/05/2026, ricorso 4746/2026 | Nessun principio attribuibile dai soli metadati | Polizze sostitutive e subentro sono tematicamente vicini, ma mancano testo, ratio e clausola comparabile | `NON_VERIFICABILE` |
| TAR Sicilia-Catania, sez. III, n. 1859/2025 | `IT-GA:TAR-SICILIA-CATANIA:2025:1859` | OpenGA, pubblicazione 10/06/2025, ricorso 1742/2024 | Nessun principio attribuibile dai soli metadati | Diniego per area cantieristica; nessuna regola assicurativa dimostrata e testo non acquisito | `NON_VERIFICABILE` |
| TAR Campania-Salerno, sez. III, n. 11/2026 | `IT-GA:TAR-CAMPANIA-SALERNO:2026:11` | OpenGA, pubblicazione 05/01/2026, ricorso 1568/2024 | Nessun principio attribuibile dai soli metadati | Affidamento stazione marittima passeggeri; manca la comparabilità con il procedimento di chiarimenti | `NON_VERIFICABILE` |
| Regolamento (UE) 2017/352, art. 4 | `CELEX:32017R0352:ART_4` | EUR-Lex, CELEX 32017R0352 | Possibili requisiti minimi, inclusi quelli assicurativi, trasparenti, obiettivi, non discriminatori e proporzionati | Rileva solo se la polizza è requisito del prestatore di servizi portuali; l'atto qualificante manca | `PERTINENTE_IN_ASTRATTO_NON_APPLICABILE_ALLO_STATO` |
| Regolamento (UE) 2017/352, art. 5 | `CELEX:32017R0352:ART_5` | EUR-Lex, CELEX 32017R0352 | Procedura trasparente, obiettiva, non discriminatoria, proporzionata e motivata | Rileva solo dopo la qualificazione del requisito ex art. 4; mancano atto e atti procedimentali | `PERTINENTE_IN_ASTRATTO_NON_APPLICABILE_ALLO_STATO` |

La rivalutazione è persistita tramite un bundle di audit separato, con zero
chiamate provider. Per ogni fonte il modello ufficiale conserva:

- risultato associato alla missione canonica e alla relativa domanda;
- `LegalSource` e `LegalSourceIdentityAssertion` ufficiale;
- valutazione temporale rispetto al 12 ottobre 2026;
- `ResearchSourceAssessmentRecord` corrente e non usabile, con motivi
  bloccanti espliciti;
- classificazione e limite nel risultato di ricerca.

## Esiti originari sui 24 candidati

| # | Provider | Candidato | Esito | Evidenza ufficiale e temporalità |
|---|----------|-----------|-------|----------------------------------|
| 1 | Simpliciter | TAR Sicilia-Catania n. 2351/2021 | PERTINENTE_VERIFICATA | OpenGA: sentenza del 19/07/2021 su revoca e archiviazione di concessione demaniale marittima; anteriore alla data di riferimento. |
| 2 | Simpliciter | TAR Abruzzo-Pescara n. 17/2019 | PERTINENTE_VERIFICATA | OpenGA: sentenza del 31/01/2019 sulla decadenza di concessione demaniale marittima; anteriore alla data di riferimento. |
| 3 | Simpliciter | TAR Lazio-Roma n. 9229/2026 | PERTINENTE_VERIFICATA | OpenGA: sentenza breve del 18/05/2026 su subentro in concessione demaniale marittima e polizze sostitutive; anteriore alla data di riferimento. |
| 4 | Simpliciter | TAR Sicilia-Catania n. 1859/2025 | PERTINENTE_VERIFICATA | OpenGA: sentenza del 10/06/2025 sul diniego di concessione demaniale marittima da parte di una Autorità di sistema portuale; anteriore alla data di riferimento. |
| 5 | Simpliciter | TAR Campania-Salerno n. 11/2026 | PERTINENTE_VERIFICATA | OpenGA: sentenza del 05/01/2026 sull'affidamento della stazione marittima passeggeri; anteriore alla data di riferimento. |
| 6 | Simpliciter | Allegato direttiva (UE) 2019/1937 | NON_PERTINENTE | EUR-Lex conferma l'allegato sugli ambiti della disciplina whistleblowing; nessun nesso specifico con il procedimento. |
| 7 | Simpliciter | Art. 4 regolamento (UE) 2017/352 | PERTINENTE_VERIFICATA | EUR-Lex: requisiti minimi per i prestatori di servizi portuali; vigente prima della data di riferimento. La riconducibilità concreta della concessione a un servizio portuale deve essere valutata. |
| 8 | Simpliciter | Allegato direttiva (UE) 2019/1159 | NON_PERTINENTE | EUR-Lex conferma requisiti di formazione e qualificazione della gente di mare; materia diversa dal procedimento. |
| 9 | Simpliciter | Art. 5 regolamento (UE) 2017/352 | PERTINENTE_VERIFICATA | EUR-Lex: procedura trasparente, obiettiva, non discriminatoria e proporzionata per i requisiti minimi dei servizi portuali; vigente prima della data di riferimento. |
| 10 | Simpliciter | Allegato regolamento (UE) 2019/2099 | NON_PERTINENTE | EUR-Lex conferma violazioni prudenziali delle controparti centrali; materia finanziaria estranea. |
| 11 | Simpliciter | Allegato regolamento (UE) 2019/1239 | NON_PERTINENTE | EUR-Lex conferma obblighi di dichiarazione delle navi nello sportello unico marittimo; non disciplina la concessione o il subentro. |
| 12 | Simpliciter | Allegato regolamento (UE) 2019/833 | NON_PERTINENTE | EUR-Lex conferma misure di conservazione e controllo della pesca NAFO; materia estranea. |
| 13 | Simpliciter | Art. 47 regolamento (UE) 2024/1624 | NON_PERTINENTE | EUR-Lex conferma obblighi AML per assicurazione vita e investimenti; inoltre il regolamento si applica dal 10/07/2027, dopo la data di riferimento. |
| 14 | Simpliciter | Allegato I direttiva (UE) 2016/97 | NON_PERTINENTE | EUR-Lex conferma requisiti professionali della distribuzione assicurativa; materia estranea. |
| 15 | Moonlit | Consiglio di Stato n. 4286/2018, ricorso 3219/2018 | NON_PERTINENTE | OpenGA: gestione logistica di magazzini e movimentazione materiali; materia diversa. |
| 16 | Moonlit | Consiglio di Stato n. 4402/2020 | NON_PERTINENTE | OpenGA: decadenza di autorizzazione per impianto a biogas; non riguarda concessioni demaniali marittime. |
| 17 | Moonlit | Consiglio di Stato n. 4286/2018, ricorso 3225/2018 | NON_PERTINENTE | Duplicato dello stesso provvedimento n. 4286/2018 riferito a un ricorso riunito; materia diversa. |
| 18 | Moonlit | Legge 1 febbraio 2010, n. 19 | NON_PERTINENTE | Gazzetta Ufficiale: responsabilità civile per inquinamento da combustibile delle navi; materia diversa. |
| 19 | Moonlit | Commissione europea SA.37389 | NON_PERTINENTE | Registro ufficiale: decisione del 20/09/2018 che esclude aiuti di Stato nel porto di Napoli; non riguarda il rapporto concessorio del fascicolo. |
| 20 | Moonlit | CELEX 52019XC1018(02) | NON_PERTINENTE | EUR-Lex: pubblicazione Solvency II su assicurazione e riassicurazione; materia estranea. |
| 21 | Moonlit | Cassazione, ECLI:IT:CASS:2026:06456CIV | NON_PERTINENTE | Italgiure: ordinanza del 18/03/2026 sulla prova del contratto assicurativo relativo a un velivolo; anteriore alla data di riferimento ma estranea. |
| 22 | Moonlit | Cassazione, ECLI:IT:CASS:2021:26584CIV | NON_VERIFICABILE | L'URL ufficiale identifica il documento, ma il testo restituisce errore e SentenzeWeb non consente di confermare gratuitamente il contenuto specifico. |
| 23 | Moonlit | Disegno di legge S. 1883 | NON_VERIFICABILE | Senato conferma identità e iter del disegno di conversione del d.l. 76/2020, ma il candidato non individua una disposizione pertinente al fascicolo. |
| 24 | Moonlit | Consiglio di Stato n. 5958/2025 | NON_PERTINENTE | OpenGA: autorizzazione per posa di fibra ottica su strada provinciale; materia diversa. |

Totali originari, sostituiti dalla rivalutazione delle sette fonti:

- `PERTINENTE_VERIFICATA`: 7;
- `NON_PERTINENTE`: 15;
- `NON_VERIFICABILE`: 2.

## Evidenze ufficiali riproducibili

- [OpenGA - CDS Sentenze](https://openga.giustizia-amministrativa.it/dataset/cds-sentenze)
- [OpenGA - TAR Sicilia Catania](https://openga.giustizia-amministrativa.it/dataset/tar-sicilia-catania-sentenze)
- [OpenGA - TAR Abruzzo Pescara](https://openga.giustizia-amministrativa.it/dataset/tar-abruzzo-pescara-sentenze)
- [OpenGA - TAR Lazio Roma](https://openga.giustizia-amministrativa.it/dataset/tar-lazio-roma-sentenze)
- [OpenGA - TAR Campania Salerno](https://openga.giustizia-amministrativa.it/dataset/tar-campania-salerno-sentenze)
- [EUR-Lex - regolamento (UE) 2017/352](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32017R0352)
- [Gazzetta Ufficiale - legge 19/2010](https://www.gazzettaufficiale.it/eli/id/2010/02/22/010G0033/sg)
- [Commissione europea - SA.37389](https://competition-cases.ec.europa.eu/cases/SA.37389)
- [Senato - S. 1883](https://www.senato.it/legislature/18/leggi-e-documenti/disegni-di-legge/scheda-ddl?did=53158)
- [SentenzeWeb Cassazione](https://www.italgiure.giustizia.it/sncass/)

## Limiti residui

1. I cinque provvedimenti TAR sono verificati solo per identità, data, esito e
   oggetto ufficiale; senza testo integrale non sono fonti usabili dal report.
2. Gli articoli 4 e 5 del regolamento (UE) 2017/352 restano pertinenti in
   astratto, ma non applicabili allo stato del fascicolo: occorre l'atto che
   qualifica la polizza come requisito del prestatore di servizi portuali.
3. I due candidati `NON_VERIFICABILE` non devono essere usati a sostegno di una
   conclusione giuridica.
4. Le verifiche sono conservate separatamente dai bundle storici per non
   riscrivere output append-only né inventare metadati semantici mancanti.

## Chiusura Legal Data Hunter

Il ricollaudo autorizzato del 2 novembre 2026 ha usato esclusivamente Legal
Data Hunter sulla Preview:

- missione:
  `research-mission:53b4df387f748621e126984feb7c59be3fa649ad2651c0516609acb2159fdd33`;
- bundle:
  `research-bundle:656b6a956035598ff243cc457eacaf4191b27a0abb675bf33dcb283c12e919f0`;
- tre chiamate completate in circa 14 secondi, senza `TIMEOUT` o altro
  `errorCode`;
- costo autorizzato e consuntivato: EUR 0,06;
- discovery, resolve e fallback hanno restituito zero risultati per
  `Cons. Stato, sez. AP, n. 18/2021`;
- il bundle registra correttamente
  `OFFICIAL_IDENTITY_NOT_VERIFIED`, zero candidati e
  `BUDGET_EXHAUSTED`, senza trasformare l'assenza di risultati in un successo
  giuridico.

Il precedente timeout era quindi applicativo e risulta corretto. Il limite
residuo non è più tecnico: il provider non ha risolto la citazione testata.
