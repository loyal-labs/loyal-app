CREATE TABLE "business_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_connection_id" text NOT NULL,
	"user_chat_id" bigint NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"rights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_connections" ADD CONSTRAINT "business_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_connections_user_id_idx" ON "business_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "business_connections_is_enabled_idx" ON "business_connections" USING btree ("is_enabled");