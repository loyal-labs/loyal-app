CREATE TABLE "loyal_stats_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_key" text DEFAULT 'current' NOT NULL,
	"total_aum_raw" bigint NOT NULL,
	"total_users" integer NOT NULL,
	"total_optimized_volume_raw" bigint NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyal_stats_snapshots_current_key_check" CHECK ("loyal_stats_snapshots"."snapshot_key" = 'current'),
	CONSTRAINT "loyal_stats_snapshots_nonnegative_check" CHECK ("loyal_stats_snapshots"."total_aum_raw" >= 0 AND "loyal_stats_snapshots"."total_users" >= 0 AND "loyal_stats_snapshots"."total_optimized_volume_raw" >= 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_update_id" bigint NOT NULL,
	"command" text NOT NULL,
	"chat_id" bigint NOT NULL,
	"telegram_user_id" bigint,
	"status" text DEFAULT 'processing' NOT NULL,
	"telegram_message_id" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_command_receipts_status_check" CHECK ("telegram_command_receipts"."status" IN ('processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "loyal_stats_snapshots_key_uidx" ON "loyal_stats_snapshots" USING btree ("snapshot_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_command_receipts_update_uidx" ON "telegram_command_receipts" USING btree ("telegram_update_id");
--> statement-breakpoint
CREATE INDEX "telegram_command_receipts_status_created_idx" ON "telegram_command_receipts" USING btree ("status","created_at");
