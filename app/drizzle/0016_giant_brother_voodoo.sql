CREATE TABLE "app_wallet_auth_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"solana_env" text NOT NULL,
	"state" text NOT NULL,
	"processing_token" text,
	"processing_started_at" timestamp with time zone,
	"user_id" uuid,
	"smart_account_address" text,
	"provisioning_outcome" text,
	"last_error_code" text,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_wallet_auth_completions_solana_env_check" CHECK ("app_wallet_auth_completions"."solana_env" IN ('mainnet', 'testnet', 'devnet', 'localnet')),
	CONSTRAINT "app_wallet_auth_completions_state_check" CHECK ("app_wallet_auth_completions"."state" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "app_wallet_auth_completions_provisioning_outcome_check" CHECK ("app_wallet_auth_completions"."provisioning_outcome" IS NULL OR "app_wallet_auth_completions"."provisioning_outcome" IN ('existing_ready', 'reconciled_ready', 'sponsored_existing_record', 'sponsored_new_record', 'retried_failed_record'))
);
--> statement-breakpoint
ALTER TABLE "app_user_smart_accounts" DROP CONSTRAINT "app_user_smart_accounts_state_check";--> statement-breakpoint
ALTER TABLE "app_user_smart_accounts" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user_smart_accounts" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "app_user_smart_accounts" ADD COLUMN "last_error_message" text;--> statement-breakpoint
UPDATE "app_user_smart_accounts"
SET
	"state" = 'provisioning',
	"last_checked_at" = COALESCE("last_checked_at", "updated_at")
WHERE "state" = 'pending';--> statement-breakpoint
ALTER TABLE "app_wallet_auth_completions" ADD CONSTRAINT "app_wallet_auth_completions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_wallet_auth_completions_challenge_hash_uidx" ON "app_wallet_auth_completions" USING btree ("challenge_hash");--> statement-breakpoint
CREATE INDEX "app_wallet_auth_completions_wallet_address_idx" ON "app_wallet_auth_completions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "app_wallet_auth_completions_state_idx" ON "app_wallet_auth_completions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "app_wallet_auth_completions_user_id_idx" ON "app_wallet_auth_completions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app_user_smart_accounts" ADD CONSTRAINT "app_user_smart_accounts_state_check" CHECK ("app_user_smart_accounts"."state" IN ('provisioning', 'ready', 'failed'));
