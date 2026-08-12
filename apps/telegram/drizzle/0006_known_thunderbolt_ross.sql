CREATE TABLE "summary_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"summary_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_votes_action_check" CHECK ("summary_votes"."action" IN ('LIKE', 'DISLIKE'))
);
--> statement-breakpoint
ALTER TABLE "summary_votes" ADD CONSTRAINT "summary_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_votes" ADD CONSTRAINT "summary_votes_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "summary_votes_summary_user_uidx" ON "summary_votes" USING btree ("summary_id","user_id");--> statement-breakpoint
CREATE INDEX "summary_votes_summary_action_idx" ON "summary_votes" USING btree ("summary_id","action");