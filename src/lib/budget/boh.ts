// Building overheads by building × GL account: GL actuals (reference only) and the budget. The budget of
// an account is entered by the property manager (PM accounts) or Finance (Finance accounts), or
// calculated: water & electricity (forecast × (1 + %)), insurance (insured value × rate, liability
// premium), watchmen (security allocation), accounts with a contract schedule (AMC tabs), and municipal
// charges (last year's forecast until entered). The budget is phased by month for the P&L: flat, the
// seasonal pattern (water & electricity), the month paid, or the contracts' terms.
import 'server-only';
import { cache } from 'react';
import { and, eq, gte, inArray, like, lte, max, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { canEditProperty, type Actor, type EditCheck } from '@/lib/auth/permissions';
import { writeGuard } from '@/lib/write-guard';
import { clash } from '@/lib/conflict';
import { withDefaults } from '@/lib/engine/assumptions';
import { BOH_ACCOUNT, BOH_ACCOUNTS, CONTRACT_KIND_OF, phase, type BohBlock, type BohCalc, type BohChange, type BohLine, type BohRow } from './boh-types';
import { referenceBudget } from './reference';
import { frozen } from './snapshot-store';
import { contractYear, type ContractInput, forecastY1, parBudget, plBudget, waterBudget, watchmenBudget } from './boh-calc';

const z12 = () => Array.from({ length: 12 }, () => 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const WATER = '62324';
const PAR = '64601';
const PL = '64604';
const WATCHMEN = '62603';
const MUNICIPAL = '64802';

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

/** Everything the budget of the buildings is worked out from. */
async function bohContext(version: schema.BudgetVersion, ids: number[]) {
  const by = <T extends { propertyId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.propertyId, [...(m.get(r.propertyId) ?? []), r]);
    return m;
  };
  const [{ m, cutoff }, budget, insurance, watchmen, contracts, patterns] = await Promise.all([
    actualsFor(version.year, ids),
    ids.length ? db.select().from(schema.bohBudget).where(and(eq(schema.bohBudget.versionId, version.id), inArray(schema.bohBudget.propertyId, ids))) : Promise.resolve([]),
    ids.length ? db.select().from(schema.bohInsurance).where(and(eq(schema.bohInsurance.versionId, version.id), inArray(schema.bohInsurance.propertyId, ids))) : Promise.resolve([]),
    ids.length ? db.select().from(schema.bohWatchmen).where(and(eq(schema.bohWatchmen.versionId, version.id), inArray(schema.bohWatchmen.propertyId, ids))) : Promise.resolve([]),
    ids.length ? db.select().from(schema.bohContracts).where(and(eq(schema.bohContracts.versionId, version.id), inArray(schema.bohContracts.propertyId, ids))) : Promise.resolve([]),
    seasonalPatterns(version.year),
  ]);
  // a locked version keeps the cells it was locked with (water & electricity, municipal, phasing, contracts)
  const snap = await frozen<BohSnapshot>(version, 'boh');
  const frozenCells = snap ? new Map(snap.cells.map(([pid, account, cell]) => [`${pid}|${account}`, cell])) : null;
  return {
    frozen: frozenCells,
    version,
    a: withDefaults(version.assumptions),
    // the imported 2026 budget is history: nothing is calculated for it
    calcOn: !version.isBaseline,
    m,
    cutoff: snap ? snap.cutoff : cutoff,
    budget: by(budget),
    insurance: new Map(insurance.map((i) => [i.propertyId, i])),
    watchmen: new Map(watchmen.map((w) => [w.propertyId, w.share])),
    contracts: by(contracts),
    patterns,
  };
}
type BohContext = Awaited<ReturnType<typeof bohContext>>;

/**
 * The context for the read paths (page, summary, statements), shared within one request: the same
 * version and set of buildings is worked out once however many loaders ask for it. Writes keep
 * calling bohContext directly so they never see a stale copy.
 */
const bohContextRead = cache((version: schema.BudgetVersion, idsKey: string) => bohContext(version, idsKey ? idsKey.split(',').map(Number) : []));
const readCtx = (version: schema.BudgetVersion, ids: number[]) => bohContextRead(version, [...new Set(ids)].sort((a, b) => a - b).join(','));

interface BohCell {
  row: BohRow;
  /** budget by month (expense) and the cash paid by month */
  months: number[];
  cash: number[];
}

/** One building's account: its actuals, forecast, budget (entered or calculated) and phasing. */
function cellOf(ctx: BohContext, propertyId: number, account: string): BohCell {
  if (ctx.frozen) {
    const f = ctx.frozen.get(`${propertyId}|${account}`);
    // a copy: the page adds its reference figures to the row
    return f ? structuredClone(f) : { row: { account, a2: null, a1: null, ytd: null, f: null, b: null, entered: null, calc: null, dueMonth: null, defaultDue: 1 }, months: z12(), cash: z12() };
  }
  return liveCell(ctx, propertyId, account);
}

/** the building overheads as stored when a version is locked (version_snapshots): cells with figures only */
export interface BohSnapshot {
  cutoff: number;
  cells: [number, string, BohCell][];
}

/** Every building's cells worked out now, for a snapshot. */
export async function bohSnapshot(version: schema.BudgetVersion): Promise<BohSnapshot> {
  const ids = (await db.select({ id: schema.properties.id }).from(schema.properties)).map((p) => p.id);
  const ctx = await bohContext({ ...version, status: 'OPEN' }, ids);
  const cells: BohSnapshot['cells'] = [];
  for (const id of ids)
    for (const a of BOH_ACCOUNTS) {
      const c = liveCell(ctx, id, a.code);
      const r = c.row;
      if ([r.a2, r.a1, r.ytd, r.f, r.b, r.entered].some((v) => v !== null) || c.months.some((v) => v) || c.cash.some((v) => v)) cells.push([id, a.code, c]);
    }
  return { cutoff: ctx.cutoff, cells };
}

function liveCell(ctx: BohContext, propertyId: number, account: string): BohCell {
  const a = BOH_ACCOUNT.get(account)!;
  const Y = ctx.version.year;
  const yrs = ctx.m.get(propertyId)?.get(account);
  const ytd = yrs?.get(Y - 1);
  const last = yrs?.get(Y - 2);
  const f = forecastY1(a.phasing, ytd, last, ctx.cutoff, account === WATER ? ctx.a.bohUtilitiesPct : 0);
  const stored = ctx.budget.get(propertyId)?.find((x) => x.account === account);
  const entered = stored?.amount ?? null;
  const defaultDue = peak(last) ?? peak(ytd) ?? 1;
  const due = stored?.dueMonth ?? defaultDue;

  let calc: BohCalc | null = null;
  let b = entered;
  const contracts = ctx.contracts.get(propertyId)?.filter((c) => c.account === account) ?? [];
  if (ctx.calcOn) {
    const ins = ctx.insurance.get(propertyId);
    const share = ctx.watchmen.get(propertyId);
    // water & electricity is calculated from last year's forecast; a building with no history (no
    // forecast) takes the amount typed instead (audit FIN-011)
    if (account === WATER && f) [calc, b] = ['water', waterBudget(f, ctx.a.bohUtilitiesPct)];
    else if (account === PAR && ins?.insuredValue && ins.parRate) [calc, b] = ['insurance', parBudget(ins.insuredValue, ins.parRate, ctx.a.insParPct)];
    else if (account === PL && ins?.plPremium) [calc, b] = ['insurance', plBudget(ins.plPremium, ctx.a.insPlPct)];
    else if (account === WATCHMEN && share) [calc, b] = ['watchmen', watchmenBudget(share, ctx.a.watchmanCost)];
    else if (CONTRACT_KIND_OF.has(account) && contracts.length) [calc, b] = ['contracts', r2(contracts.reduce((s, c) => s + contractYear(c as ContractInput, Y).total, 0))];
    else if (account === MUNICIPAL && entered === null && f) [calc, b] = ['forecast', f];
  }

  let months: number[];
  let cash: number[];
  if (calc === 'contracts') {
    // each contract over its own period: only its days in the year are booked; paid by its terms (FIN-008)
    months = z12();
    cash = z12();
    for (const c of contracts) {
      const y = contractYear(c as ContractInput, Y);
      y.expense.forEach((v, i) => (months[i] += v));
      y.cash.forEach((v, i) => (cash[i] += v));
    }
  } else {
    months = phase(b ?? 0, a.phasing, due, ctx.patterns.get(account));
    cash = a.paidUpfront ? phase(b ?? 0, 'due', due) : months;
  }
  return {
    row: {
      account,
      a2: sum(yrs?.get(Y - 3)),
      a1: sum(last),
      ytd: ytd ? sum(ytd.slice(0, ctx.cutoff || 12)) : null,
      f,
      b,
      entered,
      calc,
      dueMonth: stored?.dueMonth ?? null,
      defaultDue,
    },
    months,
    cash,
  };
}

/** A version's budget of one account over all buildings, entered or calculated (null: none). */
export async function bohAccountBudget(version: schema.BudgetVersion, account: string): Promise<number | null> {
  const ids = (await db.select({ id: schema.properties.id }).from(schema.properties)).map((p) => p.id);
  const ctx = await readCtx(version, ids);
  const bs = ids.map((id) => cellOf(ctx, id, account).row.b).filter((b): b is number => b !== null);
  return bs.length ? r2(bs.reduce((s, b) => s + b, 0)) : null;
}

/** `editable`: buildings whose property manager inputs the user may change; `finEditable`: Finance's inputs */
export async function loadBuildingOverheads(version: schema.BudgetVersion, props: schema.Property[], editable: Set<number>, finEditable: Set<number> = new Set()) {
  const ids = props.map((p) => p.id);
  const bus = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  const ctx = await readCtx(version, ids);
  const blocks: BohBlock[] = props.map((p) => ({
    propertyId: p.id,
    code: p.code,
    name: p.name,
    buCode: p.buCode,
    buName: bus.get(p.buCode) ?? p.buCode,
    pm: p.coordinator,
    editable: editable.has(p.id),
    finEditable: finEditable.has(p.id),
    rows: BOH_ACCOUNTS.map((a) => cellOf(ctx, p.id, a.code).row),
  }));
  // who entered each amount last, and when (shown on hover)
  const entered = ids.length
    ? await db
        .select({ propertyId: schema.bohBudget.propertyId, account: schema.bohBudget.account, at: schema.bohBudget.updatedAt, by: schema.users.name })
        .from(schema.bohBudget)
        .leftJoin(schema.users, eq(schema.users.id, schema.bohBudget.updatedBy))
        .where(and(eq(schema.bohBudget.versionId, version.id), inArray(schema.bohBudget.propertyId, ids)))
    : [];
  const updated = new Map(entered.map((e) => [`${e.propertyId}|${e.account}`, { by: e.by, at: e.at.toISOString() }]));
  for (const b of blocks) for (const r of b.rows) if (updated.has(`${b.propertyId}|${r.account}`)) r.updated = updated.get(`${b.propertyId}|${r.account}`);
  // last year's approved budget, reference only (2026B from the 2026 workbook)
  const ref = await referenceBudget(version.year - 1, 'boh', ids);
  for (const b of blocks) {
    for (const r of ref.filter((x) => x.propertyId === b.propertyId)) {
      const row = b.rows.find((x) => x.account === r.account);
      if (row) Object.assign(row, { pb: (row.pb ?? 0) + r.amount, pbNote: r.note });
      else (b.pbOther ??= []).push({ account: r.account, amount: r.amount, note: r.note });
    }
  }
  return { blocks, cutoff: ctx.cutoff, priorLabel: ref.length ? `${version.year - 1}B` : null };
}

/** a calculated budget is changed where it is calculated, not typed (municipal charges excepted) */
const fixedCalc = (calc: BohCalc | null) => calc !== null && calc !== 'forecast';

/** Saves budget amounts and due months. PM accounts: whoever may edit the property; Finance accounts: Finance. */
export async function saveBuildingOverheads(user: Actor, versionId: number, changes: BohChange[]): Promise<{ saved: number; errors: string[] }> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { saved: 0, errors: ['Version not found'] };
  if (version.status === 'LOCKED') return { saved: 0, errors: ['This budget version is locked'] };
  const props = new Map((await db.select().from(schema.properties)).map((p) => [p.id, p]));
  const ctx = await bohContext(version, [...new Set(changes.map((c) => c.propertyId))].filter((id) => props.has(id)));
  const errors: string[] = [];
  let saved = 0;
  type Cell = { amount: number; dueMonth: number | null } | null;
  // every value and its audit row land together, in one transaction: the buildings' statuses and the cells
  // are read in here and held until it commits (a submission or lock waits for it); the cells are read and
  // written in a few statements, not one round trip per cell
  await db.transaction(async (tx) => {
    const cur = await writeGuard(tx, versionId, { properties: changes.map((c) => c.propertyId).filter((id) => props.has(id)) });
    if (!cur || cur.status === 'LOCKED') {
      errors.push(cur ? 'This budget version is locked' : 'Version not found');
      return;
    }
    const checks = new Map<string, EditCheck>();
    const todo: { p: schema.Property; c: BohChange; acct: NonNullable<ReturnType<typeof BOH_ACCOUNT.get>>; after: Cell }[] = [];
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
      const calc = cellOf(ctx, p.id, c.account).row.calc;
      if (fixedCalc(calc) && c.amount !== null) {
        errors.push(`${p.code} ${acct.name}: calculated (${calc === 'contracts' ? 'the contract schedule' : calc === 'watchmen' ? 'Security allocation' : 'Assumptions'})`);
        continue;
      }
      // whose input the account is decides who may change it (and when)
      const key = `${p.id}|${acct.owner}`;
      if (!checks.has(key)) checks.set(key, await canEditProperty(user, versionId, p.id, acct.owner, tx));
      const check = checks.get(key)!;
      if (!check.ok) {
        errors.push(`${p.code} ${acct.name}: ${check.reason}`);
        continue;
      }
      todo.push({ p, c, acct, after: c.amount === null ? null : { amount: c.amount, dueMonth: acct.phasing === 'due' || acct.paidUpfront ? c.dueMonth : null } });
    }
    if (!todo.length) return;
    const b = schema.bohBudget;
    const rows = await tx
      .select()
      .from(b)
      .where(and(eq(b.versionId, versionId), inArray(b.propertyId, [...new Set(todo.map((t) => t.p.id))]), inArray(b.account, [...new Set(todo.map((t) => t.c.account))])));
    // each cell as it stands while the changes are applied in order (a cell changed twice: the second sees the first)
    const state = new Map<string, Cell>(rows.map((r) => [`${r.propertyId}|${r.account}`, { amount: r.amount, dueMonth: r.dueMonth }]));
    const stored = new Map(state);
    const upserts = new Map<string, typeof b.$inferInsert>();
    const deletes = new Map<string, { propertyId: number; account: string }>();
    const trail: (typeof schema.auditLog.$inferInsert)[] = [];
    for (const { p, c, acct, after } of todo) {
      const k = `${p.id}|${c.account}`;
      // a cell someone else changed after the user loaded it is left as it is (lib/conflict.ts)
      if (c.seen) {
        const now = stored.get(k) ?? null;
        const was = { amount: now?.amount ?? null, dueMonth: now?.dueMonth ?? null };
        const mine = { amount: after?.amount ?? null, dueMonth: after?.dueMonth ?? null };
        const seen = { amount: c.seen.amount ?? null, dueMonth: c.seen.amount === null ? null : (c.seen.dueMonth ?? null) };
        const message = await clash(tx, user.id, `${p.code} ${acct.name}`, { entity: 'boh_budget', entityId: k }, seen, was, mine, { show: [was.amount, mine.amount] });
        if (message) {
          errors.push(message);
          continue;
        }
      }
      const before = state.get(k) ?? null;
      if ((before?.amount ?? null) === (after?.amount ?? null) && (before?.dueMonth ?? null) === (after?.dueMonth ?? null)) continue;
      if (!after) {
        upserts.delete(k);
        deletes.set(k, { propertyId: p.id, account: c.account });
      } else {
        deletes.delete(k);
        upserts.set(k, { versionId, propertyId: p.id, account: c.account, ...after, updatedBy: user.id });
      }
      state.set(k, after);
      trail.push({ userId: user.id, versionId, propertyId: p.id, entity: 'boh_budget', entityId: k, action: 'update', changes: { from: before ? { amount: before.amount, dueMonth: before.dueMonth } : null, to: after } });
      saved++;
    }
    if (deletes.size)
      await tx.delete(b).where(and(eq(b.versionId, versionId), sql`(${b.propertyId}, ${b.account}) in (${sql.join([...deletes.values()].map((d) => sql`(${d.propertyId}::int, ${d.account}::text)`), sql`, `)})`));
    const ins = [...upserts.values()];
    for (let i = 0; i < ins.length; i += 500)
      await tx
        .insert(b)
        .values(ins.slice(i, i + 500))
        .onConflictDoUpdate({ target: [b.versionId, b.propertyId, b.account], set: { amount: sql`excluded.amount`, dueMonth: sql`excluded.due_month`, updatedAt: new Date(), updatedBy: user.id } });
    for (let i = 0; i < trail.length; i += 500) await tx.insert(schema.auditLog).values(trail.slice(i, i + 500));
  });
  return { saved, errors };
}

