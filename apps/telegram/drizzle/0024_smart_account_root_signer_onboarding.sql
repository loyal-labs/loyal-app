CREATE TABLE IF NOT EXISTS "app_smart_account_settings_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"solana_env" text NOT NULL,
	"smart_account_address" text NOT NULL,
	"settings_pda" text NOT NULL,
	"signer_address" text NOT NULL,
	"scope" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by_user_id" uuid,
	"transaction_index" numeric(30, 0),
	"signature" text,
	"submitted_at" timestamp with time zone,
	"confirmed_slot" bigint,
	"confirmed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_smart_account_settings_change_requests_requested_by_user_id_app_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "app_smart_account_settings_change_req_solana_env_check" CHECK ("app_smart_account_settings_change_requests"."solana_env" IN ('mainnet', 'testnet', 'devnet', 'localnet')),
	CONSTRAINT "app_smart_account_settings_change_req_scope_check" CHECK ("app_smart_account_settings_change_requests"."scope" IN ('root_settings')),
	CONSTRAINT "app_smart_account_settings_change_req_action_check" CHECK ("app_smart_account_settings_change_requests"."action" IN ('add_root_signer', 'remove_root_signer')),
	CONSTRAINT "app_smart_account_settings_change_req_status_check" CHECK ("app_smart_account_settings_change_requests"."status" IN ('draft', 'submitted', 'confirmed', 'failed', 'canceled', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_smart_account_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"solana_env" text NOT NULL,
	"smart_account_address" text NOT NULL,
	"settings_pda" text NOT NULL,
	"signer_address" text NOT NULL,
	"scope" text NOT NULL,
	"state" text NOT NULL,
	"permission_mask" integer,
	"source_signature" text,
	"source_slot" bigint,
	"activated_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_smart_account_signers_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "app_smart_account_signers_solana_env_check" CHECK ("app_smart_account_signers"."solana_env" IN ('mainnet', 'testnet', 'devnet', 'localnet')),
	CONSTRAINT "app_smart_account_signers_scope_check" CHECK ("app_smart_account_signers"."scope" IN ('root_settings')),
	CONSTRAINT "app_smart_account_signers_state_check" CHECK ("app_smart_account_signers"."state" IN ('active', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "app_wallet_auth_completions" ADD COLUMN IF NOT EXISTS "settings_pda" text;
--> statement-breakpoint
ALTER TABLE "app_wallet_auth_completions" DROP CONSTRAINT IF EXISTS "app_wallet_auth_completions_provisioning_outcome_check";
--> statement-breakpoint
ALTER TABLE "app_wallet_auth_completions" ADD CONSTRAINT "app_wallet_auth_completions_provisioning_outcome_check" CHECK ("app_wallet_auth_completions"."provisioning_outcome" IS NULL OR "app_wallet_auth_completions"."provisioning_outcome" IN ('existing_ready', 'delegated_root_signer', 'reconciled_ready', 'sponsored_existing_record', 'sponsored_new_record', 'retried_failed_record'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_smart_account_settings_change_req_idem_uidx" ON "app_smart_account_settings_change_requests" USING btree ("solana_env", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_settings_change_req_settings_idx" ON "app_smart_account_settings_change_requests" USING btree ("solana_env", "settings_pda");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_settings_change_req_signer_idx" ON "app_smart_account_settings_change_requests" USING btree ("solana_env", "signer_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_settings_change_req_status_idx" ON "app_smart_account_settings_change_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_settings_change_req_user_idx" ON "app_smart_account_settings_change_requests" USING btree ("requested_by_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_smart_account_signers_env_settings_scope_signer_uidx" ON "app_smart_account_signers" USING btree ("solana_env", "settings_pda", "scope", "signer_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_signers_env_signer_state_idx" ON "app_smart_account_signers" USING btree ("solana_env", "signer_address", "state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_signers_settings_idx" ON "app_smart_account_signers" USING btree ("solana_env", "settings_pda");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_smart_account_signers_user_idx" ON "app_smart_account_signers" USING btree ("user_id");
