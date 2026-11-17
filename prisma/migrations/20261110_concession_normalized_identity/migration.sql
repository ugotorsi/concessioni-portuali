DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Concessione"
    WHERE "enteId" IS NOT NULL
    GROUP BY "enteId", lower(regexp_replace("numeroAtto", '\s+', '', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CONCESSION_NORMALIZED_IDENTITY_DUPLICATES_REQUIRE_REVIEW';
  END IF;
END
$$;

CREATE UNIQUE INDEX "concessione_tenant_normalized_numero_atto_uq"
ON "Concessione" (
  "enteId",
  lower(regexp_replace("numeroAtto", '\s+', '', 'g'))
)
WHERE "enteId" IS NOT NULL;
