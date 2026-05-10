ALTER TABLE "stores" ADD COLUMN "lat" real;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "lng" real;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "business_hours" text DEFAULT '' NOT NULL;