ALTER TABLE "communities" ADD COLUMN "summary_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "summary_notification_time_hours" integer DEFAULT 24;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "summary_notification_message_count" integer DEFAULT null;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_summary_notification_time_hours_check" CHECK ("communities"."summary_notification_time_hours" IS NULL OR "communities"."summary_notification_time_hours" IN (24, 48));--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_summary_notification_message_count_check" CHECK ("communities"."summary_notification_message_count" IS NULL OR "communities"."summary_notification_message_count" IN (500, 1000));