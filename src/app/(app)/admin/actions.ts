'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireAdmin } from '@/lib/auth/dal';
import { recalcLines } from '@/lib/budget/calc';
import { lockJob, writeGuard } from '@/lib/write-guard';
import { rollForward } from '@/lib/budget/rollforward';
import { getSettings, settingsChanged, DEFAULT_SETTINGS, type AppSettings } from '@/lib/settings';
import { DEFAULT_ASSUMPTIONS, type AdminAssumptions } from '@/lib/engine/assumptions';
import type { ImportExtras, ImportPreview, ReportRow } from '@/lib/import/tenant-lease';
import { glOtherIncomeScope, isGlLedger, type GlPreview } from '@/lib/import/gl-other-income';
import { countInScope, dropsTooMuch, keepReplaced, type GlScope, type GlTable } from '@/lib/import/gl-history';
import type { RrPreview } from '@/lib/import/revenue-recognition';

import { changedFields, pick } from '@/lib/audit-diff';

type Result = { error?: string; ok?: string };

async function audit(userId: number, versionId: number | null, entity: string, action: string, changes: unknown) {
  await db.insert(schema.auditLog).values({ userId, versionId, entity, action, changes });
}

const wrap = async (fn: () => Promise<string | void>): Promise<Result> => {
  try {
    const ok = await fn();
    revalidatePath('/', 'layout');
    return { ok: ok || 'Saved' };
  } catch (e) {
    return { error: (e as Error).message };
  }
};

// ---- versions -------------------------------------------------------------------------------

export async function setVersionStatus(versionId: number, status: 'OPEN' | 'LOCKED', reason?: string | null): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    if (!v) throw new Error('Version not found');
    if (status === 'OPEN') {
      // the imported baseline is the approved budget: it stays as it was approved
      if (v.isBaseline) throw new Error(`${v.name} is the approved baseline: it cannot be reopened`);
      if (!reason?.trim()) throw new Error('Give a reason for reopening it');
    }
    if (status === 'LOCKED') {
      // one approved (locked) version per year: it is "last year's budget" for the year after (prior-version.ts)
      const same = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.year, v.year));
      const other = same.find((x) => x.id !== v.id && x.status === 'LOCKED');
      if (other) throw new Error(`${other.name} is already the approved ${v.year} budget: only one version of a year can be locked`);
    }
    const why = reason?.trim().slice(0, 2000) || null;
    if (status === 'OPEN') {
      // reopening drops the snapshot so the version follows the live data again
      await db.transaction(async (tx) => {
        const cur = await writeGuard(tx, versionId, { versionUpdate: true });
        if (!cur) throw new Error('Version not found');
        await tx.delete(schema.versionSnapshots).where(eq(schema.versionSnapshots.versionId, versionId));
        await tx.update(schema.budgetVersions).set({ status }).where(eq(schema.budgetVersions.id, versionId));
        await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'version', action: 'unlock', changes: { from: cur.status, to: status, reason: why } });
      });
      return 'Version reopened';
    }
    // 1. the lock: waits for the saves running now (they hold the version row), and every save after it sees
    //    LOCKED inside its own transaction, so nothing can change the version's inputs any more
    await db
      .transaction(async (tx) => {
        const cur = await writeGuard(tx, versionId, { versionUpdate: true, leases: true });
        if (!cur) throw new Error('Version not found');
        await tx.update(schema.budgetVersions).set({ status }).where(eq(schema.budgetVersions.id, versionId));
        await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'version', action: 'lock', changes: { from: cur.status, to: status, reason: why } });
      })
      .catch((e: Error) => {
        // two versions of a year locked at the same moment: the database keeps one (budget_versions_one_locked_per_year)
        if (/one_locked_per_year/.test(String((e.cause as Error | undefined)?.message ?? e.message))) throw new Error(`Another ${v.year} version was just locked: only one version of a year can be locked`);
        throw e;
      });
    // 2. the freeze: what is otherwise worked out live (comparatives, forecast, building overheads, fees),
    //    worked out from the inputs as they were locked
    try {
      const parts = await (await import('@/lib/budget/snapshot')).takeSnapshot(v);
      await db.transaction(async (tx) => {
        const cur = await writeGuard(tx, versionId, { versionUpdate: true });
        if (cur?.status !== 'LOCKED') return; // reopened meanwhile: nothing to freeze
        await tx.delete(schema.versionSnapshots).where(eq(schema.versionSnapshots.versionId, versionId));
        for (const p of parts) await tx.insert(schema.versionSnapshots).values({ versionId, part: p.part, data: p.data, createdBy: user.id });
      });
    } catch (e) {
      // without its snapshot the version can't stay locked: back to open, and say so
      await db.transaction(async (tx) => {
        await writeGuard(tx, versionId, { versionUpdate: true });
        await tx.update(schema.budgetVersions).set({ status: 'OPEN' }).where(eq(schema.budgetVersions.id, versionId));
        await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'version', action: 'unlock', changes: { from: 'LOCKED', to: 'OPEN', reason: `Freezing the figures failed: ${(e as Error).message}`.slice(0, 2000) } });
      });
      throw new Error(`The version could not be locked: ${(e as Error).message}`);
    }
    return 'Version locked';
  });
}

