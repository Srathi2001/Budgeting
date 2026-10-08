// Building overheads by building × GL account: GL actuals (reference only) and the budget, entered by the
// property manager (PM accounts) or Finance (Finance accounts). Nothing is pre-filled: last year's
// actuals and run-rate are shown next to the input. The budget is phased by month for the P&L: flat,
// last year's monthly pattern (water & electricity), or in full in the month it is paid.
import 'server-only';
import { and, eq, gte, inArray, like, lte, max } from 'drizzle-orm';
import { db, schema } from '@/db';
import { canEditProperty, isFinance, type Actor, type EditCheck } from '@/lib/auth/permissions';
import { BOH_ACCOUNT, BOH_ACCOUNTS, paidInOneMonth, phase, type BohBlock, type BohChange, type BohLine, type BohPhasing, type BohRow } from './boh-types';

const z12 = () => Array.from({ length: 12 }, () => 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** GL actuals of the buildings for years Y-3 … Y-1, by property → account → year → 12 months; and Y-1's last month. */
async function actualsFor(year: number, propertyIds: number[]) {
  const rows = propertyIds.length
    ? await db
        .select()
        .from(schema.bohActuals)
        .where(and(inArray(schema.bohActuals.propertyId, propertyIds), gte(schema.bohActuals.month, `${year - 3}-01`), lte(schema.bohActuals.month, `${year - 1}-12`)))
    : [];
  const m = new Map<number, Map<string, Map<number, number[]>>>();
  let last = 0;
  for (const r of rows) {
    const y = Number(r.month.slice(0, 4));
    const mo = Number(r.month.slice(5));
    if (y === year - 1) last = Math.max(last, mo);
    const byAcct = m.get(r.propertyId) ?? new Map();
    const byYear = byAcct.get(r.account) ?? new Map();
    const arr = byYear.get(y) ?? z12();
    arr[mo - 1] += r.amount;
    byYear.set(y, arr);
    byAcct.set(r.account, byYear);
    m.set(r.propertyId, byAcct);
  }
  // the latest month in the GL for Y-1, across all buildings (not just these)
  const [top] = await db
    .select({ month: max(schema.bohActuals.month) })
    .from(schema.bohActuals)
    .where(like(schema.bohActuals.month, `${year - 1}-%`));
  return { m, cutoff: top?.month ? Number(top.month.slice(5)) : last };
}

const sum = (a: number[] | undefined) => (a ? a.reduce((s, v) => s + v, 0) : null);
/** month (1–12) of the largest payment in a year's months, null when none */
const peak = (a: number[] | undefined) => {
  if (!a || !a.some((v) => v > 0)) return null;
  return a.indexOf(Math.max(...a)) + 1;
};

/**
 * Y-1 forecast by how the line is paid: contracts at the run-rate (year to date ÷ months × 12); water &
 * electricity the year to date plus last year's remaining months (its summer peak is already in); a
 * lump sum this year's payment once made, else last year's.
 */
function forecast(phasing: BohPhasing, ytd: number[] | undefined, last: number[] | undefined, cutoff: number, due: number): number | null {
  if (!cutoff || (!ytd && !last)) return null;
  const done = ytd ? ytd.slice(0, cutoff).reduce((s, v) => s + v, 0) : 0;
  if (phasing === 'seasonal') return r2(done + (last ? last.slice(cutoff).reduce((s, v) => s + v, 0) : (done / cutoff) * (12 - cutoff)));
  if (phasing === 'due') return r2(due <= cutoff || !last ? done : done + last.slice(cutoff).reduce((s, v) => s + v, 0));
  return ytd ? r2((done / cutoff) * 12) : null;
}

export async function loadBuildingOverheads(version: schema.BudgetVersion, props: schema.Property[], editable: Set<number>) {
  const Y = version.year;
  const ids = props.map((p) => p.id);
  const bus = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  const { m, cutoff } = await actualsFor(Y, ids);
  const budget = ids.length ? await db.select().from(schema.bohBudget).where(and(eq(schema.bohBudget.versionId, version.id), inArray(schema.bohBudget.propertyId, ids))) : [];
  const blocks: BohBlock[] = props.map((p) => {
    const byAcct = m.get(p.id);
    const rows: BohRow[] = BOH_ACCOUNTS.map((a) => {
      const yrs = byAcct?.get(a.code);
      const ytd = yrs?.get(Y - 1);
      const last = yrs?.get(Y - 2);
      const b = budget.find((x) => x.propertyId === p.id && x.account === a.code);
      const ytdSum = ytd ? sum(ytd.slice(0, cutoff || 12)) : null;
      const defaultDue = peak(last) ?? peak(ytd) ?? 1;
      return {
        account: a.code,
        a2: sum(yrs?.get(Y - 3)),
        a1: sum(last),
        ytd: ytdSum,
        f: forecast(a.phasing, ytd, last, cutoff, defaultDue),
        b: b?.amount ?? null,
        dueMonth: b?.dueMonth ?? null,
        defaultDue,
      };
    });
    return { propertyId: p.id, code: p.code, name: p.name, buCode: p.buCode, buName: bus.get(p.buCode) ?? p.buCode, pm: p.coordinator, editable: editable.has(p.id), rows };
  });
  return { blocks, cutoff };
}

/** Saves budget amounts and due months. PM accounts: whoever may edit the property; Finance accounts: Finance. */
export async function saveBuildingOverheads(user: Actor, versionId: number, changes: BohChange[]): Promise<{ saved: number; errors: string[] }> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { saved: 0, errors: ['Version not found'] };
  if (version.status === 'LOCKED') return { saved: 0, errors: ['This budget version is locked'] };
  const props = new Map((await db.select().from(schema.properties)).map((p) => [p.id, p]));
  const checks = new Map<number, EditCheck>();
  const errors: string[] = [];
  let saved = 0;
  for (const c of changes) {
    const acct = BOH_ACCOUNT.get(c.account);
    const p = props.get(c.propertyId);
    if (!acct || !p) {
      errors.push(`${c.account}: unknown account or property`);
      continue;
    }
    if (c.amount !== null && (!Number.isFinite(c.amount) || Math.abs(c.amount) > 1e10)) {
      errors.push(`${p.code} ${acct.name}: not a valid amount`);
      continue;
    }
    if (c.dueMonth !== null && (!Number.isInteger(c.dueMonth) || c.dueMonth < 1 || c.dueMonth > 12)) {
      errors.push(`${p.code} ${acct.name}: month 1–12`);
      continue;
    }
    if (acct.owner === 'FIN' && !isFinance(user)) {
      errors.push(`${p.code} ${acct.name}: entered by Finance`);
      continue;
    }
    if (!checks.has(p.id)) checks.set(p.id, await canEditProperty(user, versionId, p.id));
    const check = checks.get(p.id)!;
    if (!check.ok) {
      errors.push(`${p.code}: ${check.reason}`);
      continue;
    }
    const where = and(eq(schema.bohBudget.versionId, versionId), eq(schema.bohBudget.propertyId, p.id), eq(schema.bohBudget.account, c.account));
    const [before] = await db.select().from(schema.bohBudget).where(where);
    const after = c.amount === null ? null : { amount: c.amount, dueMonth: paidInOneMonth(acct) ? c.dueMonth : null };
    if ((before?.amount ?? null) === (after?.amount ?? null) && (before?.dueMonth ?? null) === (after?.dueMonth ?? null)) continue;
    if (!after) await db.delete(schema.bohBudget).where(where);
    else
      await db
        .insert(schema.bohBudget)
        .values({ versionId, propertyId: p.id, account: c.account, ...after, updatedBy: user.id })
        .onConflictDoUpdate({
          target: [schema.bohBudget.versionId, schema.bohBudget.propertyId, schema.bohBudget.account],
          set: { ...after, updatedAt: new Date(), updatedBy: user.id },
        });
    await db.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId: p.id,
      entity: 'boh_budget',
      entityId: `${p.id}|${c.account}`,
      action: 'update',
      changes: { from: before ? { amount: before.amount, dueMonth: before.dueMonth } : null, to: after },
    });
    saved++;
  }
  return { saved, errors };
}

