-- P0-A: technical Preview actors do not have a persisted User row.
ALTER TABLE "DecisioneProcedimento"
  ALTER COLUMN "registeredByUserId" DROP NOT NULL;