export async function createNextVersion(sourceVersionId: number, name: string): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const v = await rollForward(db, sourceVersionId, { name: name.trim() || undefined, userId: user.id });
    await audit(user.id, v.id, 'version', 'create', { from: sourceVersionId, name: v.name });
    return `Created ${v.name}`;
  });
}

export async function recalcVersion(versionId: number): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    // a locked version keeps its stored results (unit details are shared with later years); the imported
    // baseline keeps the figures of the approved workbook
    if (!v) throw new Error('Version not found');
    if (v.isBaseline) throw new Error(`${v.name} is the approved baseline: its figures are kept as imported`);
    if (v.status === 'LOCKED') throw new Error(`${v.name} is locked: its figures are kept as they were`);
    await db.transaction(async (tx) => {
      // after the lease saves running now; the version can't be locked until this commits
      const cur = await writeGuard(tx, versionId, { leases: true });
      if (cur?.status === 'LOCKED') throw new Error(`${v.name} is locked: its figures are kept as they were`);
      await recalcLines(tx, versionId);
      await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'version', action: 'recalculate', changes: null });
    });
    return 'Recalculated';
  });
}

// ---- assumptions ----------------------------------------------------------------------------

const AssumptionsSchema = z.object({
  renewalTermDays: z.number().int().min(28).max(3650),
  defaultVacancyDays: z.number().int().min(0).max(1095),
  staffDiscount: z.number().min(0).max(1),
  reraBands: z.array(z.object({ gapAbove: z.number().min(-1).max(1), increase: z.number().min(0).max(1) })).max(10),
  labourIncrease: z.number().min(-1).max(2),
  campIncrease: z.number().min(-1).max(2),
  defaultCheques: z.number().int().min(1).max(12),
  chequeSpanDays: z.number().min(28).max(400),
  vatRate: z.number().min(0).max(1),
  depositPct: z.number().min(0).max(1),
  mfPct: z.number().min(0).max(1),
  actualsCutoffMonth: z.number().int().min(1).max(12),
}) satisfies z.ZodType<AdminAssumptions>;

export async function saveAssumptions(versionId: number, input: AdminAssumptions): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const a = AssumptionsSchema.parse(input);
    await db.transaction(async (tx) => {
      // the version row as it is now, held until this commits: another Admin's change of other settings
      // (yearly rules, Building overheads' Assumptions tab) can't be overwritten with an old copy
      const v = await writeGuard(tx, versionId, { versionUpdate: true, leases: true });
      if (!v || v.status === 'LOCKED') throw new Error('Version is locked');
      // keep the settings made elsewhere (Building overheads' Assumptions tab)
      await tx.update(schema.budgetVersions).set({ assumptions: { ...v.assumptions, ...a } }).where(eq(schema.budgetVersions.id, versionId));
      await recalcLines(tx, versionId);
      const from = { ...DEFAULT_ASSUMPTIONS, ...v.assumptions } as Record<string, unknown>;
      await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'assumptions', action: 'update', changes: changedFields(from, a) });
    });
    return 'Assumptions saved and all units recalculated';
  });
}

