ALTER TABLE "stores" ADD COLUMN "operator_type" text DEFAULT '未設定' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "operator_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "ai_analysis_result" text;