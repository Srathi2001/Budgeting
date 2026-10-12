CREATE TABLE "contingencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"entity" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"amount" numeric(16, 2) DEFAULT 0 NOT NULL,
	"phasing" text DEFAULT 'EVEN' NOT NULL,
	"month" integer,
	"cash" boolean DEFAULT true NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "fixed_deposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"bank" text NOT NULL,
	"reference" text,
	"entity" text NOT NULL,
	"amount" numeric(16, 2) DEFAULT 0 NOT NULL,
	"placement_date" date,
	"maturity_date" date,
	"rate" numeric(12, 6) DEFAULT 0 NOT NULL,
	"day_basis" text DEFAULT 'ACT/365' NOT NULL,
	"interest_payout" text DEFAULT 'MATURITY' NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"rollover_rate" numeric(12, 6),
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "loan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shareholder_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"name" text NOT NULL,
	"lender" text,
	"entity" text NOT NULL,
	"principal" numeric(16, 2),
	"opening_balance" numeric(16, 2) DEFAULT 0 NOT NULL,
	"rate" numeric(12, 6) DEFAULT 0 NOT NULL,
	"day_basis" text DEFAULT 'ACT/365' NOT NULL,
	"interest_frequency" text DEFAULT 'Quarterly' NOT NULL,
	"first_interest_date" date,
	"repayment_type" text DEFAULT 'EQUAL_PRINCIPAL' NOT NULL,
	"repayment_frequency" text DEFAULT 'Quarterly' NOT NULL,
	"first_repayment_date" date,
	"maturity_date" date,
	"capitalise_pct" numeric(12, 6) DEFAULT 0 NOT NULL,
	"capitalise_project" text,
	"contribution_lag_months" integer,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD COLUMN "renewal" text;--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD COLUMN "renewal_rate" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD COLUMN "renewal_terms" text;--> statement-breakpoint
ALTER TABLE "contingencies" ADD CONSTRAINT "contingencies_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_loan_id_shareholder_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."shareholder_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shareholder_loans" ADD CONSTRAINT "shareholder_loans_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contingencies_version_idx" ON "contingencies" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "fixed_deposits_version_idx" ON "fixed_deposits" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "shareholder_loans_version_idx" ON "shareholder_loans" USING btree ("version_id");