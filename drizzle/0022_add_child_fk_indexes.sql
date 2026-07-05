CREATE INDEX "deals_store_id_idx" ON "deals" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "handoffs_store_id_idx" ON "handoffs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "handoffs_deal_id_idx" ON "handoffs" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "place_candidates_matched_store_id_idx" ON "place_candidates" USING btree ("matched_store_id");--> statement-breakpoint
CREATE INDEX "research_store_id_idx" ON "research" USING btree ("store_id");