// ---- yearly rules (per version) and mappings (every version): audit FIN-019 ----------------------------

const pct = z.number().min(0).max(1);
const YearlySchema = z.object({
  payrollRules: z.record(z.string().regex(/^\d{3}$/), z.object({ cap: pct, mjnh: pct, asre: pct, asreWhole: z.boolean().optional() })),
  fmSupervision: z.object({
    split: z.array(z.object({ share: pct, workTypes: z.array(z.string().regex(/^[MR]\d{2}$/)).min(1) })).min(1).max(10),
    bus: z.array(z.string().regex(/^\w{2,6}$/)).min(1),
  }),
});

/** The version's payroll rules and FM supervision split (Admin → Yearly rules). */
export async function saveYearlyRules(versionId: number, input: z.infer<typeof YearlySchema>): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const d = YearlySchema.parse(input);
    const total = d.fmSupervision.split.reduce((s, x) => s + x.share, 0);
    if (Math.abs(total - 1) > 0.0005) throw new Error(`The supervision split adds up to ${Math.round(total * 10000) / 100}%: it must be 100%`);
    await db.transaction(async (tx) => {
      // the version row as it is now, held until this commits (see saveAssumptions)
      const v = await writeGuard(tx, versionId, { versionUpdate: true });
      if (!v || v.status === 'LOCKED') throw new Error('Version is locked');
      const before = { ...DEFAULT_ASSUMPTIONS, ...v.assumptions };
      await tx.update(schema.budgetVersions).set({ assumptions: { ...v.assumptions, ...d } }).where(eq(schema.budgetVersions.id, versionId));
      await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'yearly_rules', action: 'update', changes: changedFields(pick(before, ['payrollRules', 'fmSupervision']), d) });
    });
    return 'Yearly rules saved';
  });
}

const MappingsSchema = z.object({
  firstReportYear: z.number().int().min(2000).max(2100),
  glCompanies: z.record(z.string().min(1), z.record(z.string().regex(/^\w{1,6}$/), z.string().regex(/^\w{1,6}$/))),
  mallCodes: z.array(z.string().trim().min(3).max(20)).min(1),
  wholeBuildingNames: z.array(z.string().trim().min(1).max(120)),
});

/** Mappings that apply to every version (Admin → Mappings). */
export async function saveMappings(input: AppSettings): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const d = MappingsSchema.parse(input) as AppSettings;
    await db.transaction(async (tx) => {
      // one mappings save at a time; "before" read in here so two Admins' saves are recorded correctly
      await lockJob(tx, 'settings');
      const before: AppSettings = { ...DEFAULT_SETTINGS };
      for (const r of await tx.select().from(schema.appSettings)) if (r.key in DEFAULT_SETTINGS) (before as unknown as Record<string, unknown>)[r.key] = r.value;
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
        await tx
          .insert(schema.appSettings)
          .values({ key, value: d[key], updatedBy: user.id })
          .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: d[key], updatedAt: new Date(), updatedBy: user.id } });
      }
      await tx.insert(schema.auditLog).values({ userId: user.id, entity: 'mappings', action: 'update', changes: changedFields(before as unknown as Record<string, unknown>, d as unknown as Record<string, unknown>) });
    });
    settingsChanged();
    await getSettings();
    return 'Mappings saved';
  });
}
// ---- ASRE (the mall operator): its budget lines, blank until its finance team sends them ------------

/** Saves ASRE's yearly amounts per statement line (Admin → ASRE). */
export async function saveAsre(versionId: number, values: Record<string, number | null>): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const { saveAsreBudget } = await import('@/lib/budget/asre');
    const r = await saveAsreBudget(user, versionId, values);
    if (r.error) throw new Error(r.error);
    return 'ASRE budget saved';
  });
}
// ---- users ----------------------------------------------------------------------------------

const UserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(100),
  role: z.enum(['ADMIN', 'FINANCE', 'PM', 'FM']),
  coordinator: z.string().trim().toUpperCase().max(40).nullable(),
  password: z.string().min(8).max(200).nullable(),
  active: z.boolean(),
});

export async function upsertUser(id: number | null, input: z.infer<typeof UserSchema>): Promise<Result> {
  const me = await requireAdmin();
  return wrap(async () => {
    const d = UserSchema.parse(input);
    if (d.role === 'PM' && !d.coordinator) throw new Error('Property managers need a coordinator code (e.g. RUCHI)');
    if (d.role === 'ADMIN' && me.role !== 'ADMIN') throw new Error('Only an admin can create admins');
    const values = {
      email: d.email,
      name: d.name,
      role: d.role,
      coordinator: d.role === 'PM' ? d.coordinator : null,
      active: d.active,
      ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 10) } : {}),
    };
    if (!id && !d.password) throw new Error('Set a password for the new user');
    // the account and its audit row (who, before and after; never the password) land together
    const shown = ['email', 'name', 'role', 'coordinator', 'active'] as const;
    await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, id));
        if (!before) throw new Error('User not found');
        // a new password, another role or a deactivation signs the user's open sessions out
        const revoke = !!d.password || before.role !== d.role || (before.active && !d.active);
        await tx
          .update(schema.users)
          .set({ ...values, ...(revoke ? { sessionVersion: sql`${schema.users.sessionVersion} + 1` } : {}) })
          .where(eq(schema.users.id, id));
        await tx.insert(schema.auditLog).values({ userId: me.id, entity: 'user', entityId: String(id), action: 'update', changes: { ...changedFields(pick(before, shown), pick(values, shown)), ...(d.password ? { password: 'changed' } : {}) } });
      } else {
        const [row] = await tx.insert(schema.users).values({ ...values, passwordHash: values.passwordHash! }).returning({ id: schema.users.id });
        await tx.insert(schema.auditLog).values({ userId: me.id, entity: 'user', entityId: String(row.id), action: 'create', changes: { from: null, to: pick(values, shown) } });
      }
    });
    return id ? 'User updated' : 'User created';
  });
}

// ---- properties -----------------------------------------------------------------------------

const PropertySchema = z.object({
  name: z.string().trim().min(1).max(120),
  coordinator: z.string().trim().toUpperCase().max(40).nullable(),
  kind: z.enum(['BUILDING', 'CAMP', 'MALL']),
  location: z.string().trim().max(60).nullable(),
  active: z.boolean(),
});

export async function updateProperty(id: number, input: z.infer<typeof PropertySchema>): Promise<Result> {
  const me = await requireAdmin();
  return wrap(async () => {
    const d = PropertySchema.parse(input);
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.properties).where(eq(schema.properties.id, id));
      if (!before) throw new Error('Property not found');
      await tx.update(schema.properties).set(d).where(eq(schema.properties.id, id));
      // e.g. a change of property manager: who had it before and who has it now
      await tx.insert(schema.auditLog).values({ userId: me.id, propertyId: id, entity: 'property', entityId: String(id), action: 'update', changes: changedFields(before as unknown as Record<string, unknown>, d) });
    });
    return 'Property updated';
  });
}

// ---- comparatives -----------------------------------------------------------------------------

/**
 * Upload an Excel sheet of comparatives: a column with property codes ("Code" / "Property Code")
 * and one column per label (e.g. 2026F, 2025A, 2024A). Blank cells are left unchanged.
 */
