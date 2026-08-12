-- Idempotent: wallet_public_key + nullable telegram_user_id were applied
-- out-of-band while iterating on the Seeker wallet branch. Safe to replay
-- on any env.
ALTER TABLE "push_tokens" ALTER COLUMN "telegram_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "wallet_public_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_tokens_wallet_public_key_idx" ON "push_tokens" USING btree ("wallet_public_key");
