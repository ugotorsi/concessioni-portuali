-- P0-D1 migration (review-only, NOT applied)
-- Limitation: migration history in this repository is not bootstrap-complete.
-- This SQL is conservative and intended for manual review before any non-local execution.

-- 1) Enum for technical effect state tracking.
CREATE TYPE "StatoEffettoProcedimento" AS ENUM (
  'NON_PREVISTO',
  'PENDENTE',
  'PRONTO',
  'APPLICATO',
  'BLOCCATO',
  'ERRORE'
);

-- 2) New columns on DecisioneProcedimento.
-- Default BLOCCATO is intentionally conservative for legacy rows until explicit backfill rules run.
ALTER TABLE "DecisioneProcedimento"
  ADD COLUMN "statoEffetto" "StatoEffettoProcedimento" NOT NULL DEFAULT 'BLOCCATO',
  ADD COLUMN "effettoApplicatoAt" TIMESTAMP(3),
  ADD COLUMN "effectVersion" INTEGER NOT NULL DEFAULT 0;

-- 3) Conservative backfill for existing records.
-- WARNING: technical state only, not legal certification of efficacy.

-- No title effect expected.
UPDATE "DecisioneProcedimento"
SET "statoEffetto" = 'NON_PREVISTO'
WHERE "effettoTitolo" = 'NESSUNO';

-- I record legacy con effetto non sono classificati automaticamente come APPLICATI,
-- poiche la coincidenza dello stato della concessione non dimostra quale decisione
-- abbia prodotto l'effetto ne la sua efficacia giuridica.
-- Remaining rows with an expected effect stay conservatively blocked.
UPDATE "DecisioneProcedimento"
SET
  "statoEffetto" = 'BLOCCATO',
  "effettoApplicatoAt" = NULL,
  "effectVersion" = 0
WHERE "effettoTitolo" <> 'NESSUNO'
  AND "statoEffetto" <> 'NON_PREVISTO';

-- 4) Composite index for mature/pending effect search.
CREATE INDEX "DecisioneProcedimento_statoEffetto_dataEfficacia_idx"
ON "DecisioneProcedimento"("statoEffetto", "dataEfficacia");
