// Other income by property × GL account: actuals (GL), the current-year forecast and the budget.
// Company-level items sit on each BU's General row. The maintenance service fee budget comes from
// the leases (5% of renewal / new-tenant rent, in the month the contract starts); everything else is
// entered by the property manager (properties) or Finance (General) and phased evenly over 12 months.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { canEditProperty, isFinance, type EditCheck } from '@/lib/auth/permissions';
import type { Actor } from '@/lib/auth/permissions';
import { OI_ACCOUNT, OI_INPUT, OI_STORED, oiInput, type OiBlock, type OiChange, type OiPeriod } from './other-income-types';
import { managementFees } from './admin';
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
        editable: open,
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

  // ANPM's PMA fee is calculated: each landlord's rate × base, from Admin overheads (2026 budget: 6% of rent)
  const pmaBlock = blocks.get(PMA_FEE.scope);
  if (pmaBlock) {
    const { rows } = await managementFees(version);
    pmaBlock.calcB = { [PMA_FEE.account]: Math.round(rows.reduce((s, r) => s + (r.fee === 'PMA' ? (r.amount ?? 0) : 0), 0) * 100) / 100 };
  }

  return [...blocks.values()].sort((a, b) => a.buCode.localeCompare(b.buCode) || (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'G' ? 1 : -1));
}

/** Saves typed values (Oct–Dec forecast, budget). Properties: whoever may edit the property; General: Finance. */
export async function saveOtherIncome(user: Actor, versionId: number, changes: OiChange[]): Promise<{ saved: number; errors: string[] }> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { saved: 0, errors: ['Version not found'] };
  if (version.status === 'LOCKED') return { saved: 0, errors: ['This budget version is locked'] };

  const errors: string[] = [];
  const checks = new Map<string, EditCheck>();
  const props = new Map((await db.select().from(schema.properties)).map((p) => [p.id, p]));
  let saved = 0;

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
      if (!checks.has(c.scope)) checks.set(c.scope, await canEditProperty(user, versionId, propertyId));
      const check = checks.get(c.scope)!;
      if (!check.ok) {
        errors.push(`${p.code}: ${check.reason}`);
        continue;
      }
    } else {
      buCode = m[2];
      if (c.scope === PMA_FEE.scope && c.account === PMA_FEE.account && c.period === 'B') {
        errors.push("The PMA fee is calculated: the rate × the base per landlord, in Admin overheads");
        continue;
      }
      if (!isFinance(user)) {
        errors.push(`General ${buCode}: Finance only`);
        continue;
      }
    }

    const where = and(
      eq(schema.otherIncome.versionId, versionId),
      eq(schema.otherIncome.scope, c.scope),
      eq(schema.otherIncome.account, c.account),
      eq(schema.otherIncome.period, c.period),
    );
    // the value and its audit row land together or not at all
    const written = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.otherIncome).where(where);
      if ((before?.amount ?? null) === c.amount) return false;
      if (c.amount === null) await tx.delete(schema.otherIncome).where(where);
      else
        await tx
          .insert(schema.otherIncome)
          .values({ versionId, buCode, propertyId, scope: c.scope, account: c.account, period: c.period, amount: c.amount, updatedBy: user.id })
          .onConflictDoUpdate({
            target: [schema.otherIncome.versionId, schema.otherIncome.scope, schema.otherIncome.account, schema.otherIncome.period],
            set: { amount: c.amount, updatedAt: new Date(), updatedBy: user.id },
          });
      await tx.insert(schema.auditLog).values({
        userId: user.id,
        versionId,
        propertyId,
        entity: 'other_income',
        entityId: `${c.scope}|${c.account}|${c.period}`,
        action: 'update',
        changes: { from: before?.amount ?? null, to: c.amount },
      });
      return true;
    });
    if (written) saved++;
  }
  return { saved, errors };
}
