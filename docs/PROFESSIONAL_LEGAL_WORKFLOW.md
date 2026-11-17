# Percorso professionale NOETRA V7

## Quesiti giuridici

I ruoli `ADMIN` e `GIURIDICO`, con sessione MFA verificata e accesso in scrittura al tenant del fascicolo, possono:

1. creare un quesito professionale in bozza;
2. creare nuove versioni senza sovrascrivere lo storico;
3. approvare una specifica versione;
4. archiviare il quesito conservando versioni e audit.

Una nuova versione rende superata la precedente bozza. L'approvazione rende superata l'eventuale versione precedentemente approvata, ma non elimina dati o missioni storiche.

## Avvio controllato della ricerca

La ricerca professionale:

- riguarda una sola versione approvata;
- non concede al ruolo `GIURIDICO` accesso alle funzioni amministrative;
- richiede MFA, accesso al tenant e conferma esplicita dell'eventuale spesa;
- applica un massimo di 6 chiamate: 2 Moonlit, 2 Simpliciter e 2 Legal Data Hunter;
- resta soggetta alla policy automatica e al cost gate di runtime;
- non crea alcun job se manca la conferma esplicita.

Le missioni professionali sono collegate in modo univoco alla versione approvata e non vengono storicizzate dalla riconciliazione delle domande proposte automaticamente.

## Rapporto ed esportazione

Una missione professionale corrente viene proiettata nel rapporto `STRUCTURED_FASCICOLO_REPORT_V2` come quesito `HUMAN_CONFIRMED`, anche se non deriva da un item della Knowledge AI. Risultati, assessment, fonti non utilizzabili e limitazioni seguono gli stessi controlli fail-closed delle missioni automatiche.

Ogni snapshot corrente o storico può essere esportato in:

- PDF;
- RTF modificabile con Word o LibreOffice.

Entrambi i formati riportano versione, data, stato, fonti, limiti e stato delle verifiche. Il download richiede ruolo `ADMIN` o `GIURIDICO`, MFA e accesso in lettura al tenant ed è registrato nell'audit log.

## Verifiche gratuite

Il percorso viene verificato senza chiamate provider mediante:

- test unitari sul versionamento, budget, conferma costi, lifecycle e report V2;
- applicazione completa delle migrazioni su PostgreSQL isolato;
- E2E browser locale con login MFA del ruolo `GIURIDICO`, creazione, revisione, approvazione e verifica della persistenza;
- typecheck e build di produzione.

L'E2E verifica la presenza dell'azione di autorizzazione ma non la esegue, quindi non consuma crediti.
