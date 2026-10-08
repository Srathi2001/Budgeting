'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireFinance } from '@/lib/auth/dal';
import { recalcLines } from '@/lib/budget/calc';
import { rollForward } from '@/lib/budget/rollforward';
import { FIRST_REPORT_YEAR } from '@/lib/budget/comparatives';
import { DEFAULT_ASSUMPTIONS, type Assumptions } from '@/lib/engine/assumptions';
import type { ImportPreview } from '@/lib/import/tenant-lease';
import type { GlPreview } from '@/lib/import/gl-other-income';
import type { RrPreview } from '@/lib/import/revenue-recognition';

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

export async function setVersionStatus(versionId: number, status: 'OPEN' | 'LOCKED'): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    await db.update(schema.budgetVersions).set({ status }).where(eq(schema.budgetVersions.id, versionId));
    await audit(user.id, versionId, 'version', status === 'LOCKED' ? 'lock' : 'unlock', null);
    return status === 'LOCKED' ? 'Version locked' : 'Version reopened';
  });
}

export async function createNextVersion(sourceVersionId: number, name: string): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    const v = await rollForward(db, sourceVersionId, { name: name.trim() || undefined, userId: user.id });
    await audit(user.id, v.id, 'version', 'create', { from: sourceVersionId, name: v.name });
    return `Created ${v.name}`;
  });
}

export async function recalcVersion(versionId: number): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    // a locked version keeps its stored results (unit details are shared with later years)
    if (v?.status === 'LOCKED') throw new Error(`${v.name} is locked: its figures are kept as they were`);
    await db.transaction((tx) => recalcLines(tx, versionId));
    await audit(user.id, versionId, 'version', 'recalculate', null);
    return 'Recalculated';
  });
}

// ---- assumptions ----------------------------------------------------------------------------

const AssumptionsSchema = z.object({
  renewalTermDays: z.number().int().min(28).max(3650),
  staffDiscount: z.number().min(0).max(1),
  reraBands: z.array(z.object({ gapAbove: z.number().min(-1).max(1), increase: z.number().min(0).max(1) })).max(10),
  labourIncrease: z.number().min(-1).max(2),
  campIncrease: z.number().min(-1).max(2),
  defaultCheques: z.number().int().min(1).max(12),
  chequeSpanDays: z.number().min(28).max(400),
  vatRate: z.number().min(0).max(1),
  depositPct: z.number().min(0).max(1),
  mfPct: z.number().min(0).max(1),
  pmaRate: z.number().min(0).max(1),
  amaRate: z.number().min(0).max(1),
}) satisfies z.ZodType<Assumptions>;

export async function saveAssumptions(versionId: number, input: Assumptions): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    const a = AssumptionsSchema.parse(input);
    const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    if (!v || v.status === 'LOCKED') throw new Error('Version is locked');
    await db.transaction(async (tx) => {
      await tx.update(schema.budgetVersions).set({ assumptions: a }).where(eq(schema.budgetVersions.id, versionId));
      await recalcLines(tx, versionId);
    });
    await audit(user.id, versionId, 'assumptions', 'update', { from: { ...DEFAULT_ASSUMPTIONS, ...v.assumptions }, to: a });
    return 'Assumptions saved and all units recalculated';
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
  const me = await requireFinance();
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
    if (id) {
      await db.update(schema.users).set(values).where(eq(schema.users.id, id));
    } else {
      if (!d.password) throw new Error('Set a password for the new user');
      await db.insert(schema.users).values({ ...values, passwordHash: values.passwordHash! });
    }
    await audit(me.id, null, 'user', id ? 'update' : 'create', { email: d.email, role: d.role, active: d.active, passwordChanged: !!d.password });
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
  const me = await requireFinance();
  return wrap(async () => {
    const d = PropertySchema.parse(input);
    await db.update(schema.properties).set(d).where(eq(schema.properties.id, id));
    await audit(me.id, null, 'property', 'update', { id, ...d });
    return 'Property updated';
  });
}

// ---- comparatives -----------------------------------------------------------------------------

/**
 * Upload an Excel sheet of comparatives: a column with property codes ("Code" / "Property Code")
 * and one column per label (e.g. 2026F, 2025A, 2024A). Blank cells are left unchanged.
 */
