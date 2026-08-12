-- Idempotent: safe to replay on any env.
CREATE TABLE IF NOT EXISTS "wallet_push_sync_state" (
	"wallet_public_key" text PRIMARY KEY NOT NULL,
	"last_signature" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
