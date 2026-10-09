CREATE TYPE "public"."property_kind" AS ENUM('BUILDING', 'CAMP', 'MALL');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'FINANCE', 'PM', 'FM');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('OPEN', 'LOCKED');--> statement-breakpoint
CREATE TABLE "admin_actuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"dept" text NOT NULL,
	"account" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_budget" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"dept" text NOT NULL,
	"account" text NOT NULL,
	"entity" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "admin_fees" (
	"version_id" integer NOT NULL,
	"fee" text NOT NULL,
	"entity" text NOT NULL,
	"rate" numeric(16, 10),
	"base" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "admin_fees_version_id_fee_entity_pk" PRIMARY KEY("version_id","fee","entity")
);
--> statement-breakpoint
CREATE TABLE "admin_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"kind" text NOT NULL,
	"dept" text NOT NULL,
	"payer" text DEFAULT '521' NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "admin_payroll" (
	"version_id" integer NOT NULL,
	"dept" text NOT NULL,
	"headcount" integer,
	"ctc" numeric(16, 2),
	"new_headcount" integer,
	"new_ctc" numeric(16, 2),
	"cap_pct" numeric(12, 6),
	"mjnh_pct" numeric(12, 6),
	"asre_pct" numeric(12, 6),
	"senior_ctc" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "admin_payroll_version_id_dept_pk" PRIMARY KEY("version_id","dept")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"version_id" integer,
	"property_id" integer,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"changes" jsonb
);
--> statement-breakpoint
CREATE TABLE "boh_actuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"property_id" integer NOT NULL,
	"account" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boh_budget" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"account" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"due_month" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "boh_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"kind" text NOT NULL,
	"account" text NOT NULL,
	"supplier" text,
	"description" text,
	"terms" text DEFAULT 'Monthly' NOT NULL,
	"quantity" numeric(12, 6) DEFAULT 12 NOT NULL,
	"rate" numeric(16, 2) DEFAULT 0 NOT NULL,
	"start_month" integer,
	"remarks" text,
	"source" text DEFAULT 'PM' NOT NULL,
	"po_number" text,
	"po_line" text,
	"po_category" text,
	"po_status" text,
	"po_quantity" numeric(12, 6),
	"po_rate" numeric(16, 2),
	"po_amount" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "boh_insurance" (
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"insured_value" numeric(16, 2),
	"par_rate" numeric(16, 10),
	"pl_premium" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "boh_insurance_version_id_property_id_pk" PRIMARY KEY("version_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "boh_watchmen" (
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"share" numeric(12, 6) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "boh_watchmen_version_id_property_id_pk" PRIMARY KEY("version_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "budget_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"status" "version_status" DEFAULT 'OPEN' NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"source_version_id" integer,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_units" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "fm_actuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer,
	"company" text NOT NULL,
	"work_type" text NOT NULL,
	"element" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fm_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"work_type" text NOT NULL,
	"element" text NOT NULL,
	"sub_element" text,
	"description" text,
	"business_need" text,
	"kind" text DEFAULT 'PLANNED' NOT NULL,
	"amount" numeric(16, 2) DEFAULT 0 NOT NULL,
	"month" integer,
	"remarks" text,
	"source" text DEFAULT 'FM' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "fm_staff" (
	"version_id" integer NOT NULL,
	"team" text NOT NULL,
	"ctc" numeric(16, 2) DEFAULT 0 NOT NULL,
	"overtime" numeric(16, 2) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "fm_staff_version_id_team_pk" PRIMARY KEY("version_id","team")
);
--> statement-breakpoint
CREATE TABLE "fm_submissions" (
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"status" "submission_status" DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "fm_submissions_version_id_property_id_pk" PRIMARY KEY("version_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "lease_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"lease_number" text,
	"lease_version" text,
	"tenant_code" text,
	"customer_class" text,
	"rent_start" date,
	"lease_status" text,
	"lease_remarks" text,
	"vat_amount" numeric(16, 2),
	"lease_synced_at" timestamp with time zone,
	"tenant" text,
	"vacant" boolean DEFAULT false NOT NULL,
	"staff_owner" text,
	"mf_current" boolean,
	"current_rent" numeric(16, 2),
	"current_start" date,
	"current_end" date,
	"current_schedule" jsonb,
	"security_deposit" numeric(16, 2),
	"maintenance_fee" numeric(16, 2),
	"mf_status" text,
	"mf_paid" numeric(16, 2),
	"mf_paid_date" date,
	"mf_outstanding" numeric(16, 2),
	"mf_renewal" text,
	"utility_fee" numeric(16, 2),
	"car_park_fee" numeric(16, 2),
	"renew1" boolean DEFAULT true NOT NULL,
	"no_renewal" boolean DEFAULT false NOT NULL,
	"vacancy_days" integer,
	"r1_rent" numeric(16, 2),
	"r1_start" date,
	"r1_end" date,
	"r1_mf" boolean,
	"r1_schedule" jsonb,
	"r2_renew" boolean,
	"r2_rent" numeric(16, 2),
	"r2_start" date,
	"r2_end" date,
	"r2_mf" boolean,
	"r2_schedule" jsonb,
	"r3_renew" boolean,
	"r3_rent" numeric(16, 2),
	"r3_start" date,
	"r3_end" date,
	"r3_mf" boolean,
	"r3_schedule" jsonb,
	"contracted" integer DEFAULT 0 NOT NULL,
	"budget_rate" numeric(16, 2),
	"increase_pct_override" numeric(12, 6),
	"cheques" integer,
	"notes" text,
	"calc" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "line_monthly" (
	"line_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"month" integer NOT NULL,
	"revenue" numeric(16, 2) DEFAULT 0 NOT NULL,
	"cash" numeric(16, 2) DEFAULT 0 NOT NULL,
	"vat" numeric(16, 2) DEFAULT 0 NOT NULL,
	"deposit_in" numeric(16, 2) DEFAULT 0 NOT NULL,
	"deposit_out" numeric(16, 2) DEFAULT 0 NOT NULL,
	CONSTRAINT "line_monthly_line_id_month_pk" PRIMARY KEY("line_id","month")
);
--> statement-breakpoint
CREATE TABLE "other_income" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"bu_code" text NOT NULL,
	"property_id" integer,
	"scope" text NOT NULL,
	"account" text NOT NULL,
	"period" text NOT NULL,
	"amount" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"bu_code" text NOT NULL,
	"coordinator" text,
	"kind" "property_kind" DEFAULT 'BUILDING' NOT NULL,
	"location" text,
	"active" boolean DEFAULT true NOT NULL,
	"fm_zone" text,
	"fm_active_since" date,
	"fm_gross_area" numeric(16, 2),
	"fm_assets" jsonb,
	CONSTRAINT "properties_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "property_notes" (
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"comment" text,
	"vacancy_loss_override" numeric(16, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "property_notes_version_id_property_id_pk" PRIMARY KEY("version_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "rera_index" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"property_code" text NOT NULL,
	"bedroom" text NOT NULL,
	"unit_type" text,
	"min" numeric(16, 2) NOT NULL,
	"max" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_actuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"version_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"status" "submission_status" DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "submissions_version_id_property_id_pk" PRIMARY KEY("version_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"unit_code" text NOT NULL,
	"bedroom" text,
	"area" numeric(16, 2),
	"rc" text DEFAULT 'R' NOT NULL,
	"pivot_category" text,
	"unit_type" text,
	"rooms" integer,
	"capacity" integer,
	"merged_unit_number" text,
	"unit_status" text,
	"resi_commercial" text,
	"landlord" text,
	"unit_usage" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"coordinator" text,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "admin_budget" ADD CONSTRAINT "admin_budget_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_fees" ADD CONSTRAINT "admin_fees_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_items" ADD CONSTRAINT "admin_items_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_payroll" ADD CONSTRAINT "admin_payroll_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_actuals" ADD CONSTRAINT "boh_actuals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_budget" ADD CONSTRAINT "boh_budget_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_budget" ADD CONSTRAINT "boh_budget_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD CONSTRAINT "boh_contracts_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_contracts" ADD CONSTRAINT "boh_contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_insurance" ADD CONSTRAINT "boh_insurance_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_insurance" ADD CONSTRAINT "boh_insurance_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_watchmen" ADD CONSTRAINT "boh_watchmen_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boh_watchmen" ADD CONSTRAINT "boh_watchmen_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparatives" ADD CONSTRAINT "comparatives_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparatives" ADD CONSTRAINT "comparatives_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fm_actuals" ADD CONSTRAINT "fm_actuals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fm_lines" ADD CONSTRAINT "fm_lines_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fm_lines" ADD CONSTRAINT "fm_lines_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fm_staff" ADD CONSTRAINT "fm_staff_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fm_submissions" ADD CONSTRAINT "fm_submissions_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fm_submissions" ADD CONSTRAINT "fm_submissions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_lines" ADD CONSTRAINT "lease_lines_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_lines" ADD CONSTRAINT "lease_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_lines" ADD CONSTRAINT "lease_lines_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_monthly" ADD CONSTRAINT "line_monthly_line_id_lease_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."lease_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_bu_code_business_units_code_fk" FOREIGN KEY ("bu_code") REFERENCES "public"."business_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_bu_code_business_units_code_fk" FOREIGN KEY ("bu_code") REFERENCES "public"."business_units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_notes" ADD CONSTRAINT "property_notes_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_notes" ADD CONSTRAINT "property_notes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rera_index" ADD CONSTRAINT "rera_index_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_actuals" ADD CONSTRAINT "revenue_actuals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_version_id_budget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_actuals_uq" ON "admin_actuals" USING btree ("company","dept","account","month");--> statement-breakpoint
CREATE INDEX "admin_actuals_month_idx" ON "admin_actuals" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_budget_uq" ON "admin_budget" USING btree ("version_id","dept","account","entity");--> statement-breakpoint
CREATE INDEX "admin_items_version_idx" ON "admin_items" USING btree ("version_id","kind");--> statement-breakpoint
CREATE INDEX "audit_version_property_idx" ON "audit_log" USING btree ("version_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boh_actuals_uq" ON "boh_actuals" USING btree ("company","property_id","account","month");--> statement-breakpoint
CREATE INDEX "boh_actuals_month_idx" ON "boh_actuals" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "boh_budget_uq" ON "boh_budget" USING btree ("version_id","property_id","account");--> statement-breakpoint
CREATE INDEX "boh_contracts_version_idx" ON "boh_contracts" USING btree ("version_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boh_contracts_po_uq" ON "boh_contracts" USING btree ("version_id","po_number","po_line","property_id","account");--> statement-breakpoint
CREATE UNIQUE INDEX "comparatives_uq" ON "comparatives" USING btree ("version_id","property_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "fm_actuals_uq" ON "fm_actuals" USING btree ("company","property_id","work_type","element","month");--> statement-breakpoint
CREATE INDEX "fm_lines_version_idx" ON "fm_lines" USING btree ("version_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_lines_version_unit_uq" ON "lease_lines" USING btree ("version_id","unit_id");--> statement-breakpoint
CREATE INDEX "lease_lines_version_property_idx" ON "lease_lines" USING btree ("version_id","property_id");--> statement-breakpoint
CREATE INDEX "line_monthly_version_property_idx" ON "line_monthly" USING btree ("version_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "other_income_uq" ON "other_income" USING btree ("version_id","scope","account","period");--> statement-breakpoint
CREATE INDEX "other_income_version_idx" ON "other_income" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rera_uq" ON "rera_index" USING btree ("version_id","property_code","bedroom");--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_actuals_uq" ON "revenue_actuals" USING btree ("property_id","month","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_uq" ON "units" USING btree ("unit_code");--> statement-breakpoint
CREATE INDEX "units_property_idx" ON "units" USING btree ("property_id");