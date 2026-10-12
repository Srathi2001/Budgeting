// Admin overheads (G&A): payroll by department and admin overheads by department × GL account, with GL
// actuals by cost centre as reference, and the 2026 rules (PDD capitalised, recharges to MJNH / ASRE,
// PMA and AMA fees). Finance only: it holds payroll. Phased evenly over 12 months, as in 2026.
import 'server-only';
import { and, eq, gte, inArray, isNull, like, lte, max, sql } from 'drizzle-orm';
import { priorVersion } from './prior-version';
import { getSettings } from '@/lib/settings';
import { db, schema } from '@/db';
import { isFinance, type Actor } from '@/lib/auth/permissions';
import { writeGuard } from '@/lib/write-guard';
import { withDefaults } from '@/lib/engine/assumptions';
import { bohAccountBudget } from './boh';
import { referenceBudget } from './reference';
import { frozen } from './snapshot-store';
import {
  ADMIN_ACCOUNT,
  DEPTS,
  FEES,
  FEE_ENTITIES,
  PAYERS,
  SALARY_ALLOCATION,
  feeAmount,
  feeBase,
  feeRate,
  isPayrollAccount,
  payrollSplit,
  type Actual4,
  type AdminChange,
  type AdminData,
  type AdminRow,
  type FeeEntity,
  type FeeKind,
  type FeeRow,
  type PayrollRow,
  type SplitEntity,
} from './admin-types';
import { isMall, quarterlyCash, type EntityKey } from './group';
import { CAPEX, ITEM_KIND, SCHEDULE_ACCOUNT, cleanItem, isItemKind, type AdminItem, type ItemData, type ItemKind, type Posting } from './admin-items';

const z12 = () => Array.from({ length: 12 }, () => 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const flat = (amount: number) => z12().map(() => amount / 12);
/** watchmen's salaries in Building Overheads: the security department's payroll */
const WATCHMEN_ACCOUNT = '62603';

/** the landlords' (REHL, REHL-MJN, the mall) budget rent of a version, by entity and month: the PMA fee base */
export async function landlordRent(versionId: number): Promise<Record<FeeEntity, number[]>> {
  await getSettings(); // the mappings (e.g. the Mall's codes) before any property is classified
  const rows = await db
    .select({ code: schema.properties.code, bu: schema.properties.buCode, month: schema.lineMonthly.month, revenue: sql<number>`sum(${schema.lineMonthly.revenue})::float` })
    .from(schema.lineMonthly)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.lineMonthly.propertyId))
    .where(and(eq(schema.lineMonthly.versionId, versionId), inArray(schema.properties.buCode, ['501', '502'])))
    .groupBy(schema.properties.code, schema.properties.buCode, schema.lineMonthly.month);
  const out: Record<FeeEntity, number[]> = { '501': z12(), '502': z12(), MALL: z12() };
  for (const r of rows) out[isMall(r.code) ? 'MALL' : (r.bu as '501' | '502')][r.month - 1] += r.revenue;
  return out;
}

/** budget rent of REHL, REHL-MJN (without the mall) and the PMC: ANPM's G&A is shared on it (2026 PayrollxCost row 12) */
async function splitRevenue(versionId: number): Promise<Record<SplitEntity, number>> {
  await getSettings(); // the mappings (e.g. the Mall's codes) before any property is classified
  const rows = await db
    .select({ code: schema.properties.code, bu: schema.properties.buCode, revenue: sql<number>`sum(${schema.lineMonthly.revenue})::float` })
    .from(schema.lineMonthly)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.lineMonthly.propertyId))
    .where(and(eq(schema.lineMonthly.versionId, versionId), inArray(schema.properties.buCode, ['501', '502', '522'])))
    .groupBy(schema.properties.code, schema.properties.buCode);
  const out: Record<SplitEntity, number> = { '501': 0, '502': 0, '522': 0 };
  for (const r of rows) if (!isMall(r.code)) out[r.bu as SplitEntity] += r.revenue;
  return out;
}

