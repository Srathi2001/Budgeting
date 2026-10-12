CREATE TABLE "budget_reference" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"module" text NOT NULL,
	"property_id" integer,
	"scope" text NOT NULL,
	"account" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"note" text,
	"source" text,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_reference" ADD CONSTRAINT "budget_reference_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reference_uq" ON "budget_reference" USING btree ("year","module","scope","account");