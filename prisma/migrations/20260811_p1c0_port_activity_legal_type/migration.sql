CREATE TYPE "PortActivityLegalType" AS ENUM (
  'OPERAZIONI_PORTUALI',
  'SERVIZI_PORTUALI',
  'PASSEGGERI',
  'ALTRO'
);

ALTER TABLE "Concessione"
ADD COLUMN "portActivityLegalType" "PortActivityLegalType";