/**
 * Budgeted building overheads of a version, by building, Building P&L line and month (the expense
 * lines of the statements): the expense, and the cash (premiums paid upfront in the month paid).
 * `lines`: the lines with a budget in the version (entered or calculated).
 */
export async function bohMonthly(version: schema.BudgetVersion, propertyIds?: number[]) {
  const ids = propertyIds ?? (await db.select({ id: schema.properties.id }).from(schema.properties).where(eq(schema.properties.active, true))).map((p) => p.id);
  const lines = new Set<BohLine>();
  const out = new Map<number, Partial<Record<BohLine, { months: number[]; cash: number[] }>>>();
  if (!ids.length) return { byProperty: out, lines };
  const ctx = await readCtx(version, ids);
  for (const id of ids)
    for (const acct of BOH_ACCOUNTS) {
      const cell = cellOf(ctx, id, acct.code);
      if (!cell.row.b) continue;
      lines.add(acct.line);
      const r = out.get(id) ?? {};
      const into = r[acct.line] ?? { months: z12(), cash: z12() };
      cell.months.forEach((v, i) => (into.months[i] += v));
      cell.cash.forEach((v, i) => (into.cash[i] += v));
      r[acct.line] = into;
      out.set(id, r);
    }
  return { byProperty: out, lines };
}
