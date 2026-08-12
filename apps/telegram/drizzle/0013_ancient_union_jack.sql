CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"subject_address" text NOT NULL,
	"grid_user_id" text,
	"smart_account_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_provider_check" CHECK ("app_users"."provider" IN ('solana'))
);
--> statement-breakpoint
CREATE TABLE "app_user_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_chat_id" text,
	"title" text,
	"model" text NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"client_message_id" text,
	"turn_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_chat_messages_role_check" CHECK ("app_chat_messages"."role" IN ('user', 'assistant', 'system'))
);
--> statement-breakpoint
ALTER TABLE "app_user_wallets" ADD CONSTRAINT "app_user_wallets_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_chats" ADD CONSTRAINT "app_chats_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_chat_messages" ADD CONSTRAINT "app_chat_messages_chat_id_app_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."app_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_provider_subject_uidx" ON "app_users" USING btree ("provider","subject_address");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_wallets_wallet_address_uidx" ON "app_user_wallets" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "app_chats_user_client_chat_uidx" ON "app_chats" USING btree ("user_id","client_chat_id") WHERE "app_chats"."client_chat_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_chats_user_last_message_idx" ON "app_chats" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_chat_messages_chat_client_message_uidx" ON "app_chat_messages" USING btree ("chat_id","client_message_id") WHERE "app_chat_messages"."client_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_chat_messages_chat_role_turn_uidx" ON "app_chat_messages" USING btree ("chat_id","role","turn_id") WHERE "app_chat_messages"."turn_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_chat_messages_chat_created_idx" ON "app_chat_messages" USING btree ("chat_id","created_at");
