CREATE TABLE "import_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"kind" text NOT NULL,
	"ledger" text,
	"version_id" integer,
	"table_name" text NOT NULL,
	"scope" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"removed" integer NOT NULL,
	"inserted" integer NOT NULL,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" integer
);
--> statement-breakpoint
CREATE INDEX "import_history_plan_idx" ON "import_history" USING btree ("plan_id");