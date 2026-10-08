CREATE TABLE "earn_max_invite_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"settings_pda" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "earn_max_invite_redemptions_code_uidx" ON "earn_max_invite_redemptions" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "earn_max_invite_redemptions_wallet_uidx" ON "earn_max_invite_redemptions" USING btree ("wallet_address");