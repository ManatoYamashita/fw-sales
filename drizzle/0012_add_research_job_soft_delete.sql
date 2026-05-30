ALTER TABLE "research_jobs"
  ADD COLUMN "deleted_at" timestamp with time zone,
  ADD COLUMN "deleted_by" uuid;

ALTER TABLE "research_jobs"
  ADD CONSTRAINT "research_jobs_deleted_by_profiles_id_fk"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "research_jobs_deleted_at_idx"
  ON "research_jobs" USING btree ("deleted_at");
ALTER TABLE "research_jobs"
  ADD COLUMN "deleted_at" timestamp with time zone,
  ADD COLUMN "deleted_by" uuid;

ALTER TABLE "research_jobs"
  ADD CONSTRAINT "research_jobs_deleted_by_profiles_id_fk"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "research_jobs_deleted_at_idx"
  ON "research_jobs" USING btree ("deleted_at");
