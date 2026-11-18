-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RuoloUser" AS ENUM ('ADMIN', 'OPERATORE_SOCIETA', 'PROJECT_MANAGER', 'GIURIDICO', 'TECNICO', 'ECONOMICO', 'OPERATORE_DOCUMENTALE', 'VIEWER_ADSP');

-- CreateEnum
CREATE TYPE "NormaRiferimento" AS ENUM ('ART_36_COD_NAV', 'ART_18_L_84_1994', 'ALTRO');

-- CreateEnum
CREATE TYPE "TipologiaBene" AS ENUM ('AREA_SCOPERTA', 'BANCHINA', 'MOLO', 'SPECCHIO_ACQUEO', 'BOX', 'LOCALE', 'MANUFATTO', 'ALTRO');

-- CreateEnum
CREATE TYPE "AttivitaConcessione" AS ENUM ('DIPORTO', 'COMMERCIALE', 'TURISTICO_RICREATIVA', 'LOGISTICA', 'CANTIERISTICA', 'SERVIZI_PORTUALI', 'PASSEGGERI', 'ALTRO');

-- CreateEnum
CREATE TYPE "ConcessionVertical" AS ENUM ('PORTUALE_ADSP', 'MARITTIMA_TURISTICO_RICREATIVA', 'ALTRA_CONCESSIONE_DEMANIALE');

-- CreateEnum
CREATE TYPE "LegalFramework" AS ENUM ('ART_36_COD_NAV', 'ART_18_L_84_1994', 'ART_37_COD_NAV', 'ART_47_COD_NAV', 'DL_400_1993', 'DIR_2006_123_ART_12', 'ALTRO');

-- CreateEnum
CREATE TYPE "ConcessionObjectType" AS ENUM ('AREA_DEMANIALE', 'BANCHINA', 'MOLO', 'SPECCHIO_ACQUEO', 'PERTINENZA_DEMANIALE', 'MANUFATTO', 'LOCALE', 'ALTRO');

-- CreateEnum
CREATE TYPE "AwardingProcedureType" AS ENUM ('DIRETTA', 'COMPARATIVA_ART37', 'EVIDENZA_PUBBLICA', 'RINNOVO', 'PROROGA_TECNICA', 'ALTRO');

-- CreateEnum
CREATE TYPE "RemovableWorksProfile" AS ENUM ('NON_RILEVATO', 'PREVALENTE_AMOVIBILE', 'MISTO', 'PREVALENTE_NON_AMOVIBILE');

-- CreateEnum
CREATE TYPE "SeasonalityProfile" AS ENUM ('ANNUALE', 'STAGIONALE', 'MISTO', 'NON_RILEVATO');

-- CreateEnum
CREATE TYPE "FeeRegime" AS ENUM ('PORTUALE', 'TURISTICO_RICREATIVO_DL400', 'ORDINARIO_DEMANIALE', 'ALTRO');

-- CreateEnum
CREATE TYPE "ComparativeProcedureStatus" AS ENUM ('NON_APPLICABILE', 'DA_AVVIARE', 'IN_CORSO', 'CONCLUSA', 'CONTENZIOSO');

-- CreateEnum
CREATE TYPE "ThirdPartyManagementStatus" AS ENUM ('DIRETTA', 'AFFIDAMENTO_AUTORIZZATO', 'AFFIDAMENTO_DA_VERIFICARE', 'AFFIDAMENTO_NON_AUTORIZZATO');

-- CreateEnum
CREATE TYPE "ChecklistProfile" AS ENUM ('CORE', 'PORTUALE_ADSP', 'TURISTICO_RICREATIVO', 'MISTO');

-- CreateEnum
CREATE TYPE "StatoConcessione" AS ENUM ('ATTIVA', 'SCADUTA', 'IN_PROROGA', 'SOSPESA', 'REVOCATA', 'DECADUTA', 'ARCHIVIATA');

