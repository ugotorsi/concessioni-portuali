BEGIN;

ALTER TABLE "Procedimento" ADD COLUMN "enteId" TEXT;
ALTER TABLE "FascicoloIntake" ADD COLUMN "procedimentoId" TEXT;

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO unresolved_count
  FROM "Procedimento" procedimento
  LEFT JOIN "Concessione" concessione ON concessione."id" = procedimento."concessioneId"
  WHERE concessione."id" IS NULL OR concessione."enteId" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill Procedimento.enteId: % legacy procedure(s) lack a uniquely determined tenant',
      unresolved_count;
  END IF;
END $$;

UPDATE "Procedimento" procedimento
SET "enteId" = concessione."enteId"
FROM "Concessione" concessione
WHERE concessione."id" = procedimento."concessioneId";

ALTER TABLE "Procedimento" ALTER COLUMN "enteId" SET NOT NULL;
ALTER TABLE "Procedimento" ALTER COLUMN "concessioneId" DROP NOT NULL;

ALTER TABLE "Procedimento"
  DROP CONSTRAINT "Procedimento_concessioneId_fkey";

ALTER TABLE "Procedimento"
  ADD CONSTRAINT "Procedimento_enteId_fkey"
  FOREIGN KEY ("enteId") REFERENCES "Ente"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Procedimento"
  ADD CONSTRAINT "Procedimento_concessioneId_fkey"
  FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloIntake"
  ADD CONSTRAINT "FascicoloIntake_procedimentoId_fkey"
  FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Procedimento_enteId_idx" ON "Procedimento"("enteId");
CREATE UNIQUE INDEX "FascicoloIntake_procedimentoId_key" ON "FascicoloIntake"("procedimentoId");

COMMIT;
