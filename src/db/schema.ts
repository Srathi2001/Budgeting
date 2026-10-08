import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  numeric,
  date,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { Assumptions } from '@/lib/engine/assumptions';

/** One cheque: date 'YYYY-MM-DD', amount ex VAT */
export interface ScheduleItem {
  date: string;
  amount: number;
}

// numeric columns come back as strings from pg; read them through `mode: 'number'`
const money = (name: string) => numeric(name, { precision: 16, scale: 2, mode: 'number' });
const decimal = (name: string) => numeric(name, { precision: 12, scale: 6, mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });

// FM: the Facilities Management department (enters the FM cost budget only)
export const roleEnum = pgEnum('role', ['ADMIN', 'FINANCE', 'PM', 'FM']);
export const versionStatusEnum = pgEnum('version_status', ['OPEN', 'LOCKED']);
export const submissionStatusEnum = pgEnum('submission_status', ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED']);
export const propertyKindEnum = pgEnum('property_kind', ['BUILDING', 'CAMP', 'MALL']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  /** Property coordinator code (PC column), e.g. RUCHI. Required for PMs. */
  coordinator: text('coordinator'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessUnits = pgTable('business_units', {
  code: text('code').primaryKey(), // 501, 502, 522
  name: text('name').notNull(), // REHL, MJN, ...
});

export const properties = pgTable('properties', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  buCode: text('bu_code').notNull().references(() => businessUnits.code),
  coordinator: text('coordinator'),
  kind: propertyKindEnum('kind').notNull().default('BUILDING'),
  /** Community (Al Qusais, Mirdiff, …); null = derived from the property name */
  location: text('location'),
  active: boolean('active').notNull().default(true),
  // Facilities Management master data (FMD budget file): fixed in the FM budget
  fmZone: text('fm_zone'),
  /** in service since (facility age) */
  fmActiveSince: day('fm_active_since'),
  /** gross building area, sq ft (FMD) */
  fmGrossArea: money('fm_gross_area'),
  /** HVAC assets by type (Chiller, CU, FCU, AHU, …) */
  fmAssets: jsonb('fm_assets').$type<Record<string, number>>(),
});

export const units = pgTable(
  'units',
  {
    id: serial('id').primaryKey(),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    unitCode: text('unit_code').notNull(),
    bedroom: text('bedroom'),
    area: money('area'),
    rc: text('rc').notNull().default('R'), // R / C / L
    pivotCategory: text('pivot_category'),
    unitType: text('unit_type'),
    rooms: integer('rooms'),
    capacity: integer('capacity'),
    // Fusion unit attributes (Unit Dump)
    mergedUnitNumber: text('merged_unit_number'),
    unitStatus: text('unit_status'), // Leased / Available / Pending …
    resiCommercial: text('resi_commercial'), // unit type as per Oracle (lease report)
    landlord: text('landlord'),
    /** Unit usage as per the Oracle Unit Dump: Residential / Commercial / Retail / Mixed Use */
    unitUsage: text('unit_usage'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('units_code_uq').on(t.unitCode), index('units_property_idx').on(t.propertyId)],
);

export const budgetVersions = pgTable('budget_versions', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  name: text('name').notNull(),
  status: versionStatusEnum('status').notNull().default('OPEN'),
  /** Imported baseline (e.g. 2026B from the Excel file) */
  isBaseline: boolean('is_baseline').notNull().default(false),
  sourceVersionId: integer('source_version_id'),
  assumptions: jsonb('assumptions').$type<Partial<Assumptions>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per unit per budget version: everything the PM enters in the template's Main sheet. */
export const leaseLines = pgTable(
  'lease_lines',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    unitId: integer('unit_id').notNull().references(() => units.id),
    propertyId: integer('property_id').notNull().references(() => properties.id),

    // ---- current lease: facts from Oracle Fusion (read-only in the tool) ----
    leaseNumber: text('lease_number'),
    leaseVersion: text('lease_version'),
    tenantCode: text('tenant_code'),
    customerClass: text('customer_class'),
    rentStart: day('rent_start'),
    leaseStatus: text('lease_status'),
    leaseRemarks: text('lease_remarks'),
    vatAmount: money('vat_amount'),
    leaseSyncedAt: timestamp('lease_synced_at', { withTimezone: true }),

    tenant: text('tenant'),
    vacant: boolean('vacant').notNull().default(false),
    staffOwner: text('staff_owner'), // STAFF / OWNER / null
    mfCurrent: boolean('mf_current'),

    currentRent: money('current_rent'),
    currentStart: day('current_start'),
    currentEnd: day('current_end'),
    /** Actual cheques of the current lease: from Fusion lease schedules (or entered until the sync exists). */
    currentSchedule: jsonb('current_schedule').$type<ScheduleItem[]>(),
    securityDeposit: money('security_deposit'),
    /** Other income billed with the current contract year (Oracle). Not part of rent revenue. */
    maintenanceFee: money('maintenance_fee'),
    /** Current lease, from the Oracle Maintenance Fee report: Yes / No / Waived Off, and payment status */
    mfStatus: text('mf_status'),
    mfPaid: money('mf_paid'),
    mfPaidDate: day('mf_paid_date'),
    mfOutstanding: money('mf_outstanding'),
    /** Budget input: MF on the renewal / new tenant: YES / NO / WAIVED; null = default (see lease engine) */
    mfRenewal: text('mf_renewal'),
    utilityFee: money('utility_fee'),
    carParkFee: money('car_park_fee'),

    renew1: boolean('renew1').notNull().default(true),
    noRenewal: boolean('no_renewal').notNull().default(false),
    /** New tenant: empty days between the lease end and the new tenant's start (entered per lease). */
    vacancyDays: integer('vacancy_days'),
    r1Rent: money('r1_rent'),
    r1Start: day('r1_start'),
    r1End: day('r1_end'),
    r1Mf: boolean('r1_mf'),
    /** Edited cheque schedule for the 1st renewal; null = equal cheques */
    r1Schedule: jsonb('r1_schedule').$type<ScheduleItem[]>(),

    r2Renew: boolean('r2_renew'),
    r2Rent: money('r2_rent'),
    r2Start: day('r2_start'),
    r2End: day('r2_end'),
    r2Mf: boolean('r2_mf'),
    r2Schedule: jsonb('r2_schedule').$type<ScheduleItem[]>(),

    r3Renew: boolean('r3_renew'),
    r3Rent: money('r3_rent'),
    r3Start: day('r3_start'),
    r3End: day('r3_end'),
    r3Mf: boolean('r3_mf'),
    r3Schedule: jsonb('r3_schedule').$type<ScheduleItem[]>(),
    /** How many of the renewals (1st, 2nd, 3rd) are contracted lease years loaded from the lease report (0–3). */
    contracted: integer('contracted').notNull().default(0),

    budgetRate: money('budget_rate'),
    increasePctOverride: decimal('increase_pct_override'),
    cheques: integer('cheques'),
    notes: text('notes'),

    /** Cached engine output: derived contracts, totals, warnings (see LeaseResult). */
    calc: jsonb('calc'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [
    uniqueIndex('lease_lines_version_unit_uq').on(t.versionId, t.unitId),
    index('lease_lines_version_property_idx').on(t.versionId, t.propertyId),
  ],
);

/** Engine output by month, denormalised for fast reporting. */
export const lineMonthly = pgTable(
  'line_monthly',
  {
    lineId: integer('line_id').notNull().references(() => leaseLines.id, { onDelete: 'cascade' }),
    versionId: integer('version_id').notNull(),
    propertyId: integer('property_id').notNull(),
    month: integer('month').notNull(),
    revenue: money('revenue').notNull().default(0),
    cash: money('cash').notNull().default(0),
    vat: money('vat').notNull().default(0),
    depositIn: money('deposit_in').notNull().default(0),
    depositOut: money('deposit_out').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.month] }), index('line_monthly_version_property_idx').on(t.versionId, t.propertyId)],
);

export const reraIndex = pgTable(
  'rera_index',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyCode: text('property_code').notNull(),
    bedroom: text('bedroom').notNull(),
    unitType: text('unit_type'),
    min: money('min').notNull(),
    max: money('max').notNull(),
  },
  (t) => [uniqueIndex('rera_uq').on(t.versionId, t.propertyCode, t.bedroom)],
);

/** Comparative figures shown in Revenue Analysis (e.g. 2026B, 2026F, 2025A) per property. */
export const comparatives = pgTable(
  'comparatives',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    label: text('label').notNull(),
    amount: money('amount'),
  },
  (t) => [uniqueIndex('comparatives_uq').on(t.versionId, t.propertyId, t.label)],
);

