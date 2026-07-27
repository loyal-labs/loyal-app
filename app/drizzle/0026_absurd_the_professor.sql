CREATE TABLE "telegram_relay_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_key" text NOT NULL,
	"state_version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_relay_state_state_key_uidx" ON "telegram_relay_state" USING btree ("state_key");