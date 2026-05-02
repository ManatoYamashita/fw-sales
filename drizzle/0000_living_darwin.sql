CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"date" text NOT NULL,
	"meeting_type" text NOT NULL,
	"discussion" text NOT NULL,
	"proposal" text NOT NULL,
	"estimate_amount" integer NOT NULL,
	"order_amount" integer,
	"lost_reason" text NOT NULL,
	"status" text NOT NULL,
	"assigned_sales" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefecture" text NOT NULL,
	"city" text NOT NULL,
	"address" text NOT NULL,
	"genre" text NOT NULL,
	"priority" text NOT NULL,
	"stage" text NOT NULL,
	"channel" text NOT NULL,
	"has_contact_form" text NOT NULL,
	"map_url" text NOT NULL,
	"site_url" text NOT NULL,
	"instagram_url" text NOT NULL,
	"phone" text NOT NULL,
	"target_service" text NOT NULL,
	"review_count" integer NOT NULL,
	"review_avg" real NOT NULL,
	"memo" text NOT NULL,
	"assigned_planner" text NOT NULL,
	"assigned_sales" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;