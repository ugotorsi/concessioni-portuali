CREATE TABLE "FascicoloIntake" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "concessioneId" TEXT,
    "tipologiaConcessione" "ConcessionVertical" NOT NULL,
    "oggettoFascicolo" TEXT NOT NULL,
    "denominazioneBreve" TEXT,
    "concessionario" TEXT,
    "enteConcedente" TEXT,
    "autoritaCompetente" TEXT,
    "numeroConcessione" TEXT,
    "dataRilascio" TIMESTAMP(3),
    "decorrenza" TIMESTAMP(3),
    "scadenza" TIMESTAMP(3),
    "oggettoConcessione" TEXT,
    "beneAreaServizio" TEXT,
    "localita" TEXT,
    "soggettoAssistito" TEXT,
    "controparteAmministrazione" TEXT,
    "contestoIniziale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FascicoloIntake_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Documento" ADD COLUMN "fascicoloIntakeId" TEXT;

CREATE INDEX "FascicoloIntake_enteId_idx" ON "FascicoloIntake"("enteId");
CREATE INDEX "FascicoloIntake_concessioneId_idx" ON "FascicoloIntake"("concessioneId");
CREATE INDEX "FascicoloIntake_createdAt_idx" ON "FascicoloIntake"("createdAt");
CREATE INDEX "Documento_fascicoloIntakeId_idx" ON "Documento"("fascicoloIntakeId");

ALTER TABLE "FascicoloIntake" ADD CONSTRAINT "FascicoloIntake_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloIntake" ADD CONSTRAINT "FascicoloIntake_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_fascicoloIntakeId_fkey" FOREIGN KEY ("fascicoloIntakeId") REFERENCES "FascicoloIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
