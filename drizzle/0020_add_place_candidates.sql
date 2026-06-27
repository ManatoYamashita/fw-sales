CREATE TABLE "place_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"google_place_id" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"discovery_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_searched_keyword" text,
	"last_searched_area" text,
	"last_center_lat" real,
	"last_center_lng" real,
	"last_radius_meters" integer,
	"last_distance_meters" real,
	"last_is_within_radius" boolean,
	"matched_store_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "place_candidates" ADD CONSTRAINT "place_candidates_matched_store_id_stores_id_fk" FOREIGN KEY ("matched_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_candidates_google_place_id_idx" ON "place_candidates" USING btree ("google_place_id");