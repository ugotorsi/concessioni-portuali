-- CreateEnum
CREATE TYPE "TipoDecisioneProcedimento" AS ENUM ('DECADENZA_DICHIARATA', 'REVOCA_DISPOSTA', 'ARCHIVIAZIONE', 'CHIUSURA_SENZA_EFFETTO');

-- CreateEnum
CREATE TYPE "EffettoTitoloProcedimento" AS ENUM ('NESSUNO', 'CONCESSIONE_DECADUTA', 'CONCESSIONE_REVOCATA');

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
    "statoConcessionePrecedente" "StatoConcessione",
    "statoConcessioneSuccessivo" "StatoConcessione",
    "registeredByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisioneProcedimento_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "DecisioneProcedimento_createdAt_idx" ON "DecisioneProcedimento"("createdAt");

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