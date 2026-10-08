ALTER TABLE "ResearchMissionRecord"
ADD COLUMN "assignedActorId" TEXT;

CREATE INDEX "research_mission_actor_status_idx"
ON "ResearchMissionRecord"("tenantId", "assignedActorId", "status", "createdAt");

ALTER TABLE "ResearchMissionRecord"
ADD CONSTRAINT "research_mission_assigned_actor_fk"
FOREIGN KEY ("assignedActorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "protect_research_mission_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."id", NEW."tenantId", NEW."assignedActorId", NEW."contractVersion", NEW."caseId",
        NEW."fascicoloReference", NEW."referenceDate", NEW."mode",
        NEW."payload", NEW."payloadFingerprint", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
        OLD."id", OLD."tenantId", OLD."assignedActorId", OLD."contractVersion", OLD."caseId",
        OLD."fascicoloReference", OLD."referenceDate", OLD."mode",
        OLD."payload", OLD."payloadFingerprint", OLD."createdAt"
    ) THEN
        RAISE EXCEPTION 'Research mission snapshot is immutable';
    END IF;
    RETURN NEW;
END;
$$;