type PriorFee = { fee: FeeKind; entity: FeeEntity; rate: number; base: number | null; amount: number | null };

/** last budget's fees: a past budget kept outside the tool, or the fees of last year's version */
async function priorFees(version: schema.BudgetVersion): Promise<{ label: string; rows: PriorFee[] } | null> {
  const Y = version.year - 1;
  // a past budget kept outside the tool: its fees as loaded into the reference (2026: the workbook's
  // PnLxREHLxANPM rows; scripts/load-reference-budget.ts); the base is the fee ÷ the rate
  const ref = await referenceBudget(Y, 'fees');
  if (ref.length) {
    const pick = (fee: string, account: string) => ref.find((r) => r.scope === fee && r.account === account)?.amount ?? null;
    return {
      label: `${Y}B`,
      rows: FEES.flatMap((f) =>
        FEE_ENTITIES.map((e) => {
          const rate = (pick(f.key, 'ratePct') ?? 0) / 100;
          const amount = pick(f.key, e.key);
          return { fee: f.key, entity: e.key, rate, base: amount !== null && rate ? r2(amount / rate) : null, amount };
        }),
      ),
    };
  }
  // last year's approved budget (prior-version.ts)
  const pv = await priorVersion(version);
  if (!pv) return null;
  const { rows } = await managementFees(pv);
  return { label: `${Y}B`, rows: rows.map((r) => ({ fee: r.fee, entity: r.entity, rate: feeRate(r), base: feeBase(r), amount: r.amount })) };
}

/**
 * The PMA and AMA fees of a version per landlord entity, and by month: the PMA fee follows the entity's
 * rent month by month, the AMA fee is even. Unset rates and bases take the defaults (see FeeRow).
 */
export type ManagementFees = { rows: FeeRow[]; prior: string | null; months: Record<FeeKind, Record<FeeEntity, number[]>> };
export async function managementFees(version: schema.BudgetVersion): Promise<ManagementFees> {
  // a locked version keeps the fees it was locked with (the defaults read last year's budget and the rent)
  const snap = await frozen<ManagementFees>(version, 'fees');
  if (snap) return snap;
  const a = withDefaults(version.assumptions);
  const [stored, rent, prior] = await Promise.all([db.select().from(schema.adminFees).where(eq(schema.adminFees.versionId, version.id)), landlordRent(version.id), priorFees(version)]);
  const fallback: Record<FeeKind, number> = { PMA: a.pmaRate, AMA: a.amaRate };
  const rows: FeeRow[] = [];
  const months = { PMA: {}, AMA: {} } as Record<FeeKind, Record<FeeEntity, number[]>>;
  for (const f of FEES)
    for (const e of FEE_ENTITIES) {
      const s = stored.find((x) => x.fee === f.key && x.entity === e.key);
      const p = prior?.rows.find((x) => x.fee === f.key && x.entity === e.key) ?? null;
      const rentTotal = rent[e.key].reduce((t, v) => t + v, 0);
      const row: FeeRow = {
        fee: f.key,
        entity: e.key,
        prior: p && { rate: p.rate, base: p.base, amount: p.amount },
        rate: s?.rate ?? null,
        base: s?.base ?? null,
        defaultRate: p?.rate ?? fallback[f.key],
        defaultBase: f.key === 'PMA' ? r2(rentTotal) : version.isBaseline ? null : (p?.base ?? null),
        amount: null,
      };
      row.amount = feeAmount(row);
      rows.push(row);
      const fee = row.amount ?? 0;
      months[f.key][e.key] = f.key === 'PMA' && rentTotal > 0 ? rent[e.key].map((v) => (fee * v) / rentTotal) : flat(fee);
    }
  return { rows, prior: prior?.label ?? null, months };
}

