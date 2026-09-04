CREATE TABLE "gasless_claim_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"solana_env" text NOT NULL,
	"signature" text NOT NULL,
	"transaction_type" text NOT NULL,
	"payer_address" text NOT NULL,
	"recipient_address" text,
	"slot" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"spent_lamports" numeric(30, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gasless_claim_transactions_type_check" CHECK ("gasless_claim_transactions"."transaction_type" IN ('store', 'verify_telegram_init_data', 'top_up_to_0_01_sol')),
	CONSTRAINT "gasless_claim_transactions_solana_env_check" CHECK ("gasless_claim_transactions"."solana_env" IN ('mainnet', 'devnet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gasless_claim_transactions_env_signature_uidx" ON "gasless_claim_transactions" USING btree ("solana_env","signature");--> statement-breakpoint
CREATE INDEX "gasless_claim_transactions_occurred_at_idx" ON "gasless_claim_transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "gasless_claim_transactions_type_occurred_at_idx" ON "gasless_claim_transactions" USING btree ("transaction_type","occurred_at");--> statement-breakpoint
CREATE INDEX "gasless_claim_transactions_recipient_address_idx" ON "gasless_claim_transactions" USING btree ("recipient_address");