export async function importComparatives(versionId: number, form: FormData): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choose an Excel file');
    // a locked version keeps its figures: Admin reopens it first
    const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    if (!v || v.status === 'LOCKED') throw new Error('This version is locked: reopen it first');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const headerIdx = rows.findIndex((r) => r.some((c) => /^(property\s*)?code$/i.test(String(c ?? '').trim())));
    if (headerIdx < 0) throw new Error('No "Code" column found in the first sheet');
    const header = rows[headerIdx].map((c) => String(c ?? '').trim().toUpperCase());
    const codeCol = header.findIndex((h) => /^(PROPERTY\s*)?CODE$/.test(h));
    // years before the first reporting year (Admin → Mappings) are not kept
    const firstYear = (await getSettings()).firstReportYear;
    const labelCols = header.map((h, i) => ({ h, i })).filter((x) => /^\d{4}[ABF]$/.test(x.h) && Number(x.h.slice(0, 4)) >= firstYear);
    if (!labelCols.length) throw new Error('No comparative columns found (headers like 2026F, 2025A, 2024A)');

    const props = await db.select().from(schema.properties);
    const norm = (c: string) => c.trim().toUpperCase().replace(/N$/, '');
    const byCode = new Map(props.map((p) => [norm(p.code), p.id]));
    const unknown: string[] = [];
    const values: { versionId: number; propertyId: number; label: string; amount: number }[] = [];
    for (const r of rows.slice(headerIdx + 1)) {
      const code = r[codeCol] ? String(r[codeCol]) : '';
      if (!code) continue;
      const pid = byCode.get(norm(code));
      if (!pid) {
        unknown.push(code);
        continue;
      }
      for (const { h, i } of labelCols) {
        const raw = r[i];
        if (raw === null || raw === '') continue;
        const amount = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
        if (!Number.isFinite(amount)) continue;
        values.push({ versionId, propertyId: pid, label: h, amount });
      }
    }
    const saved = values.length;
    // the whole file lands, with its audit row, or nothing does
    await db.transaction(async (tx) => {
      // the version stays open until this commits (a lock waits for it)
      const cur = await writeGuard(tx, versionId);
      if (!cur || cur.status === 'LOCKED') throw new Error('This version is locked: reopen it first');
      for (const x of values)
        await tx
          .insert(schema.comparatives)
          .values(x)
          .onConflictDoUpdate({
            target: [schema.comparatives.versionId, schema.comparatives.propertyId, schema.comparatives.label],
            set: { amount: x.amount },
          });
      await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'comparative', action: 'import', changes: { file: file.name, values: saved, unknown } });
    });
    return `Imported ${saved} values${unknown.length ? `; unknown property codes: ${unknown.slice(0, 8).join(', ')}` : ''}`;
  });
}

// ---- revenue actuals: Revenue Recognition Summary → Revenue Analysis ------------------------------

async function revenueReport(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Choose the Revenue Recognition Summary');
  const { parseRevenueRecognition } = await import('@/lib/import/revenue-recognition');
  return { report: parseRevenueRecognition(Buffer.from(await file.arrayBuffer())), name: file.name };
}

/** What the import would load: nothing is written. */
export async function previewRevenueImport(form: FormData): Promise<{ error?: string; preview?: RrPreview }> {
  await requireAdmin();
  try {
    const { report } = await revenueReport(form);
    const { planRevenueImport } = await import('@/lib/import/revenue-recognition');
    return { preview: (await planRevenueImport(report)).preview };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function applyRevenueImportAction(form: FormData): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const { report, name } = await revenueReport(form);
    const { applyRevenueImport } = await import('@/lib/import/revenue-recognition');
    const p = await applyRevenueImport(report, user.id, name);
    return `Imported revenue actuals ${p.from} – ${p.to} for ${p.matched} properties`;
  });
}

// ---- GL actuals: Account Analysis Report → Other Income -----------------------------------------

const GlValues = z
  .array(
    z.object({
      scope: z.string().regex(/^(P:\d+|G:\w+)$/),
      buCode: z.string().max(10),
      propertyId: z.number().int().nullable(),
      account: z.string().regex(/^52\d{3}$/),
      period: z.enum(['A2', 'A1', 'YTD']),
      amount: z.number().finite(),
    }),
  )
  .max(50000);