export async function loadAdminOverheads(version: schema.BudgetVersion): Promise<AdminData> {
  const Y = version.year;
  const [actuals, [top], payroll, budget, fees, itemRows, revenue] = await Promise.all([
    db
      .select()
      .from(schema.adminActuals)
      .where(and(gte(schema.adminActuals.month, `${Y - 3}-01`), lte(schema.adminActuals.month, `${Y - 1}-12`))),
    db.select({ m: max(schema.adminActuals.month) }).from(schema.adminActuals).where(like(schema.adminActuals.month, `${Y - 1}-%`)),
    db.select().from(schema.adminPayroll).where(eq(schema.adminPayroll.versionId, version.id)),
    db.select().from(schema.adminBudget).where(eq(schema.adminBudget.versionId, version.id)),
    managementFees(version),
    db.select().from(schema.adminItems).where(eq(schema.adminItems.versionId, version.id)).orderBy(schema.adminItems.id),
    splitRevenue(version.id),
  ]);
  const items = itemRows.filter((r) => isItemKind(r.kind)).map((r) => ({ id: r.id, kind: r.kind as ItemKind, dept: r.dept, payer: r.payer, data: r.data as ItemData }));
  // what the schedules post, by department × account × payer (capex is not an account: cash only)
  const posted = new Map<string, number>();
  for (const it of items) for (const p of postingsOf(it)) if (p.account !== CAPEX) posted.set(`${p.dept}|${p.account}|${it.payer}`, (posted.get(`${p.dept}|${p.account}|${it.payer}`) ?? 0) + p.amount);
  const cutoff = top?.m ? Number(top.m.slice(5)) : 0;

  // actuals: Y-3, Y-2, Y-1 to date, and the run-rate
  type Period = 'a2' | 'a1' | 'ytd';
  const acc = new Map<string, Record<Period, number> & { has: Set<Period> }>();
  const add = (k: string, month: string, amount: number) => {
    const y = Number(month.slice(0, 4));
    const p: Period | null = y === Y - 3 ? 'a2' : y === Y - 2 ? 'a1' : y === Y - 1 && Number(month.slice(5)) <= (cutoff || 12) ? 'ytd' : null;
    if (!p) return;
    const e = acc.get(k) ?? { a2: 0, a1: 0, ytd: 0, has: new Set<Period>() };
    e[p] += amount;
    e.has.add(p);
    acc.set(k, e);
  };
  for (const r of actuals) {
    if (r.account === SALARY_ALLOCATION) add('alloc', r.month, r.amount);
    else if (isPayrollAccount(r.account)) add(`pay|${r.dept}`, r.month, r.amount);
    else add(`oh|${r.dept}|${r.account}`, r.month, r.amount);
  }
  const four = (k: string): Actual4 => {
    const e = acc.get(k);
    if (!e) return { a2: null, a1: null, ytd: null, f: null };
    return {
      a2: e.has.has('a2') ? r2(e.a2) : null,
      a1: e.has.has('a1') ? r2(e.a1) : null,
      ytd: e.has.has('ytd') ? r2(e.ytd) : null,
      f: e.has.has('ytd') && cutoff ? r2((e.ytd / cutoff) * 12) : null,
    };
  };

  const payrollRows: PayrollRow[] = DEPTS.filter((d) => !d.elsewhere).map((d) => {
    const p = payroll.find((x) => x.dept === d.code);
    return {
      dept: d.code,
      ...four(`pay|${d.code}`),
      headcount: p?.headcount ?? null,
      ctc: p?.ctc ?? null,
      newHeadcount: p?.newHeadcount ?? null,
      newCtc: p?.newCtc ?? null,
      capPct: p?.capPct ?? null,
      mjnhPct: p?.mjnhPct ?? null,
      asrePct: p?.asrePct ?? null,
      seniorCtc: p?.seniorCtc ?? null,
    };
  });

  // admin overheads: every department × account with actuals or a budget (FM and security included:
  // their actuals are shown; their budget is elsewhere)
  const keys = new Set<string>();
  for (const k of acc.keys()) if (k.startsWith('oh|')) keys.add(k.slice(3));
  for (const b of budget) keys.add(`${b.dept}|${b.account}`);
  for (const k of posted.keys()) keys.add(k.split('|').slice(0, 2).join('|'));
  const admin: AdminRow[] = [...keys]
    .map((k) => {
      const [dept, account] = k.split('|');
      const b: Record<string, number | null> = {};
      const fromItems: Record<string, number | null> = {};
      for (const p of PAYERS) {
        // an account with its own schedule is budgeted only there: typed amounts don't count
        b[p.code] = SCHEDULE_ACCOUNT.has(account) ? null : (budget.find((x) => x.dept === dept && x.account === account && x.entity === p.code)?.amount ?? null);
        fromItems[p.code] = posted.get(`${k}|${p.code}`) ?? null;
      }
      return { dept, account, ...four(`oh|${k}`), b, items: fromItems, schedule: SCHEDULE_ACCOUNT.get(account) ?? null };
    })
    .filter((r) => ADMIN_ACCOUNT.has(r.account));

  // FM and security payroll, budgeted in the FM budget and Building Overheads
  const [fmStaff] = await db
    .select({ total: sql<number | null>`sum(${schema.fmStaff.ctc} + ${schema.fmStaff.overtime})::float` })
    .from(schema.fmStaff)
    .where(eq(schema.fmStaff.versionId, version.id));
  // watchmen: Building Overheads' security allocation (share × cost per watchman) or the amount entered
  const watch = await bohAccountBudget(version, WATCHMEN_ACCOUNT);

  // last year's approved budget, reference only: payroll cost to company and admin overheads per
  // department (the 2026 workbook budgets G&A by department and cost line, not by GL account)
  const [refPay, refAdmin] = await Promise.all([referenceBudget(Y - 1, 'payroll'), referenceBudget(Y - 1, 'admin')]);
  const byDept = (rows: typeof refPay) => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.scope]: (m[r.scope] ?? 0) + r.amount }), {});
  const prior = refPay.length || refAdmin.length ? { label: `${Y - 1}B`, payroll: byDept(refPay), admin: byDept(refAdmin) } : null;

  return {
    rules: withDefaults(version.assumptions).payrollRules,
    prior,
    year: Y,
    cutoff,
    payroll: payrollRows,
    admin,
    elsewhere: [
      { dept: '209', budget: fmStaff?.total ?? null },
      { dept: '211', budget: watch },
    ],
    allocation: four('alloc'),
    fees: fees.rows,
    feesPrior: fees.prior,
    revenue,
    items,
  };
}