/**
 * Monthly pattern of the seasonal accounts (water & electricity): the portfolio's actuals of the full
 * years Y-3 and Y-2 by month, each month floored at 0 and averaged with its neighbours. Single buildings
 * and single years are booked too unevenly (DEWA bills caught up in one month, accruals reversed in
 * another) to follow; the portfolio over two years keeps the summer peak without the booking noise.
 */
async function seasonalPatterns(year: number): Promise<Map<string, number[]>> {
  const seasonal = BOH_ACCOUNTS.filter((a) => a.phasing === 'seasonal').map((a) => a.code);
  const rows = await db
    .select({ account: schema.bohActuals.account, month: schema.bohActuals.month, amount: schema.bohActuals.amount })
    .from(schema.bohActuals)
    .where(and(inArray(schema.bohActuals.account, seasonal), gte(schema.bohActuals.month, `${year - 3}-01`), lte(schema.bohActuals.month, `${year - 2}-12`)));
  const byYear = new Map<string, number[]>(); // `${account}|${year}` → months
  for (const r of rows) {
    const k = `${r.account}|${r.month.slice(0, 4)}`;
    const a = byYear.get(k) ?? z12();
    a[Number(r.month.slice(5)) - 1] += r.amount;
    byYear.set(k, a);
  }
  const out = new Map<string, number[]>();
  for (const acct of seasonal) {
    const months = z12();
    for (const y of [year - 3, year - 2]) byYear.get(`${acct}|${y}`)?.forEach((v, i) => (months[i] += Math.max(v, 0)));
    if (!months.some((v) => v > 0)) continue;
    out.set(acct, months.map((_, i) => (months[(i + 11) % 12] + months[i] + months[(i + 1) % 12]) / 3));
  }
  return out;
}