const FmActualRows = z
  .array(
    z.object({
      company: z.string().regex(/^\d{3}$/),
      propertyId: z.number().int().nullable(),
      workType: z.string().max(10),
      element: z.string().regex(/^\d{2}$/),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().finite(),
    }),
  )
  .max(100000);
const FmActualsPreviewSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}$/),
  rows: z.number(),
  byYear: z.array(z.object({ year: z.string(), maintenance: z.number(), capex: z.number() })),
  unmatched: z.array(z.object({ segment: z.string(), amount: z.number() })),
  noWorkType: z.number(),
});

const BohActualRows = z
  .array(
    z.object({
      company: z.string().regex(/^\d{3}$/),
      propertyId: z.number().int(),
      account: z.string().regex(/^\d{5}$/),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().finite(),
    }),
  )
  .max(100000);
const BohActualsPreviewSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}$/),
  rows: z.number(),
  byYear: z.array(z.object({ year: z.string(), lines: z.record(z.string(), z.number()), total: z.number() })),
  unmatched: z.array(z.object({ segment: z.string(), amount: z.number() })),
  companyLevel: z.number(),
  accounts: z.array(z.string().regex(/^\d{5}$/)).min(1),
});

const AdminActualRows = z
  .array(
    z.object({
      company: z.string().regex(/^\d{3}$/),
      dept: z.string().max(10),
      account: z.string().regex(/^\d{5}$/),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().finite(),
    }),
  )
  .max(100000);
const AdminActualsPreviewSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}$/),
  rows: z.number(),
  byYear: z.array(z.object({ year: z.string(), payroll: z.number(), admin: z.number(), allocation: z.number() })),
  accounts: z.array(z.string().regex(/^\d{5}$/)).min(1),
});

/**
 * Writes a prepared GL import (made by /api/import/gl and kept in import_plans): other income, and from
 * MJN HOLDING the FM costs, building overheads and G&A by department, in one transaction. A plan is
 * applied once; the rows come from the server, never from the browser. What it replaces is kept
 * (import_history) so it can be undone. A part that would replace its rows with less than half as many
 * (a file run for part of the ledger) is held until an admin confirms it (`force`).
 */
