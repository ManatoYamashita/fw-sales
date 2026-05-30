ALTER TABLE "research_jobs"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

ALTER TABLE "research_jobs"
  ADD COLUMN IF NOT EXISTS "deleted_by" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'research_jobs_deleted_by_profiles_id_fk'
  ) THEN
    ALTER TABLE "research_jobs"
      ADD CONSTRAINT "research_jobs_deleted_by_profiles_id_fk"
      FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "research_jobs_deleted_at_idx"
  ON "research_jobs" USING btree ("deleted_at");
