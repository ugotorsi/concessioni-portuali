-- P0-B ASSIGNMENT & RESPONSIBILITY HISTORY
-- No backfill: P0-A current snapshots remain unchanged.

CREATE TABLE "ProcedimentoResponsabileAssignment" (
    "id" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "responsabileNome" TEXT NOT NULL,
    "responsabileEmail" TEXT,
    "unitaOrganizzativa" TEXT NOT NULL,
    "decorrenza" TIMESTAMP(3) NOT NULL,
    "cessazione" TIMESTAMP(3),
    "motivoAssegnazione" TEXT,
    "comunicataAt" TIMESTAMP(3),
    "registeredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedimentoResponsabileAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcedimentoResponsabileAssignment_procedimentoId_idx"
  ON "ProcedimentoResponsabileAssignment"("procedimentoId");
CREATE INDEX "ProcedimentoResponsabileAssignment_decorrenza_idx"
  ON "ProcedimentoResponsabileAssignment"("decorrenza");
CREATE INDEX "ProcedimentoResponsabileAssignment_cessazione_idx"
  ON "ProcedimentoResponsabileAssignment"("cessazione");
CREATE INDEX "ProcedimentoResponsabileAssignment_registeredByUserId_idx"
  ON "ProcedimentoResponsabileAssignment"("registeredByUserId");

CREATE UNIQUE INDEX "ProcedimentoResponsabileAssignment_one_active_per_procedimento"
  ON "ProcedimentoResponsabileAssignment"("procedimentoId")
  WHERE "cessazione" IS NULL;

ALTER TABLE "ProcedimentoResponsabileAssignment"
  ADD CONSTRAINT "ProcedimentoResponsabileAssignment_procedimentoId_fkey"
  FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProcedimentoResponsabileAssignment"
  ADD CONSTRAINT "ProcedimentoResponsabileAssignment_registeredByUserId_fkey"
  FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