export async function applyGlActuals(planId: number, force = false): Promise<Result> {
  const user = await requireAdmin();
  if (force && user.role !== 'ADMIN') return { error: 'Only an admin can confirm an import that replaces most of the actuals with fewer rows' };
  return wrap(async () => {
    const [plan] = await db.select().from(schema.importPlans).where(and(eq(schema.importPlans.id, planId), eq(schema.importPlans.kind, 'gl')));
    if (!plan) throw new Error('The prepared import was not found: choose the file again');
    if (plan.appliedAt) throw new Error('This import has already been applied');
    if (Date.now() - plan.createdAt.getTime() > 6 * 60 * 60_000) throw new Error('The prepared import is older than 6 hours: choose the file again');
    if (!plan.versionId) throw new Error('The prepared import has no version');
    // other income actuals are kept per version: a locked one keeps its figures (Admin reopens it first)
    const [target] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, plan.versionId));
    if (!target || target.status === 'LOCKED') throw new Error('The version is locked: reopen it to import GL actuals into it');
    const p = plan.payload as { values: unknown; preview: GlPreview; fm: { rows: unknown; preview: unknown } | null; boh: { rows: unknown; preview: unknown } | null; ga: { rows: unknown; preview: unknown } | null };
    const v = GlValues.parse(p.values);
    const fm = p.fm ? { rows: FmActualRows.parse(p.fm.rows), preview: FmActualsPreviewSchema.parse(p.fm.preview) } : null;
    const boh = p.boh ? { rows: BohActualRows.parse(p.boh.rows), preview: BohActualsPreviewSchema.parse(p.boh.preview) } : null;
    const ga = p.ga ? { rows: AdminActualRows.parse(p.ga.rows), preview: AdminActualsPreviewSchema.parse(p.ga.preview) } : null;
    const { applyGlImport } = await import('@/lib/import/gl-other-income');
    const { applyFmActuals } = await import('@/lib/import/gl-fm');
    const { applyBohActuals } = await import('@/lib/import/gl-boh');
    const { applyAdminActuals } = await import('@/lib/import/gl-admin');
    const versionId = plan.versionId;
    const ledger = p.preview.ledger;
    if (!isGlLedger(ledger)) throw new Error(`Unknown ledger ${ledger}`);
    // what each part replaces, with what
    const parts: { table: GlTable; label: string; scope: GlScope; incoming: number }[] = [
      { table: 'other_income', label: 'other income actuals', scope: glOtherIncomeScope(versionId, ledger), incoming: v.length },
      ...(fm ? [{ table: 'fm_actuals' as const, label: 'FM cost actuals', scope: { from: fm.preview.from, to: fm.preview.to }, incoming: fm.rows.length }] : []),
      ...(boh ? [{ table: 'boh_actuals' as const, label: 'building overhead actuals', scope: { from: boh.preview.from, to: boh.preview.to, accounts: boh.preview.accounts }, incoming: boh.rows.length }] : []),
      ...(ga ? [{ table: 'admin_actuals' as const, label: 'G&A actuals', scope: { from: ga.preview.from, to: ga.preview.to, accounts: ga.preview.accounts }, incoming: ga.rows.length }] : []),
    ];
    if (!force) {
      for (const part of parts) {
        const existing = await countInScope(part.table, part.scope);
        if (dropsTooMuch(existing, part.incoming))
          throw new Error(`Held: the file would replace ${existing.toLocaleString('en-US')} ${part.label} with ${part.incoming.toLocaleString('en-US')}. Check the report covers the whole ledger; an admin can confirm it with "Replace anyway".`);
      }
    }
    const extra: string[] = [];
    const info = { planId, ledger, versionId, userId: user.id };
    await db.transaction(async (tx) => {
      // the version stays open until this commits; one GL import (or undo) at a time; a plan is applied once
      const cur = await writeGuard(tx, versionId);
      if (!cur || cur.status === 'LOCKED') throw new Error('The version is locked: reopen it to import GL actuals into it');
      await lockJob(tx, 'gl');
      const claimed = await tx
        .update(schema.importPlans)
        .set({ appliedAt: new Date() })
        .where(and(eq(schema.importPlans.id, planId), isNull(schema.importPlans.appliedAt)))
        .returning({ id: schema.importPlans.id });
      if (!claimed.length) throw new Error('This import has already been applied');
      // keep what is replaced, so the import can be undone
      for (const part of parts) await keepReplaced(tx, info, part.table, part.scope, part.incoming);
      await applyGlImport(versionId, v, user.id, { file: plan.file, preview: p.preview }, tx);
      if (fm) {
        await applyFmActuals(fm.rows, fm.preview, user.id, plan.file, tx);
        extra.push(`${fm.rows.length.toLocaleString('en-US')} FM cost actuals`);
      }
      if (boh) {
        await applyBohActuals(boh.rows, boh.preview, user.id, plan.file, tx);
        extra.push(`${boh.rows.length.toLocaleString('en-US')} building overhead actuals`);
      }
      if (ga) {
        await applyAdminActuals(ga.rows, ga.preview, user.id, plan.file, tx);
        extra.push(`${ga.rows.length.toLocaleString('en-US')} G&A actuals`);
      }
      // applied once: a second apply of the same plan is refused; the rows are dropped to keep the table small
      await tx.update(schema.importPlans).set({ appliedAt: new Date(), payload: { applied: true, preview: p.preview } }).where(eq(schema.importPlans.id, planId));
    });
    return `Imported ${v.length.toLocaleString('en-US')} ${p.preview.ledger} GL actuals into Other Income${extra.length ? `, ${extra.join(' and ')}` : ''}`;
  });
}

/** Puts back what a GL import replaced (the latest import of its ledger). */
export async function undoGlActuals(planId: number): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const { undoGlImport } = await import('@/lib/import/gl-history');
    return undoGlImport(planId, user.id);
  });
}