/** what an item posts: its schedule's rule */
const postingsOf = (it: Pick<AdminItem, 'kind' | 'dept' | 'data'>): Posting[] => ITEM_KIND.get(it.kind)!.postings(it.data, it.dept);

/** Adds or changes a back-up schedule item (Finance). Returns the item id. */
export async function saveAdminItem(
  user: Actor,
  versionId: number,
  item: { id: number | null; kind: string; dept: string; payer: string; data: ItemData },
): Promise<{ id?: number; error?: string }> {
  if (!isFinance(user)) return { error: 'Admin overheads are entered by Finance' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'This budget version is locked' };
  if (!isItemKind(item.kind)) return { error: 'Unknown schedule' };
  if (!DEPTS.some((d) => d.code === item.dept && !d.elsewhere)) return { error: 'Choose a department budgeted here' };
  if (!PAYERS.some((p) => p.code === item.payer)) return { error: 'Choose who pays it' };
  // other items post to the accounts without a schedule of their own
  const accounts = new Set([...ADMIN_ACCOUNT.values()].filter((a) => !isPayrollAccount(a.code) && !SCHEDULE_ACCOUNT.has(a.code)).map((a) => a.code));
  const clean = cleanItem(item.kind, item.data, accounts);
  if ('error' in clean) return { error: clean.error };
  const values = { versionId, kind: item.kind, dept: item.dept, payer: item.payer, data: clean.data, updatedAt: new Date(), updatedBy: user.id };
  let id = item.id;
  // the item and its audit row (before and after) land together
  const found = await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const cur = await writeGuard(tx, versionId);
    if (!cur || cur.status === 'LOCKED') return 'locked' as const;
    let before: typeof schema.adminItems.$inferSelect | undefined;
    if (id) {
      [before] = await tx.select().from(schema.adminItems).where(and(eq(schema.adminItems.id, id), eq(schema.adminItems.versionId, versionId)));
      if (!before) return false;
      await tx.update(schema.adminItems).set(values).where(eq(schema.adminItems.id, id));
    } else {
      [{ id }] = await tx.insert(schema.adminItems).values(values).returning({ id: schema.adminItems.id });
    }
    const after = { kind: item.kind, dept: item.dept, payer: item.payer, data: clean.data };
    await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'admin_item', entityId: String(id), action: before ? 'update' : 'create', changes: { from: before ? { kind: before.kind, dept: before.dept, payer: before.payer, data: before.data } : null, to: after } });
    return true;
  });
  if (found === 'locked') return { error: 'This budget version is locked' };
  if (!found) return { error: 'Item not found' };
  return { id: id! };
}

