CREATE TABLE "telegram_helper_message_cleanup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_helper_message_cleanup_delete_after_idx" ON "telegram_helper_message_cleanup" USING btree ("delete_after");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_helper_message_cleanup_chat_message_uidx" ON "telegram_helper_message_cleanup" USING btree ("chat_id","message_id");