-- CreateEnum
CREATE TYPE "TipologiaObbligo" AS ENUM ('PAGAMENTO_CANONE', 'MANUTENZIONE', 'USO_DIRETTO', 'DIVIETO_SUBCONCESSIONE_NON_AUTORIZZATA', 'PRESCRIZIONI_TECNICHE', 'POLIZZA', 'GARANZIA', 'DOCUMENTAZIONE_PERIODICA', 'SICUREZZA', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoObbligo" AS ENUM ('ADEMPIUTO', 'PARZIALMENTE_ADEMPIUTO', 'INADEMPIUTO', 'DA_VERIFICARE');

-- CreateEnum
CREATE TYPE "TipologiaScadenza" AS ENUM ('CONCESSIONE', 'PAGAMENTO_CANONE', 'POLIZZA', 'CAUZIONE', 'FIDEIUSSIONE', 'VERIFICA_PERIODICA', 'SOPRALLUOGO', 'TERMINE_ADEMPIMENTO', 'TERMINE_PROCEDIMENTALE', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoScadenza" AS ENUM ('APERTA', 'GESTITA', 'SCADUTA', 'ARCHIVIATA');

-- CreateEnum
CREATE TYPE "TipologiaCriticita" AS ENUM ('GIURIDICA', 'TECNICA', 'ECONOMICA', 'DOCUMENTALE', 'MANUTENTIVA', 'SICUREZZA', 'OCCUPAZIONE_DIFFORME', 'USO_NON_CONFORME', 'MOROSITA', 'RISCHIO_DECADENZA', 'RISCHIO_REVOCA', 'ALTRO');

-- CreateEnum
CREATE TYPE "GravitaCriticita" AS ENUM ('BASSA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "FonteCriticita" AS ENUM ('SOPRALLUOGO', 'VERIFICA_DOCUMENTALE', 'SEGNALAZIONE', 'ALERT_AUTOMATICO', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoCriticita" AS ENUM ('APERTA', 'IN_GESTIONE', 'RISOLTA', 'ARCHIVIATA');

-- CreateEnum
CREATE TYPE "Art47CodNavLettera" AS ENUM ('A_MANCATA_ESECUZIONE_OPERE', 'B_NON_USO_O_CATTIVO_USO', 'C_MUTAMENTO_SCOPO_NON_AUTORIZZATO', 'D_OMESSO_PAGAMENTO_CANONE', 'E_SUBINGRESSO_ABUSIVO', 'F_INADEMPIMENTO_OBBLIGHI', 'ALTRO_PROFILO_ISTRUTTORIO');

-- CreateEnum
CREATE TYPE "LivelloRischioDecadenza" AS ENUM ('BASSO', 'MEDIO', 'ALTO', 'CRITICO');

-- CreateEnum
CREATE TYPE "EsitoRegolarizzazione" AS ENUM ('DA_VERIFICARE', 'PARZIALE', 'COMPLETA', 'NON_IDONEA', 'SUPERATA_DA_PROVVEDIMENTO');

-- CreateEnum
CREATE TYPE "TipologiaProcedimento" AS ENUM ('CHIARIMENTI', 'DIFFIDA', 'CONTESTAZIONE', 'ORDINE_RIPRISTINO', 'RECUPERO_CANONI', 'ESCUSSIONE_GARANZIA', 'AVVIO_DECADENZA', 'AVVIO_REVOCA', 'NUOVA_PROCEDURA', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoProcedimento" AS ENUM ('DA_AVVIARE', 'IN_CORSO', 'CONCLUSO', 'ARCHIVIATO');

-- CreateEnum
CREATE TYPE "EsitoIstruttorioProcedimento" AS ENUM ('DA_VALUTARE', 'ARCHIVIAZIONE', 'DIFFIDA', 'REGOLARIZZAZIONE', 'DECADENZA_DA_VALUTARE', 'REVOCA_DA_VALUTARE', 'ALTRO');

-- CreateEnum
CREATE TYPE "TipoDecisioneProcedimento" AS ENUM ('DECADENZA_DICHIARATA', 'REVOCA_DISPOSTA', 'ARCHIVIAZIONE', 'CHIUSURA_SENZA_EFFETTO');

-- CreateEnum
CREATE TYPE "EffettoTitoloProcedimento" AS ENUM ('NESSUNO', 'CONCESSIONE_DECADUTA', 'CONCESSIONE_REVOCATA');

-- CreateEnum
CREATE TYPE "StatoEffettoProcedimento" AS ENUM ('NON_PREVISTO', 'PENDENTE', 'PRONTO', 'APPLICATO', 'BLOCCATO', 'ERRORE');

-- CreateEnum
CREATE TYPE "OrigineProcedimento" AS ENUM ('UFFICIO', 'ISTANZA_PARTE', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoPreavvisoRigetto" AS ENUM ('NON_VALUTATO', 'NON_APPLICABILE', 'APPLICABILE_DA_INVIARE', 'INVIATO', 'OSSERVAZIONI_RICEVUTE', 'OSSERVAZIONI_VALUTATE');

-- CreateEnum
CREATE TYPE "EsitoSopralluogo" AS ENUM ('POSITIVO', 'CON_RILIEVI', 'NEGATIVO');

-- CreateEnum
CREATE TYPE "StatoPagamento" AS ENUM ('PAGATO', 'PARZIALE', 'NON_PAGATO', 'SCADUTO');

-- CreateEnum
CREATE TYPE "TipologiaDocumento" AS ENUM ('TITOLO_CONCESSORIO', 'PROROGA', 'RINNOVO', 'SUBINGRESSO', 'PLANIMETRIA', 'POLIZZA', 'FIDEIUSSIONE', 'CAUZIONE', 'PAGAMENTO', 'VERBALE', 'DIFFIDA', 'CONTESTAZIONE', 'DETERMINA', 'NOTA', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoDocumento" AS ENUM ('ATTIVO', 'ARCHIVIATO');

-- CreateEnum
CREATE TYPE "DocumentoDirezione" AS ENUM ('ENTRATA', 'USCITA', 'INTERNO');

-- CreateEnum
CREATE TYPE "DocumentoCanale" AS ENUM ('UPLOAD', 'PEC', 'PROTOCOLLO_INTERNO', 'ALTRO');

-- CreateEnum
CREATE TYPE "TipologiaReport" AS ENUM ('REPORT_MENSILE', 'REPORT_CRITICITA', 'REPORT_MOROSITA', 'REPORT_SCADENZE', 'SCHEDA_CONCESSIONE', 'SCHEDA_CRITICITA', 'DOSSIER_ISTRUTTORIO', 'RELAZIONE_TECNICA', 'RELAZIONE_ECONOMICA', 'PROPOSTA_BANDO', 'ALTRO');

-- CreateEnum
CREATE TYPE "NormaAmbito" AS ENUM ('CONCESSIONI', 'PROCEDIMENTI', 'CANONI', 'SICUREZZA', 'AMBIENTE', 'DOCUMENTAZIONE', 'ALTRO');

-- CreateEnum
CREATE TYPE "StatoNormaVersione" AS ENUM ('VIGENTE', 'SUPERATA', 'IN_CONSULTAZIONE');

-- CreateEnum
CREATE TYPE "ModuloImpattoNorma" AS ENUM ('CRITICITA', 'PROCEDIMENTI', 'SCADENZE', 'PAGAMENTI', 'REPORT', 'CONCESSIONI');

-- CreateEnum
CREATE TYPE "AuditEsito" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "EnteTipo" AS ENUM ('ADSP', 'COMUNE_COSTIERO', 'ALTRO_ENTE_PUBBLICO', 'ALTRO');

-- CreateEnum
CREATE TYPE "EnteStato" AS ENUM ('ATTIVO', 'DISATTIVATO');

-- CreateEnum
CREATE TYPE "AuthorityLevel" AS ENUM ('UE', 'NAZIONALE', 'REGIONALE', 'LOCALE', 'ADSP', 'ALTRO');

-- CreateEnum
CREATE TYPE "LegalSourceType" AS ENUM ('LEGGE', 'DECRETO', 'REGOLAMENTO', 'DELIBERA', 'ORDINANZA', 'PIANO', 'PARERE', 'TARIFFA', 'PLANIMETRIA', 'ALTRO');

-- CreateEnum
CREATE TYPE "LegalSourceStatus" AS ENUM ('CURRENT', 'CURRENT_SUBJECT_TO_REVIEW', 'PENDING_VALIDITY_CHECK', 'HISTORICAL', 'SUPERSEDED', 'PARTIALLY_SUPERSEDED', 'DRAFT_OR_ONGOING_PROCEDURE', 'CASE_SPECIFIC', 'MISSING_SOURCE');

-- CreateEnum
CREATE TYPE "LegalSourceRole" AS ENUM ('NORMATIVE', 'PROCEDURAL', 'PROGRAMMATIC', 'STRATEGIC', 'ENVIRONMENTAL', 'ADVISORY', 'TECHNICAL_GUIDANCE', 'SUPPORTING_MAP', 'PREPARATORY', 'CASE_SPECIFIC');

-- CreateEnum
CREATE TYPE "LegalSourceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT');

-- CreateEnum
CREATE TYPE "LegalTerritorialScope" AS ENUM ('NATIONAL', 'AUTHORITY', 'PORT', 'PORT_AREA');

-- CreateEnum
CREATE TYPE "LegalRank" AS ENUM ('NATIONAL_LAW', 'AUTHORITY_REGULATION', 'PORT_ORDINANCE', 'PLANNING_INSTRUMENT', 'PROCEDURE_DOCUMENT', 'ENVIRONMENTAL_ACT', 'TECHNICAL_GUIDANCE', 'ADVISORY_OPINION', 'CARTOGRAPHIC_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceRelationType" AS ENUM ('MODIFICA', 'ATTUA', 'RICHIAMA', 'DEROGA', 'ALLEGA', 'COORDINA');

-- CreateEnum
CREATE TYPE "LegalRuleCategory" AS ENUM ('TITOLO', 'PROCEDURA', 'CANONE', 'GARANZIA', 'DOCUMENTAZIONE', 'SUBINGRESSO', 'SICUREZZA', 'OCCUPAZIONE', 'ALTRO');

-- CreateEnum
CREATE TYPE "LegalRuleStatus" AS ENUM ('ATTIVA', 'SUPERATA', 'BOZZA');

-- CreateEnum
CREATE TYPE "DocumentGapStatus" AS ENUM ('APERTA', 'IN_GESTIONE', 'RISOLTA', 'ARCHIVIATA');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Ente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codice" TEXT NOT NULL,
    "tipo" "EnteTipo" NOT NULL DEFAULT 'ALTRO',
    "stato" "EnteStato" NOT NULL DEFAULT 'ATTIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Authority" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "AuthorityLevel" NOT NULL DEFAULT 'ALTRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Authority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Port" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enteId" TEXT,
    "authorityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortArea" (
    "id" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "packCode" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "manifestPath" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "ruleCount" INTEGER NOT NULL DEFAULT 0,
    "relationCount" INTEGER NOT NULL DEFAULT 0,
    "gapCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "errorMessage" TEXT,
    "enteId" TEXT,
    "authorityId" TEXT,
    "portId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalSource" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "LegalSourceType" NOT NULL,
    "status" "LegalSourceStatus" NOT NULL DEFAULT 'CURRENT_SUBJECT_TO_REVIEW',
    "role" "LegalSourceRole" NOT NULL DEFAULT 'NORMATIVE',
    "legalRank" "LegalRank" NOT NULL DEFAULT 'OTHER',
    "territorialScope" "LegalTerritorialScope" NOT NULL DEFAULT 'AUTHORITY',
    "confidence" "LegalSourceConfidence" NOT NULL DEFAULT 'MEDIUM',
    "issuingBody" TEXT,
    "sourceNumber" TEXT,
    "sourceDate" TIMESTAMP(3),
    "sourceOrigin" TEXT,
    "portAreaCode" TEXT,
    "tags" JSONB,
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "isConformative" BOOLEAN NOT NULL DEFAULT true,
    "isExtractable" BOOLEAN NOT NULL DEFAULT true,
    "duplicateOfSourceKey" TEXT,
    "publicationDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "fileName" TEXT,
    "filePath" TEXT,
    "fileChecksumSha256" TEXT,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "enteId" TEXT,
    "authorityId" TEXT,
    "portId" TEXT,
    "importRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRelation" (
    "id" TEXT NOT NULL,
    "fromSourceId" TEXT NOT NULL,
    "toSourceId" TEXT NOT NULL,
    "relationType" "SourceRelationType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRule" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" "LegalRuleCategory" NOT NULL,
    "status" "LegalRuleStatus" NOT NULL DEFAULT 'ATTIVA',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enteId" TEXT,
    "portId" TEXT,
    "matchConcessionVertical" "ConcessionVertical",
    "matchObjectType" "ConcessionObjectType",
    "matchAttivita" "AttivitaConcessione",
    "matchAwardingProcedure" "AwardingProcedureType",
    "matchFeeRegime" "FeeRegime",
    "matchComparativeStatus" "ComparativeProcedureStatus",
    "requiresRilevanzaArt47" BOOLEAN,
    "matchArt47Letter" "Art47CodNavLettera",
    "requiresMorosita" BOOLEAN,
    "requiresPolizzaValida" BOOLEAN,
    "outputSeverity" "GravitaCriticita" NOT NULL DEFAULT 'MEDIA',
    "outcomeTitle" TEXT NOT NULL,
    "outcomeSummary" TEXT NOT NULL,
    "disclaimer" TEXT,
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentGap" (
    "id" TEXT NOT NULL,
    "gapKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "GravitaCriticita" NOT NULL DEFAULT 'MEDIA',
    "status" "DocumentGapStatus" NOT NULL DEFAULT 'APERTA',
    "requiredDocumentTypes" JSONB,
    "notes" TEXT,
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "enteId" TEXT,
    "portId" TEXT,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "role" "RuoloUser" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "ruolo" "RuoloUser" NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedLoginAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaRecoveryCodes" JSONB,
    "mfaVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concessionario" (
    "id" TEXT NOT NULL,
    "denominazione" TEXT NOT NULL,
    "codiceFiscale" TEXT,
    "partitaIva" TEXT,
    "sedeLegale" TEXT,
    "pec" TEXT,
    "legaleRappresentante" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Concessionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concessione" (
    "id" TEXT NOT NULL,
    "numeroAtto" TEXT NOT NULL,
    "dataRilascio" TIMESTAMP(3) NOT NULL,
    "dataScadenza" TIMESTAMP(3) NOT NULL,
    "normaRiferimento" "NormaRiferimento" NOT NULL,
    "tipologiaBene" "TipologiaBene" NOT NULL,
    "attivita" "AttivitaConcessione" NOT NULL,
    "superficieMq" DECIMAL(65,30),
    "latitudineGis" DECIMAL(65,30),
    "longitudineGis" DECIMAL(65,30),
    "coordinateGis" TEXT,
    "areaDescrizione" TEXT,
    "zonaPortuale" TEXT,
    "riferimentoCatastale" TEXT,
    "canoneAnnuo" DECIMAL(65,30),
    "categoriaCanone" TEXT,
    "concessionVertical" "ConcessionVertical" NOT NULL DEFAULT 'PORTUALE_ADSP',
    "concessionObjectType" "ConcessionObjectType",
    "awardingProcedureType" "AwardingProcedureType" NOT NULL DEFAULT 'ALTRO',
    "removableWorksProfile" "RemovableWorksProfile" NOT NULL DEFAULT 'NON_RILEVATO',
    "seasonalityProfile" "SeasonalityProfile" NOT NULL DEFAULT 'NON_RILEVATO',
    "feeRegime" "FeeRegime" NOT NULL DEFAULT 'ALTRO',
    "comparativeProcedureStatus" "ComparativeProcedureStatus" NOT NULL DEFAULT 'NON_APPLICABILE',
    "thirdPartyManagementStatus" "ThirdPartyManagementStatus" NOT NULL DEFAULT 'DIRETTA',
    "stato" "StatoConcessione" NOT NULL,
    "descrizioneBene" TEXT,
    "ubicazione" TEXT,
    "note" TEXT,
    "concessionarioId" TEXT NOT NULL,
    "enteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Concessione_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcessioneLegalFramework" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "framework" "LegalFramework" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcessioneLegalFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObbligoConcessorio" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "tipologia" "TipologiaObbligo" NOT NULL,
    "fonte" TEXT,
    "descrizione" TEXT NOT NULL,
    "frequenza" TEXT,
    "dataProssimaVerifica" TIMESTAMP(3),
    "stato" "StatoObbligo" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObbligoConcessorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scadenza" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "tipologia" "TipologiaScadenza" NOT NULL,
    "dataScadenza" TIMESTAMP(3) NOT NULL,
    "preavvisoGiorni" INTEGER NOT NULL DEFAULT 30,
    "stato" "StatoScadenza" NOT NULL,
    "descrizione" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scadenza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criticita" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "tipologia" "TipologiaCriticita" NOT NULL,
    "gravita" "GravitaCriticita" NOT NULL,
    "fonte" "FonteCriticita" NOT NULL,
    "descrizione" TEXT NOT NULL,
    "riferimentoNormativo" TEXT,
    "azioneConsigliata" TEXT,
    "latitudineGis" DECIMAL(65,30),
    "longitudineGis" DECIMAL(65,30),
    "localizzazioneDescrizione" TEXT,
    "rilevanzaArt47" BOOLEAN NOT NULL DEFAULT false,
    "letteraArt47" "Art47CodNavLettera",
    "rischioDecadenza" "LivelloRischioDecadenza",
    "motivazioneArt47" TEXT,
    "azioneIstruttoriaArt47" TEXT,
    "regolarizzata" BOOLEAN NOT NULL DEFAULT false,
    "dataRegolarizzazione" TIMESTAMP(3),
    "descrizioneRegolarizzazione" TEXT,
    "esitoRegolarizzazione" "EsitoRegolarizzazione",
    "verificataRegolarizzazione" BOOLEAN NOT NULL DEFAULT false,
    "dataVerificaRegolarizzazione" TIMESTAMP(3),
    "noteVerificaRegolarizzazione" TEXT,
    "stato" "StatoCriticita" NOT NULL,
    "dataRilevazione" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataUltimoAggiornamento" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Criticita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Procedimento" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "criticitaId" TEXT,
    "tipologia" "TipologiaProcedimento" NOT NULL,
    "origineProcedimento" "OrigineProcedimento" NOT NULL DEFAULT 'UFFICIO',
    "procedimentoUfficio" BOOLEAN NOT NULL DEFAULT true,
    "riferimentoNormativo" TEXT,
    "dataAvvio" TIMESTAMP(3),
    "dataScadenzaContraddittorio" TIMESTAMP(3),
    "dataProvvedimentoFinale" TIMESTAMP(3),
    "comunicazioneAvvioInviata" BOOLEAN NOT NULL DEFAULT false,
    "dataComunicazioneAvvio" TIMESTAMP(3),
    "termineMemorieGiorni" INTEGER,
    "termineMemorieScadenza" TIMESTAMP(3),
    "memorieRicevute" BOOLEAN NOT NULL DEFAULT false,
    "dataRicezioneMemorie" TIMESTAMP(3),
    "audizioneRichiesta" BOOLEAN NOT NULL DEFAULT false,
    "audizioneSvolta" BOOLEAN NOT NULL DEFAULT false,
    "dataAudizione" TIMESTAMP(3),
    "sopralluogoIstruttorioSvolto" BOOLEAN NOT NULL DEFAULT false,
    "contestazioneFormaleInviata" BOOLEAN NOT NULL DEFAULT false,
    "dataContestazioneFormale" TIMESTAMP(3),
    "controdeduzioniValutate" BOOLEAN NOT NULL DEFAULT false,
    "motivazioneValutazione" TEXT,
    "propostaEsitoIstruttorio" "EsitoIstruttorioProcedimento",
    "preavvisoRigettoApplicabile" BOOLEAN NOT NULL DEFAULT false,
    "statoPreavvisoRigetto" "StatoPreavvisoRigetto" NOT NULL DEFAULT 'NON_VALUTATO',
    "dataPreavvisoRigetto" TIMESTAMP(3),
    "termineOsservazioniPreavviso" TIMESTAMP(3),
    "osservazioniPreavvisoRicevute" BOOLEAN NOT NULL DEFAULT false,
    "dataOsservazioniPreavviso" TIMESTAMP(3),
    "valutazioneOsservazioniPreavviso" TEXT,
    "motivazioneMancatoPreavviso" TEXT,
    "checklistProfile" "ChecklistProfile" NOT NULL DEFAULT 'CORE',
    "checklistContraddittorioCompleta" BOOLEAN NOT NULL DEFAULT false,
    "noteChecklistContraddittorio" TEXT,
    "stato" "StatoProcedimento" NOT NULL,
    "noteIstruttorie" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procedimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sopralluogo" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "operatori" TEXT NOT NULL,
    "esito" "EsitoSopralluogo" NOT NULL,
    "conformitaPlanimetrica" BOOLEAN NOT NULL DEFAULT false,
    "latitudineGis" DECIMAL(65,30),
    "longitudineGis" DECIMAL(65,30),
    "localizzazioneDescrizione" TEXT,
    "statoManutentivo" TEXT,
    "sicurezza" TEXT,
    "occupazione" TEXT,
    "interferenze" TEXT,
    "descrizione" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sopralluogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "annoRiferimento" INTEGER NOT NULL,
    "importoDovuto" DECIMAL(65,30) NOT NULL,
    "importoVersato" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dataScadenza" TIMESTAMP(3) NOT NULL,
    "dataVersamento" TIMESTAMP(3),
    "stato" "StatoPagamento" NOT NULL,
    "interessiMora" DECIMAL(65,30),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipologia" "TipologiaDocumento" NOT NULL,
    "statoDocumento" "StatoDocumento" NOT NULL DEFAULT 'ATTIVO',
    "direzione" "DocumentoDirezione",
    "canale" "DocumentoCanale",
    "numeroProtocollo" TEXT,
    "dataProtocollo" TIMESTAMP(3),
    "mittente" TEXT,
    "destinatario" TEXT,
    "pecMessageId" TEXT,
    "pecRicevutaAccettazioneId" TEXT,
    "pecRicevutaConsegnaId" TEXT,
    "pecWarningMancataRicevuta" BOOLEAN NOT NULL DEFAULT false,
    "mimeType" TEXT,
    "dimensioneBytes" INTEGER,
    "checksumSha256" TEXT,
    "sha256" TEXT,
    "url" TEXT,
    "storagePath" TEXT,
    "storageKey" TEXT,
    "storageProvider" TEXT,
    "storageBucket" TEXT,
    "publicUrl" TEXT,
    "nomeStorage" TEXT,
    "originalName" TEXT,
    "sizeBytes" INTEGER,
    "documentType" TEXT,
    "documentDate" TIMESTAMP(3),
    "source" TEXT,
    "status" TEXT,
    "dataDocumento" TIMESTAMP(3),
    "descrizione" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedByUserEmail" TEXT,
    "uploadedByUserRole" TEXT,
    "archivedAt" TIMESTAMP(3),
    "enteId" TEXT,
    "concessioneId" TEXT,
    "criticitaId" TEXT,
    "procedimentoId" TEXT,
    "sopralluogoId" TEXT,
    "pagamentoId" TEXT,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisioneProcedimento" (
    "id" TEXT NOT NULL,
    "enteId" TEXT,
    "procedimentoId" TEXT NOT NULL,
    "concessioneId" TEXT,
    "tipoDecisione" "TipoDecisioneProcedimento" NOT NULL,
    "numeroAtto" TEXT NOT NULL,
    "dataAtto" TIMESTAMP(3) NOT NULL,
    "dataEfficacia" TIMESTAMP(3) NOT NULL,
    "organoCompetente" TEXT NOT NULL,
    "motivazioneSintetica" TEXT NOT NULL,
    "documentoId" TEXT,
    "effettoTitolo" "EffettoTitoloProcedimento" NOT NULL DEFAULT 'NESSUNO',
    "statoEffetto" "StatoEffettoProcedimento" NOT NULL DEFAULT 'BLOCCATO',
    "effettoApplicatoAt" TIMESTAMP(3),
    "effectVersion" INTEGER NOT NULL DEFAULT 0,
    "statoConcessionePrecedente" "StatoConcessione",
    "statoConcessioneSuccessivo" "StatoConcessione",
    "registeredByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisioneProcedimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "enteId" TEXT,
    "concessioneId" TEXT,
    "tipologia" "TipologiaReport" NOT NULL,
    "titolo" TEXT NOT NULL,
    "contenuto" TEXT NOT NULL,
    "formato" TEXT NOT NULL DEFAULT 'PDF',
    "validato" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormaFonte" (
    "id" TEXT NOT NULL,
    "codice" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "enteEmittente" TEXT,
    "ambito" "NormaAmbito" NOT NULL,
    "descrizione" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormaFonte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormaVersione" (
    "id" TEXT NOT NULL,
    "normaFonteId" TEXT NOT NULL,
    "versione" TEXT NOT NULL,
    "stato" "StatoNormaVersione" NOT NULL,
    "dataEntrataVigore" TIMESTAMP(3) NOT NULL,
    "dataFineVigore" TIMESTAMP(3),
    "urlTesto" TEXT,
    "sintesi" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormaVersione_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormaImpatto" (
    "id" TEXT NOT NULL,
    "normaFonteId" TEXT NOT NULL,
    "normaVersioneId" TEXT,
    "modulo" "ModuloImpattoNorma" NOT NULL,
    "severita" "GravitaCriticita" NOT NULL DEFAULT 'MEDIA',
    "descrizione" TEXT NOT NULL,
    "azioneRichiesta" TEXT,
    "concessioneId" TEXT,
    "criticitaId" TEXT,
    "procedimentoId" TEXT,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormaImpatto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userRole" TEXT,
    "enteId" TEXT,
    "concessioneId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "azione" TEXT NOT NULL,
    "entita" TEXT NOT NULL,
    "entitaId" TEXT,
    "esito" "AuditEsito" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ente_codice_key" ON "Ente"("codice");

-- CreateIndex
CREATE INDEX "Ente_tipo_idx" ON "Ente"("tipo");

-- CreateIndex
CREATE INDEX "Ente_stato_idx" ON "Ente"("stato");

-- CreateIndex
CREATE INDEX "Ente_createdAt_idx" ON "Ente"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Authority_code_key" ON "Authority"("code");

-- CreateIndex
CREATE INDEX "Authority_level_idx" ON "Authority"("level");

-- CreateIndex
CREATE INDEX "Authority_createdAt_idx" ON "Authority"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Port_code_key" ON "Port"("code");

-- CreateIndex
CREATE INDEX "Port_enteId_idx" ON "Port"("enteId");

-- CreateIndex
CREATE INDEX "Port_authorityId_idx" ON "Port"("authorityId");

-- CreateIndex
CREATE INDEX "Port_createdAt_idx" ON "Port"("createdAt");

-- CreateIndex
CREATE INDEX "PortArea_portId_idx" ON "PortArea"("portId");

-- CreateIndex
CREATE INDEX "PortArea_createdAt_idx" ON "PortArea"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortArea_portId_code_key" ON "PortArea"("portId", "code");

-- CreateIndex
CREATE INDEX "ImportRun_packCode_idx" ON "ImportRun"("packCode");

-- CreateIndex
CREATE INDEX "ImportRun_status_idx" ON "ImportRun"("status");

-- CreateIndex
CREATE INDEX "ImportRun_enteId_idx" ON "ImportRun"("enteId");

-- CreateIndex
CREATE INDEX "ImportRun_createdAt_idx" ON "ImportRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalSource_sourceKey_key" ON "LegalSource"("sourceKey");

-- CreateIndex
CREATE INDEX "LegalSource_sourceType_idx" ON "LegalSource"("sourceType");

-- CreateIndex
CREATE INDEX "LegalSource_status_idx" ON "LegalSource"("status");

-- CreateIndex
CREATE INDEX "LegalSource_role_idx" ON "LegalSource"("role");

-- CreateIndex
CREATE INDEX "LegalSource_legalRank_idx" ON "LegalSource"("legalRank");

-- CreateIndex
CREATE INDEX "LegalSource_territorialScope_idx" ON "LegalSource"("territorialScope");

-- CreateIndex
CREATE INDEX "LegalSource_confidence_idx" ON "LegalSource"("confidence");

-- CreateIndex
CREATE INDEX "LegalSource_isConformative_idx" ON "LegalSource"("isConformative");

-- CreateIndex
CREATE INDEX "LegalSource_isExtractable_idx" ON "LegalSource"("isExtractable");

-- CreateIndex
CREATE INDEX "LegalSource_enteId_idx" ON "LegalSource"("enteId");

-- CreateIndex
CREATE INDEX "LegalSource_portId_idx" ON "LegalSource"("portId");

-- CreateIndex
CREATE INDEX "LegalSource_effectiveFrom_idx" ON "LegalSource"("effectiveFrom");

-- CreateIndex
CREATE INDEX "LegalSource_createdAt_idx" ON "LegalSource"("createdAt");

-- CreateIndex
CREATE INDEX "SourceRelation_fromSourceId_idx" ON "SourceRelation"("fromSourceId");

-- CreateIndex
CREATE INDEX "SourceRelation_toSourceId_idx" ON "SourceRelation"("toSourceId");

-- CreateIndex
CREATE INDEX "SourceRelation_relationType_idx" ON "SourceRelation"("relationType");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRelation_fromSourceId_toSourceId_relationType_key" ON "SourceRelation"("fromSourceId", "toSourceId", "relationType");

-- CreateIndex
CREATE INDEX "LegalRule_status_idx" ON "LegalRule"("status");

-- CreateIndex
CREATE INDEX "LegalRule_category_idx" ON "LegalRule"("category");

-- CreateIndex
CREATE INDEX "LegalRule_priority_idx" ON "LegalRule"("priority");

-- CreateIndex
CREATE INDEX "LegalRule_enteId_idx" ON "LegalRule"("enteId");

-- CreateIndex
CREATE INDEX "LegalRule_portId_idx" ON "LegalRule"("portId");

-- CreateIndex
CREATE INDEX "LegalRule_matchConcessionVertical_idx" ON "LegalRule"("matchConcessionVertical");

-- CreateIndex
CREATE INDEX "LegalRule_createdAt_idx" ON "LegalRule"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRule_sourceId_ruleCode_key" ON "LegalRule"("sourceId", "ruleCode");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentGap_gapKey_key" ON "DocumentGap"("gapKey");

-- CreateIndex
CREATE INDEX "DocumentGap_status_idx" ON "DocumentGap"("status");

-- CreateIndex
CREATE INDEX "DocumentGap_severity_idx" ON "DocumentGap"("severity");

-- CreateIndex
CREATE INDEX "DocumentGap_enteId_idx" ON "DocumentGap"("enteId");

-- CreateIndex
CREATE INDEX "DocumentGap_portId_idx" ON "DocumentGap"("portId");

-- CreateIndex
CREATE INDEX "DocumentGap_ruleId_idx" ON "DocumentGap"("ruleId");

-- CreateIndex
CREATE INDEX "DocumentGap_createdAt_idx" ON "DocumentGap"("createdAt");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_idx" ON "TenantMembership"("userId");

-- CreateIndex
CREATE INDEX "TenantMembership_enteId_idx" ON "TenantMembership"("enteId");

-- CreateIndex
CREATE INDEX "TenantMembership_isDefault_idx" ON "TenantMembership"("isDefault");

-- CreateIndex
CREATE INDEX "TenantMembership_role_idx" ON "TenantMembership"("role");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_userId_enteId_key" ON "TenantMembership"("userId", "enteId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_ruolo_idx" ON "User"("ruolo");

-- CreateIndex
CREATE INDEX "User_attivo_idx" ON "User"("attivo");

-- CreateIndex
CREATE INDEX "User_lockedUntil_idx" ON "User"("lockedUntil");

-- CreateIndex
CREATE INDEX "User_mfaEnabled_idx" ON "User"("mfaEnabled");

-- CreateIndex
CREATE INDEX "User_mustChangePassword_idx" ON "User"("mustChangePassword");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Concessionario_denominazione_idx" ON "Concessionario"("denominazione");

-- CreateIndex
CREATE INDEX "Concessionario_createdAt_idx" ON "Concessionario"("createdAt");

-- CreateIndex
CREATE INDEX "Concessione_stato_idx" ON "Concessione"("stato");

-- CreateIndex
CREATE INDEX "Concessione_dataScadenza_idx" ON "Concessione"("dataScadenza");

-- CreateIndex
CREATE INDEX "Concessione_concessionarioId_idx" ON "Concessione"("concessionarioId");

-- CreateIndex
CREATE INDEX "Concessione_enteId_idx" ON "Concessione"("enteId");

-- CreateIndex
CREATE INDEX "Concessione_tipologiaBene_idx" ON "Concessione"("tipologiaBene");

-- CreateIndex
CREATE INDEX "Concessione_zonaPortuale_idx" ON "Concessione"("zonaPortuale");

-- CreateIndex
CREATE INDEX "Concessione_concessionVertical_idx" ON "Concessione"("concessionVertical");

-- CreateIndex
CREATE INDEX "Concessione_concessionObjectType_idx" ON "Concessione"("concessionObjectType");

-- CreateIndex
CREATE INDEX "Concessione_awardingProcedureType_idx" ON "Concessione"("awardingProcedureType");

-- CreateIndex
CREATE INDEX "Concessione_feeRegime_idx" ON "Concessione"("feeRegime");

-- CreateIndex
CREATE INDEX "Concessione_comparativeProcedureStatus_idx" ON "Concessione"("comparativeProcedureStatus");

-- CreateIndex
CREATE INDEX "Concessione_thirdPartyManagementStatus_idx" ON "Concessione"("thirdPartyManagementStatus");

-- CreateIndex
CREATE INDEX "Concessione_latitudineGis_longitudineGis_idx" ON "Concessione"("latitudineGis", "longitudineGis");

-- CreateIndex
CREATE INDEX "Concessione_createdAt_idx" ON "Concessione"("createdAt");

-- CreateIndex
CREATE INDEX "ConcessioneLegalFramework_concessioneId_idx" ON "ConcessioneLegalFramework"("concessioneId");

-- CreateIndex
CREATE INDEX "ConcessioneLegalFramework_framework_idx" ON "ConcessioneLegalFramework"("framework");

-- CreateIndex
CREATE INDEX "ConcessioneLegalFramework_createdAt_idx" ON "ConcessioneLegalFramework"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConcessioneLegalFramework_concessioneId_framework_key" ON "ConcessioneLegalFramework"("concessioneId", "framework");

-- CreateIndex
CREATE INDEX "ObbligoConcessorio_concessioneId_idx" ON "ObbligoConcessorio"("concessioneId");

-- CreateIndex
CREATE INDEX "ObbligoConcessorio_stato_idx" ON "ObbligoConcessorio"("stato");

-- CreateIndex
CREATE INDEX "ObbligoConcessorio_tipologia_idx" ON "ObbligoConcessorio"("tipologia");

-- CreateIndex
CREATE INDEX "ObbligoConcessorio_dataProssimaVerifica_idx" ON "ObbligoConcessorio"("dataProssimaVerifica");

-- CreateIndex
CREATE INDEX "ObbligoConcessorio_createdAt_idx" ON "ObbligoConcessorio"("createdAt");

-- CreateIndex
CREATE INDEX "Scadenza_concessioneId_idx" ON "Scadenza"("concessioneId");

-- CreateIndex
CREATE INDEX "Scadenza_stato_idx" ON "Scadenza"("stato");

-- CreateIndex
CREATE INDEX "Scadenza_tipologia_idx" ON "Scadenza"("tipologia");

-- CreateIndex
CREATE INDEX "Scadenza_dataScadenza_idx" ON "Scadenza"("dataScadenza");

-- CreateIndex
CREATE INDEX "Scadenza_createdAt_idx" ON "Scadenza"("createdAt");

-- CreateIndex
CREATE INDEX "Criticita_concessioneId_idx" ON "Criticita"("concessioneId");

-- CreateIndex
CREATE INDEX "Criticita_stato_idx" ON "Criticita"("stato");

-- CreateIndex
CREATE INDEX "Criticita_gravita_idx" ON "Criticita"("gravita");

-- CreateIndex
CREATE INDEX "Criticita_tipologia_idx" ON "Criticita"("tipologia");

-- CreateIndex
CREATE INDEX "Criticita_latitudineGis_longitudineGis_idx" ON "Criticita"("latitudineGis", "longitudineGis");

-- CreateIndex
CREATE INDEX "Criticita_rilevanzaArt47_idx" ON "Criticita"("rilevanzaArt47");

-- CreateIndex
CREATE INDEX "Criticita_letteraArt47_idx" ON "Criticita"("letteraArt47");

-- CreateIndex
CREATE INDEX "Criticita_rischioDecadenza_idx" ON "Criticita"("rischioDecadenza");

-- CreateIndex
CREATE INDEX "Criticita_regolarizzata_idx" ON "Criticita"("regolarizzata");

-- CreateIndex
CREATE INDEX "Criticita_dataRegolarizzazione_idx" ON "Criticita"("dataRegolarizzazione");

-- CreateIndex
CREATE INDEX "Criticita_esitoRegolarizzazione_idx" ON "Criticita"("esitoRegolarizzazione");

-- CreateIndex
CREATE INDEX "Criticita_verificataRegolarizzazione_idx" ON "Criticita"("verificataRegolarizzazione");

-- CreateIndex
CREATE INDEX "Criticita_dataRilevazione_idx" ON "Criticita"("dataRilevazione");

-- CreateIndex
CREATE INDEX "Criticita_createdAt_idx" ON "Criticita"("createdAt");

-- CreateIndex
CREATE INDEX "Procedimento_concessioneId_idx" ON "Procedimento"("concessioneId");

-- CreateIndex
CREATE INDEX "Procedimento_criticitaId_idx" ON "Procedimento"("criticitaId");

-- CreateIndex
CREATE INDEX "Procedimento_stato_idx" ON "Procedimento"("stato");

-- CreateIndex
CREATE INDEX "Procedimento_tipologia_idx" ON "Procedimento"("tipologia");

-- CreateIndex
CREATE INDEX "Procedimento_origineProcedimento_idx" ON "Procedimento"("origineProcedimento");

-- CreateIndex
CREATE INDEX "Procedimento_procedimentoUfficio_idx" ON "Procedimento"("procedimentoUfficio");

-- CreateIndex
CREATE INDEX "Procedimento_preavvisoRigettoApplicabile_idx" ON "Procedimento"("preavvisoRigettoApplicabile");

-- CreateIndex
CREATE INDEX "Procedimento_statoPreavvisoRigetto_idx" ON "Procedimento"("statoPreavvisoRigetto");

-- CreateIndex
CREATE INDEX "Procedimento_checklistProfile_idx" ON "Procedimento"("checklistProfile");

-- CreateIndex
CREATE INDEX "Procedimento_dataScadenzaContraddittorio_idx" ON "Procedimento"("dataScadenzaContraddittorio");

-- CreateIndex
CREATE INDEX "Procedimento_checklistContraddittorioCompleta_idx" ON "Procedimento"("checklistContraddittorioCompleta");

-- CreateIndex
CREATE INDEX "Procedimento_termineMemorieScadenza_idx" ON "Procedimento"("termineMemorieScadenza");

-- CreateIndex
CREATE INDEX "Procedimento_contestazioneFormaleInviata_idx" ON "Procedimento"("contestazioneFormaleInviata");

-- CreateIndex
CREATE INDEX "Procedimento_createdAt_idx" ON "Procedimento"("createdAt");

-- CreateIndex
CREATE INDEX "Sopralluogo_concessioneId_idx" ON "Sopralluogo"("concessioneId");

-- CreateIndex
CREATE INDEX "Sopralluogo_data_idx" ON "Sopralluogo"("data");

-- CreateIndex
CREATE INDEX "Sopralluogo_esito_idx" ON "Sopralluogo"("esito");

-- CreateIndex
CREATE INDEX "Sopralluogo_latitudineGis_longitudineGis_idx" ON "Sopralluogo"("latitudineGis", "longitudineGis");

-- CreateIndex
CREATE INDEX "Sopralluogo_createdAt_idx" ON "Sopralluogo"("createdAt");

-- CreateIndex
CREATE INDEX "Pagamento_concessioneId_idx" ON "Pagamento"("concessioneId");

-- CreateIndex
CREATE INDEX "Pagamento_stato_idx" ON "Pagamento"("stato");

-- CreateIndex
CREATE INDEX "Pagamento_dataScadenza_idx" ON "Pagamento"("dataScadenza");

-- CreateIndex
CREATE INDEX "Pagamento_annoRiferimento_idx" ON "Pagamento"("annoRiferimento");

-- CreateIndex
CREATE INDEX "Pagamento_createdAt_idx" ON "Pagamento"("createdAt");

-- CreateIndex
CREATE INDEX "Documento_uploadedByUserId_idx" ON "Documento"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "Documento_statoDocumento_idx" ON "Documento"("statoDocumento");

-- CreateIndex
CREATE INDEX "Documento_enteId_idx" ON "Documento"("enteId");

-- CreateIndex
CREATE INDEX "Documento_concessioneId_idx" ON "Documento"("concessioneId");

-- CreateIndex
CREATE INDEX "Documento_criticitaId_idx" ON "Documento"("criticitaId");

-- CreateIndex
CREATE INDEX "Documento_procedimentoId_idx" ON "Documento"("procedimentoId");

-- CreateIndex
CREATE INDEX "Documento_sopralluogoId_idx" ON "Documento"("sopralluogoId");

-- CreateIndex
CREATE INDEX "Documento_pagamentoId_idx" ON "Documento"("pagamentoId");

-- CreateIndex
CREATE INDEX "Documento_reportId_idx" ON "Documento"("reportId");

-- CreateIndex
CREATE INDEX "Documento_tipologia_idx" ON "Documento"("tipologia");

-- CreateIndex
CREATE INDEX "Documento_direzione_idx" ON "Documento"("direzione");

-- CreateIndex
CREATE INDEX "Documento_canale_idx" ON "Documento"("canale");

-- CreateIndex
CREATE INDEX "Documento_numeroProtocollo_idx" ON "Documento"("numeroProtocollo");

-- CreateIndex
CREATE INDEX "Documento_dataProtocollo_idx" ON "Documento"("dataProtocollo");

-- CreateIndex
CREATE INDEX "Documento_pecWarningMancataRicevuta_idx" ON "Documento"("pecWarningMancataRicevuta");

-- CreateIndex
CREATE INDEX "Documento_dataDocumento_idx" ON "Documento"("dataDocumento");

-- CreateIndex
CREATE INDEX "Documento_createdAt_idx" ON "Documento"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisioneProcedimento_procedimentoId_key" ON "DecisioneProcedimento"("procedimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisioneProcedimento_idempotencyKey_key" ON "DecisioneProcedimento"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_enteId_idx" ON "DecisioneProcedimento"("enteId");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_procedimentoId_idx" ON "DecisioneProcedimento"("procedimentoId");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_concessioneId_idx" ON "DecisioneProcedimento"("concessioneId");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_documentoId_idx" ON "DecisioneProcedimento"("documentoId");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_registeredByUserId_idx" ON "DecisioneProcedimento"("registeredByUserId");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_tipoDecisione_idx" ON "DecisioneProcedimento"("tipoDecisione");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_statoEffetto_dataEfficacia_idx" ON "DecisioneProcedimento"("statoEffetto", "dataEfficacia");

-- CreateIndex
CREATE INDEX "DecisioneProcedimento_createdAt_idx" ON "DecisioneProcedimento"("createdAt");

-- CreateIndex
CREATE INDEX "Report_enteId_idx" ON "Report"("enteId");

-- CreateIndex
CREATE INDEX "Report_concessioneId_idx" ON "Report"("concessioneId");

-- CreateIndex
CREATE INDEX "Report_tipologia_idx" ON "Report"("tipologia");

-- CreateIndex
CREATE INDEX "Report_validato_idx" ON "Report"("validato");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NormaFonte_codice_key" ON "NormaFonte"("codice");

-- CreateIndex
CREATE INDEX "NormaFonte_ambito_idx" ON "NormaFonte"("ambito");

-- CreateIndex
CREATE INDEX "NormaFonte_titolo_idx" ON "NormaFonte"("titolo");

-- CreateIndex
CREATE INDEX "NormaFonte_createdAt_idx" ON "NormaFonte"("createdAt");

-- CreateIndex
CREATE INDEX "NormaVersione_normaFonteId_idx" ON "NormaVersione"("normaFonteId");

-- CreateIndex
CREATE INDEX "NormaVersione_stato_idx" ON "NormaVersione"("stato");

-- CreateIndex
CREATE INDEX "NormaVersione_dataEntrataVigore_idx" ON "NormaVersione"("dataEntrataVigore");

-- CreateIndex
CREATE INDEX "NormaVersione_createdAt_idx" ON "NormaVersione"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NormaVersione_normaFonteId_versione_key" ON "NormaVersione"("normaFonteId", "versione");

-- CreateIndex
CREATE INDEX "NormaImpatto_normaFonteId_idx" ON "NormaImpatto"("normaFonteId");

-- CreateIndex
CREATE INDEX "NormaImpatto_normaVersioneId_idx" ON "NormaImpatto"("normaVersioneId");

-- CreateIndex
CREATE INDEX "NormaImpatto_modulo_idx" ON "NormaImpatto"("modulo");

-- CreateIndex
CREATE INDEX "NormaImpatto_severita_idx" ON "NormaImpatto"("severita");

-- CreateIndex
CREATE INDEX "NormaImpatto_criticitaId_idx" ON "NormaImpatto"("criticitaId");

-- CreateIndex
CREATE INDEX "NormaImpatto_procedimentoId_idx" ON "NormaImpatto"("procedimentoId");

-- CreateIndex
CREATE INDEX "NormaImpatto_reportId_idx" ON "NormaImpatto"("reportId");

-- CreateIndex
CREATE INDEX "NormaImpatto_concessioneId_idx" ON "NormaImpatto"("concessioneId");

-- CreateIndex
CREATE INDEX "NormaImpatto_createdAt_idx" ON "NormaImpatto"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_currentHash_idx" ON "ActivityLog"("currentHash");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_enteId_idx" ON "ActivityLog"("enteId");

-- CreateIndex
CREATE INDEX "ActivityLog_entita_entitaId_idx" ON "ActivityLog"("entita", "entitaId");

-- CreateIndex
CREATE INDEX "ActivityLog_concessioneId_idx" ON "ActivityLog"("concessioneId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Port" ADD CONSTRAINT "Port_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Port" ADD CONSTRAINT "Port_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortArea" ADD CONSTRAINT "PortArea_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSource" ADD CONSTRAINT "LegalSource_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSource" ADD CONSTRAINT "LegalSource_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSource" ADD CONSTRAINT "LegalSource_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSource" ADD CONSTRAINT "LegalSource_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRelation" ADD CONSTRAINT "SourceRelation_fromSourceId_fkey" FOREIGN KEY ("fromSourceId") REFERENCES "LegalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRelation" ADD CONSTRAINT "SourceRelation_toSourceId_fkey" FOREIGN KEY ("toSourceId") REFERENCES "LegalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRule" ADD CONSTRAINT "LegalRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LegalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRule" ADD CONSTRAINT "LegalRule_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRule" ADD CONSTRAINT "LegalRule_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGap" ADD CONSTRAINT "DocumentGap_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGap" ADD CONSTRAINT "DocumentGap_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGap" ADD CONSTRAINT "DocumentGap_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "LegalRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concessione" ADD CONSTRAINT "Concessione_concessionarioId_fkey" FOREIGN KEY ("concessionarioId") REFERENCES "Concessionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concessione" ADD CONSTRAINT "Concessione_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcessioneLegalFramework" ADD CONSTRAINT "ConcessioneLegalFramework_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObbligoConcessorio" ADD CONSTRAINT "ObbligoConcessorio_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scadenza" ADD CONSTRAINT "Scadenza_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criticita" ADD CONSTRAINT "Criticita_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedimento" ADD CONSTRAINT "Procedimento_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedimento" ADD CONSTRAINT "Procedimento_criticitaId_fkey" FOREIGN KEY ("criticitaId") REFERENCES "Criticita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sopralluogo" ADD CONSTRAINT "Sopralluogo_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_criticitaId_fkey" FOREIGN KEY ("criticitaId") REFERENCES "Criticita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_sopralluogoId_fkey" FOREIGN KEY ("sopralluogoId") REFERENCES "Sopralluogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "Pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisioneProcedimento" ADD CONSTRAINT "DecisioneProcedimento_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisioneProcedimento" ADD CONSTRAINT "DecisioneProcedimento_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisioneProcedimento" ADD CONSTRAINT "DecisioneProcedimento_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisioneProcedimento" ADD CONSTRAINT "DecisioneProcedimento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisioneProcedimento" ADD CONSTRAINT "DecisioneProcedimento_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaVersione" ADD CONSTRAINT "NormaVersione_normaFonteId_fkey" FOREIGN KEY ("normaFonteId") REFERENCES "NormaFonte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaImpatto" ADD CONSTRAINT "NormaImpatto_normaFonteId_fkey" FOREIGN KEY ("normaFonteId") REFERENCES "NormaFonte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaImpatto" ADD CONSTRAINT "NormaImpatto_normaVersioneId_fkey" FOREIGN KEY ("normaVersioneId") REFERENCES "NormaVersione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaImpatto" ADD CONSTRAINT "NormaImpatto_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaImpatto" ADD CONSTRAINT "NormaImpatto_criticitaId_fkey" FOREIGN KEY ("criticitaId") REFERENCES "Criticita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaImpatto" ADD CONSTRAINT "NormaImpatto_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaImpatto" ADD CONSTRAINT "NormaImpatto_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE SET NULL ON UPDATE CASCADE;