export async function deleteAdminItem(user: Actor, versionId: number, id: number): Promise<{ error?: string }> {
  if (!isFinance(user)) return { error: 'Admin overheads are entered by Finance' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'This budget version is locked' };
  const locked = await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const cur = await writeGuard(tx, versionId);
    if (!cur || cur.status === 'LOCKED') return true;
    const [row] = await tx.delete(schema.adminItems).where(and(eq(schema.adminItems.id, id), eq(schema.adminItems.versionId, versionId))).returning();
    if (row) await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'admin_item', entityId: String(id), action: 'delete', changes: { from: { kind: row.kind, dept: row.dept, payer: row.payer, data: row.data }, to: null } });
    return false;
  });
  return locked ? { error: 'This budget version is locked' } : {};
}

const PAYROLL_FIELDS = { headcount: 'int', ctc: 'amount', newHeadcount: 'int', newCtc: 'amount', capPct: 'pct', mjnhPct: 'pct', asrePct: 'pct', seniorCtc: 'amount' } as const;

/** Saves admin overhead inputs: Finance only. */
export async function saveAdminOverheads(user: Actor, versionId: number, changes: AdminChange[]): Promise<{ saved: number; errors: string[] }> {
  if (!isFinance(user)) return { saved: 0, errors: ['Admin overheads are entered by Finance'] };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { saved: 0, errors: ['Version not found'] };
  if (version.status === 'LOCKED') return { saved: 0, errors: ['This budget version is locked'] };
  const errors: string[] = [];
  let saved = 0;
  // every change and its audit row land together: one transaction for the batch
  await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const cur = await writeGuard(tx, versionId);
    if (!cur || cur.status === 'LOCKED') {
      errors.push('This budget version is locked');
      return;
    }
    for (const c of changes) {
      const v = c.value;
      if (v !== null && (!Number.isFinite(v) || Math.abs(v) > 1e11)) {
        errors.push('Not a valid amount');
        continue;
      }
      // the value it replaces, for the audit row
      let from: number | null = null;
      if (c.kind === 'payroll') {
        const kind = PAYROLL_FIELDS[c.field];
        if (!DEPTS.some((d) => d.code === c.dept && !d.elsewhere)) {
          errors.push(`${c.dept}: not budgeted here`);
          continue;
        }
        if (v !== null && ((kind === 'int' && (!Number.isInteger(v) || v < 0)) || (kind === 'pct' && (v < 0 || v > 1)))) {
          errors.push(`${c.dept}: ${kind === 'pct' ? 'a share 0–100%' : 'a whole number'}`);
          continue;
        }
        const [b] = await tx.select().from(schema.adminPayroll).where(and(eq(schema.adminPayroll.versionId, versionId), eq(schema.adminPayroll.dept, c.dept)));
        from = (b?.[c.field] as number | null | undefined) ?? null;
        await tx
          .insert(schema.adminPayroll)
          .values({ versionId, dept: c.dept, [c.field]: v, updatedBy: user.id })
          .onConflictDoUpdate({ target: [schema.adminPayroll.versionId, schema.adminPayroll.dept], set: { [c.field]: v, updatedAt: new Date(), updatedBy: user.id } });
      } else if (c.kind === 'admin') {
        if (!ADMIN_ACCOUNT.has(c.account) || isPayrollAccount(c.account) || !PAYERS.some((p) => p.code === c.entity)) {
          errors.push(`${c.account}: not an admin overhead input`);
          continue;
        }
        const tab = SCHEDULE_ACCOUNT.get(c.account);
        if (tab) {
          errors.push(`${ADMIN_ACCOUNT.get(c.account)!.name}: entered in the ${ITEM_KIND.get(tab)!.label} tab`);
          continue;
        }
        const where = and(eq(schema.adminBudget.versionId, versionId), eq(schema.adminBudget.dept, c.dept), eq(schema.adminBudget.account, c.account), eq(schema.adminBudget.entity, c.entity));
        from = (await tx.select().from(schema.adminBudget).where(where))[0]?.amount ?? null;
        if (v === null) await tx.delete(schema.adminBudget).where(where);
        else
          await tx
            .insert(schema.adminBudget)
            .values({ versionId, dept: c.dept, account: c.account, entity: c.entity, amount: v, updatedBy: user.id })
            .onConflictDoUpdate({
              target: [schema.adminBudget.versionId, schema.adminBudget.dept, schema.adminBudget.account, schema.adminBudget.entity],
              set: { amount: v, updatedAt: new Date(), updatedBy: user.id },
            });
      } else {
        if (!FEES.some((f) => f.key === c.fee) || !FEE_ENTITIES.some((e) => e.key === c.entity) || (c.field !== 'rate' && c.field !== 'base')) {
          errors.push(`${c.fee} ${c.entity}: not a management fee input`);
          continue;
        }
        if (v !== null && (v < 0 || (c.field === 'rate' && v > 1))) {
          errors.push(`${c.fee} ${c.entity}: ${c.field === 'rate' ? 'a rate 0–100%' : 'not a negative base'}`);
          continue;
        }
        const where = and(eq(schema.adminFees.versionId, versionId), eq(schema.adminFees.fee, c.fee), eq(schema.adminFees.entity, c.entity));
        from = ((await tx.select().from(schema.adminFees).where(where))[0]?.[c.field] as number | null | undefined) ?? null;
        await tx
          .insert(schema.adminFees)
          .values({ versionId, fee: c.fee, entity: c.entity, [c.field]: v, updatedBy: user.id })
          .onConflictDoUpdate({ target: [schema.adminFees.versionId, schema.adminFees.fee, schema.adminFees.entity], set: { [c.field]: v, updatedAt: new Date(), updatedBy: user.id } });
        // both back to the defaults: nothing to keep
        await tx.delete(schema.adminFees).where(and(where, isNull(schema.adminFees.rate), isNull(schema.adminFees.base)));
      }
      await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'admin_overheads', entityId: JSON.stringify({ ...c, value: undefined }), action: 'update', changes: { from, to: v } });
      saved++;
    }
  });
  return { saved, errors };
}

