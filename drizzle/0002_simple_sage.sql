CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"deal_id" text NOT NULL,
	"contract_services" text NOT NULL,
	"initial_fee" integer NOT NULL,
	"monthly_fee" integer NOT NULL,
	"contract_period" text NOT NULL,
	"expected_result" text NOT NULL,
	"contract_owner" text NOT NULL,
	"caution" text NOT NULL,
	"ng_items" text NOT NULL,
	"due_date" text NOT NULL,
	"materials_status" text NOT NULL,
	"ops_assignee" text NOT NULL,
	"contract_date" text NOT NULL,
	"payment_confirmed" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"total_review" text NOT NULL,
	"strength1" text NOT NULL,
	"strength2" text NOT NULL,
	"strength3" text NOT NULL,
	"weakness1" text NOT NULL,
	"weakness2" text NOT NULL,
	"weakness3" text NOT NULL,
	"review_positive" text NOT NULL,
	"review_negative" text NOT NULL,
	"meo_gap" text NOT NULL,
	"hp_gap" text NOT NULL,
	"instagram_gap" text NOT NULL,
	"channel" text NOT NULL,
	"channel_reason" text NOT NULL,
	"sales_hook" text NOT NULL,
	"entry_product" text NOT NULL,
	"main_product" text NOT NULL,
	"researcher" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;