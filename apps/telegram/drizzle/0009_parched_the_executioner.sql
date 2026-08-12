ALTER TABLE "communities" ADD COLUMN "parser_type" text DEFAULT 'bot' NOT NULL;--> statement-breakpoint
CREATE INDEX "communities_is_active_parser_type_idx" ON "communities" USING btree ("is_active","parser_type");--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_parser_type_check" CHECK ("communities"."parser_type" IN ('bot', 'userbot'));