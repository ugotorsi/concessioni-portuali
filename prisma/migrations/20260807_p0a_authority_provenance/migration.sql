-- P0-A AUTHORITY & PROVENANCE ENVELOPE
-- Add nullable organizational provenance fields with no backfill.

ALTER TABLE "Procedimento"
  ADD COLUMN "responsabileProcedimentoNome" TEXT,
  ADD COLUMN "responsabileProcedimentoEmail" TEXT,
  ADD COLUMN "unitaOrganizzativaResponsabile" TEXT,
  ADD COLUMN "responsabileAssegnatoAt" TIMESTAMP(3);

ALTER TABLE "DecisioneProcedimento"
  ADD COLUMN "protocolloAtto" TEXT,
  ADD COLUMN "adottanteNome" TEXT,
  ADD COLUMN "adottanteQualifica" TEXT,
  ADD COLUMN "scostamentoDaIstruttoria" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivazioneScostamentoIstruttoria" TEXT;
