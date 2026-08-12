CREATE TABLE "private_transfer_analytics_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_key" text NOT NULL,
	"backfill_cursor" text,
	"latest_seen_signature" text,
	"backfill_completed_at" timestamp with time zone,
	"last_run_started_at" timestamp with time zone,
	"last_run_finished_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_transfer_modify_balance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature" text NOT NULL,
	"instruction_index" integer NOT NULL,
	"slot" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"user_address" text NOT NULL,
	"vault_address" text NOT NULL,
	"token_mint" text NOT NULL,
	"flow" text NOT NULL,
	"amount_raw" numeric(30, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_transfer_modify_balance_events_flow_check" CHECK ("private_transfer_modify_balance_events"."flow" IN ('shield', 'unshield'))
);
--> statement-breakpoint
CREATE TABLE "private_transfer_token_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_mint" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer NOT NULL,
	"last_price_usd" numeric(30, 12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_transfer_vault_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_address" text NOT NULL,
	"token_account_address" text NOT NULL,
	"token_mint" text NOT NULL,
	"amount_raw" numeric(30, 0) NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "private_transfer_analytics_sync_state_sync_key_uidx" ON "private_transfer_analytics_sync_state" USING btree ("sync_key");--> statement-breakpoint
CREATE UNIQUE INDEX "private_transfer_modify_balance_events_signature_instruction_uidx" ON "private_transfer_modify_balance_events" USING btree ("signature","instruction_index");--> statement-breakpoint
CREATE INDEX "private_transfer_modify_balance_events_occurred_at_idx" ON "private_transfer_modify_balance_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "private_transfer_modify_balance_events_token_mint_idx" ON "private_transfer_modify_balance_events" USING btree ("token_mint");--> statement-breakpoint
CREATE INDEX "private_transfer_modify_balance_events_flow_occurred_at_idx" ON "private_transfer_modify_balance_events" USING btree ("flow","occurred_at");--> statement-breakpoint
CREATE INDEX "private_transfer_modify_balance_events_vault_address_idx" ON "private_transfer_modify_balance_events" USING btree ("vault_address");--> statement-breakpoint
CREATE UNIQUE INDEX "private_transfer_token_catalog_token_mint_uidx" ON "private_transfer_token_catalog" USING btree ("token_mint");--> statement-breakpoint
CREATE UNIQUE INDEX "private_transfer_vault_holdings_vault_address_uidx" ON "private_transfer_vault_holdings" USING btree ("vault_address");--> statement-breakpoint
CREATE UNIQUE INDEX "private_transfer_vault_holdings_token_account_address_uidx" ON "private_transfer_vault_holdings" USING btree ("token_account_address");--> statement-breakpoint
CREATE INDEX "private_transfer_vault_holdings_token_mint_idx" ON "private_transfer_vault_holdings" USING btree ("token_mint");