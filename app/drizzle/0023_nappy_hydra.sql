CREATE TABLE "helius_webhook_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"address" text NOT NULL,
	"wallet_public_key" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helius_webhook_deliveries" (
	"signature" text NOT NULL,
	"wallet_public_key" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helius_webhook_deliveries_signature_wallet_public_key_pk" PRIMARY KEY("signature","wallet_public_key")
);
--> statement-breakpoint
CREATE TABLE "helius_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"helius_webhook_id" text NOT NULL,
	"webhook_url" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"address_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helius_webhook_addresses" ADD CONSTRAINT "helius_webhook_addresses_webhook_id_helius_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."helius_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helius_webhook_addresses_address_unique" ON "helius_webhook_addresses" USING btree ("address");--> statement-breakpoint
CREATE INDEX "helius_webhook_addresses_wallet_idx" ON "helius_webhook_addresses" USING btree ("wallet_public_key");--> statement-breakpoint
CREATE INDEX "helius_webhook_addresses_webhook_idx" ON "helius_webhook_addresses" USING btree ("webhook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "helius_webhooks_helius_id_unique" ON "helius_webhooks" USING btree ("helius_webhook_id");
