-- Add the temporal generation. Existing concessions remain on the frozen V1 contract.
ALTER TABLE "Concessione"
ADD COLUMN "expiryGeneration" INTEGER NOT NULL DEFAULT 1;

UPDATE "Concessione" SET "expiryGeneration" = 0;

ALTER TABLE "Concessione"
ADD CONSTRAINT "concessione_expiry_generation_ck" CHECK ("expiryGeneration" >= 0);

-- Legacy signals remain NULL; only V2 signals carry a positive generation.
ALTER TABLE "FascicoloSignal"
ADD COLUMN "expiryGeneration" INTEGER;

ALTER TABLE "FascicoloSignal"
ADD CONSTRAINT "fascicolo_signal_expiry_generation_ck" CHECK (
  "expiryGeneration" IS NULL OR "expiryGeneration" > 0
);

CREATE TABLE "ConcessioneExpiryChangeCommand" (
  "id" TEXT NOT NULL,
  "requestId" VARCHAR(128) NOT NULL,
  "payloadFingerprint" CHAR(64) NOT NULL,
  "concessioneId" TEXT NOT NULL,
  "enteId" TEXT NOT NULL,
  "expectedGeneration" INTEGER NOT NULL,
  "resultingGeneration" INTEGER NOT NULL,
  "previousDataScadenza" TIMESTAMP(3) NOT NULL,
  "newDataScadenza" TIMESTAMP(3) NOT NULL,
  "motivation" VARCHAR(2000) NOT NULL,
  "reference" VARCHAR(1000),
  "actorUserId" TEXT,
  "actorId" VARCHAR(256) NOT NULL,
  "actorEmail" TEXT,
  "actorRole" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConcessioneExpiryChangeCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "concessione_expiry_change_command_hash_ck" CHECK (
    "payloadFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "concessione_expiry_change_command_generation_ck" CHECK (
    "expectedGeneration" >= 0
    AND "resultingGeneration" = "expectedGeneration" + 1
  ),
  CONSTRAINT "concessione_expiry_change_command_dates_ck" CHECK (
    "previousDataScadenza" <> "newDataScadenza"
  ),
  CONSTRAINT "concessione_expiry_change_command_required_text_ck" CHECK (
    "requestId" ~ '[^[:space:]]'
    AND "motivation" ~ '[^[:space:]]'
    AND "actorId" ~ '[^[:space:]]'
    AND "actorRole" ~ '[^[:space:]]'
  )
);

CREATE UNIQUE INDEX "ConcessioneExpiryChangeCommand_requestId_key"
ON "ConcessioneExpiryChangeCommand"("requestId");

CREATE UNIQUE INDEX "ConcessioneExpiryChangeCommand_concessioneId_resultingGeneration_key"
ON "ConcessioneExpiryChangeCommand"("concessioneId", "resultingGeneration");

CREATE INDEX "ConcessioneExpiryChangeCommand_enteId_createdAt_idx"
ON "ConcessioneExpiryChangeCommand"("enteId", "createdAt");

CREATE INDEX "ConcessioneExpiryChangeCommand_concessioneId_createdAt_idx"
ON "ConcessioneExpiryChangeCommand"("concessioneId", "createdAt");

CREATE INDEX "ConcessioneExpiryChangeCommand_actorUserId_idx"
ON "ConcessioneExpiryChangeCommand"("actorUserId");

ALTER TABLE "ConcessioneExpiryChangeCommand"
ADD CONSTRAINT "ConcessioneExpiryChangeCommand_concessioneId_fkey"
FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConcessioneExpiryChangeCommand"
ADD CONSTRAINT "ConcessioneExpiryChangeCommand_enteId_fkey"
FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConcessioneExpiryChangeCommand"
ADD CONSTRAINT "ConcessioneExpiryChangeCommand_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;