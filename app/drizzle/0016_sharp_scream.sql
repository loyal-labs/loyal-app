-- Idempotent catch-up for library_* tables (applied to prod out-of-band via
-- #282) and the push_tokens identity extension. Safe to replay on any env.
CREATE TABLE IF NOT EXISTS "library_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"title" text NOT NULL,
	"cover_image_url" text NOT NULL,
	"content_markdown" text NOT NULL,
	"read_time" text NOT NULL,
	"excerpt" text,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ALTER COLUMN "telegram_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "wallet_public_key" text;--> statement-breakpoint
ALTER TABLE "library_articles" DROP CONSTRAINT IF EXISTS "library_articles_section_id_library_sections_id_fk";--> statement-breakpoint
ALTER TABLE "library_articles" ADD CONSTRAINT "library_articles_section_id_library_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."library_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_articles_section_order_idx" ON "library_articles" USING btree ("section_id","is_active","display_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_articles_featured_idx" ON "library_articles" USING btree ("is_featured","is_active","display_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_sections_active_order_idx" ON "library_sections" USING btree ("is_active","display_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_tokens_wallet_public_key_idx" ON "push_tokens" USING btree ("wallet_public_key");
