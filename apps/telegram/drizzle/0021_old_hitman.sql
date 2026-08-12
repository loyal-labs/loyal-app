CREATE TABLE "app_smart_account_sponsorship_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"solana_env" text NOT NULL,
	"signature" text NOT NULL,
	"payer_address" text NOT NULL,
	"user_address" text NOT NULL,
	"settings_pda" text NOT NULL,
	"smart_account_address" text NOT NULL,
	"slot" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"spent_lamports" numeric(30, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_smart_account_sponsorship_tx_solana_env_check" CHECK ("app_smart_account_sponsorship_transactions"."solana_env" IN ('mainnet', 'testnet', 'devnet', 'localnet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_smart_account_sponsorship_tx_env_signature_uidx" ON "app_smart_account_sponsorship_transactions" USING btree ("solana_env","signature");--> statement-breakpoint
CREATE INDEX "app_smart_account_sponsorship_tx_occurred_at_idx" ON "app_smart_account_sponsorship_transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "app_smart_account_sponsorship_tx_user_address_idx" ON "app_smart_account_sponsorship_transactions" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "app_smart_account_sponsorship_tx_smart_account_idx" ON "app_smart_account_sponsorship_transactions" USING btree ("smart_account_address");