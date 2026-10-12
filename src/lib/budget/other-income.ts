// Other income by property × GL account: actuals (GL), the current-year forecast and the budget.
// Company-level items sit on each BU's General row. The maintenance service fee budget comes from
// the leases (5% of renewal / new-tenant rent, in the month the contract starts); everything else is
// entered by the property manager (properties) or Finance (General) and phased evenly over 12 months.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { canEditProperty, entersData, isFinance, type EditCheck } from '@/lib/auth/permissions';
import type { Actor } from '@/lib/auth/permissions';
import { writeGuard } from '@/lib/write-guard';
import { OI_ACCOUNT, OI_INPUT, OI_STORED, oiInput, type OiBlock, type OiChange, type OiPeriod } from './other-income-types';
import { managementFees } from './admin';
import { referenceBudget } from './reference';
import { FD_INTEREST_ACCOUNT, treasuryForStatements } from './treasury';
import { PMA_FEE } from './group';

export async function loadOtherIncome(version: schema.BudgetVersion, user: Actor, props: schema.Property[], editable: Set<number>): Promise<OiBlock[]> {
  const ids = props.map((p) => p.id);
  const bus = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  const finance = isFinance(user);
  const open = version.status !== 'LOCKED';

  const blocks = new Map<string, OiBlock>();
  for (const p of props) {
    blocks.set(`P:${p.id}`, {
      scope: `P:${p.id}`,
      kind: 'P',
      propertyId: p.id,
      buCode: p.buCode,
      buName: bus.get(p.buCode) ?? p.buCode,
      code: p.code,
      name: p.name,
      pm: p.coordinator,
      editable: editable.has(p.id),
      values: {},
      mfBudget: 0,
    });
  }
  // company-level items: Finance only; every business unit (ANPM has no properties of its own)
  if (finance) {
    for (const bu of [...bus.keys()]) {
      blocks.set(`G:${bu}`, {
        scope: `G:${bu}`,
        kind: 'G',
        propertyId: null,
        buCode: bu,
        buName: bus.get(bu) ?? bu,
        code: 'General',
        name: 'Company level',
        pm: null,
        editable: open && entersData(user, 'FIN'),
        values: {},
        mfBudget: 0,
      });
    }
  }

  const stored = await db.select().from(schema.otherIncome).where(eq(schema.otherIncome.versionId, version.id));
  for (const r of stored) {
    const b = blocks.get(r.scope);
    if (!b) continue;
    (b.values[r.account] ??= {})[r.period as OiPeriod] = r.amount;
  }

  // maintenance service fee from the lease calculation
  if (ids.length) {
    const mf = await db
      .select({ propertyId: schema.leaseLines.propertyId, amount: sql<string>`sum(coalesce((${schema.leaseLines.calc}->'totals'->>'maintenance')::numeric, 0))` })
      .from(schema.leaseLines)
      .where(and(eq(schema.leaseLines.versionId, version.id), inArray(schema.leaseLines.propertyId, ids)))
      .groupBy(schema.leaseLines.propertyId);
    for (const m of mf) {
      const b = blocks.get(`P:${m.propertyId}`);
      if (b) b.mfBudget = Math.round(Number(m.amount) * 100) / 100;
    }
  }

  // last year's approved budget, reference only (2026B from the 2026 workbook)
  for (const r of await referenceBudget(version.year - 1, 'oi')) {
    const b = blocks.get(r.propertyId !== null ? `P:${r.propertyId}` : r.scope);
    if (b) (b.prior ??= {})[r.account] = (b.prior[r.account] ?? 0) + r.amount;
  }

  // ANPM's PMA fee is calculated: each landlord's rate × base, from Admin overheads (2026 budget: 6% of rent)
  const pmaBlock = blocks.get(PMA_FEE.scope);
  if (pmaBlock) {
    const { rows } = await managementFees(version);
    pmaBlock.calcB = { [PMA_FEE.account]: Math.round(rows.reduce((s, r) => s + (r.fee === 'PMA' ? (r.amount ?? 0) : 0), 0) * 100) / 100 };
  }

  // deposit interest of the companies: calculated from Finance → Fixed deposits (it replaced the typed figure)
  if (finance) {
    const fd = new Map((await treasuryForStatements(version)).fdInterest.map((x) => [x.entity, x.months.reduce((s, v) => s + v, 0)]));
    for (const b of blocks.values()) if (b.kind === 'G') b.calcB = { ...b.calcB, [FD_INTEREST_ACCOUNT]: Math.round((fd.get(b.buCode) ?? 0) * 100) / 100 };
  }

  return [...blocks.values()].sort((a, b) => a.buCode.localeCompare(b.buCode) || (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'G' ? 1 : -1));
}

