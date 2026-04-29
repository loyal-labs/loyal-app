-- Idempotent: safe to replay on any env.
ALTER TABLE "trusted_dapps" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trusted_dapps_active_category_order_idx" ON "trusted_dapps" USING btree ("is_active","category","display_order");