/**
 * Rent revenue recognised per property and month, from Oracle's Revenue Recognition Summary.
 * kind 'A' = accounted (actual), 'F' = Oracle's forecast from signed leases (reference only).
 * Facts, not budget inputs: shared by all versions; an import replaces its properties' rows.
 */
export const revenueActuals = pgTable(
  'revenue_actuals',
  {
    id: serial('id').primaryKey(),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    month: text('month').notNull(), // YYYY-MM
    kind: text('kind').notNull(),
    amount: money('amount').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('revenue_actuals_uq').on(t.propertyId, t.month, t.kind)],
);

/**
 * Other income by property (or a BU's "General" row for company-level items) × GL account × period.
 * Periods are relative to the version year Y: A2 = Y-3 actual, A1 = Y-2 actual, YTD = Y-1 Jan–Sep
 * actual, OD = Y-1 Oct–Dec (input), B = budget Y (input). Maintenance service fee B is calculated
 * from the leases and not stored here.
 */
export const otherIncome = pgTable(
  'other_income',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    buCode: text('bu_code').notNull().references(() => businessUnits.code),
    /** null = the BU's General row */
    propertyId: integer('property_id').references(() => properties.id),
    /** 'P:<property id>' or 'G:<bu code>' — one key for the unique index */
    scope: text('scope').notNull(),
    account: text('account').notNull(),
    period: text('period').notNull(),
    amount: money('amount'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [uniqueIndex('other_income_uq').on(t.versionId, t.scope, t.account, t.period), index('other_income_version_idx').on(t.versionId)],
);

export const propertyNotes = pgTable(
  'property_notes',
  {
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    comment: text('comment'),
    vacancyLossOverride: money('vacancy_loss_override'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.propertyId] })],
);

