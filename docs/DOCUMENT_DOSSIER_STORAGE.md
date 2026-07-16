# Document Dossier Storage - Sprint 1

## Scopo Sprint 1
Stabilizzare il fascicolo documentale come fondazione tecnica per un pilot reale:
- storage persistente cloud S3-compatible;
- fallback locale;
- upload/download con hash SHA-256;
- metadati obbligatori;
- audit eventi documentali.

## Perche questo sprint e fondazione della piattaforma
Senza persistenza affidabile dei documenti il fascicolo resta una demo.

La persistenza oggetti e il punto tecnico minimo per:
- credibilita verso ente pilot;
- continuita operativa tra deploy e ambienti;
- tracciabilita del ciclo documentale.

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
- almeno una entita collegata (concessione o altra entita istruttoria);
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
