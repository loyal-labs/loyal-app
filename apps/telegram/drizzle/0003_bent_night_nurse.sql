CREATE TABLE "bot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"encrypted_content" jsonb NOT NULL,
	"telegram_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"telegram_thread_id" integer,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_thread_id_bot_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."bot_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_threads" ADD CONSTRAINT "bot_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_messages_thread_created_idx" ON "bot_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_messages_telegram_id_idx" ON "bot_messages" USING btree ("telegram_message_id");--> statement-breakpoint
CREATE INDEX "bot_threads_user_id_idx" ON "bot_threads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_threads_telegram_unique_idx" ON "bot_threads" USING btree ("telegram_chat_id","telegram_thread_id");--> statement-breakpoint
CREATE INDEX "bot_threads_status_idx" ON "bot_threads" USING btree ("status");