export const submissions = pgTable(
  'submissions',
  {
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    status: submissionStatusEnum('status').notNull().default('DRAFT'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.propertyId] })],
);

/**
 * Facilities Management budget: one line per facility × work type (M01–M04 maintain, R01–R04
 * renewal) × building element (GL 627xx; 117xx for capex). Entered by FMD; the 2026 lines come
 * from the FMD budget file. `month`: R lines in the month planned; null = spread over 12 months.
 */
export const fmLines = pgTable(
  'fm_lines',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    workType: text('work_type').notNull(), // M01 … R04
    element: text('element').notNull(), // building element, 2 digits (07); GL account = glOf(workType, element): 62707 / 11707
    subElement: text('sub_element'),
    description: text('description'),
    businessNeed: text('business_need'), // Statutory / Functional / Business-Critical / Optional
    kind: text('kind').notNull().default('PLANNED'), // PLANNED / PROVISIONAL / COMMITTED
    amount: money('amount').notNull().default(0),
    month: integer('month'),
    remarks: text('remarks'),
    /** FMD_2026: from the FMD file · CARRIED: last year's recurring line · FM: entered */
    source: text('source').notNull().default('FM'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [index('fm_lines_version_idx').on(t.versionId, t.propertyId)],
);

/** FM staff budget by team (cost to company + overtime); the G&A share is the team 'GA' (amount only). */
export const fmStaff = pgTable(
  'fm_staff',
  {
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    team: text('team').notNull(), // SUPERVISORY / ZONE_1 / ZONE_2 / ZONE_3 / PPM / VACANT / GA
    ctc: money('ctc').notNull().default(0),
    overtime: money('overtime').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.team] })],
);

/** FM budget approval per facility: FMD submits, Finance approves or returns (same statuses as revenue). */
export const fmSubmissions = pgTable(
  'fm_submissions',
  {
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    status: submissionStatusEnum('status').notNull().default('DRAFT'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.propertyId] })],
);

/** FM cost actuals from the GL (MJN HOLDING Account Analysis Report) by month: 627xx debit − credit, 117xx debits (see gl-fm.ts). */
export const fmActuals = pgTable(
  'fm_actuals',
  {
    id: serial('id').primaryKey(),
    propertyId: integer('property_id').references(() => properties.id),
    /** company of the GL line (501, 502, 503, 521, 522) */
    company: text('company').notNull(),
    workType: text('work_type').notNull(), // M01 … R04, or 000 when the GL line has none
    element: text('element').notNull(),
    month: text('month').notNull(), // YYYY-MM
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('fm_actuals_uq').on(t.company, t.propertyId, t.workType, t.element, t.month)],
);