export async function importComparatives(versionId: number, form: FormData): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choose an Excel file');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const headerIdx = rows.findIndex((r) => r.some((c) => /^(property\s*)?code$/i.test(String(c ?? '').trim())));
    if (headerIdx < 0) throw new Error('No "Code" column found in the first sheet');
    const header = rows[headerIdx].map((c) => String(c ?? '').trim().toUpperCase());
    const codeCol = header.findIndex((h) => /^(PROPERTY\s*)?CODE$/.test(h));
    // years before FIRST_REPORT_YEAR are not kept
    const labelCols = header.map((h, i) => ({ h, i })).filter((x) => /^\d{4}[ABF]$/.test(x.h) && Number(x.h.slice(0, 4)) >= FIRST_REPORT_YEAR);
    if (!labelCols.length) throw new Error('No comparative columns found (headers like 2026F, 2025A, 2024A)');

    const props = await db.select().from(schema.properties);
    const norm = (c: string) => c.trim().toUpperCase().replace(/N$/, '');
    const byCode = new Map(props.map((p) => [norm(p.code), p.id]));
    let saved = 0;
    const unknown: string[] = [];
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
        await db
          .insert(schema.comparatives)
          .values({ versionId, propertyId: pid, label: h, amount })
          .onConflictDoUpdate({
            target: [schema.comparatives.versionId, schema.comparatives.propertyId, schema.comparatives.label],
            set: { amount },
          });
        saved++;
      }
    }
    await audit(user.id, versionId, 'comparative', 'import', { file: file.name, values: saved, unknown });
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
  await requireFinance();
  try {
    const { report } = await revenueReport(form);
    const { planRevenueImport } = await import('@/lib/import/revenue-recognition');
    return { preview: (await planRevenueImport(report)).preview };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function applyRevenueImportAction(form: FormData): Promise<Result> {
  const user = await requireFinance();
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
});

/**
 * Writes the actuals the upload preview returned (the file is read by /api/import/gl): other income,
 * and from MJN HOLDING the FM costs, building overheads and G&A by department.
 */
export async function applyGlActuals(
  versionId: number,
  values: unknown,
  preview: GlPreview,
  file: string | null,
  fm: { rows: unknown; preview: unknown } | null = null,
  boh: { rows: unknown; preview: unknown } | null = null,
  ga: { rows: unknown; preview: unknown } | null = null,
): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    const v = GlValues.parse(values);
    const { applyGlImport } = await import('@/lib/import/gl-other-income');
    await applyGlImport(versionId, v, user.id, { file, preview });
    const extra: string[] = [];
    if (fm) {
      const rows = FmActualRows.parse(fm.rows);
      const { applyFmActuals } = await import('@/lib/import/gl-fm');
      await applyFmActuals(rows, FmActualsPreviewSchema.parse(fm.preview), user.id, file);
      extra.push(`${rows.length.toLocaleString('en-US')} FM cost actuals`);
    }
    if (boh) {
      const rows = BohActualRows.parse(boh.rows);
      const { applyBohActuals } = await import('@/lib/import/gl-boh');
      await applyBohActuals(rows, BohActualsPreviewSchema.parse(boh.preview), user.id, file);
      extra.push(`${rows.length.toLocaleString('en-US')} building overhead actuals`);
    }
    if (ga) {
      const rows = AdminActualRows.parse(ga.rows);
      const { applyAdminActuals } = await import('@/lib/import/gl-admin');
      await applyAdminActuals(rows, AdminActualsPreviewSchema.parse(ga.preview), user.id, file);
      extra.push(`${rows.length.toLocaleString('en-US')} G&A actuals`);
    }
    return `Imported ${v.length.toLocaleString('en-US')} ${preview.ledger} GL actuals into Other Income${extra.length ? `, ${extra.join(' and ')}` : ''}`;
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

/** What the import would change: nothing is written. */
export async function previewLeaseImport(versionId: number, form: FormData): Promise<{ error?: string; preview?: ImportPreview }> {
  await requireFinance();
  try {
    const { rows, extras } = await reportRows(form);
    const { planImport } = await import('@/lib/import/tenant-lease');
    return { preview: (await planImport(versionId, rows, extras)).preview };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function applyLeaseImport(versionId: number, form: FormData): Promise<Result> {
  const user = await requireFinance();
  return wrap(async () => {
    const { rows, name, extras } = await reportRows(form);
    const { applyImport } = await import('@/lib/import/tenant-lease');
    const p = await applyImport(versionId, rows, user.id, name, extras);
    return (
      `Imported: ${p.result.leasedLines} leased and ${p.result.vacantLines} vacant lines, current rent AED ${p.result.currentRent.toLocaleString('en-US')}` +
      (p.newLines.length ? `; ${p.newLines.length} new lines` : '') +
      '. Every unit has been recalculated.'
    );
  });
}
