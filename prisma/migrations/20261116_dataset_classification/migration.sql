CREATE TYPE "DatasetClass" AS ENUM ('UNCLASSIFIED', 'PROFESSIONAL', 'DEMO', 'E2E');

ALTER TABLE "Concessione"
ADD COLUMN "datasetClass" "DatasetClass" NOT NULL DEFAULT 'UNCLASSIFIED';

ALTER TABLE "Procedimento"
ADD COLUMN "datasetClass" "DatasetClass" NOT NULL DEFAULT 'UNCLASSIFIED';

ALTER TABLE "FascicoloIntake"
ADD COLUMN "datasetClass" "DatasetClass" NOT NULL DEFAULT 'UNCLASSIFIED';

CREATE INDEX "Concessione_datasetClass_idx" ON "Concessione"("datasetClass");
CREATE INDEX "Procedimento_datasetClass_idx" ON "Procedimento"("datasetClass");
CREATE INDEX "FascicoloIntake_datasetClass_idx" ON "FascicoloIntake"("datasetClass");