/** Saves typed values (Oct–Dec forecast, budget). Properties: whoever may edit the property; General: Finance. */
export async function saveOtherIncome(user: Actor, versionId: number, changes: OiChange[]): Promise<{ saved: number; errors: string[] }> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { saved: 0, errors: ['Version not found'] };
  if (version.status === 'LOCKED') return { saved: 0, errors: ['This budget version is locked'] };

  const errors: string[] = [];
  const props = new Map((await db.select().from(schema.properties)).map((p) => [p.id, p]));
  let saved = 0;
  const propertyOf = (scope: string) => {
    const m = /^P:(\d+)$/.exec(scope);
    return m && props.has(Number(m[1])) ? Number(m[1]) : null;
  };

  // every value and its audit row land together, in one transaction: the properties' statuses and the
  // cells are read in here and held until it commits (a submission or lock waits for it); the cells are
  // read and written in a few statements, not one round trip per cell
  await db.transaction(async (tx) => {
    const cur = await writeGuard(tx, versionId, { properties: changes.map((c) => propertyOf(c.scope)).filter((id): id is number => id !== null) });
    if (!cur || cur.status === 'LOCKED') {
      errors.push(cur ? 'This budget version is locked' : 'Version not found');
      return;
    }
    const checks = new Map<string, EditCheck>();
    const todo: { c: OiChange; buCode: string; propertyId: number | null }[] = [];
    for (const c of changes) {
      const acct = OI_ACCOUNT.get(c.account);
      if (!acct || !(OI_STORED as readonly string[]).includes(c.period) || !OI_INPUT.includes(c.period)) {
        errors.push(`${c.account} ${c.period}: not an input`);
        continue;
      }
      if (c.amount !== null && (!Number.isFinite(c.amount) || Math.abs(c.amount) > 1e11)) {
        errors.push(`${c.account}: not a valid amount`);
        continue;
      }
      const m = /^([PG]):(.+)$/.exec(c.scope);
      if (!m) {
        errors.push(`${c.scope}: unknown row`);
        continue;
      }
      let propertyId: number | null = null;
      let buCode: string;
      if (m[1] === 'P') {
        propertyId = Number(m[2]);
        const p = props.get(propertyId);
        if (!p) {
          errors.push(`${c.scope}: unknown property`);
          continue;
        }
        buCode = p.buCode;
        if (!oiInput({ kind: 'P' } as OiBlock, c.account, c.period)) {
          errors.push(`${p.code} ${acct.name}: calculated from the leases`);
          continue;
        }
        if (!checks.has(c.scope)) checks.set(c.scope, await canEditProperty(user, versionId, propertyId, 'PM', tx));
        const check = checks.get(c.scope)!;
        if (!check.ok) {
          errors.push(`${p.code}: ${check.reason}`);
          continue;
        }
      } else {
        buCode = m[2];
        if (c.account === FD_INTEREST_ACCOUNT && c.period === 'B') {
          errors.push('Deposit interest is calculated from Finance → Fixed deposits');
          continue;
        }
        if (c.scope === PMA_FEE.scope && c.account === PMA_FEE.account && c.period === 'B') {
          errors.push("The PMA fee is calculated: the rate × the base per landlord, in Admin overheads");
          continue;
        }
        if (!entersData(user, 'FIN')) {
          errors.push(`General ${buCode}: entered by Finance`);
          continue;
        }
      }
      todo.push({ c, buCode, propertyId });
    }
    if (!todo.length) return;
    const t = schema.otherIncome;
    const rows = await tx
      .select({ scope: t.scope, account: t.account, period: t.period, amount: t.amount })
      .from(t)
      .where(and(eq(t.versionId, versionId), inArray(t.scope, [...new Set(todo.map((x) => x.c.scope))]), inArray(t.account, [...new Set(todo.map((x) => x.c.account))])));
    // each cell as it stands while the changes are applied in order (a cell changed twice: the second sees the first)
    const keyOf = (scope: string, account: string, period: string) => `${scope}|${account}|${period}`;
    const state = new Map<string, number | null>(rows.map((r) => [keyOf(r.scope, r.account, r.period), r.amount]));
    const upserts = new Map<string, typeof t.$inferInsert>();
    const deletes = new Map<string, OiChange>();
    const trail: (typeof schema.auditLog.$inferInsert)[] = [];
    for (const { c, buCode, propertyId } of todo) {
      const k = keyOf(c.scope, c.account, c.period);
      const before = state.has(k) ? state.get(k)! : null;
      if (before === c.amount) continue;
      if (c.amount === null) {
        upserts.delete(k);
        deletes.set(k, c);
      } else {
        deletes.delete(k);
        upserts.set(k, { versionId, buCode, propertyId, scope: c.scope, account: c.account, period: c.period, amount: c.amount, updatedBy: user.id });
      }
      state.set(k, c.amount);
      trail.push({ userId: user.id, versionId, propertyId, entity: 'other_income', entityId: k, action: 'update', changes: { from: before, to: c.amount } });
      saved++;
    }
    if (deletes.size)
      await tx
        .delete(t)
        .where(and(eq(t.versionId, versionId), sql`(${t.scope}, ${t.account}, ${t.period}) in (${sql.join([...deletes.values()].map((d) => sql`(${d.scope}::text, ${d.account}::text, ${d.period}::text)`), sql`, `)})`));
    const ins = [...upserts.values()];
    for (let i = 0; i < ins.length; i += 500)
      await tx
        .insert(t)
        .values(ins.slice(i, i + 500))
        .onConflictDoUpdate({ target: [t.versionId, t.scope, t.account, t.period], set: { amount: sql`excluded.amount`, updatedAt: new Date(), updatedBy: user.id } });
    for (let i = 0; i < trail.length; i += 500) await tx.insert(schema.auditLog).values(trail.slice(i, i + 500));
  });
  return { saved, errors };
}
