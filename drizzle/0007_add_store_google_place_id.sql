ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "google_place_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stores_google_place_id_idx" ON "stores" USING btree ("google_place_id");