CREATE TABLE IF NOT EXISTS "push_notification_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"audience" text NOT NULL,
	"platform" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"created_by" text,
	"status" text NOT NULL,
	"requested_count" integer DEFAULT 0 NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"receipt_ok_count" integer DEFAULT 0 NOT NULL,
	"receipt_error_count" integer DEFAULT 0 NOT NULL,
	"device_not_registered_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"receipts_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_notification_sends_audience_check" CHECK ("push_notification_sends"."audience" IN ('all', 'platform', 'wallet')),
	CONSTRAINT "push_notification_sends_status_check" CHECK ("push_notification_sends"."status" IN ('sending', 'sent', 'receipt_checked', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_notification_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"token" text NOT NULL,
	"ticket_id" text,
	"ticket_status" text NOT NULL,
	"ticket_message" text,
	"ticket_error" text,
	"receipt_status" text,
	"receipt_message" text,
	"receipt_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_notification_tickets_send_id_push_notification_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."push_notification_sends"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_notification_sends_created_at_idx" ON "push_notification_sends" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_notification_sends_status_idx" ON "push_notification_sends" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_notification_tickets_send_id_idx" ON "push_notification_tickets" USING btree ("send_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_notification_tickets_ticket_id_idx" ON "push_notification_tickets" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_notification_tickets_token_idx" ON "push_notification_tickets" USING btree ("token");
