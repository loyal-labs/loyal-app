CREATE TABLE "earn_yield_push_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_public_key" text NOT NULL,
	"last_pushed_earned_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"last_pushed_at" timestamp with time zone,
	"sent_campaigns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "earn_yield_push_state_wallet_uidx" ON "earn_yield_push_state" USING btree ("wallet_public_key");