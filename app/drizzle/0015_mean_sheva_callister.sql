CREATE TABLE "trusted_dapps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" text NOT NULL,
	"name" text NOT NULL,
	"start_url" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_dapps_origin_uidx" ON "trusted_dapps" USING btree ("origin");--> statement-breakpoint
CREATE INDEX "trusted_dapps_active_order_idx" ON "trusted_dapps" USING btree ("is_active","display_order");