/**
 * Budgeted building overheads of a version, by building, Building P&L line and month (the expense
 * lines of the statements): the expense, and the cash (premiums paid upfront in the month paid). `lines`: the lines with at least one amount entered in the version.
 */
export async function bohMonthly(version: schema.BudgetVersion, propertyIds?: number[]) {
  const where = propertyIds
    ? and(eq(schema.bohBudget.versionId, version.id), inArray(schema.bohBudget.propertyId, propertyIds.length ? propertyIds : [-1]))
    : eq(schema.bohBudget.versionId, version.id);
  const budget = await db.select().from(schema.bohBudget).where(where);
  const lines = new Set<BohLine>();
  // expense by month, and cash by month (the same, except premiums paid upfront)
  const out = new Map<number, Partial<Record<BohLine, { months: number[]; cash: number[] }>>>();
  if (!budget.length) return { byProperty: out, lines };
  const ids = [...new Set(budget.map((b) => b.propertyId))];
  // last year's actuals: the default payment month
  const { m } = await actualsFor(version.year, ids);
  const patterns = await seasonalPatterns(version.year);
  for (const b of budget) {
    const acct = BOH_ACCOUNT.get(b.account);
    if (!acct) continue;
    lines.add(acct.line);
    const yrs = m.get(b.propertyId)?.get(b.account);
    // the payment month: last year's largest payment, else this year's
    const due = b.dueMonth ?? peak(yrs?.get(version.year - 2)) ?? peak(yrs?.get(version.year - 1)) ?? 1;
    const months = phase(b.amount, acct.phasing, due, patterns.get(b.account));
    const cash = acct.paidUpfront ? phase(b.amount, 'due', due) : months;
    const r = out.get(b.propertyId) ?? {};
    const into = r[acct.line] ?? { months: z12(), cash: z12() };
    months.forEach((v, i) => (into.months[i] += v));
    cash.forEach((v, i) => (into.cash[i] += v));
    r[acct.line] = into;
    out.set(b.propertyId, r);
  }
  return { byProperty: out, lines };
}
