ALTER TABLE "summaries" ADD COLUMN "trigger_type" text;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "trigger_key" text;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "notification_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "notification_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "summaries_community_trigger_key_uidx" ON "summaries" USING btree ("community_id","trigger_key") WHERE "summaries"."trigger_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "summaries_trigger_key_idx" ON "summaries" USING btree ("trigger_key");--> statement-breakpoint
CREATE INDEX "summaries_notification_sent_idx" ON "summaries" USING btree ("trigger_key","notification_sent_at");