/** An entity-level cost of the statements (not a building's): G&A lines and the AMA fee. */
export interface EntityCost {
  entity: EntityKey;
  /** an EXPENSE_LINES key (section 'ga') */
  line: string;
  months: number[];
  /** cash paid by month when it differs (capitalised payroll is still paid: no cash effect) */
  cash?: number[];
}

/** G&A of a version for the statements, by entity and month; `lines`: the G&A lines budgeted. */
export async function adminEntityCosts(version: schema.BudgetVersion): Promise<{ costs: EntityCost[]; lines: Set<string> }> {
  const [payroll, budget, fees, itemRows] = await Promise.all([
    db.select().from(schema.adminPayroll).where(eq(schema.adminPayroll.versionId, version.id)),
    db.select().from(schema.adminBudget).where(eq(schema.adminBudget.versionId, version.id)),
    managementFees(version),
    db.select().from(schema.adminItems).where(eq(schema.adminItems.versionId, version.id)),
  ]);
  const costs: EntityCost[] = [];
  const lines = new Set<string>();
  // admin overheads, by the company that pays them: the back-up schedules (in the month paid, or evenly),
  // and the typed amount of each department × account without a schedule; office & IT capex is paid,
  // not expensed (cash flow only)
  const oh = new Map<string, number[]>();
  const capex = new Map<string, number[]>();
  const scheduled = new Set<string>();
  // what ANPM pays for each department: the 2026 rules capitalise and recharge a share of it too
  const anpmOh = new Map<string, number>();
  const into = (m: Map<string, number[]>, payer: string, months: number[], dept?: string) => {
    const a = m.get(payer) ?? z12();
    months.forEach((v, i) => (a[i] += v));
    m.set(payer, a);
    if (dept && payer === '521') anpmOh.set(dept, (anpmOh.get(dept) ?? 0) + months.reduce((s, v) => s + v, 0));
  };
  for (const r of itemRows) {
    if (!isItemKind(r.kind)) continue;
    for (const p of postingsOf({ kind: r.kind, dept: r.dept, data: r.data as ItemData })) {
      const months = p.month ? z12().map((_, i) => (i === p.month! - 1 ? p.amount : 0)) : flat(p.amount);
      if (p.account === CAPEX) into(capex, r.payer, months);
      else {
        into(oh, r.payer, months, p.dept);
        scheduled.add(`${p.dept}|${p.account}|${r.payer}`);
      }
    }
  }
  // depreciation accounts are below EBITDA and not paid (as the 2026 budget)
  const dep = new Map<string, number[]>();
  for (const b of budget) {
    if (SCHEDULE_ACCOUNT.has(b.account) || scheduled.has(`${b.dept}|${b.account}|${b.entity}`)) continue;
    // (still part of the department's overheads the payroll rules apply to, as PayrollxCost)
    if (ADMIN_ACCOUNT.get(b.account)?.group === 'Depreciation') into(dep, b.entity, flat(b.amount), b.dept);
    else into(oh, b.entity, flat(b.amount), b.dept);
  }
  // payroll: ANPM's, less what is capitalised (still paid) and what is recharged (received back), both
  // taken on payroll and the department's overheads as the 2026 rules
  let gross = 0;
  let cap = 0;
  let recharged = 0;
  for (const p of payroll) {
    const s = payrollSplit(p, anpmOh.get(p.dept) ?? 0, withDefaults(version.assumptions).payrollRules);
    gross += s.total;
    cap += s.cap;
    recharged += s.mjnh + s.asre;
  }
  if (gross || cap || recharged) {
    lines.add('payroll').add('payrollCap').add('payrollRecharge');
    costs.push(
      { entity: '521', line: 'payroll', months: flat(gross) },
      { entity: '521', line: 'payrollCap', months: flat(-cap), cash: z12() },
      { entity: '521', line: 'payrollRecharge', months: flat(-recharged) },
    );
  }
  for (const [payer, months] of oh) {
    lines.add('adminOh');
    costs.push({ entity: payer as EntityKey, line: 'adminOh', months });
  }
  for (const [payer, months] of dep) {
    lines.add('depreciation');
    costs.push({ entity: payer as EntityKey, line: 'depreciation', months, cash: z12() });
  }
  for (const [payer, months] of capex) {
    lines.add('gaCapex');
    costs.push({ entity: payer as EntityKey, line: 'gaCapex', months });
  }
  // AMA fee to MJNH: the rate × each landlord entity's asset value
  for (const r of fees.rows)
    if (r.fee === 'AMA' && r.amount) {
      lines.add('ama');
      // paid at each quarter end (Mar, Jun, Sep, Dec), as the 2026 budget; the expense stays monthly
      costs.push({ entity: r.entity, line: 'ama', months: fees.months.AMA[r.entity], cash: quarterlyCash(fees.months.AMA[r.entity], 'arrears') });
    }
  return { costs, lines };
}
