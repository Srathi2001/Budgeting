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

export const roleEnum = pgEnum('role', ['ADMIN', 'FINANCE', 'PM']);
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
    resiCommercial: text('resi_commercial'), // unit usage as per Fusion
    landlord: text('landlord'),
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
    utilityFee: money('utility_fee'),
    carParkFee: money('car_park_fee'),

    renew1: boolean('renew1').notNull().default(true),
    noRenewal: boolean('no_renewal').notNull().default(false),
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
