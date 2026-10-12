CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_version_at_idx" ON "audit_log" USING btree ("version_id","at");--> statement-breakpoint
CREATE INDEX "boh_actuals_property_month_idx" ON "boh_actuals" USING btree ("property_id","month");--> statement-breakpoint
CREATE INDEX "fm_actuals_month_idx" ON "fm_actuals" USING btree ("month");--> statement-breakpoint
CREATE INDEX "fm_actuals_property_month_idx" ON "fm_actuals" USING btree ("property_id","month");