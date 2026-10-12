CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "entity_budget" (
	"version_id" integer NOT NULL,
	"entity" text NOT NULL,
	"line" text NOT NULL,
	"amount" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "entity_budget_version_id_entity_line_pk" PRIMARY KEY("version_id","entity","line")
);
--> statement-breakpoint
ALTER TABLE "entity_budget" ADD CONSTRAINT "entity_budget_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ASRE (Arabian Spaces Real Estate), the mall operator: a group entity with its own budget lines (blank until its finance team sends them)
INSERT INTO "business_units" ("code", "name") VALUES ('ASRE', 'ASRE') ON CONFLICT DO NOTHING;
