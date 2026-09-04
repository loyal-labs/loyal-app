CREATE TABLE "app_user_smart_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"solana_env" text NOT NULL,
	"settings_pda" text NOT NULL,
	"state" text NOT NULL,
	"creation_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_smart_accounts_solana_env_check" CHECK ("app_user_smart_accounts"."solana_env" IN ('mainnet', 'testnet', 'devnet', 'localnet')),
	CONSTRAINT "app_user_smart_accounts_state_check" CHECK ("app_user_smart_accounts"."state" IN ('pending', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "app_user_smart_accounts" ADD CONSTRAINT "app_user_smart_accounts_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_smart_accounts_user_env_uidx" ON "app_user_smart_accounts" USING btree ("user_id","solana_env");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_smart_accounts_env_settings_uidx" ON "app_user_smart_accounts" USING btree ("solana_env","settings_pda");--> statement-breakpoint
CREATE INDEX "app_user_smart_accounts_user_id_idx" ON "app_user_smart_accounts" USING btree ("user_id");
