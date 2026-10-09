CREATE TABLE "import_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version_id" integer,
	"user_id" integer,
	"file" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "import_plans" ADD CONSTRAINT "import_plans_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_plans_user_idx" ON "import_plans" USING btree ("user_id","created_at");