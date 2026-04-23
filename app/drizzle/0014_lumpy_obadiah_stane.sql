CREATE TABLE "feature_app_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_id" uuid NOT NULL,
	"app" text NOT NULL,
	"status" text NOT NULL,
	"status_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_app_statuses_app_check" CHECK ("feature_app_statuses"."app" IN ('telegram_miniapp', 'website', 'mobile', 'extension')),
	CONSTRAINT "feature_app_statuses_status_check" CHECK ("feature_app_statuses"."status" IN ('missing', 'planned', 'in_progress', 'implemented', 'live'))
);
--> statement-breakpoint
CREATE TABLE "feature_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_app_status_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_evidence_type_check" CHECK ("feature_evidence"."type" IN ('path', 'branch', 'pr', 'linear', 'commit', 'doc'))
);
--> statement-breakpoint
CREATE TABLE "feature_flag_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_id" uuid NOT NULL,
	"flag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"owner" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"audience" text NOT NULL,
	"target_environments" jsonb DEFAULT '["development","preview","production"]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_flags_audience_check" CHECK ("runtime_flags"."audience" IN ('all', 'public', 'team')),
	CONSTRAINT "runtime_flags_target_environments_check" CHECK (jsonb_typeof("runtime_flags"."target_environments") = 'array' AND "runtime_flags"."target_environments" <@ '["development","preview","production"]'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "feature_app_statuses" ADD CONSTRAINT "feature_app_statuses_feature_id_feature_registry_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."feature_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_evidence" ADD CONSTRAINT "feature_evidence_feature_app_status_id_feature_app_statuses_id_fk" FOREIGN KEY ("feature_app_status_id") REFERENCES "public"."feature_app_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_links" ADD CONSTRAINT "feature_flag_links_feature_id_feature_registry_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."feature_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_links" ADD CONSTRAINT "feature_flag_links_flag_id_runtime_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."runtime_flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_evidence_feature_app_status_id_idx" ON "feature_evidence" USING btree ("feature_app_status_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_app_statuses_feature_app_idx" ON "feature_app_statuses" USING btree ("feature_id","app");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_links_unique_idx" ON "feature_flag_links" USING btree ("feature_id","flag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_registry_key_idx" ON "feature_registry" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_flags_key_idx" ON "runtime_flags" USING btree ("key");
