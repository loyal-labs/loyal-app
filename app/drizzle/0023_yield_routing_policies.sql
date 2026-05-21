CREATE TABLE IF NOT EXISTS "app_smart_account_vault_yield_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"smart_account_id" uuid NOT NULL,
	"solana_env" text NOT NULL,
	"settings_pda" text NOT NULL,
	"vault_address" text NOT NULL,
	"account_index" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"route_mint" text NOT NULL,
	"rebalance_policy_pda" text NOT NULL,
	"rebalance_policy_seed" text NOT NULL,
	"delegated_signer" text NOT NULL,
	"allowed_reserves" jsonb NOT NULL,
	"allowed_markets" jsonb NOT NULL,
	"allowed_liquidity_mints" jsonb NOT NULL,
	"creation_signature" text,
	"last_cranked_at" timestamp with time zone,
	"next_crank_after" timestamp with time zone,
	"last_crank_signature" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_vault_yield_policy_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "app_vault_yield_policy_smart_account_id_fk" FOREIGN KEY ("smart_account_id") REFERENCES "public"."app_user_smart_accounts"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "app_vault_yield_policy_solana_env_check" CHECK ("app_smart_account_vault_yield_policies"."solana_env" IN ('mainnet', 'testnet', 'devnet', 'localnet')),
	CONSTRAINT "app_vault_yield_policy_kind_check" CHECK ("app_smart_account_vault_yield_policies"."kind" IN ('kamino_rebalance')),
	CONSTRAINT "app_vault_yield_policy_state_check" CHECK ("app_smart_account_vault_yield_policies"."state" IN ('active', 'paused', 'failed', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_vault_yield_policy_env_policy_uidx" ON "app_smart_account_vault_yield_policies" USING btree ("solana_env","rebalance_policy_pda");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_vault_yield_policy_env_vault_mint_uidx" ON "app_smart_account_vault_yield_policies" USING btree ("solana_env","settings_pda","account_index","route_mint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_vault_yield_policy_user_id_idx" ON "app_smart_account_vault_yield_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_vault_yield_policy_smart_account_id_idx" ON "app_smart_account_vault_yield_policies" USING btree ("smart_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_vault_yield_policy_next_crank_idx" ON "app_smart_account_vault_yield_policies" USING btree ("state","next_crank_after");
