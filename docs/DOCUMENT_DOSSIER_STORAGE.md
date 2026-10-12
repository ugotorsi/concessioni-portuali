# Document Dossier Storage - Sprint 1

## Scopo Sprint 1
Stabilizzare il fascicolo documentale come fondazione tecnica per un pilot reale:
- storage persistente cloud S3-compatible;
- fallback locale;
- upload/download con hash SHA-256;
- metadati obbligatori;
- audit eventi documentali.

## Perché questo sprint è fondazione della piattaforma
Senza persistenza affidabile dei documenti il fascicolo resta una demo.

La persistenza oggetti e il punto tecnico minimo per:
- credibilita verso ente pilot;
- continuita operativa tra deploy e ambienti;
- tracciabilità del ciclo documentale.

## Architettura storage
Adapter astratto con backend selezionabile da env:
- `local`: filesystem locale (default in sviluppo/test);
- `s3`: backend S3-compatible (Cloudflare R2 consigliato, ma valido anche altro provider compatibile).

Interfaccia adapter:
- `put(input)`
- `get(storageKey)`
- `delete(storageKey)`
- `exists(storageKey)`

Output storage oggetto:
- `storageProvider`
- `storageKey`
- `bucket`
- `publicUrl` opzionale
- `sizeBytes`
- `sha256`
- `mimeType`
- `originalName`

## Variabili env
Minimo locale:
- `DOCUMENT_STORAGE_BACKEND="local"`
- `DOCUMENT_STORAGE_ROOT=".local-storage/documents"`

Minimo S3-compatible:
- `DOCUMENT_STORAGE_BACKEND="s3"`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE="true"`

Regola di sicurezza:
- se backend `s3` e le variabili richieste mancano, il sistema alza errore esplicito.

## Upload/Download
Upload:
- validazione file e metadati;
- hash SHA-256 del contenuto;
- persistenza su adapter attivo;
- scrittura metadata storage sul record documento;
- audit evento `DOCUMENT_UPLOAD`.

Download:
- autorizzazione per ruolo;
- recupero file da `storageKey` (compatibile con record legacy);
- audit evento `DOCUMENT_DOWNLOAD`;
- errore controllato se oggetto assente.

Preview semplice:
- supporto `?preview=1` per PDF/immagini con `Content-Disposition: inline`.

## Metadati obbligatori Sprint 1
- almeno una entità collegata (concessione o altra entità istruttoria);
- tipologia documento;
- fonte (`source`);
- stato (`status`);
- data documento opzionale con fallback alla data caricamento.

## Audit eventi documentali
Coperti in Sprint 1:
- upload;
- download;
- update metadati;
- archiviazione (soft delete).

## Limiti residui (espliciti)
Non inclusi in Sprint 1:
- firma digitale;
- conservazione a norma;
- OCR;
- integrazione PEC/protocollo reale;
- versioning documentale complesso.

## Cloudflare R2
Cloudflare R2 e opzione consigliata per il backend S3-compatible per:
- compatibilita API S3;
- costi prevedibili;
- integrazione semplice con adapter introdotto.

La scelta resta intercambiabile con altri provider S3-compatible senza cambiare il modulo applicativo.

### Upload diretti dal browser

I file fino a 512 KiB continuano a usare la Server Action esistente. La soglia lascia margine rispetto al limite predefinito di 1 MiB del corpo delle Server Actions, inclusivo dell'overhead multipart. I file superiori usano un URL `PUT` presigned valido dieci minuti e trasferiscono il contenuto direttamente dal browser al bucket privato, evitando anche il limite di richiesta Vercel di 4,5 MB. Le credenziali S3/R2 restano esclusivamente sul server.

Prima di firmare l'URL, il server verifica sessione, ruolo, tenant e riferimenti del fascicolo. Al completamento legge l'oggetto da R2, verifica chiave, metadati di ambito, dimensione, tipo effettivo e SHA-256 calcolato lato server, poi riusa la registrazione atomica di `Documento`, `SourceFileVersion`, audit e job di estrazione. Un tentativo interrotto puo essere ripreso con lo stesso identificativo operazione. Gli oggetti non confermati non vengono cancellati automaticamente; la loro eventuale bonifica deve usare una policy separata con periodo di conservazione e verifica dell'assenza di riferimenti DB.

I metadati di ambito sono inclusi nella query firmata dell'URL e non devono essere reinviati dal browser come header `x-amz-meta-*`. Il bucket R2 deve autorizzare soltanto l'origine operativa e gli header effettivamente inviati:

```json
[
  {
    "AllowedOrigins": ["https://app.noetra.it"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Per ambienti di sviluppo aggiungere esplicitamente le relative origini senza usare `*`. `S3_ENDPOINT` viene inoltre inserito nella direttiva CSP `connect-src` durante la build.
