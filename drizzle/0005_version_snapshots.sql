CREATE TABLE "version_snapshots" (
	"version_id" integer NOT NULL,
	"part" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "version_snapshots_version_id_part_pk" PRIMARY KEY("version_id","part")
);
--> statement-breakpoint
ALTER TABLE "version_snapshots" ADD CONSTRAINT "version_snapshots_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;