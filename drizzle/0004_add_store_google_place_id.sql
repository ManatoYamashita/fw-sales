ALTER TABLE "stores" ADD COLUMN "google_place_id" text;--> statement-breakpoint
CREATE INDEX "stores_google_place_id_idx" ON "stores" ("google_place_id");