/**
 * Building overhead actuals from the GL (MJN HOLDING Account Analysis Report): debit − credit per
 * building, natural account (the building overhead list) and month. Facts shared by all versions; an
 * import replaces the months the report covers. Company-level lines are G&A and not kept here.
 */
export const bohActuals = pgTable(
  'boh_actuals',
  {
    id: serial('id').primaryKey(),
    company: text('company').notNull(),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    account: text('account').notNull(),
    month: text('month').notNull(), // YYYY-MM
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('boh_actuals_uq').on(t.company, t.propertyId, t.account, t.month), index('boh_actuals_month_idx').on(t.month)],
);

/**
 * Building overhead budget: the year's amount per building and GL account, entered by the property
 * manager or Finance (by account). `dueMonth`: the month a lump-sum line is paid (civil
 * defence, service charges); null = the month of last year's largest payment.
 */
export const bohBudget = pgTable(
  'boh_budget',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    propertyId: integer('property_id').notNull().references(() => properties.id),
    account: text('account').notNull(),
    amount: money('amount').notNull(),
    dueMonth: integer('due_month'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [uniqueIndex('boh_budget_uq').on(t.versionId, t.propertyId, t.account)],
);

/**
 * G&A actuals from the GL (MJN HOLDING Account Analysis Report): payroll and admin overhead accounts by
 * company, department (cost centre) and month, debit − credit. Facts shared by all versions; an import
 * replaces the months the report covers.
 */
export const adminActuals = pgTable(
  'admin_actuals',
  {
    id: serial('id').primaryKey(),
    company: text('company').notNull(),
    dept: text('dept').notNull(), // cost centre, e.g. 201
    account: text('account').notNull(),
    month: text('month').notNull(), // YYYY-MM
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('admin_actuals_uq').on(t.company, t.dept, t.account, t.month), index('admin_actuals_month_idx').on(t.month)],
);

/**
 * Payroll budget per department (totals from HR, no employee data): current staff and new hires, and
 * the 2026 allocation rules: % capitalised to projects (PDD), % recharged to MJNH and to ASRE.
 * Null % = the default rule for the department.
 */
export const adminPayroll = pgTable(
  'admin_payroll',
  {
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    dept: text('dept').notNull(),
    headcount: integer('headcount'),
    ctc: money('ctc'),
    newHeadcount: integer('new_headcount'),
    newCtc: money('new_ctc'),
    capPct: decimal('cap_pct'),
    mjnhPct: decimal('mjnh_pct'),
    asrePct: decimal('asre_pct'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.dept] })],
);

/** Admin overheads budget: department × GL account × the company that pays it (ANPM 521, REHL 501, REHL-MJN 502). */
export const adminBudget = pgTable(
  'admin_budget',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    dept: text('dept').notNull(),
    account: text('account').notNull(),
    entity: text('entity').notNull(),
    amount: money('amount').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [uniqueIndex('admin_budget_uq').on(t.versionId, t.dept, t.account, t.entity)],
);

/**
 * Back-up schedules of the admin overheads, as the 2026 department templates' sheets: vehicles,
 * telephones, training plan, staff welfare events, IT equipment, office capex and other items. One row
 * per item; `data` holds its fields (by kind, see admin-types ITEM_KINDS). Each item posts to GL accounts.
 */
export const adminItems = pgTable(
  'admin_items',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** the department that owns the item (the training plan's postings go to the attendees' departments) */
    dept: text('dept').notNull(),
    /** company that pays it: 521 ANPM, 501 REHL, 502 REHL-MJN */
    payer: text('payer').notNull().default('521'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [index('admin_items_version_idx').on(t.versionId, t.kind)],
);

/** Asset value per landlord entity (501, 502, MALL), for the AMA fee to MJNH. */
export const adminAssets = pgTable(
  'admin_assets',
  {
    versionId: integer('version_id').notNull().references(() => budgetVersions.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    assetValue: money('asset_value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.entity] })],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: integer('user_id'),
    versionId: integer('version_id'),
    propertyId: integer('property_id'),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    action: text('action').notNull(),
    changes: jsonb('changes'),
  },
  (t) => [index('audit_version_property_idx').on(t.versionId, t.propertyId)],
);

export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type BudgetVersion = typeof budgetVersions.$inferSelect;
export type LeaseLine = typeof leaseLines.$inferSelect;
export type NewLeaseLine = typeof leaseLines.$inferInsert;
