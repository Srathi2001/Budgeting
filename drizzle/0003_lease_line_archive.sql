CREATE TABLE "lease_line_archive" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"property_id" integer,
	"unit_code" text,
	"line" jsonb NOT NULL,
	"had_inputs" boolean DEFAULT false NOT NULL,
	"plan_id" integer,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" integer
);
--> statement-breakpoint
ALTER TABLE "lease_line_archive" ADD CONSTRAINT "lease_line_archive_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lease_line_archive_version_idx" ON "lease_line_archive" USING btree ("version_id","property_id");