// FM cost actuals from the GL (Account Analysis Report, ledger MJN HOLDING), read with the other income
// upload: maintenance and renewal works 627xx and capex items 117xx, by building, work type (cost centre
// segment, M01–R04) and element (the last two digits of the account), per month.
// - 627xx: debit − credit (credits are reversals).
// - 117xx: debits on building lines only. Credits there, and the company-level lines, are transfers to
//   fixed assets when an item is capitalised, not lower spending.
// An import replaces the FM actuals of the months the report covers.
import { and, gte, lte } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;
import { elementOfGl, isWorkType } from '@/lib/budget/fm-types';
import { glSegments, type GlScan } from './gl-analysis';
import { propertyKey } from './tenant-lease';

export const FM_LEDGER = 'MJN HOLDING';
export const isFmAccount = (account: string) => /^(627|117)\d{2}$/.test(glSegments(account).natural);

export interface FmActual {
  company: string;
  propertyId: number | null;
  /** M01–R04, or the cost centre as booked when it is not a work type (e.g. 000) */
  workType: string;
  element: string;
  month: string;
  amount: number;
}
export interface FmActualsPreview {
  from: string;
  to: string;
  rows: number;
  /** year → maintenance (627xx) and capex (117xx) */
  byYear: { year: string; maintenance: number; capex: number }[];
  /** building codes in the GL that are not in the budget */
  unmatched: { segment: string; amount: number }[];
  /** 627xx booked without a work type */
  noWorkType: number;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monthOf = (p: string | null) => {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(p?.trim() ?? '');
  return m ? `20${m[2]}-${String(MON.indexOf(m[1].toUpperCase()) + 1).padStart(2, '0')}` : null;
};

export async function planFmActuals(scan: GlScan): Promise<{ rows: FmActual[]; preview: FmActualsPreview } | null> {
  if (scan.ledger?.trim().toUpperCase() !== FM_LEDGER) return null;
  const from = monthOf(scan.periodFrom);
  const to = monthOf(scan.periodTo);
  if (!from || !to) return null;
  const props = await db.select().from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const agg = new Map<string, FmActual>();
  const unmatched = new Map<string, number>();
  const years = new Map<string, { year: string; maintenance: number; capex: number }>();
  let noWorkType = 0;
  for (const m of scan.months) {
    if (!isFmAccount(m.account)) continue;
    const g = glSegments(m.account);
    const capex = g.natural.startsWith('117');
    const building = g.property && g.property !== '000000';
    if (capex && !building) continue;
    const amount = capex ? m.debit : m.debit - m.credit;
    if (!amount) continue;
    const prop = building ? byKey.get(propertyKey(g.property)) : undefined;
    if (building && !prop) unmatched.set(g.property, (unmatched.get(g.property) ?? 0) + amount);
    const workType = isWorkType(g.costCentre) ? g.costCentre : g.costCentre || '000';
    if (!capex && !isWorkType(g.costCentre)) noWorkType += amount;
    const row = { company: g.company, propertyId: prop?.id ?? null, workType, element: elementOfGl(g.natural), month: m.month };
    const k = `${row.company}|${row.propertyId}|${row.workType}|${row.element}|${row.month}`;
    const e = agg.get(k) ?? { ...row, amount: 0 };
    e.amount += amount;
    agg.set(k, e);
    const y = years.get(m.month.slice(0, 4)) ?? { year: m.month.slice(0, 4), maintenance: 0, capex: 0 };
    y[capex ? 'capex' : 'maintenance'] += amount;
    years.set(y.year, y);
  }
  const rows = [...agg.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 })).filter((r) => r.amount !== 0);
  const r0 = (n: number) => Math.round(n);
  return {
    rows,
    preview: {
      from,
      to,
      rows: rows.length,
      byYear: [...years.values()].sort((a, b) => a.year.localeCompare(b.year)).map((y) => ({ ...y, maintenance: r0(y.maintenance), capex: r0(y.capex) })),
      unmatched: [...unmatched].map(([segment, amount]) => ({ segment, amount: r0(amount) })).sort((a, b) => b.amount - a.amount),
      noWorkType: r0(noWorkType),
    },
  };
}

/** Replaces the FM actuals of the months `preview` covers. */
export async function applyFmActuals(rows: FmActual[], preview: FmActualsPreview, userId: number | null, file: string | null, on: Tx = db) {
  const run = async (tx: Tx) => {
    await tx.delete(schema.fmActuals).where(and(gte(schema.fmActuals.month, preview.from), lte(schema.fmActuals.month, preview.to)));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.fmActuals).values(rows.slice(i, i + 500));
    await tx.insert(schema.auditLog).values({ userId, entity: 'gl_import', action: 'fm_actuals', changes: { file, from: preview.from, to: preview.to, rows: rows.length, byYear: preview.byYear } });
  };
  if (on === db) await db.transaction(run);
  else await run(on);
}