// ---- lease data: Tenant and Lease Details Report ------------------------------------------------

/** The lease report (required) with the Unit Dump and Maintenance Fee Report (optional). */
async function reportRows(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Choose the Tenant and Lease Details Report (.xlsx)');
  const optional = (key: string) => {
    const f = form.get(key);
    return f instanceof File && f.size ? f : null;
  };
  const dumpFile = optional('dump');
  const mfFile = optional('mf');
  const { parseReport } = await import('@/lib/import/tenant-lease');
  const { parseMfReport, parseUnitDump } = await import('@/lib/import/oracle-extras');
  const buf = async (f: File) => Buffer.from(await f.arrayBuffer());
  return {
    rows: parseReport(await buf(file)),
    name: file.name,
    extras: {
      dump: dumpFile ? parseUnitDump(await buf(dumpFile)) : null,
      mf: mfFile ? parseMfReport(await buf(mfFile)) : null,
      files: [file, dumpFile, mfFile].filter((f): f is File => !!f).map((f) => f.name),
    },
  };
}

/** the contracts' as-of date chosen on the page (YYYY-MM-DD; default today) */
function asOfOf(form: FormData): string {
  const s = String(form.get('asOf') ?? '').trim();
  if (!s) return new Date().toLocaleDateString('en-CA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error('The as-of date is not a date');
  return s;
}

/**
 * What the import would change: nothing is written to the budget. The parsed reports are kept on the
 * server (import_plans) so Import applies exactly what was previewed, and only if nothing changed since.
 */
export async function previewLeaseImport(versionId: number, form: FormData): Promise<{ error?: string; preview?: ImportPreview; planId?: number }> {
  const user = await requireAdmin();
  try {
    const { rows, name, extras } = await reportRows(form);
    const asOf = asOfOf(form);
    const { planImport } = await import('@/lib/import/tenant-lease');
    const { preview } = await planImport(versionId, rows, { ...extras, asOf });
    const [plan] = await db
      .insert(schema.importPlans)
      .values({ kind: 'lease', versionId, userId: user.id, file: name, payload: { rows, extras: { ...extras, asOf }, fingerprint: preview.fingerprint } })
      .returning({ id: schema.importPlans.id });
    return { preview, planId: plan.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Applies a previewed lease import (see previewLeaseImport). */
export async function applyLeaseImport(planId: number): Promise<Result> {
  const user = await requireAdmin();
  return wrap(async () => {
    const [plan] = await db.select().from(schema.importPlans).where(and(eq(schema.importPlans.id, planId), eq(schema.importPlans.kind, 'lease')));
    if (!plan) throw new Error('The prepared import was not found: choose the files again');
    if (plan.appliedAt) throw new Error('This import has already been applied');
    if (Date.now() - plan.createdAt.getTime() > 6 * 60 * 60_000) throw new Error('The prepared import is older than 6 hours: choose the files again');
    if (!plan.versionId) throw new Error('The prepared import has no version');
    const p = plan.payload as { rows: ReportRow[]; extras: ImportExtras & { files?: string[] }; fingerprint: string };
    const { applyImport } = await import('@/lib/import/tenant-lease');
    const r = await applyImport(plan.versionId, p.rows, user.id, plan.file ?? undefined, p.extras, { expect: p.fingerprint, planId });
    // applied once; the report rows are dropped (they hold tenant names)
    await db.update(schema.importPlans).set({ appliedAt: new Date(), payload: { applied: true, asOf: r.asOf } }).where(eq(schema.importPlans.id, planId));
    return (
      `Imported: ${r.result.leasedLines} leased and ${r.result.vacantLines} vacant lines, current rent AED ${r.result.currentRent.toLocaleString('en-US')}` +
      (r.newLines.length ? `; ${r.newLines.length} new lines` : '') +
      (r.removedLines.length ? `; ${r.removedLines.length} lines archived` : '') +
      (r.heldProperties ? `; ${r.heldProperties} submitted or approved properties left as they were` : '') +
      '. The lines written have been recalculated.'
    );
  });
}
